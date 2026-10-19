/**
 * Serves the real HTML pages with a google.script.run shim that calls the
 * real server code (via gas-mock) over HTTP. Used by ui.test.js to drive
 * the UI in a headless browser. Development/testing only.
 */
const http = require('http');
const { createEnv } = require('./gas-mock');

function startHarness(port) {
  const env = createEnv();
  const shim = `<script>
  (function(){
    var AS = new URLSearchParams(location.search).get('as') || '';
    function runner(ok, fail){
      return new Proxy({}, { get: function(_, name){
        if (name === 'withSuccessHandler') return function(f){ return runner(f, fail); };
        if (name === 'withFailureHandler') return function(f){ return runner(ok, f); };
        return function(){
          var args = Array.prototype.slice.call(arguments);
          fetch('/rpc', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ fn: name, args: args, as: AS }) })
            .then(function(r){ return r.json(); }).then(function(j){ if (j.__thrown) { fail && fail(new Error(j.__thrown)); } else { ok && ok(j); } })
            .catch(function(e){ fail && fail(e); });
        };
      }});
    }
    window.google = { script: { run: runner(null, null), history: { push: function(){}, replace: function(){}, setChangeHandler: function(){} } } };
  })();
  </script>`;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'POST' && url.pathname === '/rpc') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        const { fn, args, as } = JSON.parse(body);
        let out;
        try {
          if (!/^api_/.test(fn)) throw new Error('Only api_* functions are exposed in the harness');
          out = env.call(as, fn, ...args);
        } catch (e) { out = { __thrown: String(e.message || e) }; }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(out));
      });
      return;
    }
    if (url.pathname === '/page') {
      env.state.currentUser = url.searchParams.get('as') || '';
      env.ctx.DB_CACHE_ = {}; env.ctx.SETTINGS_MEMO_ = null;
      const params = {};
      url.searchParams.forEach((v, k) => { if (k !== 'as') params[k] = v; });
      const out = env.ctx.doGet({ parameter: params });
      const html = out.html.replace('<head>', '<head>' + shim);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    res.writeHead(404); res.end('not found');
  });
  return new Promise(resolve => server.listen(port, () => resolve({ env, server })));
}

module.exports = { startHarness };
