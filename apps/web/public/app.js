import { parseRequest, parseYesNo } from '/nlu.js';

/* ---------- tiny helpers ---------- */
const $ = (s) => document.querySelector(s);
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}
const store = {
  get(k, d) { try { const v = localStorage.getItem('jirani.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('jirani.' + k, JSON.stringify(v)); } catch { /* storage blocked: app still works for this session */ } },
};
const kes = (n) => 'KSh ' + Number(n).toLocaleString('en-KE');
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2));

/* ---------- i18n (Kiswahili first) ---------- */
const T = {
  sw: {
    tabs: { shop: 'Nunua', orders: 'Oda zangu', impact: 'Athari', admin: 'Msimamizi' },
    ask: 'Unahitaji nini?', askHint: 'Mfano: mbegu za mahindi, bajeti ya elfu tatu', budget: 'Bajeti (KSh)', go: 'Tafuta', mic: 'Sema', listening: 'Nasikiliza…',
    noMic: 'Kipaza sauti hakipatikani kwenye kifaa hiki. Andika badala yake.',
    recommended: 'Inapendekezwa', select: 'Chagua', speak: 'Soma kwa sauti', qty: 'Idadi', deliv: 'Siku za uwasilishaji (makadirio)',
    within: 'Ndani ya bajeti', over: 'Zaidi ya bajeti', leftover: 'Utabaki na',
    approveTitle: 'Thibitisha ununuzi', approveTotal: 'Utalipa jumla ya', approveBtn: 'Nakubali kulipa', cancel: 'Ghairi',
    mode: 'Njia ya kuthibitisha', modes: { touch: 'Gusa', hold: 'Shikilia', voice: 'Sauti', switch: 'Kitufe kimoja' },
    holdHint: 'Shikilia kitufe kwa sekunde 1.5 ili kukubali.', voiceHint: 'Sema "ndiyo" kukubali au "hapana" kughairi.', switchHint: 'Bonyeza Nafasi/Enter wakati chaguo unalotaka limeangaziwa.',
    queued: 'Imehifadhiwa. Itatumwa mtandao ukirudi. Hujalipa bado.', sent: 'Oda imetumwa.', needReapprove: 'Bei au upatikanaji umebadilika. Tafadhali thibitisha tena.',
    pay: 'Lipa na PayPal', reapprove: 'Thibitisha tena', offline: 'Huna mtandao. Unaweza kuendelea; oda itahifadhiwa kwenye simu.', online: 'Mtandao umerudi.',
    sim: 'MAJARIBIO: malipo ni ya kuigiza, hakuna pesa halisi.', sandbox: 'MAJARIBIO: PayPal Sandbox, pesa za majaribio tu.',
    myOrders: 'Oda zangu', none: 'Hakuna oda bado.', status: { approved: 'Imekubaliwa', needs_reapproval: 'Inahitaji kuthibitishwa tena', payment_pending: 'Inasubiri malipo', paid: 'Imelipwa', failed: 'Imeshindikana', cancelled: 'Imeghairiwa', queued: 'Inasubiri mtandao' },
    receipt: 'Risiti', charged: 'Imetozwa (USD)', rate: 'Kiwango', conf: 'Imelipwa', via: 'Njia ya kuthibitisha',
    agent: 'Hali ya wakala wa jamii', agentOn: 'Ninasaidiwa na wakala', consent: 'Ninakubali kuwa ununuzi huu wa kwanza uhesabiwe kama mafanikio ya wakala wangu. Hakuna taarifa zangu binafsi zitakazohifadhiwa.', pickAgent: 'Chagua wakala',
    impactTitle: 'Leja ya Athari', programs: 'Programu', funded: 'Fedha', avail: 'Zilizobaki', outcomes: 'Matokeo', rewards: 'Zawadi za wakala', noRewards: 'Hakuna zawadi bado.',
    ledgerNote: 'Zawadi hulipwa tu baada ya malipo kuthibitishwa na mteja kukubali. Tarehe na kiasi vinaonekana hadharani; majina ya wateja hayahifadhiwi.',
    adminToken: 'Tokeni ya msimamizi', load: 'Pakia', save: 'Hifadhi', payout: 'Lipa zawadi', summary: 'Muhtasari',
    uncertain: 'Samahani, sijaelewa. Jaribu tena.', source: 'Maelezo kutoka', retry: 'Jaribu tena',
  },
  en: {
    tabs: { shop: 'Shop', orders: 'My orders', impact: 'Impact', admin: 'Admin' },
    ask: 'What do you need?', askHint: 'Example: maize seeds, budget KSh 3,000', budget: 'Budget (KSh)', go: 'Search', mic: 'Speak', listening: 'Listening…',
    noMic: 'Voice input is not available on this device. Please type instead.',
    recommended: 'Recommended', select: 'Select', speak: 'Read aloud', qty: 'Quantity', deliv: 'Delivery days (estimate)',
    within: 'Within budget', over: 'Over budget', leftover: 'You keep',
    approveTitle: 'Approve purchase', approveTotal: 'You will pay a total of', approveBtn: 'I approve this payment', cancel: 'Cancel',
    mode: 'Approval method', modes: { touch: 'Touch', hold: 'Hold', voice: 'Voice', switch: 'Single switch' },
    holdHint: 'Press and hold the button for 1.5 seconds to approve.', voiceHint: 'Say "yes" to approve or "no" to cancel.', switchHint: 'Press Space/Enter while your choice is highlighted.',
    queued: 'Saved on this phone. It will be sent when you are online. You have not paid yet.', sent: 'Order sent.', needReapprove: 'Price or availability changed. Please approve again.',
    pay: 'Pay with PayPal', reapprove: 'Approve again', offline: 'You are offline. You can continue; the order is saved on your phone.', online: 'Back online.',
    sim: 'DEMO: payments are simulated, no real money moves.', sandbox: 'DEMO: PayPal Sandbox, test money only.',
    myOrders: 'My orders', none: 'No orders yet.', status: { approved: 'Approved', needs_reapproval: 'Needs approval again', payment_pending: 'Awaiting payment', paid: 'Paid', failed: 'Failed', cancelled: 'Cancelled', queued: 'Waiting for network' },
    receipt: 'Receipt', charged: 'Charged (USD)', rate: 'Rate', conf: 'Paid', via: 'Approved by',
    agent: 'Community agent mode', agentOn: 'An agent is helping me', consent: 'I agree this first purchase may count as an outcome for my agent. None of my personal details are stored.', pickAgent: 'Choose agent',
    impactTitle: 'Impact Ledger', programs: 'Programs', funded: 'Funded', avail: 'Available', outcomes: 'Outcomes', rewards: 'Agent rewards', noRewards: 'No rewards yet.',
    ledgerNote: 'Rewards are paid only after verified payment and customer consent. Dates and amounts are public; customer identities are not stored.',
    adminToken: 'Admin token', load: 'Load', save: 'Save', payout: 'Pay reward', summary: 'Summary',
    uncertain: 'Sorry, I did not understand. Please try again.', source: 'Explanation from', retry: 'Try again',
  },
};

/* ---------- state ---------- */
const S = {
  lang: store.get('lang', 'sw'), big: store.get('big', false), hc: store.get('hc', false), mode: store.get('mode', 'touch'),
  clientId: store.get('clientId', null) || (() => { const id = 'c-' + uuid(); store.set('clientId', id); return id; })(),
  config: store.get('config', { payment: 'simulated', aiModelService: false }), catalog: store.get('catalog', []),
  queue: store.get('queue', []), orders: store.get('orders', []), agent: store.get('agent', { on: false, id: '', consent: false }),
  tab: 'shop', result: null, selected: null, qty: 1, busy: false, notice: '', adminToken: '', online: navigator.onLine,
};
const t = () => T[S.lang];
const say = (msg) => { $('#live').textContent = ''; setTimeout(() => ($('#live').textContent = msg), 30); };

/* ---------- api ---------- */
async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers || {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

/* ---------- speech ---------- */
function speak(text) {
  const locale = S.lang === 'sw' ? 'sw-KE' : 'en-KE';
  if ('speechSynthesis' in window) {
    const voices = speechSynthesis.getVoices();
    const v = voices.find((x) => x.lang.toLowerCase().startsWith(S.lang));
    if (v || S.lang === 'en') {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = locale; if (v) u.voice = v;
      speechSynthesis.cancel(); speechSynthesis.speak(u);
      return;
    }
  }
  if (S.config.aiModelService && S.online) {
    fetch('/api/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) })
      .then((r) => (r.ok ? r.blob() : Promise.reject()))
      .then((b) => new Audio(URL.createObjectURL(b)).play())
      .catch(() => say(text));
    return;
  }
  say(text); // screen readers still announce it
}
function listen(onText, onError) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return onError(t().noMic);
  const r = new SR();
  r.lang = S.lang === 'sw' ? 'sw-KE' : 'en-KE';
  r.interimResults = false; r.maxAlternatives = 1;
  r.onresult = (e) => onText(e.results[0][0].transcript);
  r.onerror = () => onError(t().noMic);
  try { r.start(); } catch { onError(t().noMic); }
  return r;
}

/* ---------- offline assistant (same parser as the server, run on the cached catalogue) ---------- */
function offlineAssist(text, budgetField) {
  const parsed = parseRequest(text);
  if (budgetField && !parsed.budget) parsed.budget = Number(budgetField);
  if (parsed.category && parsed.budget) parsed.confidence = 0.9;
  if (parsed.confidence < 0.5) return { parsed, offers: [], uncertain: true, explanation: t().uncertain, explanationSource: 'offline-rules' };
  const kw = new Set(parsed.keywords);
  const qty = parsed.quantity || 1;
  const offers = S.catalog
    .filter((p) => p.stock > 0 && (!parsed.category || p.category === parsed.category))
    .map((p) => ({ productId: p.id, name_en: p.name_en, name_sw: p.name_sw, unit: p.unit, supplier: p.supplier, county: p.county, deliveryDays: null, unitPriceKes: p.priceKes, quantity: Math.min(qty, p.stock), totalKes: p.priceKes * Math.min(qty, p.stock), stock: p.stock, relevance: (p.keywords || '').split(' ').filter((k) => kw.has(k)).length }))
    .map((o) => ({ ...o, withinBudget: parsed.budget ? o.totalKes <= parsed.budget : null }))
    .sort((a, b) => b.relevance - a.relevance || a.unitPriceKes - b.unitPriceKes).slice(0, 6);
  const rec = offers.filter((o) => o.withinBudget !== false)[0];
  return { parsed, offers, recommendedProductId: rec?.productId || null, uncertain: false, explanationSource: 'offline-rules', explanation: S.lang === 'sw' ? 'Huna mtandao: bei zinatoka kwenye orodha iliyohifadhiwa na zitathibitishwa tena baadaye.' : 'You are offline: prices come from the saved list and will be re-checked later.' };
}

/* ---------- queue + sync ---------- */
function persistOrders() { store.set('orders', S.orders.slice(0, 30)); store.set('queue', S.queue); }
function remember(o) { S.orders = [o, ...S.orders.filter((x) => x.id !== o.id)]; persistOrders(); }

async function flushQueue() {
  if (!S.online || !S.queue.length || S.busy) return;
  S.busy = true;
  const keep = [];
  for (const payload of S.queue) {
    try {
      const r = await api('/api/orders', { method: 'POST', body: payload });
      if (r.ok) remember({ id: payload.id, status: r.data.order.status, totalKes: r.data.order.totalKes });
      else if (r.status >= 400 && r.status < 500) remember({ id: payload.id, status: 'failed', totalKes: payload.approval.approvedTotalKes });
      else keep.push(payload);
    } catch { keep.push(payload); }
  }
  S.queue = keep; S.busy = false; persistOrders(); render();
  if (!keep.length) say(t().sent);
}

async function submitApproved(selection, method) {
  const payload = {
    id: uuid(), clientId: S.clientId, lang: S.lang, budgetKes: selection.budget,
    items: [{ productId: selection.offer.productId, qty: selection.qty }],
    approval: { method, approvedTotalKes: selection.total, at: new Date().toISOString() },
    createdOffline: !S.online,
    agentId: S.agent.on && S.agent.consent ? S.agent.id : null,
    inclusionConsent: Boolean(S.agent.on && S.agent.consent && S.agent.id),
  };
  S.selected = null; S.result = null;
  if (!S.online) {
    S.queue.push(payload); remember({ id: payload.id, status: 'queued', totalKes: selection.total });
    S.tab = 'orders'; S.notice = t().queued; render(); say(t().queued); speak(t().queued); return;
  }
  try {
    const r = await api('/api/orders', { method: 'POST', body: payload });
    if (!r.ok) { S.notice = r.data.message || 'Error'; render(); return; }
    remember({ id: payload.id, status: r.data.order.status, totalKes: r.data.order.totalKes });
    S.tab = 'orders'; S.notice = r.data.order.status === 'approved' ? t().sent : t().needReapprove; render(); say(S.notice);
  } catch {
    // Network dropped mid-request: queue it. The id makes the retry safe.
    S.queue.push(payload); remember({ id: payload.id, status: 'queued', totalKes: selection.total });
    S.tab = 'orders'; S.notice = t().queued; render();
  }
}

async function payOrder(id) {
  const r = await api(`/api/orders/${id}/pay`, { method: 'POST', body: {} });
  if (!r.ok) { S.notice = r.data.message || 'Error'; await refreshOrders(); render(); return; }
  location.href = r.data.approveUrl;
}
async function reapproveOrder(id, total) {
  const r = await api(`/api/orders/${id}/reapprove`, { method: 'POST', body: { approval: { method: 'touch', approvedTotalKes: total, at: new Date().toISOString() } } });
  S.notice = r.ok ? t().sent : r.data.message || 'Error'; await refreshOrders(); render();
}
async function refreshOrders() {
  if (!S.online) return;
  for (const o of S.orders) {
    if (S.queue.find((q) => q.id === o.id)) continue;
    try { const r = await api('/api/orders/' + o.id); if (r.ok) Object.assign(o, { status: r.data.status, totalKes: r.data.totalKes, approvedTotalKes: r.data.approvedTotalKes, reward: r.data.reward }); } catch { /* keep cached */ }
  }
  persistOrders();
}

/* ---------- approval widgets ---------- */
let holdTimer = null; let scanTimer = null; let recog = null;
function stopApprovalHelpers() { clearInterval(scanTimer); clearTimeout(holdTimer); if (recog) { try { recog.abort(); } catch { /* ignore */ } recog = null; } }

function approvalPanel(sel) {
  const box = h('div', { class: 'card', role: 'group', 'aria-labelledby': 'apv' });
  const total = h('div', { class: 'total' }, kes(sel.total));
  box.append(h('h2', { id: 'apv' }, t().approveTitle), h('p', {}, t().approveTotal, ' ', total),
    h('p', { class: 'muted' }, `${t().budget}: ${kes(sel.budget)} · ${t().leftover}: ${kes(sel.budget - sel.total)}`));
  const modeSel = h('select', { id: 'mode', 'aria-label': t().mode, onchange: (e) => { S.mode = e.target.value; store.set('mode', S.mode); render(); } },
    Object.entries(t().modes).map(([k, v]) => h('option', { value: k, selected: k === S.mode }, v)));
  box.append(h('label', { for: 'mode' }, t().mode), modeSel);
  const approve = () => { stopApprovalHelpers(); submitApproved(sel, S.mode === 'switch' ? 'switch' : S.mode === 'hold' ? 'gesture' : S.mode === 'voice' ? 'voice' : 'touch'); };
  const cancel = () => { stopApprovalHelpers(); S.selected = null; render(); };
  const aBtn = h('button', { class: 'primary big-approve', id: 'approveBtn' }, h('div', { class: 'fill' }), h('span', {}, t().approveBtn + ' · ' + kes(sel.total)));
  const cBtn = h('button', { class: 'danger', id: 'cancelBtn', onclick: cancel }, t().cancel);

  if (S.mode === 'touch') { aBtn.addEventListener('click', approve); box.append(aBtn); }
  if (S.mode === 'hold') {
    box.append(h('p', { class: 'muted' }, t().holdHint), aBtn);
    const fill = aBtn.querySelector('.fill');
    const begin = () => { fill.style.transition = 'width 1.5s linear'; fill.style.width = '100%'; holdTimer = setTimeout(approve, 1500); };
    const end = () => { clearTimeout(holdTimer); fill.style.transition = 'none'; fill.style.width = '0'; };
    aBtn.addEventListener('pointerdown', begin); ['pointerup', 'pointerleave', 'pointercancel'].forEach((e) => aBtn.addEventListener(e, end));
    aBtn.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); begin(); } });
    aBtn.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') end(); });
  }
  if (S.mode === 'voice') {
    box.append(h('p', { class: 'muted' }, t().voiceHint), aBtn);
    aBtn.addEventListener('click', () => {
      speak(`${t().approveTotal} ${sel.total} shilingi. ${t().voiceHint}`);
      aBtn.querySelector('span').textContent = t().listening;
      recog = listen((txt) => { const a = parseYesNo(txt, S.lang); if (a === 'yes') approve(); else if (a === 'no') cancel(); else { aBtn.querySelector('span').textContent = t().retry; } }, (m) => { aBtn.querySelector('span').textContent = m; });
    });
  }
  if (S.mode === 'switch') {
    box.append(h('p', { class: 'muted' }, t().switchHint), aBtn);
    aBtn.addEventListener('click', approve);
    // Single-switch scanning: highlight alternates between Approve and Cancel; Space/Enter picks the highlighted one.
    let idx = 0; const els = [aBtn, cBtn];
    const mark = () => els.forEach((e, i) => e.classList.toggle('scan', i === idx));
    mark();
    scanTimer = setInterval(() => { idx = (idx + 1) % 2; mark(); say(idx === 0 ? t().approveBtn : t().cancel); }, 2500);
    const key = (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); document.removeEventListener('keydown', key); idx === 0 ? approve() : cancel(); } };
    document.addEventListener('keydown', key);
  }
  box.append(h('div', { class: 'row', style: 'margin-top:.6rem' }, cBtn));
  return box;
}

