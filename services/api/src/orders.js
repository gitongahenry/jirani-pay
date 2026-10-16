import { now, logEvent } from './db.js';
import { createCheckout, captureAndVerify, kesToUsd } from './paypal.js';
import { config } from './config.js';
import { maybeReward } from './ledger.js';

const APPROVAL_METHODS = ['touch', 'voice', 'gesture', 'switch', 'agent'];

export class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const parseItems = (order) => JSON.parse(order.items_json);

/** Re-price against the live catalogue. Returns { lines, total, problems }. */
export function priceItems(db, items) {
  const lines = [];
  const problems = [];
  let total = 0;
  for (const it of items) {
    const qty = Number(it.qty);
    if (!it.productId || !Number.isInteger(qty) || qty < 1 || qty > 100) throw new HttpError(400, 'bad_item', 'Each item needs productId and qty 1-100');
    const p = db.prepare('SELECT * FROM products WHERE id = ?').get(it.productId);
    if (!p || !p.active) {
      problems.push({ productId: it.productId, reason: 'unavailable' });
      continue;
    }
    if (p.stock < qty) problems.push({ productId: p.id, reason: 'insufficient_stock', stock: p.stock });
    lines.push({ productId: p.id, name_en: p.name_en, name_sw: p.name_sw, qty, unitPriceKes: p.price_kes, lineKes: p.price_kes * qty });
    total += p.price_kes * qty;
  }
  return { lines, total, problems };
}

