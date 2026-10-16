# Jirani Pay

Accessible, offline-first agricultural shopping for smallholder farmers in Kenya, built for the
**PayPal AI Hackathon** (Devpost, deadline Nov 12, 2026). A farmer asks in Kiswahili or English
("mbegu za mahindi, bajeti ya elfu tatu"), an assistant finds real catalogue items within budget,
the farmer explicitly approves the exact total (touch, hold, voice or single switch), and the order is paid
with **PayPal Checkout**. Orders approved while offline are queued on the phone and synced safely later.
A community agent can help a first-time buyer; a verified, consented purchase creates an auditable
**Impact Ledger** milestone that a sponsor-funded program can pay out via **PayPal Payouts**.

> Everything here is a prototype with **synthetic** products, prices and suppliers. Payments are PayPal
> **sandbox** (or a labelled simulation). No real money moves.

## Run it (Node 22.13+ only, no npm install needed)

```bash
cd services/api && npm start        # http://localhost:4000  (PWA + API on one origin)
```
or `docker compose up --build`. Admin token for the demo: `jirani-demo-admin` (set `ADMIN_TOKEN`).

### Real PayPal sandbox
Create sandbox REST app credentials at developer.paypal.com, then copy `.env.example` to `.env` and set
`PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET`. The header banner switches from "simulated" to "PayPal Sandbox".
PayPal does not settle KES, so orders are charged in USD at a disclosed rate (`FX_KES_PER_USD`); the receipt shows both.

### Open Swahili models from Hugging Face (optional)
`docker compose --profile ai up --build` adds `services/ai` and sets `AI_SERVICE_URL=http://ai:8000`.
Models are set by `LLM_MODEL` and `TTS_MODEL`. **Check each model's license on its Hugging Face page before using it**
(for example MMS TTS is non-commercial; Jacaranda UlizaLlama states research/internal use only and is not used here).
Without the service the app still works: explanations come from templates and speech uses the device voice.

## How the pieces fit
| Piece | Where | Notes |
|---|---|---|
| Bilingual parser + grounded assistant | `services/api/src/nlu.js`, `assistant.js` | Rules extract need/budget; offers are real catalogue rows. The LLM only phrases an explanation, and any sentence with a number the server did not supply is discarded. |
| Explicit consent | `orders.js` | Selecting is not approving. Orders without an approval record of the exact total are rejected (403). |
| Offline queue | `apps/web/public/app.js` | Orders get a client UUID, are stored locally, and are re-sent on reconnect. The server treats the id as an idempotency key. |
| Revalidation | `orders.js` | Price rise, stock loss or budget breach at sync or pay time sets `needs_reapproval`; nothing is charged. |
| PayPal | `paypal.js` | Orders API with `PayPal-Request-Id`, server-side capture, then re-read from PayPal and checked (status, `custom_id`, amount, currency) before an order is marked paid. |
| Impact Ledger | `ledger.js` | Needs funded program, trained agent, beneficiary consent, verified payment, minimum order, one reward per beneficiary per program, daily agent cap, no self-dealing. Beneficiaries are pseudonymous hashes. |
| Accessibility | `apps/web/public` | Large text, high contrast, screen-reader announcements, 48px targets, hold-to-approve, single-switch scanning, voice approval. |
| Community gateway | `GET /api/gateway/info` | One device hosts the app; others on the same Wi-Fi open its address. |

## Tests
```bash
cd services/api && npm test          # 10 API tests (consent, idempotency, re-approval, ledger rules)
python3 e2e/e2e.py                   # browser test of the PWA incl. real offline -> sync (needs playwright + Chromium)
```

## Known limits
- Voice input/output rely on the browser; Kiswahili recognition and voices vary by device.
- Ledger funding and agent payouts are simulated unless PayPal sandbox credentials are set; the Payouts sandbox call is implemented but was not exercised against live PayPal in development.
- The web app is a zero-build PWA (plain ES modules) rather than Next.js, so it runs without installing packages.

License: MIT.