/* ---------- views ---------- */
function offerCard(o, rec) {
  const name = S.lang === 'sw' ? o.name_sw : o.name_en;
  const c = h('div', { class: 'card' + (rec ? ' rec' : '') });
  c.append(h('div', { class: 'row' }, h('strong', { class: 'grow' }, name), rec ? h('span', { class: 'pill' }, '★ ' + t().recommended) : null));
  c.append(h('div', { class: 'muted' }, `${o.supplier} · ${o.county}${o.deliveryDays ? ' · ' + t().deliv + ': ' + o.deliveryDays : ''}`));
  c.append(h('div', {}, `${kes(o.unitPriceKes)} × ${o.quantity} = `, h('span', { class: 'total' }, kes(o.totalKes))));
  if (o.withinBudget != null) c.append(h('div', { class: o.withinBudget ? 'good' : 'badtxt' }, o.withinBudget ? '✓ ' + t().within : '✗ ' + t().over));
  const qtyIn = h('input', { type: 'number', min: 1, max: Math.min(100, o.stock), value: o.quantity, 'aria-label': t().qty, style: 'max-width:6rem' });
  const sel = h('button', { class: 'primary', onclick: () => {
    const q = Math.max(1, Math.min(o.stock, Number(qtyIn.value) || 1));
    S.selected = { offer: o, qty: q, total: o.unitPriceKes * q, budget: S.result?.parsed?.budget || o.unitPriceKes * q };
    render(); setTimeout(() => $('#approveBtn')?.focus(), 50);
  } }, t().select);
  c.append(h('div', { class: 'row' }, h('label', { class: 'sr', for: 'q' + o.productId }, t().qty), qtyIn, sel,
    h('button', { onclick: () => speak(`${name}. ${o.totalKes} shilingi. ${o.supplier}.`) }, '🔊 ' + t().speak)));
  qtyIn.id = 'q' + o.productId;
  return c;
}

