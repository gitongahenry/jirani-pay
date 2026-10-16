import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { seed } from '../src/seed.js';
import { createApp } from '../src/app.js';
import { parseBudget, parseRequest } from '../src/nlu.js';
import { numbersGrounded } from '../src/assistant.js';

let server, base;
const db = openDb(':memory:');
seed(db);
test.before(async () => {
  server = createApp(db).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const approval = (total) => ({ method: 'gesture', approvedTotalKes: total, at: new Date().toISOString() });

test('parses Kiswahili budgets', () => {
  assert.equal(parseBudget('bajeti ya elfu tatu'), 3000);
  assert.equal(parseBudget('nina KSh 3,000'), 3000);
  assert.equal(parseBudget('I have 5 thousand'), 5000);
  const p = parseRequest('Nataka mbegu za mahindi, bajeti ya elfu tatu');
  assert.equal(p.category, 'seeds');
  assert.equal(p.budget, 3000);
});

test('low confidence input is flagged, not guessed', async () => {
  const r = await (await post('/api/assistant', { text: 'habari yako', lang: 'sw' })).json();
  assert.equal(r.uncertain, true);
  assert.equal(r.offers.length, 0);
});

test('assistant recommends only affordable catalogue items', async () => {
  const r = await (await post('/api/assistant', { text: 'mbegu za mahindi bajeti ya elfu tatu', lang: 'sw' })).json();
  assert.ok(r.offers.length > 0);
  const rec = r.offers.find((o) => o.productId === r.recommendedProductId);
  assert.ok(rec.totalKes <= 3000);
});

test('LLM text with invented numbers is rejected', () => {
  assert.equal(numbersGrounded('Jumla ni 640', new Set([640])), true);
  assert.equal(numbersGrounded('Jumla ni 99999', new Set([640])), false);
});

test('order requires explicit approval', async () => {
  const r = await post('/api/orders', { id: 'order-noapprove-1', clientId: 'c1', items: [{ productId: 'p-maize-o', qty: 1 }], budgetKes: 3000 });
  assert.equal(r.status, 403);
});

test('offline order: idempotent sync, pay, verify, receipt, reward (simulated)', async () => {
  const body = { id: 'order-offline-0001', clientId: 'farmer-1', items: [{ productId: 'p-maize-o', qty: 2 }], budgetKes: 3000, approval: approval(840), createdOffline: true, agentId: 'agent-amina', inclusionConsent: true, lang: 'sw' };
  const a = await post('/api/orders', body);
  assert.equal(a.status, 201);
  const b = await post('/api/orders', body); // retry after flaky network
  assert.equal(b.status, 200);
  assert.equal((await b.json()).duplicate, true);

  const pay = await (await post('/api/orders/order-offline-0001/pay', {})).json();
  assert.equal(pay.simulated, true);
  // The simulated checkout page returns the buyer; server verifies.
  const ret = await fetch(`${base}/api/paypal/return?order=order-offline-0001`, { redirect: 'manual' });
  assert.equal(ret.status, 302);
  const order = await (await fetch(`${base}/api/orders/order-offline-0001`)).json();
  assert.equal(order.status, 'paid');
  assert.match(order.receipt.disclosure, /SIMULATED/);
  assert.equal(order.reward.rewardKes, 150);
  // Reloading the return URL must not double-charge or double-reward.
  await fetch(`${base}/api/paypal/return?order=order-offline-0001`, { redirect: 'manual' });
  const ledger = await (await fetch(`${base}/api/ledger`)).json();
  assert.equal(ledger.milestones.length, 1);
  const stock = db.prepare("SELECT stock FROM products WHERE id='p-maize-o'").get().stock;
  assert.equal(stock, 118);
});

test('price increase while offline requires re-approval', async () => {
  db.prepare("UPDATE products SET price_kes = 500 WHERE id='p-bean-r'").run();
  const r = await (await post('/api/orders', { id: 'order-pricejump-01', clientId: 'farmer-2', items: [{ productId: 'p-bean-r', qty: 1 }], budgetKes: 3000, approval: approval(260) })).json();
  assert.equal(r.order.status, 'needs_reapproval');
  const pay = await post('/api/orders/order-pricejump-01/pay', {});
  assert.equal(pay.status, 409);
  const re = await post('/api/orders/order-pricejump-01/reapprove', { approval: approval(500) });
  assert.equal(re.status, 200);
  assert.equal((await re.json()).status, 'approved');
});

test('over-budget orders are never auto-approved', async () => {
  const r = await (await post('/api/orders', { id: 'order-overbudget-1', clientId: 'farmer-3', items: [{ productId: 'p-sprayer', qty: 2 }], budgetKes: 3000, approval: approval(4800) })).json();
  assert.equal(r.order.status, 'needs_reapproval');
});

test('one reward per beneficiary and admin payout is protected', async () => {
  const again = await (await post('/api/orders', { id: 'order-second-0001', clientId: 'farmer-1', items: [{ productId: 'p-hoe', qty: 1 }], budgetKes: 3000, approval: approval(700), agentId: 'agent-amina', inclusionConsent: true })).json();
  assert.equal(again.order.status, 'approved');
  await post('/api/orders/order-second-0001/pay', {});
  await fetch(`${base}/api/paypal/return?order=order-second-0001`, { redirect: 'manual' });
  const ledger = await (await fetch(`${base}/api/ledger`)).json();
  assert.equal(ledger.milestones.length, 1);

  const m = ledger.milestones[0];
  assert.equal((await post(`/api/admin/ledger/milestones/${m.id}/payout`, {})).status, 401);
  const paid = await post(`/api/admin/ledger/milestones/${m.id}/payout`, {}, { 'x-admin-token': 'jirani-demo-admin' });
  assert.equal(paid.status, 200);
  assert.equal((await paid.json()).payout.mode, 'simulated');
});

test('no reward without beneficiary consent', async () => {
  await post('/api/orders', { id: 'order-noconsent-01', clientId: 'farmer-9', items: [{ productId: 'p-hoe', qty: 1 }], budgetKes: 3000, approval: approval(700), agentId: 'agent-amina', inclusionConsent: false });
  await post('/api/orders/order-noconsent-01/pay', {});
  await fetch(`${base}/api/paypal/return?order=order-noconsent-01`, { redirect: 'manual' });
  const o = await (await fetch(`${base}/api/orders/order-noconsent-01`)).json();
  assert.equal(o.status, 'paid');
  assert.equal(o.reward, undefined);
});
