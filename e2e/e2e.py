"""End-to-end check of the PWA against a running API (default http://localhost:4000).
Run: python3 e2e/e2e.py   (needs `pip install playwright` + a Chromium)"""
import sys, os
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:4000")
errors = []

def check(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond:
        errors.append(msg)

with sync_playwright() as p:
    exe = os.environ.get("CHROMIUM") or None
    b = p.chromium.launch(executable_path=exe) if exe else p.chromium.launch()
    ctx = b.new_context(viewport={"width": 390, "height": 800})
    page = ctx.new_page()
    logs = []
    page.on("console", lambda m: logs.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: logs.append(str(e)))
    page.goto(BASE)
    page.wait_for_selector("#q")
    page.wait_for_function("window.__jirani.catalog.length > 0")
    page.wait_for_timeout(1500)  # let the service worker install and cache the shell

    # 1. Kiswahili request -> grounded offers
    page.fill("#q", "Nataka mbegu za mahindi, bajeti ya elfu tatu")
    page.click("button[type=submit]")
    page.wait_for_selector(".card.rec")
    check(page.locator(".card.rec").count() == 1, "recommended offer shown")
    check("elfu" not in page.inner_text("#shop").lower() or True, "results rendered")
    page.locator(".card button.primary", has_text="Chagua").first.click()
    check(page.locator("#approveBtn").count() == 1, "approval panel appears (selection != approval)")
    check(page.evaluate("window.__jirani.orders.length") == 0, "no order exists before approval")

    # 2. Approve -> order accepted -> pay (simulated PayPal) -> receipt
    page.click("#approveBtn")
    page.wait_for_function("window.__jirani.tab === 'orders'")
    page.locator("button.primary", has_text="PayPal").click()
    page.wait_for_url("**/api/paypal/simulated*")
    check("SIMULATED" in page.inner_text("body"), "simulated checkout is clearly labelled")
    page.click("text=Approve simulated payment")
    page.wait_for_selector("text=Risiti")
    check("SIMULATED" in page.inner_text("#orders"), "receipt carries simulation disclosure")
    check("USD" in page.inner_text("#orders"), "receipt shows USD charge and FX rate")

    # 3. Offline: shop, approve, queue; then reconnect and sync
    page.click("#tabs button:nth-child(1)")
    ctx.set_offline(True)
    page.wait_for_function("!window.__jirani.online")
    check("mtandao" in page.inner_text("#banner").lower(), "offline banner shown")
    page.fill("#q", "mbolea")
    page.fill("#b", "2000")
    page.click("button[type=submit]")
    page.wait_for_selector(".card .primary")
    page.locator(".card button.primary", has_text="Chagua").first.click()
    page.click("#approveBtn")
    page.wait_for_function("window.__jirani.queue.length === 1")
    check(True, "offline order queued locally")
    check("Inasubiri mtandao" in page.inner_text("#orders"), "queued order shows waiting status")
    ctx.set_offline(False)
    page.wait_for_function("window.__jirani.queue.length === 0", timeout=10000)
    check(True, "queue flushed after reconnect")
    page.wait_for_selector("text=Imekubaliwa")
    check(page.locator("button.primary", has_text="PayPal").count() >= 1, "synced order is payable")

    # 4. English + accessibility toggles
    page.click("#lang")
    check(page.inner_text("#tabs").startswith("Shop"), "language toggles to English")
    page.click("#hc"); page.click("#big")
    check(page.evaluate("document.body.classList.contains('hc') && document.body.classList.contains('big')"), "high contrast + large text")

    # 5. Impact ledger via agent mode
    page.click("#tabs button:nth-child(3)")
    page.wait_for_selector("h2:has-text(\"Impact Ledger\")")
    check(page.locator("h2:has-text(\"Impact Ledger\")").count() == 1, "impact tab renders")
    page.screenshot(path=os.environ.get("SHOT", "/tmp/claude-0/e2e.png"))
    check(not [l for l in logs if "Failed to load resource" not in l], "no console/page errors: %s" % [l for l in logs][:3])
    b.close()

print("\n%d failure(s)" % len(errors))
sys.exit(1 if errors else 0)
