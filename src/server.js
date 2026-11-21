import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { info, history, diff, commitAt, report } from './git.js';
import { Sessions } from './sessions.js';

const publicDir = new URL('../public/', import.meta.url);
async function body(req) {
  let text = '';
  for await (const chunk of req) { text += chunk; if (text.length > 4096) throw new Error('Request too large.'); }
  return JSON.parse(text || '{}');
}

export async function startServer(root, options = {}) {
  const sessions = new Sessions(root, options);
  const token = randomBytes(32).toString('hex');
  let expectedHost;
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-src http://127.0.0.1:*; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    try {
      if (req.headers.host !== expectedHost) return send(403, { error: 'Invalid host.' });
      const url = new URL(req.url, `http://${expectedHost}`);
      if (req.headers.origin && req.headers.origin !== `http://${expectedHost}`) return send(403, { error: 'Cross-origin requests are blocked.' });
      if (url.pathname.startsWith('/api/')) {
        if (req.headers['x-commitflix-token'] !== token) return send(403, { error: 'Invalid session token. Reload the dashboard.' });
        if (req.method === 'GET' && url.pathname === '/api/info') return send(200, { ...await info(root), options: { app: options.app || '.', skipInstall: Boolean(options.skipInstall), installScripts: Boolean(options.installScripts), envFile: Boolean(options.envFile) } });
        if (req.method === 'GET' && url.pathname === '/api/history') return send(200, await history(root, Object.fromEntries(url.searchParams)));
        if (req.method === 'GET' && url.pathname === '/api/date') return send(200, { sha: await commitAt(root, url.searchParams.get('date')) });
        if (req.method === 'GET' && ['/api/diff', '/api/report'].includes(url.pathname)) {
          const data = await diff(root, url.searchParams.get('from'), url.searchParams.get('to'));
          if (url.pathname === '/api/report') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': 'attachment; filename="commitflix-comparison.html"' });
            return res.end(report(data));
          }
          return send(200, data);
        }
        if (req.method === 'GET' && url.pathname === '/api/sessions') return send(200, sessions.list());
        if (req.method === 'POST' && url.pathname === '/api/sessions') {
          const data = await body(req);
          if (typeof data.ref !== 'string') throw new Error('Choose a commit first.');
          return send(202, { id: await sessions.create(data.ref) });
        }
        if (req.method === 'DELETE' && /^\/api\/sessions\/[a-f0-9-]+$/.test(url.pathname)) {
          await sessions.stop(url.pathname.split('/').at(-1));
          return send(200, { ok: true });
        }
        return send(404, { error: 'Endpoint not found.' });
      }
      const assets = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
      const asset = assets[url.pathname];
      if (req.method !== 'GET' || !asset) return send(404, { error: 'Not found.' });
      let content = await readFile(new URL(asset[0], publicDir), 'utf8');
      if (asset[0] === 'index.html') content = content.replace('__SESSION_TOKEN__', token);
      res.writeHead(200, { 'Content-Type': asset[1] }); res.end(content);
    } catch (error) { if (!res.headersSent) send(400, { error: error.message }); else res.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 0, '127.0.0.1', resolve); });
  expectedHost = `127.0.0.1:${server.address().port}`;
  let closing;
  return {
    server, sessions, url: `http://${expectedHost}`, token,
    close() {
      return closing ||= (async () => {
        const closed = new Promise(resolve => server.close(resolve));
        server.closeIdleConnections();
        try { await sessions.close(); } finally { await closed; }
      })();
    }
  };
}
