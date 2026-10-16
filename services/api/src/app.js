import mini from './mini.js';
import { networkInterfaces } from 'node:os';
import { config, paypalConfigured } from './config.js';
import { getSetting, setSetting, now } from './db.js';
import { assist } from './assistant.js';
import { submitOrder, reapprove, startPayment, completePayment, cancelOrder, mustGet, view, HttpError } from './orders.js';
import { ledgerView, payMilestone, programFunds } from './ledger.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

export function createApp(db) {
  const app = mini();

  const admin = (req, _res, next) => {
    if (req.get('x-admin-token') !== config.adminToken) return next(new HttpError(401, 'unauthorized', 'Admin token required'));
    next();
  };

  app.get('/api/health', (_req, res) => res.json({ ok: true, time: now() }));

  app.get('/api/config', (_req, res) =>
    res.json({
      languages: getSetting(db, 'languages', ['sw', 'en']),
      payment: paypalConfigured() ? 'paypal_sandbox' : 'simulated',
      fxKesPerUsd: config.fx.kesPerUsd,
      chargeCurrency: config.fx.currency,
      aiModelService: Boolean(config.aiUrl),
      demo: true,
    }),
  );

  app.get('/api/catalog', (_req, res) =>
    res.json(
      db.prepare(`SELECT p.id,p.name_en,p.name_sw,p.category,p.unit,p.price_kes AS priceKes,p.stock,p.keywords,s.name AS supplier,s.county
                  FROM products p JOIN suppliers s ON s.id=p.supplier_id WHERE p.active=1 ORDER BY p.category,p.price_kes`).all(),
    ),
  );

  app.post('/api/assistant', wrap(async (req, res) => {
    const { text, lang, budget } = req.body || {};
    if (typeof text !== 'string' || text.length > 500) throw new HttpError(400, 'bad_text', 'text required (max 500 chars)');
    res.json(await assist(db, { text, lang: lang === 'en' ? 'en' : 'sw', budget }));
  }));

  // --- Orders -------------------------------------------------------------
  app.post('/api/orders', wrap((req, res) => {
    const result = submitOrder(db, req.body);
    res.status(result.duplicate ? 200 : 201).json(result);
  }));
  app.get('/api/orders/:id', wrap((req, res) => {
    const o = mustGet(db, req.params.id);
    const m = db.prepare('SELECT id,reward_kes,status FROM milestones WHERE order_id = ?').get(o.id);
    res.json(view(o, m));
  }));
  app.get('/api/orders/:id/events', wrap((req, res) => {
    mustGet(db, req.params.id);
    res.json(db.prepare('SELECT type,detail,at FROM order_events WHERE order_id=? ORDER BY id').all(req.params.id));
  }));
  app.post('/api/orders/:id/reapprove', wrap((req, res) => res.json(reapprove(db, req.params.id, req.body?.approval))));
  app.post('/api/orders/:id/pay', wrap(async (req, res) => res.json(await startPayment(db, req.params.id))));
  app.post('/api/orders/:id/cancel', wrap((req, res) => res.json(cancelOrder(db, req.params.id))));

  // PayPal redirects the buyer here. We verify with PayPal server-side; the browser's word is never enough.
  app.get('/api/paypal/return', wrap(async (req, res) => {
    const id = String(req.query.order || '');
    try {
      await completePayment(db, id);
      res.redirect(`/?receipt=${encodeURIComponent(id)}`);
    } catch (e) {
      res.redirect(`/?payment_error=${encodeURIComponent(e.code || 'error')}&order=${encodeURIComponent(id)}`);
    }
  }));
  app.get('/api/paypal/cancel', (req, res) => res.redirect(`/?payment_cancelled=${encodeURIComponent(String(req.query.order || ''))}`));

  app.get('/api/paypal/simulated', wrap((req, res) => {
    const id = String(req.query.order || '');
    const o = mustGet(db, id);
    res.type('html').send(`<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><title>Simulated PayPal</title>
<body style="font-family:system-ui;max-width:28rem;margin:2rem auto;padding:1rem">
<p style="background:#fde68a;padding:.75rem;border-radius:.5rem;font-weight:700">SIMULATED CHECKOUT &mdash; no PayPal account is used and no money moves.</p>
<h1>Pay KSh ${o.total_kes.toLocaleString()}</h1><p>Charged as USD ${o.usd_amount} at ${o.fx_rate} KES/USD (simulation).</p>
<p><a style="display:block;background:#0b5;color:#fff;padding:1rem;border-radius:.5rem;text-align:center;font-size:1.25rem;text-decoration:none" href="/api/paypal/return?order=${encodeURIComponent(id)}">Approve simulated payment</a></p>
<p><a href="/api/paypal/cancel?order=${encodeURIComponent(id)}">Cancel</a></p></body>`);
  }));

  // --- Impact Ledger ------------------------------------------------------
  app.get('/api/ledger', (req, res) => res.json({ milestones: ledgerView(db, { agentId: req.query.agent }) }));
  app.get('/api/ledger/programs', (_req, res) => {
    const ids = db.prepare('SELECT id FROM programs').all();
    res.json(ids.map(({ id }) => programFunds(db, id)));
  });
  app.get('/api/agents', (_req, res) => res.json(db.prepare('SELECT id,name,trained FROM agents').all()));

  // --- Admin --------------------------------------------------------------
  app.post('/api/admin/ledger/milestones/:id/payout', admin, wrap(async (req, res) => {
    const r = await payMilestone(db, req.params.id);
    if (r.error) throw new HttpError(r.error === 'not_found' ? 404 : 409, r.error, r.error);
    res.json(r);
  }));
  app.get('/api/admin/summary', admin, (_req, res) => {
    const c = (sql) => db.prepare(sql).get().n;
    res.json({
      orders: c('SELECT COUNT(*) AS n FROM orders'),
      paid: c("SELECT COUNT(*) AS n FROM orders WHERE status='paid'"),
      offlineOrigin: c('SELECT COUNT(*) AS n FROM orders WHERE created_offline=1'),
      needsReapproval: c("SELECT COUNT(*) AS n FROM orders WHERE status='needs_reapproval'"),
      products: c('SELECT COUNT(*) AS n FROM products WHERE active=1'),
      milestones: c('SELECT COUNT(*) AS n FROM milestones'),
    });
  });
  app.put('/api/admin/products/:id', admin, wrap((req, res) => {
    const b = req.body || {};
    const sup = db.prepare('SELECT id FROM suppliers WHERE id=?').get(b.supplierId || 'sup-shamba');
    if (!sup || !b.name_en || !b.name_sw || !b.category || !Number.isInteger(b.priceKes) || !Number.isInteger(b.stock)) throw new HttpError(400, 'bad_product', 'name_en, name_sw, category, supplierId, integer priceKes and stock required');
    db.prepare(`INSERT INTO products (id,name_en,name_sw,category,unit,supplier_id,price_kes,stock,keywords,active) VALUES (?,?,?,?,?,?,?,?,?,1)
      ON CONFLICT(id) DO UPDATE SET name_en=excluded.name_en,name_sw=excluded.name_sw,category=excluded.category,unit=excluded.unit,supplier_id=excluded.supplier_id,price_kes=excluded.price_kes,stock=excluded.stock,keywords=excluded.keywords`).run(
      req.params.id, b.name_en, b.name_sw, b.category, b.unit || 'pack', sup.id, b.priceKes, b.stock, (b.keywords || `${b.name_en} ${b.name_sw}`).toLowerCase(),
    );
    res.json({ ok: true });
  }));
  app.delete('/api/admin/products/:id', admin, (req, res) => {
    db.prepare('UPDATE products SET active=0 WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  });
  app.put('/api/admin/languages', admin, wrap((req, res) => {
    const langs = req.body?.languages;
    if (!Array.isArray(langs) || !langs.every((l) => ['sw', 'en'].includes(l)) || !langs.length) throw new HttpError(400, 'bad_languages', 'Only validated languages (sw, en) can be enabled');
    setSetting(db, 'languages', langs);
    res.json({ languages: langs });
  }));
  app.post('/api/admin/agents', admin, wrap((req, res) => {
    const { id, name, payoutEmail } = req.body || {};
    if (!id || !name) throw new HttpError(400, 'bad_agent', 'id and name required');
    db.prepare('INSERT INTO agents (id,name,payout_email,trained,created_at) VALUES (?,?,?,?,?)').run(id, name, payoutEmail || null, 1, now());
    res.status(201).json({ ok: true });
  }));
  app.post('/api/admin/programs', admin, wrap((req, res) => {
    const b = req.body || {};
    if (!b.id || !b.sponsor || !b.name || !Number.isInteger(b.rewardKes) || b.rewardKes < 1) throw new HttpError(400, 'bad_program', 'id, sponsor, name, integer rewardKes required');
    db.prepare('INSERT INTO programs (id,sponsor,name,goal,reward_kes,funded_kes,funding_mode,target_outcomes,created_at) VALUES (?,?,?,?,?,0,?,?,?)').run(
      b.id, b.sponsor, b.name, b.goal || '', b.rewardKes, 'simulated', b.targetOutcomes || 0, now(),
    );
    res.status(201).json({ ok: true });
  }));
  app.post('/api/admin/programs/:id/fund', admin, wrap((req, res) => {
    const amt = req.body?.amountKes;
    if (!Number.isInteger(amt) || amt < 1) throw new HttpError(400, 'bad_amount', 'amountKes must be a positive integer');
    db.prepare('UPDATE programs SET funded_kes = funded_kes + ? WHERE id=?').run(amt, req.params.id);
    res.json({ ...programFunds(db, req.params.id), note: 'Funding is SIMULATED in this prototype.' });
  }));

  // --- Community gateway info --------------------------------------------
  app.get('/api/gateway/info', (_req, res) => {
    const ips = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
    res.json({ addresses: ips.map((ip) => `http://${ip}:4000`), note: 'Devices on the same Wi-Fi can open one of these addresses to use this gateway.' });
  });

  // --- Optional Hugging Face TTS proxy -----------------------------------
  app.post('/api/tts', wrap(async (req, res) => {
    if (!config.aiUrl) throw new HttpError(501, 'tts_unavailable', 'Model service not configured; use the device voice');
    const r = await fetch(`${config.aiUrl}/tts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: String(req.body?.text || '').slice(0, 400) }) });
    if (!r.ok) throw new HttpError(502, 'tts_failed', 'Model service error');
    res.type('audio/wav').send(Buffer.from(await r.arrayBuffer()));
  }));

  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.code, message: err.message, ...err.extra });
    console.error(err);
    res.status(500).json({ error: 'internal', message: 'Unexpected error' });
  });
  return app;
}
