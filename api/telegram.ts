/**
 * Telegram nutrition bot.
 *
 * POST /api/telegram  — webhook from Telegram (checked by secret header).
 * GET  /api/telegram?setup=<TELEGRAM_WEBHOOK_SECRET> — registers the webhook.
 *
 * Flow: photo / voice / text → Gemini estimate → draft with ✅/❌ buttons →
 * a text reply while a draft is open corrects it → ✅ stores the meal.
 * The first chat to send /start owns the bot; everyone else is ignored.
 */
import { estimateMeal } from '../src/gemini';
import {
  claimOwnerChat,
  clearDraft,
  commitDraft,
  Draft,
  getOwnerChat,
  loadDraft,
  localDate,
  mealsOn,
  normalizeDraft,
  saveDraft,
  targetFor,
  totals,
  undoLast
} from '../src/meals';
import { header, issuerOf, param, Req, Res } from './_http';
import { waitUntil } from '@vercel/functions';

// Tolerate pasted quotes, spaces or a leading "bot" from the BotFather message.
const token = () =>
  (process.env.TELEGRAM_BOT_TOKEN ?? '').trim().replace(/^["']|["']$/g, '').replace(/^bot(?=\d)/, '').replace(/\s+/g, '');
const secret = () => process.env.TELEGRAM_WEBHOOK_SECRET?.trim() ?? '';

async function tg(method: string, payload: Record<string, unknown>): Promise<any> {
  const res = await fetch(`https://api.telegram.org/bot${token()}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return res.json().catch(() => ({}));
}

async function download(fileId: string): Promise<{ data: string; path: string }> {
  const info = await tg('getFile', { file_id: fileId });
  const path = info?.result?.file_path;
  if (!path) throw new Error('Não consegui baixar o arquivo do Telegram.');
  const res = await fetch(`https://api.telegram.org/file/bot${token()}/${path}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return { data: buf.toString('base64'), path };
}

const fmt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 0 });

function draftText(d: Draft): string {
  const lines = [
    `🍽 ${cap(d.tipo)} — ${d.descricao}`,
    '',
    ...d.itens.map((i) => `• ${i.nome}${i.quantidade ? ` (${i.quantidade})` : ''}: ${fmt(i.kcal)} kcal`),
    '',
    `Total: ${fmt(d.kcal)} kcal · P ${fmt(d.proteina_g)} g · C ${fmt(d.carbo_g)} g · G ${fmt(d.gordura_g)} g`
  ];
  if (d.confianca) lines.push(`Confiança: ${d.confianca}`);
  if (d.pergunta) lines.push('', `❓ ${d.pergunta}`);
  lines.push('', 'Para corrigir, é só responder (ex.: "eram 2 ovos e 150 g de arroz").');
  return lines.join('\n');
}

function goalLine(date: string, kcal: number, prot: number): string {
  const g = targetFor(date);
  const left = g.meta_kcal - kcal;
  const pLeft = Math.max(0, g.meta_proteina_g - prot);
  return `🎯 ${g.tipo_dia}: meta ${fmt(g.meta_kcal)} kcal · ${left >= 0 ? `faltam ${fmt(left)}` : `${fmt(-left)} acima`} kcal · proteína: faltam ${fmt(pLeft)} g`;
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

const BUTTONS = {
  inline_keyboard: [
    [
      { text: '✅ Salvar', callback_data: 'save' },
      { text: '❌ Descartar', callback_data: 'drop' }
    ]
  ]
};

async function dayReport(chat: string): Promise<void> {
  const date = localDate();
  const meals = await mealsOn(date);
  if (!meals.length) {
    await tg('sendMessage', { chat_id: chat, text: `Nenhuma refeição registrada hoje.\n${goalLine(date, 0, 0)}` });
    return;
  }
  const t = totals(meals);
  const text = [
    `📊 Hoje (${date.slice(8, 10)}/${date.slice(5, 7)})`,
    ...meals.map((m) => `• ${m.time} ${cap(m.tipo)}: ${m.descricao} — ${fmt(m.kcal)} kcal`),
    '',
    `Total: ${fmt(t.kcal)} kcal · P ${fmt(t.proteina_g)} g · C ${fmt(t.carbo_g)} g · G ${fmt(t.gordura_g)} g`,
    goalLine(date, t.kcal, t.proteina_g)
  ].join('\n');
  await tg('sendMessage', { chat_id: chat, text });
}

async function handleMessage(msg: any): Promise<void> {
  const chat = String(msg.chat?.id ?? '');
  if (!chat) return;
  const text: string = (msg.text ?? msg.caption ?? '').trim();

  let owner = await getOwnerChat();
  if (!owner && text.startsWith('/start')) {
    if (await claimOwnerChat(chat)) owner = chat;
  }
  if (owner !== chat) {
    await tg('sendMessage', { chat_id: chat, text: 'Este bot é privado.' });
    return;
  }

  if (text.startsWith('/start') || text.startsWith('/ajuda')) {
    await tg('sendMessage', {
      chat_id: chat,
      text: [
        'Oi, Pedro! Manda a foto do prato, um áudio ou um texto ("cuscuz com 2 ovos") que eu estimo as calorias.',
        '',
        'Comandos:',
        '/hoje — refeições e totais de hoje',
        '/desfazer — apaga a última refeição salva hoje'
      ].join('\n')
    });
    return;
  }
  if (text.startsWith('/hoje')) return dayReport(chat);
  if (text.startsWith('/desfazer')) {
    const m = await undoLast();
    await tg('sendMessage', {
      chat_id: chat,
      text: m ? `Apaguei: ${m.time} ${m.descricao} (${fmt(m.kcal)} kcal).` : 'Nada para apagar hoje.'
    });
    return;
  }

  await tg('sendChatAction', { chat_id: chat, action: 'typing' });

  try {
    let raw: any;
    let fonte: Draft['fonte'] = 'texto';
    const sizes: any[] = Array.isArray(msg.photo) ? msg.photo : [];
    // Mid-size (~800px) is plenty to recognise food and much faster than full size.
    const photo = sizes.length ? (sizes.filter((p) => Math.max(p.width, p.height) <= 1280).pop() ?? sizes[0]) : null;
    const imageDoc = msg.document?.mime_type?.startsWith('image/') ? msg.document : null;
    const voice = msg.voice ?? msg.audio ?? null;

    if (photo || imageDoc) {
      const f = await download((photo ?? imageDoc).file_id);
      raw = await estimateMeal({ imageBase64: f.data, imageMime: imageDoc?.mime_type ?? 'image/jpeg', text: text || undefined });
      fonte = 'foto';
    } else if (voice) {
      const f = await download(voice.file_id);
      raw = await estimateMeal({ audioBase64: f.data, audioMime: voice.mime_type ?? 'audio/ogg' });
      fonte = 'audio';
    } else if (text) {
      const previous = await loadDraft(chat);
      raw = await estimateMeal({ text, previous: previous ?? undefined });
      fonte = previous?.fonte ?? 'texto';
    } else {
      return;
    }

    const draft = normalizeDraft(raw, fonte);
    if (!draft.itens.length) {
      await tg('sendMessage', { chat_id: chat, text: 'Não identifiquei comida aqui. Tenta outra foto ou descreve em texto?' });
      return;
    }
    await saveDraft(chat, draft);
    await tg('sendMessage', { chat_id: chat, text: draftText(draft), reply_markup: BUTTONS });
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    await tg('sendMessage', { chat_id: chat, text: `Deu erro ao analisar: ${m}` });
  }
}

async function handleCallback(cb: any): Promise<void> {
  const chat = String(cb.message?.chat?.id ?? '');
  const owner = await getOwnerChat();
  await tg('answerCallbackQuery', { callback_query_id: cb.id });
  if (!chat || owner !== chat) return;

  const draft = await loadDraft(chat);
  if (!draft) {
    await tg('sendMessage', { chat_id: chat, text: 'Essa estimativa expirou. Manda de novo?' });
    return;
  }
  if (cb.data === 'save') {
    const meal = await commitDraft(draft);
    await clearDraft(chat);
    const t = totals(await mealsOn(meal.date));
    await tg('editMessageReplyMarkup', { chat_id: chat, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } });
    await tg('sendMessage', {
      chat_id: chat,
      text: `✅ Salvo: ${cap(meal.tipo)} ${meal.time} — ${fmt(meal.kcal)} kcal.\nHoje: ${fmt(t.kcal)} kcal · P ${fmt(t.proteina_g)} g em ${t.refeicoes} refeição(ões).\n${goalLine(meal.date, t.kcal, t.proteina_g)}`
    });
  } else {
    await clearDraft(chat);
    await tg('editMessageReplyMarkup', { chat_id: chat, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } });
    await tg('sendMessage', { chat_id: chat, text: 'Descartado.' });
  }
}

