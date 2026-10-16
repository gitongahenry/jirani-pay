import { parseRequest } from './nlu.js';
import { config } from './config.js';

export const fmtKes = (n) => `KSh ${Number(n).toLocaleString('en-KE')}`;

export function searchProducts(db, { category, keywords }) {
  const rows = db
    .prepare(
      `SELECT p.*, s.name AS supplier_name, s.county, s.delivery_days
       FROM products p JOIN suppliers s ON s.id = p.supplier_id
       WHERE p.active = 1 AND p.stock > 0 ${category ? 'AND p.category = ?' : ''}`,
    )
    .all(...(category ? [category] : []));
  const kw = new Set(keywords);
  return rows
    .map((r) => {
      const hits = r.keywords.split(' ').filter((k) => kw.has(k)).length;
      return { ...r, relevance: hits };
    })
    .sort((a, b) => b.relevance - a.relevance || a.price_kes - b.price_kes);
}

/** Build grounded offers: each is a real catalogue row with an exact total. */
export function buildOffers(db, parsed) {
  const products = searchProducts(db, parsed).slice(0, 6);
  const qty = parsed.quantity || 1;
  return products.map((p) => {
    const quantity = Math.min(qty, p.stock);
    // If the budget allows more than requested and the farmer gave no quantity, suggest the max affordable up to 5.
    const total = p.price_kes * quantity;
    return {
      productId: p.id,
      name_en: p.name_en,
      name_sw: p.name_sw,
      unit: p.unit,
      supplier: p.supplier_name,
      county: p.county,
      deliveryDays: p.delivery_days,
      unitPriceKes: p.price_kes,
      quantity,
      totalKes: total,
      stock: p.stock,
      withinBudget: parsed.budget ? total <= parsed.budget : null,
      relevance: p.relevance,
    };
  });
}

function templateExplanation(lang, parsed, offers, recommended) {
  if (parsed.confidence < 0.5 || !offers.length) {
    return lang === 'sw'
      ? 'Samahani, sijaelewa vizuri. Tafadhali sema unachohitaji, kwa mfano: "mbegu za mahindi, bajeti ya elfu tatu".'
      : 'Sorry, I did not fully understand. Please say what you need, for example: "maize seeds, budget KSh 3,000".';
  }
  const parts = [];
  if (!recommended) {
    return lang === 'sw'
      ? `Hakuna bidhaa inayofaa bajeti yako ya ${fmtKes(parsed.budget)}. Bei ya chini zaidi ni ${fmtKes(Math.min(...offers.map((o) => o.totalKes)))}.`
      : `Nothing fits your ${fmtKes(parsed.budget)} budget. The lowest total is ${fmtKes(Math.min(...offers.map((o) => o.totalKes)))}.`;
  }
  const r = recommended;
  if (lang === 'sw') {
    parts.push(`Nimepata chaguo ${offers.length}. Ninapendekeza ${r.name_sw} kutoka ${r.supplier}, ${fmtKes(r.unitPriceKes)} kila moja, jumla ${fmtKes(r.totalKes)}.`);
    if (parsed.budget) parts.push(`Hii iko ndani ya bajeti yako ya ${fmtKes(parsed.budget)}; utabaki na ${fmtKes(parsed.budget - r.totalKes)}.`);
    parts.push(`Uwasilishaji ni takriban siku ${r.deliveryDays} (makadirio, si ahadi).`);
  } else {
    parts.push(`I found ${offers.length} options. I recommend ${r.name_en} from ${r.supplier}, ${fmtKes(r.unitPriceKes)} each, total ${fmtKes(r.totalKes)}.`);
    if (parsed.budget) parts.push(`That is within your ${fmtKes(parsed.budget)} budget, leaving ${fmtKes(parsed.budget - r.totalKes)}.`);
    parts.push(`Delivery is about ${r.deliveryDays} days (an estimate, not a guarantee).`);
  }
  return parts.join(' ');
}

/** Numbers in an LLM sentence must all come from the computed facts, else we use the template. */
export function numbersGrounded(text, allowed) {
  const nums = (text.match(/\d[\d,]*/g) || []).map((n) => Number(n.replace(/,/g, '')));
  return nums.every((n) => allowed.has(n));
}

async function llmExplain(lang, facts) {
  if (!config.aiUrl) return null;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), config.aiTimeoutMs);
    const res = await fetch(`${config.aiUrl}/explain`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lang, facts }),
      signal: ctl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.text === 'string' ? data.text : null;
  } catch {
    return null;
  }
}

export async function assist(db, { text, lang = 'sw', budget }) {
  const parsed = parseRequest(text || '');
  if (budget && !parsed.budget) parsed.budget = Number(budget);
  if (parsed.category && parsed.budget) parsed.confidence = 0.9;
  const offers = parsed.confidence >= 0.5 ? buildOffers(db, parsed) : [];

  const affordable = parsed.budget ? offers.filter((o) => o.withinBudget) : offers;
  // Recommend the most relevant affordable offer; ties broken by lower total.
  const recommended = [...affordable].sort((a, b) => b.relevance - a.relevance || a.totalKes - b.totalKes)[0] || null;

  let explanation = templateExplanation(lang, parsed, offers, recommended);
  let explanationSource = 'rules';
  if (recommended) {
    const allowed = new Set([offers.length, recommended.unitPriceKes, recommended.totalKes, recommended.deliveryDays, recommended.quantity, parsed.budget, parsed.budget - recommended.totalKes].filter((v) => v != null));
    const llm = await llmExplain(lang, { recommended, budget: parsed.budget, optionCount: offers.length, remaining: parsed.budget ? parsed.budget - recommended.totalKes : null });
    if (llm && numbersGrounded(llm, allowed)) {
      explanation = llm;
      explanationSource = 'huggingface-model';
    }
  }
  return {
    parsed,
    offers,
    recommendedProductId: recommended?.productId || null,
    explanation,
    explanationSource,
    uncertain: parsed.confidence < 0.5,
    notice: lang === 'sw' ? 'Bei na upatikanaji huthibitishwa tena wakati wa kulipa.' : 'Prices and availability are re-checked when you pay.',
  };
}
