// Garmin-style dials. Only the arcs are SVG, with their look set inline so no
// outside stylesheet can thin, recolour or rasterise them; the numbers are
// HTML laid over the dial, so they render as crisp page text at any size.
window.PG = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const el = (t, a) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); return e; };
  const pt = (r, a) => [70 + r * Math.sin(a * Math.PI / 180), 66 - r * Math.cos(a * Math.PI / 180)];
  const arcD = (r, a0, a1) => { const [x0, y0] = pt(r, a0), [x1, y1] = pt(r, a1); return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`; };
  const A0 = -135, A1 = 135, R = 54, W = 10;
  const lin = (v, min, max) => A0 + (A1 - A0) * Math.max(0, Math.min(1, (v - min) / (max - min)));
  const stroke = (color, cap, w) => `fill:none;stroke:${color};stroke-width:${w || W}px;stroke-linecap:${cap || 'round'};shape-rendering:geometricPrecision;vector-effect:none`;
  const path = (svg, a0, a1, color, cap, w) => svg.append(el('path', {d: arcD(R, a0, a1), style: stroke(color, cap, w)}));
  const div = (cls, txt, mark) => { const d = document.createElement('div'); if (cls) d.className = cls; if (txt != null) d.textContent = txt; if (mark) for (const k in mark) d.setAttribute(k, mark[k]); return d; };
  const shell = (o) => {
    const wrap = div('po-gw', null, {role: 'img', 'aria-label': o.aria});
    const svg = el('svg', {viewBox: '0 0 140 126', width: '140', height: '126', 'aria-hidden': 'true', focusable: 'false', style: 'display:block;width:100%;height:auto;overflow:visible;shape-rendering:geometricPrecision'});
    const c = div('po-gc'); c.append(div(String(o.text).length > 4 ? 'po-gv sm' : 'po-gv', o.text, o.mark)); if (o.unit) c.append(div('po-gu', o.unit));
    wrap.append(svg, c);
    if (o.label) wrap.append(div('po-glb', o.label));
    return {wrap, svg};
  };
  // segs: [{from, to, color}]; equal gives every band the same angle, as Garmin's VO2 dial does
  const segGauge = (o) => {
    const {wrap, svg} = shell(o);
    const n = o.segs.length, gap = 4, lo = o.segs[0].from, hi = o.segs[n - 1].to;
    const bandAng = (i, v) => o.equal ? A0 + (A1 - A0) / n * (i + Math.max(0, Math.min(1, (v - o.segs[i].from) / (o.segs[i].to - o.segs[i].from)))) : lin(v, lo, hi);
    o.segs.forEach((s, i) => {
      const a0 = o.equal ? A0 + (A1 - A0) / n * i : lin(s.from, lo, hi);
      const a1 = o.equal ? A0 + (A1 - A0) / n * (i + 1) : lin(s.to, lo, hi);
      path(svg, a0 + (i ? gap / 2 : 0), a1 - (i < n - 1 ? gap / 2 : 0), s.color, i === 0 || i === n - 1 ? 'round' : 'butt');
    });
    if (o.value != null) {
      let i = o.segs.findIndex((s) => o.value < s.to); if (i < 0) i = n - 1;
      const [x, y] = pt(R, bandAng(i, o.value));
      svg.append(el('circle', {cx: x.toFixed(2), cy: y.toFixed(2), r: '8.5', style: `fill:${o.segs[i].color};stroke:#fff;stroke-width:3.5px`}));
    }
    return wrap;
  };
  const fillGauge = (o) => {
    const {wrap, svg} = shell(o);
    path(svg, A0, A1, '#ededf0');
    if (o.band) path(svg, lin(o.band[0], o.min, o.max), lin(o.band[1], o.min, o.max), '#d5edc4');
    if (o.value != null && o.value > o.min) path(svg, A0, lin(o.value, o.min, o.max), '#5cb82e');
    if (o.tick != null) {
      const a = lin(o.tick, o.min, o.max), [x0, y0] = pt(R - 9, a), [x1, y1] = pt(R + 9, a);
      svg.append(el('line', {x1: x0.toFixed(2), y1: y0.toFixed(2), x2: x1.toFixed(2), y2: y1.toFixed(2), style: 'stroke:#111214;stroke-width:2.5px;stroke-linecap:round'}));
    }
    return wrap;
  };
  const hm = (h) => { const m = Math.round((+h || 0) * 60); return Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm'; };
  return {el, div, segGauge, fillGauge, hm};
})();