export default async function handler(req: Req, res: Res) {
  if (!token() || !secret()) return res.status(503).json({ error: 'Bot não configurado.' });

  if (req.method === 'GET' && param(req, 'test') === secret()) {
    const t0 = Date.now();
    try {
      const raw = await estimateMeal({ text: 'cuscuz com 2 ovos mexidos e café preto' });
      return res.status(200).json({ ms: Date.now() - t0, draft: normalizeDraft(raw, 'texto') });
    } catch (err) {
      return res.status(200).json({ ms: Date.now() - t0, error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (req.method === 'GET' && param(req, 'models') === secret()) {
    // Which Gemini models this key can call (names only, no secrets).
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
      headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY?.trim() ?? '' }
    });
    const b: any = await r.json().catch(() => ({}));
    const names = (b.models ?? [])
      .filter((m: any) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
      .map((m: any) => String(m.name).replace('models/', ''));
    return res.status(200).json({ status: r.status, models: names, error: b.error?.message });
  }

  if (req.method === 'GET') {
    if (param(req, 'setup') !== secret()) return res.status(403).json({ error: 'forbidden' });
    const url = `${issuerOf(req)}/api/telegram`;
    const result = await tg('setWebhook', {
      url,
      secret_token: secret(),
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: true
    });
    await tg('setMyCommands', {
      commands: [
        { command: 'hoje', description: 'Refeições e totais de hoje' },
        { command: 'desfazer', description: 'Apaga a última refeição de hoje' },
        { command: 'ajuda', description: 'Como usar' }
      ]
    });
    const t = token();
    return res.status(200).json({ webhook: url, telegram: result, token_shape: { length: t.length, looks_valid: /^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(t) } });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  if (header(req, 'x-telegram-bot-api-secret-token') !== secret()) {
    return res.status(403).json({ error: 'forbidden' });
  }

  const update: any = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  // Answer Telegram at once and keep working in the background: a slow model
  // call must never hold the webhook, or Telegram queues every later message.
  const work = (async () => {
    try {
      if (update?.callback_query) await handleCallback(update.callback_query);
      else if (update?.message) await handleMessage(update.message);
    } catch (err) {
      console.error('telegram update failed', err);
    }
  })();
  waitUntil(work);
  return res.status(200).json({ ok: true });
}
