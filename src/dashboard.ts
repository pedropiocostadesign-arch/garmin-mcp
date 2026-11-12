/**
 * The Performance OS dashboard, served on its own at /dashboard.
 *
 * The page is the same file the Claude dashboard runs (dashboard/index.html);
 * dashboard/shim.js stands in for Claude's runtime. Its data comes from the
 * very tools the Claude connector exposes, called in-process for the signed-in
 * person, so both copies always show the same numbers.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from './create-server';
import { GarminSession } from './garmin';
import { requireSecret, signJwt, verifyJwt } from './oauth';

export const DASH_COOKIE = 'po_session';
export const DASH_TTL = 30 * 24 * 3600;
const audience = (issuer: string) => `${issuer}/dashboard`;

/** The datasets the page declares, each one tool call as the Claude copy stores it. */
export const DATASETS: Record<string, { tool: string; args: Record<string, unknown> }> = {
  activities: { tool: 'list_activities', args: { limit: 50 } },
  plan: { tool: 'get_training_plans_and_workouts', args: { limit: 1 } },
  sleep: { tool: 'get_sleep_data', args: {} },
  hrv: { tool: 'get_hrv_data', args: {} },
  bb: { tool: 'get_body_battery', args: {} },
  status: { tool: 'get_training_status', args: {} },
  daily: { tool: 'get_daily_summary', args: {} },
  nutri: { tool: 'get_nutrition_days', args: {} },
  meals: { tool: 'get_meals', args: {} }
};

export function sessionCookie(sub: string, issuer: string): string {
  const now = Math.floor(Date.now() / 1000);
  const jwt = signJwt({ sub, iss: issuer, aud: audience(issuer), exp: now + DASH_TTL }, requireSecret('JWT_SECRET'));
  return `${DASH_COOKIE}=${jwt}; Path=/; Max-Age=${DASH_TTL}; HttpOnly; Secure; SameSite=Lax`;
}

export const clearCookie = () => `${DASH_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

/** The signed-in user id, or null when the cookie is missing, forged or expired. */
export function sessionUser(cookieHeader: string | undefined, issuer: string): string | null {
  const raw = (cookieHeader ?? '')
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${DASH_COOKIE}=`));
  if (!raw) return null;
  let secret: string;
  try {
    secret = requireSecret('JWT_SECRET');
  } catch {
    return null;
  }
  const claims = verifyJwt(raw.slice(DASH_COOKIE.length + 1), secret, { iss: issuer, aud: audience(issuer) });
  return claims?.sub ?? null;
}

let cachedPage: string | null = null;

/** Shell + avatar + runtime + the shared page, assembled once per instance. */
export function dashboardPage(): string {
  if (cachedPage) return cachedPage;
  const dir = join(process.cwd(), 'dashboard');
  const read = (f: string) => readFileSync(join(dir, f), 'utf8');
  const body = read('index.html').replace(/<link rel="stylesheet" href="avatar\.css">\s*/, '');
  // Function replacers: the page's scripts are full of `$` that a string
  // replacement would read as capture-group patterns.
  cachedPage = read('shell.html')
    .replace('{{AVATAR_CSS}}', () => read('avatar.css'))
    .replace('{{SHIM}}', () => read('shim.js'))
    .replace('{{BODY}}', () => body);
  return cachedPage;
}

type Answer = { status: 'ok'; answer: unknown } | { status: 'error'; message: string };

/** Runs every dataset's tool for one user, in parallel, through a private MCP server. */
export async function loadDatasets(userId: string): Promise<Record<string, Answer>> {
  const server = createServer(GarminSession.forUser(userId));
  const client = new Client({ name: 'performance-os-dashboard', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  try {
    const entries = await Promise.all(
      Object.entries(DATASETS).map(async ([id, { tool, args }]): Promise<[string, Answer]> => {
        try {
          const out: any = await client.callTool({ name: tool, arguments: args });
          const text = (out?.content ?? []).find((c: any) => c?.type === 'text')?.text ?? '';
          if (out?.isError) return [id, { status: 'error', message: text || 'Tool failed.' }];
          try {
            return [id, { status: 'ok', answer: JSON.parse(text) }];
          } catch {
            return [id, { status: 'ok', answer: text }];
          }
        } catch (err) {
          return [id, { status: 'error', message: err instanceof Error ? err.message : 'Tool failed.' }];
        }
      })
    );
    return Object.fromEntries(entries);
  } finally {
    await client.close().catch(() => {});
    await server.close().catch(() => {});
  }
}