function shopView() {
  const root = h('div');
  const input = h('input', { type: 'text', id: 'q', placeholder: t().askHint, autocomplete: 'off', 'aria-label': t().ask });
  const budget = h('input', { type: 'number', id: 'b', min: 1, inputmode: 'numeric', 'aria-label': t().budget });
  const run = async (text) => {
    text = text ?? input.value;
    if (!text.trim()) return;
    if (S.online) {
      try { const r = await api('/api/assistant', { method: 'POST', body: { text, lang: S.lang, budget: budget.value ? Number(budget.value) : undefined } }); S.result = r.ok ? r.data : offlineAssist(text, budget.value); }
      catch { S.result = offlineAssist(text, budget.value); }
    } else S.result = offlineAssist(text, budget.value);
    S.selected = null; render();
    say(S.result.explanation); if (S.result.explanation) speak(S.result.explanation);
  };
  const form = h('form', { onsubmit: (e) => { e.preventDefault(); run(); } },
    h('label', { for: 'q' }, t().ask), h('div', { class: 'row' }, h('div', { class: 'grow' }, input),
      h('button', { type: 'button', id: 'mic', 'aria-label': t().mic, onclick: () => { const b = $('#mic'); b.textContent = '…'; listen((txt) => { input.value = txt; b.textContent = '🎤'; run(txt); }, (m) => { b.textContent = '🎤'; S.notice = m; render(); }); } }, '🎤')),
    h('label', { for: 'b' }, t().budget), budget, h('div', { class: 'row', style: 'margin-top:.6rem' }, h('button', { class: 'primary', type: 'submit' }, t().go)));
  root.append(form);
  if (S.agent.on) root.append(agentBox());
  if (S.notice) root.append(h('p', { class: 'card', role: 'status' }, S.notice));
  if (S.result) {
    root.append(h('p', { class: 'card', role: 'status' }, S.result.explanation, h('br'), h('span', { class: 'muted' }, `${t().source}: ${S.result.explanationSource}`)));
    S.result.offers.forEach((o) => root.append(offerCard(o, o.productId === S.result.recommendedProductId)));
  }
  if (S.selected) root.append(approvalPanel(S.selected));
  return root;
}
function agentBox() {
  const sel = h('select', { 'aria-label': t().pickAgent, onchange: (e) => { S.agent.id = e.target.value; store.set('agent', S.agent); } },
    h('option', { value: '' }, t().pickAgent), ...(S.agents || []).map((a) => h('option', { value: a.id, selected: a.id === S.agent.id }, a.name)));
  const cb = h('input', { type: 'checkbox', id: 'consent', checked: S.agent.consent, onchange: (e) => { S.agent.consent = e.target.checked; store.set('agent', S.agent); } });
  return h('div', { class: 'card' }, h('strong', {}, t().agent), sel, h('label', { for: 'consent' }, cb, ' ', t().consent));
}

