import { randomUUID } from 'node:crypto';
import { config, paypalConfigured } from './config.js';

let cached = { token: null, exp: 0 };

async function token() {
  if (cached.token && Date.now() < cached.exp) return cached.token;
  const basic = Buffer.from(`${config.paypal.clientId}:${config.paypal.secret}`).toString('base64');
  const res = await fetch(`${config.paypal.base}/v1/oauth2/token`, {
    method: 'POST',
    headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`PayPal auth failed: ${res.status}`);
  const data = await res.json();
  cached = { token: data.access_token, exp: Date.now() + (data.expires_in - 60) * 1000 };
  return cached.token;
}

async function pp(path, { method = 'GET', body, requestId } = {}) {
  const res = await fetch(`${config.paypal.base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${await token()}`,
      'content-type': 'application/json',
      ...(requestId ? { 'PayPal-Request-Id': requestId } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = new Error(`PayPal ${method} ${path} -> ${res.status}: ${json.message || text}`);
    err.status = res.status;
    err.details = json;
    throw err;
  }
  return json;
}

export const kesToUsd = (kes) => (Math.round((kes / config.fx.kesPerUsd) * 100) / 100).toFixed(2);

/** Create a PayPal Checkout order. The order id is reused as PayPal-Request-Id, so retries never double-create. */
export async function createCheckout(order, items) {
  const usd = kesToUsd(order.total_kes);
  if (!paypalConfigured()) {
    const id = `SIM-${order.id.slice(0, 8)}`;
    return {
      mode: 'simulated',
      paypalOrderId: id,
      usd,
      approveUrl: `/api/paypal/simulated?order=${encodeURIComponent(order.id)}&token=${id}`,
    };
  }
  const created = await pp('/v2/checkout/orders', {
    method: 'POST',
    requestId: `jirani-create-${order.id}`,
    body: {
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: order.id,
          custom_id: order.id,
          description: `Jirani Pay order ${order.id.slice(0, 8)} (${items.length} item types, KSh ${order.total_kes})`,
          amount: { currency_code: config.fx.currency, value: usd },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            return_url: `${config.publicUrl}/api/paypal/return?order=${order.id}`,
            cancel_url: `${config.publicUrl}/api/paypal/cancel?order=${order.id}`,
            user_action: 'PAY_NOW',
            shipping_preference: 'NO_SHIPPING',
          },
        },
      },
    },
  });
  const link = (created.links || []).find((l) => ['payer-action', 'approve'].includes(l.rel));
  if (!link) throw new Error('PayPal did not return an approval link');
  return { mode: 'paypal_sandbox', paypalOrderId: created.id, usd, approveUrl: link.href };
}

/** Capture, then re-read the order from PayPal. We trust PayPal's record, never the browser. */
export async function captureAndVerify(order, paypalOrderId) {
  if (order.payment_mode === 'simulated' || !paypalConfigured()) {
    return { verified: true, status: 'COMPLETED', captureId: `SIMCAP-${order.id.slice(0, 8)}`, amount: kesToUsd(order.total_kes), simulated: true };
  }
  try {
    await pp(`/v2/checkout/orders/${paypalOrderId}/capture`, { method: 'POST', requestId: `jirani-capture-${order.id}`, body: {} });
  } catch (e) {
    // 422 ORDER_ALREADY_CAPTURED is fine: fall through to verification.
    if (!(e.status === 422 && JSON.stringify(e.details).includes('ORDER_ALREADY_CAPTURED'))) throw e;
  }
  const verified = await pp(`/v2/checkout/orders/${paypalOrderId}`);
  const unit = verified.purchase_units?.[0];
  const cap = unit?.payments?.captures?.[0];
  const ok =
    verified.status === 'COMPLETED' &&
    cap?.status === 'COMPLETED' &&
    unit?.custom_id === order.id &&
    cap.amount?.value === order.usd_amount &&
    cap.amount?.currency_code === config.fx.currency;
  return { verified: ok, status: verified.status, captureId: cap?.id, amount: cap?.amount?.value, simulated: false };
}

/** Pay a community agent through PayPal Payouts (sandbox). Falls back to a labelled simulation. */
export async function payout({ milestoneId, email, kes }) {
  const usd = kesToUsd(kes);
  if (!paypalConfigured()) return { mode: 'simulated', ref: `SIMPAYOUT-${milestoneId.slice(0, 8)}`, usd };
  const res = await pp('/v1/payments/payouts', {
    method: 'POST',
    requestId: `jirani-payout-${milestoneId}`,
    body: {
      sender_batch_header: { sender_batch_id: `jirani-${milestoneId}`, email_subject: 'Jirani Pay inclusion reward' },
      items: [{ recipient_type: 'EMAIL', receiver: email, sender_item_id: milestoneId, amount: { value: usd, currency: config.fx.currency }, note: 'Verified inclusion milestone' }],
    },
  });
  return { mode: 'paypal_sandbox', ref: res.batch_header?.payout_batch_id, usd };
}

export const newId = () => randomUUID();
