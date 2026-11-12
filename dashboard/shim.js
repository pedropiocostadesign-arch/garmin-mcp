// A small stand-in for the Claude dashboard runtime, so the very same page
// (dashboard/index.html) runs on its own at /dashboard. It offers the subset of
// `dash` the page uses: loaders, calcs, drawings and data(), fed by one call to
// /dashboard/data, which runs the same Garmin tools the Claude connector runs.
(function () {
  var loaders = {}, calcs = {}, calcOrder = [], draws = {}, store = {}, listeners = [];
  var loadedAt = null;

  function runDraw(name) {
    var fn = draws[name];
    if (!fn) return;
    document.querySelectorAll('[data-draw="' + name + '"]').forEach(function (el) {
      if (el.closest('[hidden]')) return;
      try { fn(el); } catch (e) { console.error('draw ' + name, e); }
    });
  }
  function runAll() {
    listeners.forEach(function (fn) { try { fn(); } catch (e) { console.error(e); } });
    Object.keys(draws).forEach(runDraw);
  }

  window.dash = {
    loader: function (id, o) { loaders[id] = o.fn; },
    calc: function (id, o) { calcs[id] = o; calcOrder.push(id); },
    draw: function (name, fn) {
      if (typeof fn === 'function') draws[name] = fn;
      else if (fn && typeof fn.update === 'function') draws[name] = function (el) { fn.update(el, fn.mount ? fn.mount(el) : undefined); };
      else runDraw(name);
    },
    data: function (id) { return store[id] || {status: 'loading', data: [], refreshing: false}; },
    onData: function (fn) { listeners.push(fn); try { fn(); } catch (e) { console.error(e); } },
    setLink: function (name) {
      try { history.replaceState(null, '', name ? '#' + name : location.pathname); } catch (e) { /* ignore */ }
      requestAnimationFrame(runAll);
    },
    refresh: function () { load(); },
    params: function () { return {}; },
    setParams: function () {}, resetParams: function () {},
    colors: ['#5cb82e', '#f08c2e', '#8b5cf6', '#e5484d', '#2f6e12', '#a9dc8a']
  };

  function rowsOf(out) {
    if (Array.isArray(out)) return out;
    if (out && Array.isArray(out.rows)) return out.rows;
    if (out && Array.isArray(out.data)) return out.data;
    if (out && Array.isArray(out.results)) return out.results;
    return [];
  }

  function load() {
    var bar = document.getElementById('po-status');
    if (bar) bar.textContent = 'Atualizando…';
    return fetch('/dashboard/data', {credentials: 'same-origin', cache: 'no-store'})
      .then(function (r) {
        if (r.status === 401) { location.href = '/dashboard/login'; throw new Error('signed out'); }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (j) {
        Object.keys(j.datasets || {}).forEach(function (id) {
          var v = j.datasets[id];
          if (v.status !== 'ok') { store[id] = {status: 'error', data: [], message: v.message}; return; }
          var answer = v.answer;
          try {
            store[id] = {status: 'ok', data: loaders[id] ? rowsOf(loaders[id]({answer: answer})) : rowsOf(answer)};
          } catch (e) { store[id] = {status: 'error', data: [], message: String(e)}; }
        });
        calcOrder.forEach(function (id) {
          var c = calcs[id];
          try {
            var ins = c.inputs.map(function (i) { var s = store[i]; return s && s.status === 'ok' ? s.data : []; });
            store[id] = {status: 'ok', data: c.fn.apply(null, ins)};
          } catch (e) { store[id] = {status: 'error', data: [], message: String(e)}; }
        });
        loadedAt = new Date();
        if (bar) bar.textContent = 'Atualizado às ' + loadedAt.toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'});
        runAll();
      })
      .catch(function (e) { if (bar) bar.textContent = 'Falha ao atualizar — toque para tentar de novo'; console.error(e); });
  }

  var resizeTimer;
  window.addEventListener('resize', function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(runAll, 150); });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && loadedAt && Date.now() - loadedAt > 10 * 60 * 1000) load();
  });
  window.dashBoot = function () {
    var bar = document.getElementById('po-status');
    if (bar) bar.addEventListener('click', load);
    runAll();
    load();
  };
})();