export function submitOrder(db, body) {
  const { id, clientId, items, budgetKes, lang = 'sw', approval, createdOffline = false, agentId = null, inclusionConsent = false } = body || {};
  if (!id || !/^[A-Za-z0-9-]{8,64}$/.test(id)) throw new HttpError(400, 'bad_id', 'Order id must be a client-generated unique id (8-64 chars)');
  if (!clientId) throw new HttpError(400, 'bad_client', 'clientId required');
  if (!Array.isArray(items) || !items.length || items.length > 20) throw new HttpError(400, 'bad_items', 'items required (1-20)');
  if (!Number.isInteger(budgetKes) || budgetKes < 1) throw new HttpError(400, 'bad_budget', 'budgetKes must be a positive integer');

  // Consent: selecting a product is not approving payment.
  if (!approval || !APPROVAL_METHODS.includes(approval.method) || !Number.isInteger(approval.approvedTotalKes) || !approval.at) {
    throw new HttpError(403, 'approval_required', 'Explicit approval of the total is required before an order can be accepted');
  }

  const existing = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (existing) return { order: view(existing), duplicate: true };

  const { lines, total, problems } = priceItems(db, items);
  if (agentId) {
    const a = db.prepare('SELECT id FROM agents WHERE id = ?').get(agentId);
    if (!a) throw new HttpError(400, 'bad_agent', 'Unknown agent');
  }
  let status = 'approved';
  const reasons = [...problems];
  if (!lines.length || problems.length) status = 'needs_reapproval';
  if (total > approval.approvedTotalKes + config.priceToleranceKes) {
    status = 'needs_reapproval';
    reasons.push({ reason: 'price_increased', approved: approval.approvedTotalKes, now: total });
  }
  if (total > budgetKes) {
    status = 'needs_reapproval';
    reasons.push({ reason: 'over_budget', budget: budgetKes, now: total });
  }
  const ts = now();
  db.prepare(
    `INSERT INTO orders (id,client_id,status,lang,items_json,total_kes,approved_total_kes,budget_kes,approval_method,approved_at,created_offline,agent_id,inclusion_consent,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(id, clientId, status, lang, JSON.stringify(lines), total, approval.approvedTotalKes, budgetKes, approval.method, approval.at, createdOffline ? 1 : 0, agentId, inclusionConsent ? 1 : 0, ts, ts);
  logEvent(db, id, 'received', createdOffline ? 'synced from offline queue' : 'online');
  logEvent(db, id, status === 'approved' ? 'revalidated_ok' : 'needs_reapproval', JSON.stringify(reasons));
  return { order: view(db.prepare('SELECT * FROM orders WHERE id = ?').get(id)), duplicate: false, reasons };
}

export function reapprove(db, id, approval) {
  const order = mustGet(db, id);
  if (order.status !== 'needs_reapproval') throw new HttpError(409, 'not_pending_reapproval', `Order is ${order.status}`);
  if (!approval || !APPROVAL_METHODS.includes(approval.method) || !Number.isInteger(approval.approvedTotalKes)) throw new HttpError(403, 'approval_required', 'Approval required');
  const { lines, total, problems } = priceItems(db, parseItems(order).map((l) => ({ productId: l.productId, qty: l.qty })));
  if (problems.length || !lines.length) throw new HttpError(409, 'unavailable', 'Some items are no longer available', { problems });
  if (total > approval.approvedTotalKes) throw new HttpError(409, 'price_changed', 'Approved total is below the current total', { total });
  if (total > order.budget_kes) throw new HttpError(409, 'over_budget', 'Current total exceeds the budget', { total, budget: order.budget_kes });
  db.prepare('UPDATE orders SET status=?, items_json=?, total_kes=?, approved_total_kes=?, approval_method=?, approved_at=?, updated_at=? WHERE id=?').run(
    'approved', JSON.stringify(lines), total, approval.approvedTotalKes, approval.method, approval.at || now(), now(), id,
  );
  logEvent(db, id, 'reapproved', `total ${total}`);
  return view(mustGet(db, id));
}

export async function startPayment(db, id) {
  const order = mustGet(db, id);
  if (!['approved', 'payment_pending'].includes(order.status)) throw new HttpError(409, 'bad_state', `Order is ${order.status}`);
  // Final revalidation right before money moves.
  const { lines, total, problems } = priceItems(db, parseItems(order).map((l) => ({ productId: l.productId, qty: l.qty })));
  if (problems.length || total > order.approved_total_kes || total > order.budget_kes) {
    db.prepare('UPDATE orders SET status=?, updated_at=? WHERE id=?').run('needs_reapproval', now(), id);
    logEvent(db, id, 'needs_reapproval', 'pre-payment check failed');
    throw new HttpError(409, 'needs_reapproval', 'Price or availability changed; please approve again', { total, problems });
  }
  const usd = kesToUsd(total);
  db.prepare('UPDATE orders SET usd_amount=?, fx_rate=?, total_kes=?, items_json=? WHERE id=?').run(usd, config.fx.kesPerUsd, total, JSON.stringify(lines), id);
  const fresh = mustGet(db, id);
  const checkout = await createCheckout(fresh, lines);
  db.prepare('UPDATE orders SET status=?, payment_mode=?, paypal_order_id=?, updated_at=? WHERE id=?').run('payment_pending', checkout.mode, checkout.paypalOrderId, now(), id);
  logEvent(db, id, 'payment_started', `${checkout.mode} ${checkout.paypalOrderId} USD ${checkout.usd}`);
  return { orderId: id, mode: checkout.mode, simulated: checkout.mode === 'simulated', approveUrl: checkout.approveUrl, usd: checkout.usd, fxRate: config.fx.kesPerUsd };
}

export async function completePayment(db, id) {
  const order = mustGet(db, id);
  if (order.status === 'paid') return view(order);
  if (order.status !== 'payment_pending') throw new HttpError(409, 'bad_state', `Order is ${order.status}`);
  const result = await captureAndVerify(order, order.paypal_order_id);
  if (!result.verified) {
    db.prepare('UPDATE orders SET status=?, updated_at=? WHERE id=?').run('failed', now(), id);
    logEvent(db, id, 'payment_failed', JSON.stringify(result));
    throw new HttpError(402, 'payment_not_verified', 'Payment could not be verified with PayPal', { status: result.status });
  }
  const lines = parseItems(order);
  db.exec('BEGIN');
  try {
    for (const l of lines) {
      const r = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?').run(l.qty, l.productId, l.qty);
      if (r.changes !== 1) throw new HttpError(409, 'stock_race', `Stock for ${l.productId} ran out; refund required`);
    }
    const receipt = {
      orderId: id,
      lines,
      totalKes: order.total_kes,
      chargedUsd: order.usd_amount,
      fxRateKesPerUsd: order.fx_rate,
      paymentMode: order.payment_mode,
      simulated: result.simulated,
      captureId: result.captureId,
      approvalMethod: order.approval_method,
      createdOffline: Boolean(order.created_offline),
      paidAt: now(),
      disclosure: result.simulated
        ? 'SIMULATED payment. No real funds moved.'
        : 'PayPal SANDBOX payment. Test money only; no real funds moved.',
    };
    db.prepare('UPDATE orders SET status=?, paypal_capture_id=?, receipt_json=?, updated_at=? WHERE id=?').run('paid', result.captureId, JSON.stringify(receipt), now(), id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    logEvent(db, id, 'stock_conflict', e.message);
    throw e;
  }
  logEvent(db, id, 'paid', `capture ${result.captureId}`);
  const paid = mustGet(db, id);
  const reward = maybeReward(db, paid);
  if (reward) logEvent(db, id, 'inclusion_milestone', `${reward.id} KSh ${reward.reward_kes}`);
  return view(paid, reward);
}

export function cancelOrder(db, id) {
  const order = mustGet(db, id);
  if (['paid'].includes(order.status)) throw new HttpError(409, 'bad_state', 'Paid orders cannot be cancelled here');
  db.prepare('UPDATE orders SET status=?, updated_at=? WHERE id=?').run('cancelled', now(), id);
  logEvent(db, id, 'cancelled', '');
  return view(mustGet(db, id));
}

export function mustGet(db, id) {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!o) throw new HttpError(404, 'not_found', 'Order not found');
  return o;
}

export function view(o, reward = null) {
  return {
    id: o.id,
    status: o.status,
    lang: o.lang,
    items: JSON.parse(o.items_json),
    totalKes: o.total_kes,
    approvedTotalKes: o.approved_total_kes,
    budgetKes: o.budget_kes,
    approvalMethod: o.approval_method,
    createdOffline: Boolean(o.created_offline),
    paymentMode: o.payment_mode,
    usdAmount: o.usd_amount,
    receipt: o.receipt_json ? JSON.parse(o.receipt_json) : null,
    reward: reward ? { id: reward.id, rewardKes: reward.reward_kes, status: reward.status } : undefined,
    updatedAt: o.updated_at,
  };
}
