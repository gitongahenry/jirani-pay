import { now, setSetting, getSetting } from './db.js';

// SYNTHETIC demo catalogue. Suppliers, prices and stock are invented for the hackathon.
const suppliers = [
  ['sup-shamba', 'Shamba Agrovet (demo)', 'Nakuru', 1],
  ['sup-mavuno', 'Mavuno Seeds Co-op (demo)', 'Eldoret', 2],
  ['sup-jirani', 'Jirani Farm Supplies (demo)', 'Kisumu', 3],
];

// [id, en, sw, category, unit, supplier, price, stock, keywords]
const products = [
  ['p-maize-h', 'Hybrid maize seed 2kg', 'Mbegu ya mahindi chotara kilo 2', 'seeds', 'pack', 'sup-mavuno', 640, 80, 'maize mahindi mbegu seed hybrid chotara'],
  ['p-maize-o', 'Open-pollinated maize seed 2kg', 'Mbegu ya mahindi ya kawaida kilo 2', 'seeds', 'pack', 'sup-shamba', 420, 120, 'maize mahindi mbegu seed kawaida'],
  ['p-maize-e', 'Early-maturing maize seed 2kg', 'Mbegu ya mahindi ya mapema kilo 2', 'seeds', 'pack', 'sup-jirani', 590, 40, 'maize mahindi mbegu seed early mapema'],
  ['p-bean-r', 'Rosecoco bean seed 1kg', 'Mbegu ya maharagwe kilo 1', 'seeds', 'pack', 'sup-shamba', 260, 90, 'beans maharagwe mbegu seed'],
  ['p-bean-c', 'Climbing bean seed 1kg', 'Mbegu ya maharagwe ya kupanda kilo 1', 'seeds', 'pack', 'sup-mavuno', 310, 30, 'beans maharagwe mbegu seed climbing'],
  ['p-sukuma', 'Kale (sukuma wiki) seed 100g', 'Mbegu ya sukuma wiki gramu 100', 'seeds', 'pack', 'sup-shamba', 120, 200, 'kale sukuma wiki mbegu seed vegetables mboga'],
  ['p-tomato', 'Tomato seed 50g', 'Mbegu ya nyanya gramu 50', 'seeds', 'pack', 'sup-jirani', 350, 55, 'tomato nyanya mbegu seed vegetables mboga'],
  ['p-fert-can', 'CAN top-dress fertilizer 10kg', 'Mbolea ya CAN kilo 10', 'fertilizer', 'bag', 'sup-shamba', 980, 60, 'fertilizer mbolea can top dress'],
  ['p-fert-dap', 'DAP planting fertilizer 10kg', 'Mbolea ya kupandia DAP kilo 10', 'fertilizer', 'bag', 'sup-mavuno', 1150, 45, 'fertilizer mbolea dap planting kupandia'],
  ['p-compost', 'Organic compost 20kg', 'Mbolea ya samadi kilo 20', 'fertilizer', 'bag', 'sup-jirani', 450, 70, 'compost samadi mbolea organic fertilizer'],
  ['p-pest', 'Maize pest control 250ml', 'Dawa ya wadudu wa mahindi mililita 250', 'pesticide', 'bottle', 'sup-shamba', 520, 35, 'pesticide dawa wadudu pest'],
  ['p-hoe', 'Hand hoe (jembe)', 'Jembe la mkono', 'tools', 'piece', 'sup-jirani', 700, 25, 'hoe jembe tool zana'],
  ['p-sprayer', 'Knapsack sprayer 16L', 'Pampu ya kunyunyizia lita 16', 'tools', 'piece', 'sup-mavuno', 2400, 10, 'sprayer pampu nyunyizia tool zana'],
];

export function seed(db) {
  const has = db.prepare('SELECT COUNT(*) AS n FROM products').get().n;
  if (!has) {
    const s = db.prepare('INSERT INTO suppliers (id,name,county,delivery_days) VALUES (?,?,?,?)');
    suppliers.forEach((r) => s.run(...r));
    const p = db.prepare('INSERT INTO products (id,name_en,name_sw,category,unit,supplier_id,price_kes,stock,keywords) VALUES (?,?,?,?,?,?,?,?,?)');
    products.forEach((r) => p.run(...r));
  }
  if (!db.prepare('SELECT COUNT(*) AS n FROM agents').get().n) {
    db.prepare('INSERT INTO agents (id,name,payout_email,trained,created_at) VALUES (?,?,?,?,?)').run('agent-amina', 'Amina W. (demo agent)', 'sb-agent@personal.example.com', 1, now());
  }
  if (!db.prepare('SELECT COUNT(*) AS n FROM programs').get().n) {
    db.prepare(
      'INSERT INTO programs (id,sponsor,name,goal,reward_kes,funded_kes,funding_mode,target_outcomes,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    ).run('prog-rural-traders', 'Demo Development Partner', 'Rural Digital Commerce 2026', 'Help smallholder farmers complete a first accessible digital purchase', 150, 100000, 'simulated', 500, 'active', now());
  }
  if (getSetting(db, 'languages', null) === null) setSetting(db, 'languages', ['sw', 'en']);
}