function ordersView() {
  const root = h('div', {}, h('h2', {}, t().myOrders));
  if (S.notice) root.append(h('p', { class: 'card', role: 'status' }, S.notice));
  const params = new URLSearchParams(location.search);
  if (S.receipt) root.append(receiptCard(S.receipt));
  if (!S.orders.length) root.append(h('p', { class: 'muted' }, t().none));
  for (const o of S.orders) {
    const queued = S.queue.some((q) => q.id === o.id);
    const st = queued ? 'queued' : o.status;
    const c = h('div', { class: 'card' }, h('div', { class: 'row' }, h('strong', { class: 'grow' }, '#' + o.id.slice(0, 8)), h('span', { class: 'pill' }, t().status[st] || st)), h('div', {}, kes(o.totalKes)));
    if (o.reward) c.append(h('div', { class: 'good' }, '✓ ' + kes(o.reward.rewardKes) + ' (agent)'));
    const row = h('div', { class: 'row' });
    if (st === 'approved' || st === 'payment_pending') row.append(h('button', { class: 'primary', onclick: () => payOrder(o.id) }, t().pay));
    if (st === 'needs_reapproval') row.append(h('button', { class: 'primary', onclick: () => reapproveOrder(o.id, o.totalKes) }, t().reapprove + ' (' + kes(o.totalKes) + ')'));
    if (st === 'paid') row.append(h('button', { onclick: async () => { const r = await api('/api/orders/' + o.id); S.receipt = r.data; render(); } }, t().receipt));
    c.append(row); root.append(c);
  }
  void params; return root;
}
function receiptCard(o) {
  const r = o.receipt; if (!r) return h('div');
  const c = h('div', { class: 'card rec', role: 'region', 'aria-label': t().receipt }, h('h2', {}, t().receipt + ' #' + o.id.slice(0, 8)));
  c.append(h('p', { class: r.simulated ? 'badtxt' : 'muted' }, r.disclosure));
  const tb = h('table'); for (const l of r.lines) tb.append(h('tr', {}, h('td', {}, S.lang === 'sw' ? l.name_sw : l.name_en), h('td', {}, `${l.qty} × ${kes(l.unitPriceKes)}`), h('td', {}, kes(l.lineKes))));
  c.append(tb, h('p', { class: 'total' }, kes(r.totalKes)), h('p', { class: 'muted' }, `${t().charged}: USD ${r.chargedUsd} · ${t().rate}: ${r.fxRateKesPerUsd} KES/USD`),
    h('p', { class: 'muted' }, `${t().via}: ${r.approvalMethod} · ${t().conf}: ${new Date(r.paidAt).toLocaleString()} · ${r.captureId}`),
    h('button', { onclick: () => speak(`${t().receipt}. ${r.totalKes} shilingi. ${t().conf}.`) }, '🔊 ' + t().speak));
  return c;
}

