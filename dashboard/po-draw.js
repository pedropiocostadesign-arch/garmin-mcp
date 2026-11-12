const days = () => { const a = new Date(TP.localISO() + 'T12:00:00Z'), b = new Date(TP.RACE + 'T12:00:00Z'); return String(Math.max(0, Math.round((b - a) / 864e5))); };
dash.draw('countdown', (el) => { el.textContent = days(); });
dash.draw('countdown2', (el) => { el.textContent = days(); });
const kv = (name, id, field, map, digits) => dash.draw(name, (el) => {
  const r = TP.row0(id);
  if (!r || r[field] == null) { el.textContent = '—'; return; }
  const v = r[field];
  el.textContent = map ? (map[v] || v) : (typeof v === 'number' ? TP.fmt(v, digits || 0) : v);
});
kv('st-status', 'status', 'training_status', TP.status);
kv('nu-gasto', 'daily', 'total_calories'); kv('nu-saldo', 'balance', 'saldo');

// today's nutrition row, marked by its row number
const nv = (name, field, digits) => dash.draw(name, (el) => {
  const t = TP.today('nutri');
  if (!t || t.row[field] == null) { el.textContent = '—'; return; }
  el.setAttribute('data-row', String(t.i));
  el.textContent = typeof t.row[field] === 'number' ? TP.fmt(t.row[field], digits || 0) : t.row[field];
});
nv('nu-cal', 'calorias'); nv('nu-meta', 'meta_kcal'); nv('nu-tipo', 'tipo_dia'); nv('mt-kcal', 'meta_kcal');
const pct = (a, b) => (b ? Math.min(100, (a || 0) / b * 100) : 0) + '%';
dash.draw('nu-bar', (el) => { const t = TP.today('nutri'); el.style.width = t ? pct(t.row.calorias, t.row.meta_kcal) : '0'; });
[['p', 'proteina_g', 'meta_proteina_g'], ['c', 'carbo_g', 'meta_carbo_g'], ['g', 'gordura_g', 'meta_gordura_g']].forEach(([k, f, m]) => {
  dash.draw('mac-' + k, (el) => { const t = TP.today('nutri'); el.textContent = t ? TP.fmt(t.row[f]) + ' / ' + TP.fmt(t.row[m]) + ' g' : '—'; });
  dash.draw('bar-' + k, (el) => { const t = TP.today('nutri'); el.style.width = t ? pct(t.row[f], t.row[m]) : '0'; });
});
dash.draw('nu-left', (el) => {
  const t = TP.today('nutri');
  if (!t) { el.textContent = '—'; return; }
  const left = (t.row.meta_kcal || 0) - (t.row.calorias || 0);
  el.textContent = left >= 0 ? 'Faltam ' + TP.fmt(left) + ' kcal para a meta de hoje' : TP.fmt(-left) + ' kcal acima da meta de hoje';
});
dash.draw('mt-tipo', (el) => { const t = TP.today('nutri'); el.textContent = t ? t.row.tipo_dia + ' · proteína ' + TP.fmt(t.row.meta_proteina_g) + ' g · carbo ~' + TP.fmt(t.row.meta_carbo_g) + ' g' : '—'; });

dash.draw('week', (el) => {
  const r = dash.data('weekcal');
  if (r.status !== 'ok' || !Array.isArray(r.data)) { el.replaceChildren(); return; }
  const wd = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
  el.replaceChildren(...r.data.map((d, i) => {
    const box = document.createElement('div');
    box.className = 'po-day' + (d.today ? ' is-today' : '');
    const h = document.createElement('div'); h.className = 'd';
    h.textContent = wd[i % 7]; const s = document.createElement('span'); s.textContent = d.date.slice(8, 10) + '/' + d.date.slice(5, 7); h.append(s);
    box.append(h);
    JSON.parse(d.itens || '[]').forEach((it) => {
      const x = document.createElement('div'); x.className = 'po-it ' + it.state;
      x.textContent = String(it.title || '').replace(/\s+(seg|ter|qua|qui|sex|s[aá]b|dom)\s+\d{2}\/\d{2}$/i, '').replace(/^.*? - /, '');
      box.append(x);
    });
    return box;
  }));
});

