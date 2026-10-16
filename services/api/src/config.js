// Central configuration. Everything is overridable by environment variables.
const env = process.env;

export const config = {
  port: Number(env.PORT || 4000),
  dbPath: env.DB_PATH || './data/jirani.db',
  adminToken: env.ADMIN_TOKEN || 'jirani-demo-admin',
  publicUrl: env.PUBLIC_URL || 'http://localhost:4000',
  // PayPal sandbox. Without credentials the API runs in clearly-labelled SIMULATED mode.
  paypal: {
    clientId: env.PAYPAL_CLIENT_ID || '',
    secret: env.PAYPAL_CLIENT_SECRET || '',
    base: env.PAYPAL_BASE_URL || 'https://api-m.sandbox.paypal.com',
  },
  // PayPal does not settle in KES, so orders are charged in USD at a disclosed rate.
  fx: { kesPerUsd: Number(env.FX_KES_PER_USD || 129), currency: 'USD' },
  // Optional Hugging Face model service (Swahili LLM, TTS, translation).
  aiUrl: env.AI_SERVICE_URL || '',
  aiTimeoutMs: Number(env.AI_TIMEOUT_MS || 6000),
  // Fraud / safety limits for the Impact Ledger.
  ledger: { agentDailyCap: Number(env.AGENT_DAILY_CAP || 20), minOrderKes: Number(env.MIN_REWARD_ORDER_KES || 100) },
  // Price tolerance when a queued order is revalidated at sync time.
  priceToleranceKes: 0,
};

export const paypalConfigured = () => Boolean(config.paypal.clientId && config.paypal.secret);