function impactView() {
  const root = h('div', {}, h('h2', {}, t().impactTitle), h('p', { class: 'muted' }, t().ledgerNote));
  root.append(h('div', { class: 'card' }, h('strong', {}, t().agent), agentToggle(), S.agent.on ? agentBox() : null));
  for (const p of S.programs || []) root.append(h('div', { class: 'card' }, h('strong', {}, p.name), h('div', { class: 'muted' }, p.sponsor), h('div', {}, `${t().funded}: ${kes(p.funded_kes)} · ${t().avail}: ${kes(p.availableKes)} · ${t().outcomes}: ${p.outcomes}/${p.target_outcomes}`), h('div', { class: 'pill' }, p.funding_mode === 'simulated' ? 'DEMO funding' : p.funding_mode)));
  root.append(h('h2', {}, t().rewards));
  if (!(S.ledger || []).length) root.append(h('p', { class: 'muted' }, t().noRewards));
  for (const m of S.ledger || []) root.append(h('div', { class: 'card' }, h('div', { class: 'row' }, h('strong', { class: 'grow' }, m.agent), h('span', { class: 'pill' }, m.status)), h('div', {}, kes(m.rewardKes) + ' · ' + m.type), h('div', { class: 'muted' }, `ref ${m.orderRef} · ${m.payoutMode || 'pending'} ${m.payoutRef || ''}`)));
  return root;
}
function agentToggle() {
  return h('label', { for: 'agon' }, h('input', { type: 'checkbox', id: 'agon', checked: S.agent.on, onchange: (e) => { S.agent.on = e.target.checked; store.set('agent', S.agent); render(); } }), ' ', t().agentOn);
}