dash.draw('recent', (el) => {
  const r = dash.data('activities');
  if (r.status !== 'ok') { el.replaceChildren(); return; }
  el.replaceChildren(...r.data.slice(0, 8).map((a) => {
    const li = document.createElement('li');
    const l = document.createElement('div'); const t = document.createElement('div'); t.textContent = String(a.title || '').replace(/^.*? - /, '');
    const m = document.createElement('div'); m.className = 'm'; m.textContent = TP.names[TP.sportOf(a.sport)] + ' · ' + String(a.start_time || '').slice(8, 10) + '/' + String(a.start_time || '').slice(5, 7);
    l.append(t, m);
    const rr = document.createElement('div'); rr.className = 'r';
    const km = +a.distance_km > 0 ? TP.fmt(a.distance_km, 1) + ' km' : '';
    rr.textContent = [km, a.duration, a.avg_heart_rate_bpm ? a.avg_heart_rate_bpm + ' bpm' : ''].filter(Boolean).join('\n');
    rr.style.whiteSpace = 'pre-line';
    li.append(l, rr); return li;
  }));
});

dash.draw('weekvol', (el) => {
  const r = dash.data('weekvol');
  if (r.status !== 'ok' || !Array.isArray(r.data)) { el.replaceChildren(); return; }
  const max = Math.max(1, ...r.data.map((x) => x.horas));
  el.replaceChildren(...r.data.map((x) => {
    const li = document.createElement('li'); li.className = 'po-vrow';
    const n = document.createElement('span'); n.textContent = x.esporte;
    const bar = document.createElement('div'); bar.className = 'po-bar'; const fill = document.createElement('span'); fill.style.width = (x.horas / max * 100) + '%'; bar.append(fill);
    const v = document.createElement('span'); v.className = 'r';
    v.setAttribute('data-source', 'weekvol'); v.setAttribute('data-field', 'horas'); v.setAttribute('data-where', 'esporte=' + encodeURIComponent(x.esporte));
    v.textContent = TP.fmt(x.horas, 1) + ' h';
    li.append(n, bar, v); return li;
  }));
});

const spRow = () => { const r = dash.data('sportstats'); return r.status === 'ok' && Array.isArray(r.data) ? r.data.find((x) => x.esporte === TP.sport) : null; };
const spKpi = (name, field, unit, digits) => dash.draw(name, (el) => {
  const x = spRow();
  el.setAttribute('data-field', field); el.setAttribute('data-where', 'esporte=' + TP.sport);
  if (!x || x[field] == null) { el.textContent = '—'; return; }
  el.textContent = TP.fmt(x[field], digits || 0) + (unit ? ' ' + unit : '');
});
spKpi('sp-n', 'sessoes'); spKpi('sp-h', 'horas', 'h', 1); spKpi('sp-km', 'km', 'km', 1); spKpi('sp-fc', 'fc_media', 'bpm');

const barChart = (el, data, label, tipText, refFn) => {
  const W = el.clientWidth || 320, H = 230, m = {t: 20, r: 8, b: 26, l: 40};
  const svg = d3.select(el).append('svg').attr('width', '100%').attr('height', H).attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img').attr('aria-label', label);
  const x = d3.scaleBand().domain(data.map((d) => d.k)).range([m.l, W - m.r]).padding(0.35);
  const top = d3.max(data, (d) => Math.max(d.v, d.ref || 0)) * 1.15 || 1;
  const y = d3.scaleLinear().domain([0, top]).nice().range([H - m.b, m.t]);
  svg.append('g').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(4).tickSize(-(W - m.l - m.r)).tickFormat((d) => TP.fmt(d, d % 1 ? 1 : 0))).call((g) => { g.select('.domain').remove(); g.selectAll('line').style('stroke', '#efeff1'); });
  svg.append('g').attr('transform', `translate(0,${H - m.b})`).call(d3.axisBottom(x).tickSize(0).tickFormat((d) => d.slice(8, 10) + '/' + d.slice(5, 7))).call((g) => g.select('.domain').remove()).selectAll('text').attr('dy', '1.2em');
  const tip = document.createElement('div'); tip.className = 'po-tip'; tip.hidden = true; el.append(tip);
  svg.selectAll('rect.b').data(data).join('rect').attr('class', 'b').attr('x', (d) => x(d.k)).attr('width', x.bandwidth()).attr('y', (d) => y(d.v)).attr('height', (d) => y(0) - y(d.v)).attr('rx', 7).style('fill', '#5cb82e')
    .on('pointerenter pointermove', (ev, d) => { tip.hidden = false; tip.textContent = tipText(d); const [px, py] = d3.pointer(ev, el); tip.style.left = Math.min(px + 10, W - 170) + 'px'; tip.style.top = Math.max(py - 30, 0) + 'px'; })
    .on('pointerleave', () => { tip.hidden = true; });
  if (refFn) svg.selectAll('line.ref').data(data.filter((d) => d.ref)).join('line').attr('class', 'ref').attr('x1', (d) => x(d.k) - 3).attr('x2', (d) => x(d.k) + x.bandwidth() + 3).attr('y1', (d) => y(d.ref)).attr('y2', (d) => y(d.ref)).style('stroke', '#111214').style('stroke-width', 2).style('stroke-dasharray', '3 3');
  svg.selectAll('text.v').data(data).join('text').attr('class', 'v').attr('x', (d) => x(d.k) + x.bandwidth() / 2).attr('y', (d) => y(Math.max(d.v, d.ref || 0)) - 6).attr('text-anchor', 'middle').text((d) => refFn ? TP.fmt(d.v) : TP.fmt(d.v, 1));
};

