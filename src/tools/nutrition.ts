import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { datesBetween, mealsOn, targetFor, totals } from '../meals';
import { dateSchema, problem, text, today } from './common';

/**
 * Meals logged through the Telegram nutrition bot (photo/voice/text estimated
 * by Gemini and confirmed by the athlete). Read-only from MCP.
 */
export function registerNutritionTools(server: McpServer): void {
  server.registerTool(
    'get_meals',
    {
      description:
        'Meals logged via the Telegram nutrition bot between two local dates (default today): one row per meal with time, type, description, calories, protein, carbs and fat. Estimates, not lab values.',
      inputSchema: { start_date: dateSchema.optional(), end_date: dateSchema.optional() },
      annotations: { readOnlyHint: true }
    },
    (async ({ start_date, end_date }: { start_date?: string; end_date?: string }) => {
      try {
        const start = start_date ?? today();
        const end = end_date ?? start;
        const rows = [];
        for (const date of datesBetween(start, end)) {
          for (const m of await mealsOn(date)) {
            rows.push({
              id: m.id, date: m.date, time: m.time, tipo: m.tipo, descricao: m.descricao,
              kcal: m.kcal, proteina_g: m.proteina_g, carbo_g: m.carbo_g, gordura_g: m.gordura_g,
              itens: m.itens.map((i) => `${i.nome}${i.quantidade ? ` (${i.quantidade})` : ''}`).join('; '),
              fonte: m.fonte
            });
          }
        }
        return text(rows);
      } catch (err) {
        return problem(`Could not read meals: ${err instanceof Error ? err.message : String(err)}`);
      }
    }) as any
  );

  server.registerTool(
    'get_nutrition_days',
    {
      description:
        'Daily nutrition totals (meals, kcal, protein, carbs, fat) from the Telegram nutrition bot, with that day\'s target by training-day type, one row per local day between two dates (default: last 7 days).',
      inputSchema: { start_date: dateSchema.optional(), end_date: dateSchema.optional() },
      annotations: { readOnlyHint: true }
    },
    (async ({ start_date, end_date }: { start_date?: string; end_date?: string }) => {
      try {
        const end = end_date ?? today();
        const start = start_date ?? new Date(new Date(`${end}T12:00:00Z`).getTime() - 6 * 864e5).toISOString().slice(0, 10);
        const rows = [];
        for (const date of datesBetween(start, end)) rows.push({ date, ...totals(await mealsOn(date)), ...targetFor(date) });
        return text(rows);
      } catch (err) {
        return problem(`Could not read nutrition: ${err instanceof Error ? err.message : String(err)}`);
      }
    }) as any
  );
}