function adminView() {
  const root = h('div', {}, h('h2', {}, t().tabs.admin));
  const tok = h('input', { type: 'password', id: 'tok', value: S.adminToken, 'aria-label': t().adminToken });
  root.append(h('label', { for: 'tok' }, t().adminToken), tok, h('div', { class: 'row', style: 'margin-top:.5rem' }, h('button', { class: 'primary', onclick: async () => { S.adminToken = tok.value; await loadAdmin(); render(); } }, t().load)));
  if (S.adminErr) root.append(h('p', { class: 'badtxt' }, S.adminErr));
  if (S.summary) root.append(h('div', { class: 'card' }, h('strong', {}, t().summary), h('pre', {}, JSON.stringify(S.summary, null, 1))));
  if (S.summary) {
    const tb = h('table');
    for (const p of S.catalog) {
      const price = h('input', { type: 'number', value: p.priceKes, 'aria-label': 'price ' + p.name_en, style: 'width:6rem' });
      const stock = h('input', { type: 'number', value: p.stock, 'aria-label': 'stock ' + p.name_en, style: 'width:5rem' });
      tb.append(h('tr', {}, h('td', {}, p.name_en), h('td', {}, price), h('td', {}, stock), h('td', {}, h('button', { onclick: async () => {
        const r = await api('/api/admin/products/' + p.id, { method: 'PUT', headers: { 'x-admin-token': S.adminToken }, body: { ...p, supplierId: supplierFor(p), priceKes: Number(price.value), stock: Number(stock.value) } });
        S.notice = r.ok ? 'OK' : r.data.message; await loadCatalog(); render();
      } }, t().save))));
    }
    root.append(tb);
    for (const m of (S.ledger || []).filter((x) => x.status === 'eligible')) root.append(h('div', { class: 'card' }, `${m.agent} · ${kes(m.rewardKes)} `, h('button', { class: 'primary', onclick: async () => { await api(`/api/admin/ledger/milestones/${m.id}/payout`, { method: 'POST', headers: { 'x-admin-token': S.adminToken }, body: {} }); await loadLedger(); render(); } }, t().payout)));
  }
  return root;
}
const supplierFor = (p) => ({ 'Shamba Agrovet (demo)': 'sup-shamba', 'Mavuno Seeds Co-op (demo)': 'sup-mavuno', 'Jirani Farm Supplies (demo)': 'sup-jirani' }[p.supplier] || 'sup-shamba');

