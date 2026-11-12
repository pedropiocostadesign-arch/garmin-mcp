window.TP = (function () {
  const RACE = '2026-11-28';
  const tz = 'America/Sao_Paulo';
  const localISO = (d) => new Intl.DateTimeFormat('en-CA', {timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'}).format(d || new Date());
  const sportOf = (s) => {
    s = String(s || '').toLowerCase();
    if (/swim|nata/.test(s)) return 'natacao';
    if (/cycl|bik|ride|ciclis|pedal/.test(s)) return 'bike';
    if (/run|corrid|trail|track/.test(s)) return 'corrida';
    if (/strength|for[cç]a|funcional|muscul/.test(s)) return 'forca';
    if (/duath|duat|brick|transi/.test(s)) return 'duathlon';
    return 'outro';
  };
  const names = {natacao: 'Natação', bike: 'Bike', corrida: 'Corrida', forca: 'Força', duathlon: 'Duathlon', outro: 'Outro', todos: 'Todos'};
  const fmt = (n, d = 0) => (n == null || n === '' || isNaN(+n)) ? '—' : (+n).toLocaleString('pt-BR', {minimumFractionDigits: d, maximumFractionDigits: d});
  const row0 = (id) => { const r = dash.data(id); return r.status === 'ok' && r.data && r.data[0] ? r.data[0] : null; };
  const today = (id) => { const r = dash.data(id); if (r.status !== 'ok' || !Array.isArray(r.data) || !r.data.length) return null; const t = localISO(); const i = r.data.findIndex((x) => x.date === t); const k = i >= 0 ? i : r.data.length - 1; return {row: r.data[k], i: k}; };
  const pt = {POOR: 'Ruim', FAIR: 'Razoável', GOOD: 'Bom', EXCELLENT: 'Excelente', BALANCED: 'Equilibrado', UNBALANCED: 'Desequilibrado', LOW: 'Baixo', NONE: 'Calibrando'};
  const status = {Productive: 'Produtivo', Unproductive: 'Improdutivo', Maintaining: 'Mantendo', Recovery: 'Recuperação', Peaking: 'Pico', Overreaching: 'Sobrecarga', Detraining: 'Destreino', Strained: 'Sob tensão', 'No Status': 'Sem status'};
  const balance = {AEROBIC_LOW_SHORTAGE: 'Falta volume aeróbico leve (Z1–Z2)', AEROBIC_HIGH_SHORTAGE: 'Falta volume aeróbico intenso', ANAEROBIC_SHORTAGE: 'Falta estímulo anaeróbico', BALANCED: 'Distribuição de carga equilibrada'};
  return {RACE, localISO, sportOf, names, fmt, row0, today, pt, status, balance, sport: 'todos'};
})();

dash.loader('sleep', {
  description: 'Registro único do sono; o hipnograma (fases minuto a minuto) vira texto JSON numa coluna.',
  fn: ({answer}) => { if (!answer || typeof answer !== 'object' || Array.isArray(answer)) return []; const {stages, ...rest} = answer; return [{...rest, stages: JSON.stringify(stages || [])}]; }
});
['hrv', 'daily', 'status'].forEach((id) => dash.loader(id, {
  description: 'A resposta da Garmin é um único registro; vira uma linha.',
  fn: ({answer}) => (answer && typeof answer === 'object' && !Array.isArray(answer)) ? [answer] : []
}));
dash.loader('bb', {
  description: 'Registro único do Body Battery, sem a lista de eventos.',
  fn: ({answer}) => { if (!answer || typeof answer !== 'object') return []; const {events, ...rest} = answer; return [rest]; }
});
dash.loader('plan', {
  description: 'Só os treinos agendados no calendário Garmin (vindos do Treinus).',
  fn: ({answer}) => ({columns: ['date', 'title'], rows: (answer && answer.scheduled_workouts || []).map((w) => ({date: w.date, title: w.title}))})
});
dash.loader('nutri', {
  description: 'Totais diários do bot com a meta do dia; renomeia kcal para calorias.',
  fn: ({answer}) => ({columns: ['date', 'tipo_dia', 'calorias', 'meta_kcal', 'proteina_g', 'meta_proteina_g', 'carbo_g', 'meta_carbo_g', 'gordura_g', 'meta_gordura_g', 'refeicoes'],
    rows: (Array.isArray(answer) ? answer : []).map((r) => ({date: r.date, tipo_dia: r.tipo_dia, calorias: r.kcal, meta_kcal: r.meta_kcal, proteina_g: r.proteina_g, meta_proteina_g: r.meta_proteina_g, carbo_g: r.carbo_g, meta_carbo_g: r.meta_carbo_g, gordura_g: r.gordura_g, meta_gordura_g: r.meta_gordura_g, refeicoes: r.refeicoes}))})
});
dash.loader('meals', {
  description: 'Uma linha por refeição confirmada hoje no bot.',
  fn: ({answer}) => ({columns: ['id', 'refeicao', 'kcal', 'proteina_g'], rows: (Array.isArray(answer) ? answer : []).map((m) => ({id: m.id, refeicao: m.time + ' · ' + m.tipo + ' — ' + m.descricao, kcal: m.kcal, proteina_g: m.proteina_g}))})
});

dash.calc('weekcal', {
  title: 'Planejado × feito', description: 'Cruza os treinos agendados com as atividades registradas, dia a dia, nesta semana e na próxima.',
  inputs: ['plan', 'activities'],
  fn: (plan, activities) => {
    const iso = (d) => new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'}).format(d);
    const sportOf = (s) => { s = String(s || '').toLowerCase(); if (/swim|nata/.test(s)) return 'natacao'; if (/cycl|bik|ride|ciclis/.test(s)) return 'bike'; if (/run|corrid|trail/.test(s)) return 'corrida'; if (/strength|for[cç]a|funcional/.test(s)) return 'forca'; if (/duath|duat/.test(s)) return 'duathlon'; return 'outro'; };
    const today = iso(new Date());
    const t = new Date(today + 'T12:00:00Z');
    const monday = new Date(t); monday.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
    const rows = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(monday); d.setUTCDate(monday.getUTCDate() + i);
      const date = d.toISOString().slice(0, 10);
      const planned = plan.filter((p) => p.date === date);
      const done = activities.filter((a) => String(a.start_time || '').slice(0, 10) === date);
      const used = new Set();
      const items = planned.map((p) => {
        const sp = sportOf(p.title);
        const idx = done.findIndex((a, j) => !used.has(j) && (sportOf(a.sport) === sp || (sp === 'duathlon' && /corrida|bike/.test(sportOf(a.sport)))));
        if (idx >= 0) used.add(idx);
        return {title: p.title, state: idx >= 0 ? 'done' : (date < today ? 'miss' : 'next')};
      });
      done.forEach((a, j) => { if (!used.has(j)) items.push({title: a.title, state: 'extra'}); });
      rows.push({date, today: date === today, itens: JSON.stringify(items), planejados: planned.length, feitos: items.filter((x) => x.state === 'done').length});
    }
    return rows;
  }
});
dash.calc('weekvol', {
  title: 'Horas na semana por esporte', description: 'Soma a duração das atividades desde segunda-feira, por esporte.',
  inputs: ['activities'],
  fn: (activities) => {
    const today = new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());
    const t = new Date(today + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
    const monday = t.toISOString().slice(0, 10);
    const sportOf = (s) => { s = String(s || '').toLowerCase(); if (/swim/.test(s)) return 'Natação'; if (/cycl|bik|ride/.test(s)) return 'Bike'; if (/run|trail/.test(s)) return 'Corrida'; if (/strength/.test(s)) return 'Força'; return 'Outro'; };
    const mins = (x) => { const p = String(x || '').split(':').map(Number); return p.length === 3 ? p[0] * 60 + p[1] + p[2] / 60 : (p[0] || 0) + (p[1] || 0) / 60; };
    const acc = {Natação: 0, Bike: 0, Corrida: 0, Força: 0};
    activities.filter((a) => String(a.start_time).slice(0, 10) >= monday).forEach((a) => { const k = sportOf(a.sport); acc[k] = (acc[k] || 0) + mins(a.duration); });
    return Object.entries(acc).map(([esporte, m]) => ({esporte, horas: Math.round(m / 6) / 10}));
  }
});
dash.calc('sportstats', {
  title: 'Resumo por esporte (28 dias)', description: 'Sessões, horas, km e FC média dos últimos 28 dias, por esporte e no total.',
  inputs: ['activities'],
  fn: (activities) => {
    const since = new Date(Date.now() - 28 * 864e5).toISOString().slice(0, 10);
    const sportOf = (s) => { s = String(s || '').toLowerCase(); if (/swim/.test(s)) return 'natacao'; if (/cycl|bik|ride/.test(s)) return 'bike'; if (/run|trail/.test(s)) return 'corrida'; if (/strength/.test(s)) return 'forca'; return 'outro'; };
    const mins = (x) => { const p = String(x || '').split(':').map(Number); return p.length === 3 ? p[0] * 60 + p[1] + p[2] / 60 : (p[0] || 0) + (p[1] || 0) / 60; };
    const recent = activities.filter((a) => String(a.start_time).slice(0, 10) >= since);
    return ['todos', 'natacao', 'bike', 'corrida', 'forca'].map((esporte) => {
      const xs = recent.filter((a) => esporte === 'todos' || sportOf(a.sport) === esporte);
      const hr = xs.filter((a) => +a.avg_heart_rate_bpm > 0);
      return {esporte, sessoes: xs.length, horas: Math.round(xs.reduce((s, a) => s + mins(a.duration), 0) / 6) / 10, km: Math.round(xs.reduce((s, a) => s + (+a.distance_km || 0), 0) * 10) / 10, fc_media: hr.length ? Math.round(hr.reduce((s, a) => s + +a.avg_heart_rate_bpm, 0) / hr.length) : null};
    });
  }
});
dash.calc('weekly', {
  title: 'Horas por semana e esporte', description: 'Duração somada por semana (segunda a domingo) e por esporte.',
  inputs: ['activities'],
  fn: (activities) => {
    const sportOf = (s) => { s = String(s || '').toLowerCase(); if (/swim/.test(s)) return 'natacao'; if (/cycl|bik|ride/.test(s)) return 'bike'; if (/run|trail/.test(s)) return 'corrida'; if (/strength/.test(s)) return 'forca'; return 'outro'; };
    const mins = (x) => { const p = String(x || '').split(':').map(Number); return p.length === 3 ? p[0] * 60 + p[1] + p[2] / 60 : (p[0] || 0) + (p[1] || 0) / 60; };
    const acc = {};
    activities.forEach((a) => {
      const d = new Date(String(a.start_time).slice(0, 10) + 'T12:00:00Z'); if (isNaN(d)) return;
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      const semana = d.toISOString().slice(0, 10), esporte = sportOf(a.sport), k = semana + '|' + esporte;
      acc[k] = acc[k] || {semana, esporte, horas: 0}; acc[k].horas += mins(a.duration) / 60;
    });
    return Object.values(acc).map((r) => ({...r, horas: Math.round(r.horas * 10) / 10})).sort((a, b) => a.semana.localeCompare(b.semana));
  }
});
dash.calc('balance', {
  title: 'Saldo calórico de hoje', description: 'Calorias ingeridas hoje (bot) menos o gasto total do dia até agora (Garmin).',
  inputs: ['nutri', 'daily'],
  fn: (nutri, daily) => {
    const today = new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());
    const n = nutri.find((r) => r.date === today) || nutri[nutri.length - 1];
    const ing = n ? +n.calorias || 0 : null, gasto = daily[0] ? +daily[0].total_calories || 0 : null;
    return [{ingeridas: ing, gasto, saldo: ing == null || gasto == null ? null : ing - gasto}];
  }
});

(function () {
  const tabs = document.querySelectorAll('.po-nav button');
  const show = (name) => {
    tabs.forEach((b) => b.classList.toggle('is-on', b.dataset.tab === name));
    ['home', 'esportes', 'alimentacao', 'metas'].forEach((id) => { const s = document.getElementById(id); if (s) s.hidden = id !== name; });
    dash.setLink(name === 'home' ? null : name);
  };
  tabs.forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
  const h = (location.hash || '').slice(1);
  if (['esportes', 'alimentacao', 'metas'].includes(h)) show(h);
  document.querySelectorAll('.po-chip').forEach((c) => c.addEventListener('click', () => {
    TP.sport = c.dataset.sport;
    document.querySelectorAll('.po-chip').forEach((x) => x.classList.toggle('is-on', x === c));
    ['sp-n', 'sp-h', 'sp-km', 'sp-fc', 'sp-chart', 'sp-rows'].forEach((n) => dash.draw(n));
  }));
})();
