import { createHash, randomUUID } from 'node:crypto';
import { now } from './db.js';
import { config } from './config.js';
import { payout } from './paypal.js';

const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 24);

export function programFunds(db, programId) {
  const p = db.prepare('SELECT * FROM programs WHERE id = ?').get(programId);
  if (!p) return null;
  const committed = db.prepare("SELECT COALESCE(SUM(reward_kes),0) AS n FROM milestones WHERE program_id = ? AND status IN ('eligible','paid')").get(programId).n;
  const paid = db.prepare("SELECT COALESCE(SUM(reward_kes),0) AS n FROM milestones WHERE program_id = ? AND status = 'paid'").get(programId).n;
  const outcomes = db.prepare("SELECT COUNT(*) AS n FROM milestones WHERE program_id = ? AND status IN ('eligible','paid')").get(programId).n;
  return { ...p, committedKes: committed, paidKes: paid, availableKes: p.funded_kes - committed, outcomes };
}

/**
 * Create an inclusion milestone after a verified paid order.
 * Rules: funds must already exist, the beneficiary consented, the order was genuinely paid and non-trivial,
 * one reward per beneficiary per program, a daily cap per agent, and no self-dealing.
 */
export function maybeReward(db, order) {
  if (!order.agent_id || !order.inclusion_consent || order.status !== 'paid') return null;
  if (order.total_kes < config.ledger.minOrderKes) return null;
  if (order.client_id === order.agent_id) return null; // self-dealing
  const agent = db.prepare('SELECT * FROM agents WHERE id = ? AND trained = 1').get(order.agent_id);
  if (!agent) return null;

  const today = now().slice(0, 10);
  const todays = db.prepare('SELECT COUNT(*) AS n FROM milestones WHERE agent_id = ? AND created_at LIKE ?').get(agent.id, `${today}%`).n;
  if (todays >= config.ledger.agentDailyCap) return null;

  const programs = db.prepare("SELECT id FROM programs WHERE status = 'active'").all();
  for (const { id } of programs) {
    const f = programFunds(db, id);
    if (f.availableKes < f.reward_kes) continue; // never promise unfunded rewards
    const beneficiary = sha(`${id}:${order.client_id}`); // pseudonymous, no identity or disability data stored
    const exists = db.prepare('SELECT 1 FROM milestones WHERE program_id = ? AND beneficiary_ref = ?').get(id, beneficiary);
    if (exists) continue;
    const m = {
      id: randomUUID(),
      program_id: id,
      agent_id: agent.id,
      order_id: order.id,
      beneficiary_ref: beneficiary,
      type: 'first_assisted_purchase',
      reward_kes: f.reward_kes,
      status: 'eligible',
      evidence: JSON.stringify({ consent: true, verifiedPayment: true, paymentMode: order.payment_mode, approvalMethod: order.approval_method, orderTotalKes: order.total_kes }),
      created_at: now(),
    };
    db.prepare('INSERT INTO milestones (id,program_id,agent_id,order_id,beneficiary_ref,type,reward_kes,status,evidence,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(
      m.id, m.program_id, m.agent_id, m.order_id, m.beneficiary_ref, m.type, m.reward_kes, m.status, m.evidence, m.created_at,
    );
    return m;
  }
  return null;
}

export async function payMilestone(db, id) {
  const m = db.prepare('SELECT * FROM milestones WHERE id = ?').get(id);
  if (!m) return { error: 'not_found' };
  if (m.status === 'paid') return { milestone: m, already: true };
  if (m.status !== 'eligible') return { error: 'not_eligible' };
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(m.agent_id);
  const result = await payout({ milestoneId: m.id, email: agent.payout_email, kes: m.reward_kes });
  db.prepare("UPDATE milestones SET status='paid', payout_mode=?, payout_ref=?, paid_at=? WHERE id=?").run(result.mode, result.ref, now(), id);
  return { milestone: db.prepare('SELECT * FROM milestones WHERE id = ?').get(id), payout: result };
}

/** Public-safe ledger view: pseudonymous, no beneficiary details. */
export function ledgerView(db, { agentId } = {}) {
  const rows = db
    .prepare(`SELECT m.*, a.name AS agent_name, p.name AS program_name, p.sponsor FROM milestones m
              JOIN agents a ON a.id = m.agent_id JOIN programs p ON p.id = m.program_id
              ${agentId ? 'WHERE m.agent_id = ?' : ''} ORDER BY m.created_at DESC LIMIT 100`)
    .all(...(agentId ? [agentId] : []));
  return rows.map((r) => ({
    id: r.id, program: r.program_name, sponsor: r.sponsor, agent: r.agent_name, type: r.type, rewardKes: r.reward_kes,
    status: r.status, payoutMode: r.payout_mode, payoutRef: r.payout_ref, createdAt: r.created_at, paidAt: r.paid_at,
    evidence: JSON.parse(r.evidence), orderRef: sha(r.order_id),
  }));
}