/* ---------- data loaders ---------- */
async function loadCatalog() { try { const r = await api('/api/catalog'); if (r.ok) { S.catalog = r.data; store.set('catalog', r.data); } } catch { /* offline: cached */ } }
async function loadConfig() { try { const r = await api('/api/config'); if (r.ok) { S.config = r.data; store.set('config', r.data); } } catch { /* cached */ } }
async function loadLedger() { try { const [a, b, c] = await Promise.all([api('/api/ledger'), api('/api/ledger/programs'), api('/api/agents')]); S.ledger = a.data.milestones; S.programs = b.data; S.agents = c.data; } catch { /* offline */ } }
async function loadAdmin() { const r = await api('/api/admin/summary', { headers: { 'x-admin-token': S.adminToken } }); if (r.ok) { S.summary = r.data; S.adminErr = ''; await loadLedger(); } else { S.summary = null; S.adminErr = r.data.message || 'Error'; } }

/* ---------- shell ---------- */
function render() {
  stopApprovalHelpers();
  document.documentElement.lang = S.lang;
  document.body.classList.toggle('big', S.big); document.body.classList.toggle('hc', S.hc);
  $('#lang').textContent = S.lang === 'sw' ? 'EN' : 'SW'; $('#big').setAttribute('aria-pressed', S.big); $('#hc').setAttribute('aria-pressed', S.hc);
  const b = $('#banner');
  b.className = !S.online ? 'off' : 'sim';
  b.textContent = !S.online ? t().offline + (S.queue.length ? ` (${S.queue.length})` : '') : S.config.payment === 'simulated' ? t().sim : t().sandbox;
  const tabs = $('#tabs'); tabs.replaceChildren(...Object.entries(t().tabs).map(([k, v]) => h('button', { role: 'tab', 'aria-selected': S.tab === k, onclick: async () => { S.tab = k; S.notice = ''; if (k === 'orders') await refreshOrders(); if (k === 'impact') await loadLedger(); render(); } }, v)));
  const views = { shop: shopView, orders: ordersView, impact: impactView, admin: adminView };
  for (const k of Object.keys(views)) { const el = $('#' + k); el.hidden = S.tab !== k; if (S.tab === k) el.replaceChildren(views[k]()); }
  $('#foot').textContent = S.lang === 'sw' ? 'Mfano wa majaribio: bidhaa, bei na wasambazaji ni za kubuni. Hakuna pesa halisi.' : 'Prototype: products, prices and suppliers are synthetic. No real money.';
}

