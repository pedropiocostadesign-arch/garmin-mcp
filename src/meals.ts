/**
 * Meal log for the nutrition bot: drafts from photos, voice or text are
 * estimated by Gemini, confirmed in Telegram, then stored per local day.
 *
 * Single-athlete by design: the bot is locked to one Telegram chat, and the
 * hosted MCP is locked to one Google account, so meals are not keyed by user.
 */
import { requireRedis } from './db';
import { daysAgo, localDate, TIME_ZONE } from './tools/common';

export type MealItem = {
  nome: string;
  quantidade?: string;
  kcal: number;
  proteina_g: number;
  carbo_g: number;
  gordura_g: number;
};

export type Meal = {
  id: string;
  date: string; // local YYYY-MM-DD
  time: string; // local HH:MM
  tipo: string;
  descricao: string;
  itens: MealItem[];
  kcal: number;
  proteina_g: number;
  carbo_g: number;
  gordura_g: number;
  confianca?: string;
  fonte: 'foto' | 'audio' | 'texto';
};

export type Draft = Omit<Meal, 'id' | 'date' | 'time'> & { pergunta?: string | null };

const DAY_KEY = (date: string) => `nutri:day:${date}`;
const PENDING_KEY = (chat: string | number) => `nutri:pending:${chat}`;
const OWNER_KEY = 'nutri:owner_chat';

const r1 = (n: unknown) => Math.round((Number(n) || 0) * 10) / 10;

export function localTime(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(at);
}

/** Recomputes totals from the items so the numbers always add up. */
export function normalizeDraft(raw: any, fonte: Draft['fonte']): Draft {
  const itens: MealItem[] = (Array.isArray(raw?.itens) ? raw.itens : []).map((i: any) => ({
    nome: String(i?.nome ?? 'item'),
    quantidade: i?.quantidade ? String(i.quantidade) : undefined,
    kcal: Math.round(Number(i?.kcal) || 0),
    proteina_g: r1(i?.proteina_g),
    carbo_g: r1(i?.carbo_g),
    gordura_g: r1(i?.gordura_g)
  }));
  const sum = (k: keyof MealItem) => itens.reduce((s, i) => s + (Number(i[k]) || 0), 0);
  return {
    tipo: String(raw?.tipo || guessMealType()),
    descricao: String(raw?.descricao || itens.map((i) => i.nome).join(', ') || 'Refeição'),
    itens,
    kcal: Math.round(sum('kcal')),
    proteina_g: r1(sum('proteina_g')),
    carbo_g: r1(sum('carbo_g')),
    gordura_g: r1(sum('gordura_g')),
    confianca: raw?.confianca ? String(raw.confianca) : undefined,
    pergunta: raw?.pergunta ? String(raw.pergunta) : null,
    fonte
  };
}

export function guessMealType(at: Date = new Date()): string {
  const h = Number(localTime(at).slice(0, 2));
  if (h < 10) return 'café da manhã';
  if (h < 15) return 'almoço';
  if (h < 19) return 'lanche';
  return 'jantar';
}

/* ---------- owner lock ---------- */

export async function getOwnerChat(): Promise<string | null> {
  const v = await requireRedis().get<string | number>(OWNER_KEY);
  return v == null ? null : String(v);
}

export async function claimOwnerChat(chat: string): Promise<boolean> {
  // NX: only the first /start ever claims the bot.
  const ok = await requireRedis().set(OWNER_KEY, chat, { nx: true });
  return ok === 'OK';
}

/* ---------- drafts ---------- */

export async function saveDraft(chat: string | number, draft: Draft): Promise<void> {
  await requireRedis().set(PENDING_KEY(chat), JSON.stringify(draft), { ex: 6 * 3600 });
}

export async function loadDraft(chat: string | number): Promise<Draft | null> {
  const v = await requireRedis().get<string | Draft>(PENDING_KEY(chat));
  if (!v) return null;
  return typeof v === 'string' ? (JSON.parse(v) as Draft) : v;
}

export async function clearDraft(chat: string | number): Promise<void> {
  await requireRedis().del(PENDING_KEY(chat));
}

/* ---------- meals ---------- */

export async function commitDraft(draft: Draft): Promise<Meal> {
  const now = new Date();
  const { pergunta, ...rest } = draft;
  const meal: Meal = {
    ...rest,
    id: `${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    date: localDate(now),
    time: localTime(now)
  };
  await requireRedis().rpush(DAY_KEY(meal.date), JSON.stringify(meal));
  return meal;
}

export async function mealsOn(date: string): Promise<Meal[]> {
  const list = await requireRedis().lrange<string | Meal>(DAY_KEY(date), 0, -1);
  return list.map((v) => (typeof v === 'string' ? (JSON.parse(v) as Meal) : v));
}

export async function undoLast(date: string = localDate()): Promise<Meal | null> {
  const v = await requireRedis().rpop<string | Meal>(DAY_KEY(date));
  if (!v) return null;
  return typeof v === 'string' ? (JSON.parse(v) as Meal) : v;
}

export function totals(meals: Meal[]) {
  const s = (k: 'kcal' | 'proteina_g' | 'carbo_g' | 'gordura_g') =>
    r1(meals.reduce((a, m) => a + (Number(m[k]) || 0), 0));
  return { refeicoes: meals.length, kcal: Math.round(s('kcal')), proteina_g: s('proteina_g'), carbo_g: s('carbo_g'), gordura_g: s('gordura_g') };
}

export function datesBetween(start: string, end: string): string[] {
  const out: string[] = [];
  const d = new Date(`${start}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);
  while (d <= last && out.length < 92) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export { daysAgo, localDate };

/* ---------- daily targets (deficit of ~500 kcal, set 2026-11-11) ---------- */

export type Target = { tipo_dia: string; meta_kcal: number; meta_proteina_g: number; meta_carbo_g: number; meta_gordura_g: number };

/**
 * The athlete's weekly pattern: Mon–Thu double sessions, Fri regenerative run,
 * Sat long ride or duathlon, Sun off. Protein and fat stay fixed; carbs move
 * with training load.
 */
export function targetFor(date: string): Target {
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  if (dow === 0) return { tipo_dia: 'Day off', meta_kcal: 1950, meta_proteina_g: 165, meta_carbo_g: 165, meta_gordura_g: 70 };
  if (dow === 5) return { tipo_dia: 'Regenerativo', meta_kcal: 2350, meta_proteina_g: 165, meta_carbo_g: 270, meta_gordura_g: 70 };
  if (dow === 6) return { tipo_dia: 'Longo / duathlon', meta_kcal: 3000, meta_proteina_g: 165, meta_carbo_g: 430, meta_gordura_g: 70 };
  return { tipo_dia: 'Treino duplo', meta_kcal: 2600, meta_proteina_g: 165, meta_carbo_g: 330, meta_gordura_g: 70 };
}
