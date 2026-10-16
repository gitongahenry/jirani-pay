// Deterministic bilingual (Kiswahili/English) request parser.
// Deliberately bounded: it extracts a product need, a quantity and a budget, and
// reports low confidence rather than guessing. The LLM only phrases explanations.

const SW_NUMBERS = {
  sifuri: 0, moja: 1, mbili: 2, tatu: 3, nne: 4, tano: 5, sita: 6, saba: 7, nane: 8, tisa: 9, kumi: 10,
  ishirini: 20, thelathini: 30, arobaini: 40, hamsini: 50, sitini: 60, sabini: 70, themanini: 80, tisini: 90,
};
const EN_NUMBERS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

export const CATEGORY_WORDS = {
  seeds: ['mbegu', 'seed', 'seeds', 'mahindi', 'maize', 'maharagwe', 'beans', 'sukuma', 'kale', 'nyanya', 'tomato', 'mboga'],
  fertilizer: ['mbolea', 'fertilizer', 'fertiliser', 'samadi', 'compost', 'dap', 'can'],
  pesticide: ['dawa', 'wadudu', 'pesticide', 'pest'],
  tools: ['jembe', 'hoe', 'pampu', 'sprayer', 'zana', 'tool', 'tools'],
};

const normalize = (t) => t.toLowerCase().replace(/,/g, '').replace(/\b(ksh|kes|shilingi|sh)\b\.?/g, ' ksh ').replace(/\s+/g, ' ').trim();

function wordToNumber(tokens, i) {
  const t = tokens[i];
  if (/^\d+$/.test(t)) return Number(t);
  if (t in SW_NUMBERS) {
    // "ishirini na tano" = 25
    if (tokens[i + 1] === 'na' && tokens[i + 2] in SW_NUMBERS && SW_NUMBERS[tokens[i + 2]] < 10) return SW_NUMBERS[t] + SW_NUMBERS[tokens[i + 2]];
    return SW_NUMBERS[t];
  }
  if (t in EN_NUMBERS) return EN_NUMBERS[t];
  return null;
}

export function parseBudget(text) {
  const t = normalize(text);
  const tokens = t.split(' ');
  // "elfu tatu" = 3000, "elfu 3", "3 thousand"
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === 'elfu') {
      const n = wordToNumber(tokens, i + 1);
      if (n) return n * 1000;
    }
    if (/^\d+$/.test(tokens[i]) && (tokens[i + 1] === 'thousand' || tokens[i + 1] === 'k')) return Number(tokens[i]) * 1000;
  }
  const m = t.match(/(?:ksh|bajeti(?: ya)?|budget(?: of)?|have|nina|up to|hadi)\s*(\d{2,7})/) || t.match(/(\d{2,7})\s*ksh/) || t.match(/ksh\s*(\d{2,7})/);
  if (m) return Number(m[1]);
  const k = t.match(/\b(\d+)k\b/);
  if (k) return Number(k[1]) * 1000;
  return null;
}

export function parseRequest(text) {
  const t = normalize(text);
  const tokens = t.split(' ').filter(Boolean);
  const budget = parseBudget(text);

  const scores = {};
  for (const [cat, words] of Object.entries(CATEGORY_WORDS)) {
    scores[cat] = tokens.filter((w) => words.includes(w)).length;
  }
  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  const category = best[1] > 0 ? best[0] : null;

  // quantity: a small number next to pack/bag/kilo words, or "nataka N"
  let quantity = null;
  for (let i = 0; i < tokens.length; i++) {
    const n = wordToNumber(tokens, i);
    const next = tokens[i + 1];
    if (n && n <= 100 && ['pack', 'packs', 'bag', 'bags', 'mifuko', 'mfuko', 'pakiti', 'bottles', 'chupa', 'pieces', 'vipande'].includes(next)) quantity = n;
  }
  const keywords = tokens.filter((w) => w.length > 2 && !/^\d+$/.test(w) && w !== 'ksh');
  const confidence = category ? (budget ? 0.9 : 0.7) : 0.2;
  return { category, quantity, budget, keywords, confidence };
}

export function parseYesNo(text, lang) {
  const t = normalize(text);
  const yes = ['ndiyo', 'ndio', 'sawa', 'thibitisha', 'yes', 'confirm', 'approve', 'ok'];
  const no = ['hapana', 'siyo', 'ghairi', 'no', 'cancel', 'stop'];
  const tokens = t.split(' ');
  if (tokens.some((w) => no.includes(w))) return 'no';
  if (tokens.some((w) => yes.includes(w))) return 'yes';
  return null;
}