$('#lang').onclick = () => { S.lang = S.lang === 'sw' ? 'en' : 'sw'; store.set('lang', S.lang); S.result = null; render(); };
$('#big').onclick = () => { S.big = !S.big; store.set('big', S.big); render(); };
$('#hc').onclick = () => { S.hc = !S.hc; store.set('hc', S.hc); render(); };
window.addEventListener('online', async () => { S.online = true; say(t().online); await flushQueue(); await loadCatalog(); render(); });
window.addEventListener('offline', () => { S.online = false; render(); say(t().offline); });
window.__jirani = S; // handy for demos and tests

(async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  const q = new URLSearchParams(location.search);
  await Promise.all([loadConfig(), loadCatalog(), loadLedger()]);
  await flushQueue();
  const rid = q.get('receipt');
  if (rid) { const r = await api('/api/orders/' + rid); if (r.ok) { S.receipt = r.data; remember({ id: rid, status: r.data.status, totalKes: r.data.totalKes }); S.tab = 'orders'; speak(`${t().receipt}. ${r.data.totalKes} shilingi.`); } history.replaceState(null, '', '/'); }
  else if (q.get('payment_error') || q.get('payment_cancelled')) { S.tab = 'orders'; S.notice = q.get('payment_error') ? 'Payment error: ' + q.get('payment_error') : 'Payment cancelled'; history.replaceState(null, '', '/'); }
  await refreshOrders();
  render();
})();