dash.draw('sp-chart', (el) => {
  const r = dash.data('weekly');
  el.replaceChildren();
  if (r.status !== 'ok' || !Array.isArray(r.data)) { if (r.status === 'error') { const p = document.createElement('div'); p.className = 'po-empty'; p.textContent = 'Falha ao carregar'; el.append(p); } return; }
  const by = d3.rollup(r.data.filter((x) => TP.sport === 'todos' || x.esporte === TP.sport), (v) => d3.sum(v, (x) => x.horas), (x) => x.semana);
  const data = Array.from(by, ([k, v]) => ({k, v: Math.round(v * 10) / 10})).sort((a, b) => a.k.localeCompare(b.k)).slice(-8);
  if (!data.length) { const p = document.createElement('div'); p.className = 'po-empty'; p.textContent = 'Sem treinos desse esporte no período.'; el.append(p); return; }
  barChart(el, data, 'Horas de treino por semana — ' + TP.names[TP.sport], (d) => 'Semana de ' + d.k.slice(8, 10) + '/' + d.k.slice(5, 7) + ': ' + TP.fmt(d.v, 1) + ' h');
});

dash.draw('nu-chart', (el) => {
  const r = dash.data('nutri');
  el.replaceChildren();
  if (r.status !== 'ok' || !Array.isArray(r.data)) return;
  const data = r.data.map((x) => ({k: x.date, v: +x.calorias || 0, ref: +x.meta_kcal || 0}));
  barChart(el, data, 'Calorias ingeridas por dia nos últimos 7 dias, com a meta tracejada', (d) => d.k.slice(8, 10) + '/' + d.k.slice(5, 7) + ': ' + TP.fmt(d.v) + ' de ' + TP.fmt(d.ref) + ' kcal', true);
});

dash.draw('sp-rows', (el) => {
  const r = dash.data('activities');
  if (r.status !== 'ok') { el.replaceChildren(); return; }
  const rows = r.data.filter((a) => TP.sport === 'todos' || TP.sportOf(a.sport) === TP.sport);
  el.replaceChildren(...rows.map((a) => {
    const tr = document.createElement('tr'); tr.setAttribute('data-key', String(a.activity_id));
    [String(a.start_time || '').slice(8, 10) + '/' + String(a.start_time || '').slice(5, 7), String(a.title || '').replace(/^.*? - /, ''), +a.distance_km > 0 ? TP.fmt(a.distance_km, 1) : '—', a.duration || '—', a.avg_heart_rate_bpm || '—', a.calories || '—']
      .forEach((c) => { const td = document.createElement('td'); td.textContent = c; tr.append(td); });
    return tr;
  }));
});

dash.draw('meals', (el) => {
  const r = dash.data('meals');
  if (r.status !== 'ok') { el.replaceChildren(); return; }
  if (!r.data.length) { const li = document.createElement('li'); li.className = 'po-empty'; li.textContent = 'Nenhuma refeição registrada hoje.'; el.replaceChildren(li); return; }
  el.replaceChildren(...r.data.map((m, i) => {
    const li = document.createElement('li');
    const a = document.createElement('div'); a.textContent = m.refeicao;
    const b = document.createElement('div'); b.className = 'r'; b.setAttribute('data-source', 'meals'); b.setAttribute('data-field', 'kcal'); b.setAttribute('data-row', String(i));
    b.textContent = m.kcal != null ? TP.fmt(m.kcal) + ' kcal' : '';
    li.append(a, b); return li;
  }));
});
