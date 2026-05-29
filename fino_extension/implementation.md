# PXPense Chrome Extension — Implementation

## Architecture

```
Chrome Extension (Manifest V3) — single popup.html, multiple screens
  content.js   → runs on all URLs
                 → checkout keyword detection in URL
                 → best-effort cart total scrape
                 → writes to chrome.storage.session

  popup.js     → screen router: onboarding / main / settings
                 → all API calls (fetch)

                         ↓  HTTP (localhost)

  ARI Module: FastAPI
    POST /statements/upload   CSV parse → transactions table
    GET/POST/DELETE /goals
    GET/PUT /income
    GET/PUT /profile
    POST /affordability       verdict calculation

                         ↓

  local PostgreSQL
    transactions, income_events, goals, user_profile
```

---

## Chrome extension file tree

```
extension/
  manifest.json
  content.js          # URL detection + cart total scrape
  popup.html          # all screens — shown/hidden via JS classList
  popup.js            # screen router + all fetch logic
  styles.css          # dark theme, verdict colors, onboarding steps
  icons/
    icon16.png
    icon48.png
    icon128.png
```

Single `popup.html` with section divs (`#onboard-1`, `#onboard-2`, `#onboard-3`, `#main`, `#settings`). `showScreen(id)` hides all then shows the target.

---

## manifest.json

```json
{
  "manifest_version": 3,
  "name": "PXPense — Affordability Check",
  "version": "1.0.0",
  "permissions": ["activeTab", "storage"],
  "host_permissions": ["<all_urls>"],
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["content.js"],
    "run_at": "document_idle"
  }],
  "action": {
    "default_popup": "popup.html",
    "default_title": "PXPense — Check affordability"
  }
}
```

---

## content.js

```js
const CHECKOUT_KEYWORDS = ['checkout', 'cart', 'shipping', 'payment', 'order', 'billing', 'purchase'];
const url = window.location.href.toLowerCase();
const onCheckout = CHECKOUT_KEYWORDS.some(kw => url.includes(kw));

if (onCheckout) {
  const selectors = [
    '[data-testid="order-total"]',
    '[data-testid="order-summary-total"] .price-value',
    '.order-summary__total .price',
    '.cart-total .amount',
    '#checkout-total',
    '.summary-total',
    '.order-total',
  ];
  let total = null;
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) {
      total = parseFloat(el.textContent.replace(/[^0-9.]/g, ''));
      break;
    }
  }
  chrome.storage.session.set({ cartTotal: total, onCheckout: true });
} else {
  chrome.storage.session.set({ cartTotal: null, onCheckout: false });
}
```

Selectors cover common checkout patterns across major e-commerce sites. Always falls back to editable input if scrape fails.

---

## popup.js screen router

```js
const API_BASE = 'http://localhost:8000';  // update to ARI module port

function showScreen(id) {
  document.querySelectorAll('section').forEach(s => s.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

async function init() {
  const { profileSetup } = await chrome.storage.local.get('profileSetup');
  if (!profileSetup) { showScreen('onboard-1'); return; }

  const { cartTotal, onCheckout } = await chrome.storage.session.get(['cartTotal', 'onCheckout']);

  if (!onCheckout) { showScreen('main-no-checkout'); return; }

  showScreen('main');
  if (cartTotal != null) {
    document.getElementById('cart-amount-display').textContent = `$${cartTotal.toFixed(2)}`;
    showSpinner();
    try {
      const result = await postAffordability(cartTotal);
      renderVerdict(result);
    } catch {
      showError('Could not reach backend. Is the ARI module running?');
    }
  } else {
    showManualInput();
  }
}

document.addEventListener('DOMContentLoaded', init);
```

---

## Onboarding flow (popup.js)

**Step 1 — Statement upload:**
```js
document.getElementById('upload-btn').addEventListener('click', async () => {
  const file = document.getElementById('csv-input').files[0];
  if (!file) return;
  const form = new FormData();
  form.append('file', file);
  await fetch(`${API_BASE}/statements/upload`, { method: 'POST', body: form });
  showScreen('onboard-2');
});
```

