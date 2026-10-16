// Tiny Express-compatible router on node:http. Zero dependencies so judges can run the API with just Node 22.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize as pnorm, extname } from 'node:path';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };

export default function mini() {
  const routes = [];
  const mids = [];
  let staticDir = null;
  const staticMap = {};
  let errorHandler = (err, _req, res) => res.status(500).json({ error: 'internal', message: String(err) });

  const add = (method) => (path, ...handlers) => {
    const keys = [];
    const re = new RegExp('^' + path.replace(/:([A-Za-z]+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$');
    routes.push({ method, re, keys, handlers });
  };

  function decorate(req, res) {
    const url = new URL(req.url, 'http://x');
    req.path = url.pathname;
    req.query = Object.fromEntries(url.searchParams);
    req.params = {};
    req.get = (h) => req.headers[h.toLowerCase()];
    res.status = (c) => ((res.statusCode = c), res);
    res.json = (o) => {
      if (!res.getHeader('content-type')) res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(o));
    };
    res.type = (t) => (res.setHeader('content-type', t === 'html' ? 'text/html; charset=utf-8' : t), res);
    res.send = (b) => res.end(b);
    res.redirect = (loc) => {
      res.statusCode = 302;
      res.setHeader('location', loc);
      res.end();
    };
  }

  async function readJson(req) {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return {};
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > 200_000) throw Object.assign(new Error('Body too large'), { status: 413 });
      chunks.push(c);
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch {
      throw Object.assign(new Error('Invalid JSON'), { status: 400 });
    }
  }

  const app = {
    use(fn) {
      if (fn.length === 4) errorHandler = fn;
      else mids.push(fn);
    },
    serveStatic(dir, map = {}) {
      staticDir = dir;
      Object.assign(staticMap, map);
    },
    get: add('GET'),
    post: add('POST'),
    put: add('PUT'),
    delete: add('DELETE'),
    listen(port, ...rest) {
      const server = createServer((req, res) => app.handle(req, res));
      return server.listen(port, ...rest);
    },
    async handle(req, res) {
      decorate(req, res);
      // CORS (the web app normally proxies, but allow direct use too)
      res.setHeader('access-control-allow-origin', '*');
      res.setHeader('access-control-allow-headers', 'content-type,x-admin-token');
      res.setHeader('access-control-allow-methods', 'GET,POST,PUT,DELETE,OPTIONS');
      if (req.method === 'OPTIONS') return res.status(204).end();
      try {
        req.body = await readJson(req);
        for (const m of mids) await new Promise((ok, no) => m(req, res, (e) => (e ? no(e) : ok())));
        const route = routes.find((r) => r.method === req.method && r.re.test(req.path));
        if (!route && req.method === 'GET' && staticDir) {
          const rel = req.path === '/' ? '/index.html' : req.path;
          const file = staticMap[rel] || join(staticDir, pnorm(rel).replace(/^(\.\.[/\\])+/, ''));
          try {
            const buf = await readFile(file);
            res.setHeader('content-type', MIME[extname(file)] || 'application/octet-stream');
            if (rel === '/sw.js') res.setHeader('cache-control', 'no-cache');
            return res.end(buf);
          } catch {
            /* fall through to 404 */
          }
        }
        if (!route) return res.status(404).json({ error: 'not_found', message: 'No such route' });
        const m = req.path.match(route.re);
        route.keys.forEach((k, i) => (req.params[k] = decodeURIComponent(m[i + 1])));
        for (const h of route.handlers) {
          await new Promise((ok, no) => {
            let settled = false;
            const next = (e) => {
              settled = true;
              e ? no(e) : ok();
            };
            Promise.resolve(h.length >= 3 ? h(req, res, next) : h(req, res)).then(
              () => {
                if (!settled && (h.length < 3 || res.writableEnded)) ok();
              },
              no,
            );
          });
          if (res.writableEnded) break;
        }
      } catch (err) {
        if (err.status && !err.code) return res.status(err.status).json({ error: 'bad_request', message: err.message });
        errorHandler(err, req, res, () => {});
      }
    },
  };
  return app;
}