(() => {
  const {div, hm} = PG;
  const empty = (el) => el.replaceChildren(div('po-empty', 'Sem dados de hoje'));
  const mk = (src, field) => ({'data-source': src, 'data-field': field, 'data-row': '0'});

  // VO2 max: Garmin's bands for men by age bracket (where Fair, Good, Excellent, Superior start)
  const VO2_BANDS = {20: [41.7, 45.4, 51.1, 55.4], 30: [40.5, 44.0, 48.3, 54.0], 40: [38.5, 42.4, 46.4, 52.5], 50: [35.6, 39.2, 43.4, 48.9], 60: [32.3, 35.5, 39.5, 45.7]};
  dash.draw('g-vo2', (el) => {
    const r = TP.row0('status');
    if (!r || r.vo2_max_running == null) { empty(el); return; }
    const age = +r.chronological_age || 35, key = Math.max(20, Math.min(60, Math.floor(age / 10) * 10));
    const [f, g, e, s] = VO2_BANDS[key];
    const segs = [
      {from: f - 8, to: f, color: '#e5484d', name: 'Ruim'},
      {from: f, to: g, color: '#f08c2e', name: 'Razoável'},
      {from: g, to: e, color: '#a9dc8a', name: 'Bom'},
      {from: e, to: s, color: '#5cb82e', name: 'Excelente'},
      {from: s, to: s + 6, color: '#2f6e12', name: 'Superior'}
    ];
    const v = +r.vo2_max_running, band = segs.find((x) => v < x.to) || segs[4];
    el.replaceChildren(
      PG.segGauge({aria: 'VO2máx ' + TP.fmt(v, 1) + ', classificação ' + band.name, segs, equal: true, value: v, text: TP.fmt(v, 1), unit: 'ml/kg/min', label: band.name, mark: mk('status', 'vo2_max_running')}),
      div('po-sub po-c', 'Idade fitness ' + TP.fmt(r.fitness_age) + ' anos')
    );
  });

  const STAGE = {deep: {c: '#2f6e12', h: 0.3, n: 'Profundo'}, light: {c: '#8fd16a', h: 0.55, n: 'Leve'}, rem: {c: '#d63cbf', h: 0.8, n: 'REM'}, awake: {c: '#f4a6cf', h: 1, n: 'Acordado'}};
  dash.draw('g-sleep', (el) => {
    const r = TP.row0('sleep');
    if (!r || r.sleep_score == null) { empty(el); return; }
    let stages = []; try { stages = JSON.parse(r.stages || '[]'); } catch (e) { stages = []; }
    const top = div('po-sl-top');
    const a = div(); a.append(div('po-big', TP.fmt(r.sleep_score), mk('sleep', 'sleep_score')), div('po-sub', TP.pt[r.sleep_score_qualifier] || r.sleep_score_qualifier || ''));
    const b = div('po-r'); b.append(div('po-mid-n', hm(r.sleep_hours), mk('sleep', 'sleep_hours')), div('po-sub', 'Duração'));
    top.append(a, b);
    const total = stages.length ? stages[stages.length - 1].to_min : (+r.sleep_hours || 0) * 60;
    // Drawn in real pixels from the box's width, so bars never stretch
    const W = Math.max(120, el.clientWidth || 160), H = 60;
    const svg = PG.el('svg', {viewBox: `0 0 ${W} ${H}`, width: String(W), height: String(H), class: 'po-hyp', role: 'img', style: `display:block;width:100%;height:${H}px;shape-rendering:crispEdges`,
      'aria-label': 'Fases do sono: profundo ' + hm(r.deep_sleep_hours) + ', leve ' + hm(r.light_sleep_hours) + ', REM ' + hm(r.rem_sleep_hours)});
    const sx = W / Math.max(1, total);
    stages.forEach((s) => { const k = STAGE[s.stage]; if (!k) return; const x = s.from_min * sx, w = Math.max((s.to_min - s.from_min) * sx, 1.5); svg.append(PG.el('rect', {x: x.toFixed(2), y: (H * (1 - k.h)).toFixed(2), width: w.toFixed(2), height: (H * k.h).toFixed(2), style: `fill:${k.c}`})); });
    const axis = div('po-axis'); axis.append(div(null, String(r.sleep_start || '').slice(11, 16)), div(null, String(r.sleep_end || '').slice(11, 16)));
    const keys = div('po-keys');
    [['deep', r.deep_sleep_hours], ['light', r.light_sleep_hours], ['rem', r.rem_sleep_hours]].forEach(([k, h]) => { const s = document.createElement('span'); const i = document.createElement('i'); i.style.background = STAGE[k].c; s.append(i, STAGE[k].n + ' ' + hm(h)); keys.append(s); });
    el.replaceChildren(top, svg, axis, keys);
  });

  dash.draw('g-hrv', (el) => {
    const r = TP.row0('hrv');
    if (!r || r.last_night_avg_ms == null) { empty(el); return; }
    const v = +r.last_night_avg_ms, wk = r.weekly_avg_ms != null ? +r.weekly_avg_ms : null;
    const band = r.baseline_balanced_low_ms != null && r.baseline_balanced_high_ms != null ? [+r.baseline_balanced_low_ms, +r.baseline_balanced_high_ms] : null;
    el.replaceChildren(
      PG.fillGauge({aria: 'HRV noturno ' + v + ' ms; média de 7 dias ' + (wk ?? '—') + ' ms', min: 20, max: 80, value: v, tick: wk, band, text: TP.fmt(v), unit: 'ms', label: TP.pt[r.hrv_status] || r.hrv_status || '', mark: mk('hrv', 'last_night_avg_ms')}),
      div('po-sub po-c', 'Média 7 dias: ' + TP.fmt(wk) + ' ms')
    );
  });

  dash.draw('g-bb', (el) => {
    const r = TP.row0('bb');
    const v = r && r.latest_level != null ? +r.latest_level : null;
    if (v == null) { empty(el); return; }
    const two = div('po-two');
    // The sign sits outside the marked number, so the mark matches the data
    const signed = (sign, v, field) => { const n = div('n', sign); const x = document.createElement('span'); x.textContent = TP.fmt(v); for (const [k, val] of Object.entries(mk('bb', field))) x.setAttribute(k, val); n.append(x); return n; };
    const a = div(); a.append(signed('+', r.charged, 'charged'), div('t', 'Carregada'));
    const b = div('po-r'); b.append(signed('−', r.drained, 'drained'), div('t', 'Esgotada'));
    two.append(a, b);
    el.replaceChildren(
      PG.fillGauge({aria: 'Body Battery agora ' + v + ' de 100', min: 0, max: 100, value: v, text: TP.fmt(v), unit: 'agora', mark: mk('bb', 'latest_level')}),
      two
    );
  });

  dash.draw('g-energy', (el) => {
    const d = TP.row0('daily');
    if (!d || d.total_calories == null) { empty(el); return; }
    const act = +d.active_calories || 0, rest = +d.bmr_calories || Math.max(0, d.total_calories - act), tot = act + rest || 1;
    const big = div('po-big', TP.fmt(d.total_calories), mk('daily', 'total_calories'));
    const sm = document.createElement('small'); sm.textContent = 'kcal'; big.append(sm);
    const split = div('po-split', null, {role: 'img', 'aria-label': 'Ativo ' + TP.fmt(act) + ' kcal, em repouso ' + TP.fmt(rest) + ' kcal'});
    const sa = document.createElement('span'); sa.style.flex = String(act / tot); sa.style.background = '#e5484d';
    const sb = document.createElement('span'); sb.style.flex = String(rest / tot); sb.style.background = '#5cb82e';
    split.append(sa, sb);
    const two = div('po-two');
    const a = div(); a.append(div('n', TP.fmt(act), mk('daily', 'active_calories')), div('t', 'Ativo'));
    const b = div('po-r'); b.append(div('n', TP.fmt(rest), mk('daily', 'bmr_calories')), div('t', 'Em repouso'));
    two.append(a, b);
    const nodes = [big, split, two];
    const t = TP.today('nutri');
    if (t) {
      const ing = div('po-ing');
      const row = div('po-two');
      row.append(div('t', 'Ingeridas'), div('t', TP.fmt(t.row.calorias) + ' / ' + TP.fmt(t.row.meta_kcal) + ' kcal', {'data-source': 'nutri', 'data-field': 'calorias', 'data-row': String(t.i)}));
      const bar = div('po-bar'); const f = document.createElement('span'); f.style.width = Math.min(100, (t.row.calorias || 0) / (t.row.meta_kcal || 1) * 100) + '%'; bar.append(f);
      ing.append(row, bar); nodes.push(ing);
    }
    el.replaceChildren(...nodes);
  });

  dash.draw('g-status', (el) => {
    const r = TP.row0('status');
    if (!r || r.acute_load == null) { empty(el); return; }
    const lo = +r.chronic_load_target_min || 0, hi = +r.chronic_load_target_max || (+r.acute_load * 1.2), max = hi * 1.5;
    const segs = [
      {from: 0, to: lo, color: '#a9dc8a', name: 'Baixa'},
      {from: lo, to: hi, color: '#5cb82e', name: 'Ideal'},
      {from: hi, to: hi * 1.25, color: '#f08c2e', name: 'Alta'},
      {from: hi * 1.25, to: max, color: '#e5484d', name: 'Muito alta'}
    ];
    const v = +r.acute_load, band = segs.find((x) => v < x.to) || segs[3];
    const wrap = div('po-st');
    const g = PG.segGauge({aria: 'Carga aguda ' + TP.fmt(v) + ', faixa ' + band.name + ' (ideal ' + TP.fmt(lo) + '–' + TP.fmt(hi) + ')', segs, value: v, text: TP.fmt(v), unit: 'carga aguda', label: band.name, mark: mk('status', 'acute_load')});
    const side = div('po-kv');
    [['Aguda:crônica', TP.fmt(r.acute_chronic_ratio, 1), 'acute_chronic_ratio'], ['Carga crônica', TP.fmt(r.chronic_load), 'chronic_load'], ['Faixa ideal', TP.fmt(lo) + '–' + TP.fmt(hi), 'chronic_load_target_max']]
      .forEach(([l, val, f]) => { const x = div(); x.append(div('lbl', l), div('v', val, mk('status', f))); side.append(x); });
    wrap.append(g, side);
    const focus = div('po-focus');
    focus.append(div('lbl', 'Foco da carga · 4 semanas'));
    const fx = [['Aeróbico leve', r.monthly_load_aerobic_low, '#5cb82e', 'monthly_load_aerobic_low'], ['Aeróbico intenso', r.monthly_load_aerobic_high, '#f08c2e', 'monthly_load_aerobic_high'], ['Anaeróbico', r.monthly_load_anaerobic, '#8b5cf6', 'monthly_load_anaerobic']];
    const fmax = Math.max(1, ...fx.map((x) => +x[1] || 0));
    fx.forEach(([n, val, c, f]) => {
      const row = div('po-frow');
      const bar = div('po-bar'); const s = document.createElement('span'); s.style.width = ((+val || 0) / fmax * 100) + '%'; s.style.background = c; bar.append(s);
      row.append(div('n', n), bar, div('v', TP.fmt(val), mk('status', f)));
      focus.append(row);
    });
    focus.append(div('po-sub', r.load_balance_feedback ? (TP.balance[r.load_balance_feedback] || r.load_balance_feedback) : ''));
    el.replaceChildren(wrap, focus);
  });
})();