**Step 2 — Goals:**
```js
// Collect all goal forms, POST each one
document.getElementById('goals-next').addEventListener('click', async () => {
  const goals = collectGoalForms();  // returns array of {name, target_amount, target_date, monthly_contribution}
  await Promise.all(goals.map(g => fetch(`${API_BASE}/goals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(g),
  })));
  showScreen('onboard-3');
});
```

**Step 3 — Income:**
```js
document.getElementById('finish-btn').addEventListener('click', async () => {
  const amount = parseFloat(document.getElementById('income-amount').value);
  const period_end = document.getElementById('income-end').value;
  await fetch(`${API_BASE}/income`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount, period_end }),
  });
  await chrome.storage.local.set({ profileSetup: true });
  showScreen('main');
  init();
});
```

---

## Backend API endpoints

All responses: `{ "ok": true, "data": ... }` or `{ "ok": false, "error": "..." }`

```
GET  /health
POST /affordability           { "amount": float }
POST /statements/upload       multipart/form-data  file=<csv>
GET  /goals
POST /goals                   { "name", "target_amount", "target_date", "monthly_contribution" }
DELETE /goals/{id}
GET  /income                  → current month income_event or null
PUT  /income                  { "amount", "period_end" }  — upsert
GET  /profile
PUT  /profile                 { "savings_buffer", "monthly_savings_target" }
```

---

## POST /affordability — response shape

```json
{
  "verdict": "YES",
  "label": "Comfortable",
  "projected_month_end": 823.50,
  "buffer_after_purchase": 323.50,
  "savings_buffer_threshold": 500.00,
  "buffer_intact": true,
  "advice": "You're within your clothing budget. No goals are affected.",
  "income_source": "statement",
  "warning": null
}
```

`income_source`: `"statement"` | `"forecast"` | `"historical_avg"`
`warning`: non-null string if `income_source === "historical_avg"`

---

## Affordability calculation (Python)

```python
def calculate_affordability(amount: float, db) -> dict:
    USER = 'demo'

    # Income
    income_row = db.execute(
        "SELECT amount, period_end FROM income_events WHERE user_id = %s "
        "AND period_start <= CURRENT_DATE AND period_end >= CURRENT_DATE "
        "ORDER BY created_at DESC LIMIT 1", [USER]
    ).fetchone()

    if income_row:
        income = float(income_row['amount'])
        income_source = 'forecast'
    else:
        # 3-month historical avg from positive transactions
        row = db.execute(
            "SELECT AVG(monthly_total) FROM ("
            "  SELECT DATE_TRUNC('month', date) AS m, SUM(amount) AS monthly_total"
            "  FROM transactions WHERE user_id = %s AND amount > 0"
            "  AND date >= CURRENT_DATE - INTERVAL '3 months'"
            "  GROUP BY m"
            ") AS sub", [USER]
        ).fetchone()
        income = float(row[0] or 0)
        income_source = 'historical_avg'

    # Spending this calendar month (expenses are negative amounts)
    spent_row = db.execute(
        "SELECT COALESCE(SUM(ABS(amount)), 0) FROM transactions "
        "WHERE user_id = %s AND amount < 0 "
        "AND DATE_TRUNC('month', date) = DATE_TRUNC('month', CURRENT_DATE)", [USER]
    ).fetchone()
    spent = float(spent_row[0])

    # Goals monthly deduction
    goals_row = db.execute(
        "SELECT COALESCE(SUM(monthly_contribution), 0) FROM goals "
        "WHERE user_id = %s AND status = 'active'", [USER]
    ).fetchone()
    goals_deduction = float(goals_row[0])

    # Profile thresholds
    profile = db.execute(
        "SELECT savings_buffer, monthly_savings_target FROM user_profile WHERE user_id = %s", [USER]
    ).fetchone()
    savings_buffer = float(profile['savings_buffer'])
    savings_target = float(profile['monthly_savings_target'])

    # Verdict math
    remaining = income - spent - goals_deduction - savings_target
    projected_month_end = remaining - amount

    if projected_month_end > savings_buffer:
        verdict, label = 'YES', 'Comfortable'
    elif projected_month_end > 0:
        verdict, label = 'MAYBE', 'Tight'
    else:
        verdict, label = 'NO', 'Risky'

    return {
        'verdict': verdict,
        'label': label,
        'projected_month_end': round(projected_month_end, 2),
        'buffer_after_purchase': round(projected_month_end - savings_buffer, 2),
        'savings_buffer_threshold': savings_buffer,
        'buffer_intact': projected_month_end > savings_buffer,
        'advice': generate_advice(verdict, projected_month_end, savings_buffer),
        'income_source': income_source,
        'warning': 'No statement or forecast found. Using 3-month historical average.' if income_source == 'historical_avg' else None,
    }
```

---

## POST /statements/upload — CSV parsing

```python
import csv, io
from fastapi import UploadFile

@app.post('/statements/upload')
async def upload_statement(file: UploadFile):
    content = (await file.read()).decode('utf-8-sig')
    reader = csv.DictReader(io.StringIO(content))

    # Normalize headers
    headers = {h.strip().lower(): h for h in reader.fieldnames or []}
    date_col = next((headers[k] for k in ['date', 'transaction date', 'trans date'] if k in headers), None)
    amount_col = next((headers[k] for k in ['amount', 'debit', 'credit'] if k in headers), None)
    desc_col = next((headers[k] for k in ['description', 'merchant', 'details', 'memo'] if k in headers), None)

    rows = []
    for row in reader:
        try:
            rows.append({
                'user_id': 'demo',
                'date': parse_date(row[date_col]),
                'amount': float(row[amount_col].replace(',', '').replace('$', '')),
                'description': row.get(desc_col, ''),
            })
        except Exception:
            continue  # skip malformed rows

    db.execute("DELETE FROM transactions WHERE user_id = 'demo'")
    db.executemany("INSERT INTO transactions (user_id, date, amount, description) VALUES (%s, %s, %s, %s)",
                   [(r['user_id'], r['date'], r['amount'], r['description']) for r in rows])
    return {'ok': True, 'data': {'imported': len(rows)}}
