/**
 * Food estimation with Gemini (free tier). Turns a photo, a voice note or a
 * line of text into an itemized meal with calories and macros.
 */

// Fast, free-tier models first; the next one is tried when a model is busy,
// retired or slow. GEMINI_MODEL (comma-separated) overrides the list.
const MODELS = (process.env.GEMINI_MODEL?.trim() ||
  'gemini-3.5-flash-lite,gemini-flash-lite-latest,gemini-3.1-flash-lite,gemini-3.7-flash,gemini-2.5-flash-lite')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);

const SYSTEM = `Você é um nutricionista esportivo que estima refeições a partir de fotos, áudios ou texto, para um triatleta brasileiro.
Regras:
- Identifique cada alimento e estime a porção em medidas caseiras brasileiras (colher, concha, unidade, fatia) e em gramas.
- Use valores nutricionais típicos de comida brasileira (TACO quando fizer sentido): cuscuz, tapioca, pão francês, arroz, feijão, etc.
- Se o usuário disser quantidades, use as dele em vez das suas estimativas.
- Seja realista: na dúvida sobre óleo/azeite de preparo, inclua uma quantidade moderada como item separado.
- "tipo" é um de: café da manhã, almoço, lanche, jantar, pré-treino, pós-treino, ceia. Use o que o usuário disser; se não disser, deixe vazio.
- "confianca": alta, media ou baixa.
- "pergunta": uma pergunta curta só se uma informação mudar muito o total (ex.: tamanho da porção); senão null.
- Responda apenas o JSON.`;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    tipo: { type: 'STRING' },
    descricao: { type: 'STRING' },
    itens: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          nome: { type: 'STRING' },
          quantidade: { type: 'STRING' },
          kcal: { type: 'NUMBER' },
          proteina_g: { type: 'NUMBER' },
          carbo_g: { type: 'NUMBER' },
          gordura_g: { type: 'NUMBER' }
        },
        required: ['nome', 'kcal', 'proteina_g', 'carbo_g', 'gordura_g']
      }
    },
    confianca: { type: 'STRING' },
    pergunta: { type: 'STRING', nullable: true }
  },
  required: ['descricao', 'itens']
};

type Part = { text: string } | { inline_data: { mime_type: string; data: string } };

export async function estimateMeal(input: {
  imageBase64?: string;
  imageMime?: string;
  audioBase64?: string;
  audioMime?: string;
  text?: string;
  previous?: unknown;
}): Promise<any> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error('GEMINI_API_KEY não configurada.');

  const parts: Part[] = [];
  if (input.previous) {
    parts.push({
      text: `Estimativa anterior (JSON):\n${JSON.stringify(input.previous)}\n\nO usuário corrigiu com a mensagem abaixo. Devolva a estimativa completa atualizada.`
    });
  }
  if (input.imageBase64) {
    parts.push({ inline_data: { mime_type: input.imageMime || 'image/jpeg', data: input.imageBase64 } });
  }
  if (input.audioBase64) {
    parts.push({ inline_data: { mime_type: input.audioMime || 'audio/ogg', data: input.audioBase64 } });
    parts.push({ text: 'O áudio descreve o que foi comido.' });
  }
  if (input.text) parts.push({ text: input.text });
  if (!parts.length) throw new Error('Nada para analisar.');

  const call = (model: string, thinking: boolean) =>
    fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      signal: AbortSignal.timeout(35_000),
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature: 0.2,
          response_mime_type: 'application/json',
          response_schema: SCHEMA,
          // Food estimates need little reasoning; keep the answer fast.
          ...(thinking ? { thinking_config: { thinking_level: 'low' } } : {})
        }
      })
    });

  const failures: string[] = [];
  let body: any = null;
  for (const model of MODELS) {
    try {
      let res = await call(model, true);
      body = await res.json().catch(() => ({}));
      if (res.status === 400 && /thinking/i.test(String(body?.error?.message ?? ''))) {
        res = await call(model, false);
        body = await res.json().catch(() => ({}));
      }
      if (res.ok) break;
      failures.push(`${model}: ${res.status} ${String(body?.error?.message ?? '').slice(0, 80)}`);
      // Busy, rate-limited, retired or broken: try the next model.
      if (![404, 429, 500, 502, 503, 504].includes(res.status)) {
        throw new Error(`Gemini ${res.status}: ${body?.error?.message ?? 'erro desconhecido'}`);
      }
      body = null;
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Gemini ')) throw err;
      failures.push(`${model}: ${err instanceof Error ? err.message : String(err)}`);
      body = null;
    }
  }
  if (!body) throw new Error(`Todos os modelos falharam — ${failures.join(' | ')}`);
  const textOut = body?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('') ?? '';
  try {
    return JSON.parse(textOut);
  } catch {
    throw new Error('Não consegui ler a resposta do Gemini.');
  }
}