```

---

## DB schema (local PostgreSQL, no RLS)

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS transactions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'demo',
  date date not null,
  amount numeric not null,
  merchant text,
  description text,
  custom_category text
);

CREATE TABLE IF NOT EXISTS income_events (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'demo',
  amount numeric not null,
  period_start date,
  period_end date,
  label text,
  cadence text
);

CREATE TABLE IF NOT EXISTS goals (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'demo',
  name text,
  target_amount numeric,
  target_date date,
  monthly_contribution numeric default 0,
  status text default 'active'
);

CREATE TABLE IF NOT EXISTS user_profile (
  user_id text primary key default 'demo',
  savings_buffer numeric default 500,
  monthly_savings_target numeric default 200
);

INSERT INTO user_profile VALUES ('demo', 500, 200) ON CONFLICT DO NOTHING;
```

Run this once on the local PostgreSQL instance. No seed data — onboarding populates everything.

---

## CORS config (required — extension origin ≠ localhost)

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
```

---

## 3-hour build order

### Hour 1 — Backend (0:00–1:00)

1. ARI module: FastAPI scaffold + PostgreSQL connection + 4 `CREATE TABLE` + `INSERT INTO user_profile` + `/health`
2. `POST /affordability` with full `calculate_affordability()` function
3. `POST /statements/upload` with CSV column sniffing + bulk INSERT
4. `GET /goals`, `POST /goals`, `DELETE /goals/{id}`
5. `GET /income`, `PUT /income` (upsert by current month)
6. `GET /profile`, `PUT /profile`
7. Smoke tests with `curl`:
   ```bash
   curl http://localhost:8000/health
   curl -X POST http://localhost:8000/affordability -H 'Content-Type: application/json' -d '{"amount": 150}'
   curl -X PUT http://localhost:8000/income -H 'Content-Type: application/json' -d '{"amount": 5000, "period_end": "2026-05-31"}'
   ```

### Hour 2 — Extension skeleton + onboarding (1:00–2:00)

8. `manifest.json`, placeholder icons (copy any PNG, rename), `content.js`
9. `popup.html`: 5 `<section>` divs, header with ⚙ button, basic structure
10. `styles.css`: dark `#0F0D0A` background, amber `#C7842E` accent, step progress indicators
11. `popup.js`: `showScreen()` + `init()` + first-boot detection
12. Onboarding step 1: file picker → `POST /statements/upload` → advance
13. Onboarding step 2: goal form with "add another" button → `POST /goals` for each → advance
14. Onboarding step 3: income amount + date → `PUT /income` → set `profileSetup: true` → go to main
15. Chrome → Extensions → Load unpacked → test full onboarding flow

### Hour 3 — Main + Settings + Wire (2:00–3:00)

16. Main screen auto-analysis: read storage → if `onCheckout + cartTotal` → spinner → `POST /affordability` → `renderVerdict()`
17. "Re-check" button: shows editable amount input after verdict; re-fires on submit
18. "Not on checkout" fallback screen with manual amount + Analyze button
19. Settings screen: `GET /goals` + `GET /income` + `GET /profile` → render lists
20. Settings actions: re-upload CSV, `POST /goals`, `DELETE /goals/{id}`, `PUT /income`, `PUT /profile`
21. ⚙ / ← navigation between main ↔ settings
22. ⚠ warning banner when `income_source === 'historical_avg'`
23. Error state: show "Backend unreachable" message if fetch throws
24. Demo run: onboard with real CSV → navigate to any checkout URL → popup auto-analyzes → show verdict live

---

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| Cart total scrape fails | Popup always shows editable amount as fallback; auto-analyze only when scraped |
| Checkout keyword false positive (blog post mentioning "order") | Popup still requires non-null total or manual input before firing; user sees it's not a checkout and closes |
| CORS block | `allow_origins=["*"]` on all FastAPI routes |
| ARI port unknown until startup | `const API_BASE = 'http://localhost:8000'` as top-of-file constant in `popup.js` — change once |
| CSV column names vary by bank | Case-insensitive header sniffing with aliases (`date`/`transaction date`, `amount`/`debit`, etc.) |
| Popup too tall on small screens | `body { max-height: 560px; overflow-y: auto; }` in `styles.css` |
