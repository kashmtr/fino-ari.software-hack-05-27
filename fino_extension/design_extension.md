# PXPense Chrome Extension — Design

## Feature overview

Chrome extension (Manifest V3) that auto-detects checkout pages on any website and tells the user whether they can afford their cart, based on their uploaded bank statements, forecasted income, and savings goals.

1. First boot → onboarding wizard (3 steps: statement upload, goals, income)
2. On any checkout URL → popup auto-analyzes cart total and shows verdict immediately
3. ⚙ settings button → edit statement, goals, income at any time

---

## Trigger — generic checkout detection

`content.js` runs on all URLs and checks for checkout-intent keywords:

```
checkout  |  cart  |  shipping  |  payment  |  order  |  billing  |  purchase
```

Only activates analysis if a keyword appears in the current URL. Works on any e-commerce site.

---

## Screen 1 — Onboarding (first boot only)

Detected via `chrome.storage.local`. Runs once; user can always re-edit via Settings.

```
Step 1 of 3 — Bank Statement
┌─────────────────────────────────────────────┐
│  🧾 PXPense Setup                            │
│                                              │
│  Upload your bank statement (CSV):           │
│  [ Choose File ]  or drag & drop             │
│                                              │
│  Expected columns: Date, Amount, Description │
│                                [ Next → ]    │
└──────────────────────────────────────────────┘

Step 2 of 3 — Savings Goals
┌─────────────────────────────────────────────┐
│  🎯 PXPense Setup                            │
│                                              │
│  Goal name:    [ Emergency Fund    ]         │
│  Target $:     [ 3000  ]                     │
│  Target date:  [ 2026-12-31        ]         │
│  Monthly $:    [ 150   ]                     │
│                                              │
│  [ + Add another goal ]                      │
│                                [ Next → ]    │
└──────────────────────────────────────────────┘

Step 3 of 3 — This Month's Income
┌─────────────────────────────────────────────┐
│  💰 PXPense Setup                            │
│                                              │
│  Expected income this month:                 │
│  Amount $:   [ 5000          ]               │
│  Income until (end of month):                │
│  Date:       [ 2026-05-31    ]               │
│                                              │
│                       [ Finish — Let's go ]  │
└──────────────────────────────────────────────┘
```

---

## Screen 2 — Main (auto-analyzes on popup open)

Popup opens → reads cart total and checkout flag from `chrome.storage.session`:

- `onCheckout: true` + cart total scraped → auto-POST `/affordability` → spinner → verdict (no button tap)
- `onCheckout: true` + scrape failed → editable input + "Analyze" button (fallback)
- `onCheckout: false` → "Navigate to a checkout page" prompt + manual input option

```
Auto-analyzing:
┌──────────────────────────────────────────┐
│  💳 Checkout Check                [ ⚙ ] │
│  Cart: $147.00  (detected)               │
│  ⟳ Analyzing…                            │
└──────────────────────────────────────────┘

Verdict — YES:
┌──────────────────────────────────────────┐
│  💳 Checkout Check                [ ⚙ ] │
│  Cart: $147.00              [ Re-check ] │
├──────────────────────────────────────────┤
│        ✅  YES — Comfortable              │
│                                          │
│  Month-end balance   $823 after purchase │
│  Savings buffer      $500  ✓ intact      │
│                                          │
│  "You're within your clothing budget.    │
│   No goals are affected this month."    │
└──────────────────────────────────────────┘

Verdict — MAYBE:
┌──────────────────────────────────────────┐
│  💳 Checkout Check                [ ⚙ ] │
│  Cart: $147.00              [ Re-check ] │
├──────────────────────────────────────────┤
│        ⚠️  MAYBE — Tight                 │
│                                          │
│  Month-end balance   $83 after purchase  │
│  Savings buffer      $500  ⚠ below       │
│                                          │
│  "This purchase would leave you tight.   │
│   Consider waiting until next month."   │
└──────────────────────────────────────────┘

Verdict — NO:
┌──────────────────────────────────────────┐
│  💳 Checkout Check                [ ⚙ ] │
│  Cart: $147.00              [ Re-check ] │
├──────────────────────────────────────────┤
│        ❌  NO — Risky                    │
│                                          │
│  Month-end balance   -$217 if purchased  │
│  Savings buffer      $500  ✗ breached    │
│                                          │
│  "This would put you in the negative.    │
│   Your Emergency Fund goal is at risk." │
└──────────────────────────────────────────┘

Not on checkout page:
┌──────────────────────────────────────────┐
│  💳 PXPense                       [ ⚙ ] │
│                                          │
│  Navigate to a checkout page and I'll    │
│  automatically check if you can afford   │
│  your cart.                              │
│                                          │
│  Or enter an amount manually:            │
│  [ $0.00           ]  [ Analyze ]        │
└──────────────────────────────────────────┘
```

### Verdict colors
| Verdict | Color | Label |
|---|---|---|
| YES | `#22c55e` green | "Comfortable" |
| MAYBE | `#C7842E` amber | "Tight" |
| NO | `#ef4444` red | "Risky" |

### Warning banner
⚠ amber strip shown below verdict when `income_source === 'historical_avg'`: no statement uploaded and no forecast set — result is an estimate based on 3-month average.

---

## Screen 3 — Settings (⚙ from main screen)

```
┌──────────────────────────────────────────┐
│  ← Settings                              │
│                                          │
│  📄 Bank Statement                       │
│  Last uploaded: May 20, 2026             │
│  [ Re-upload CSV ]                       │
│                                          │
│  🎯 Savings Goals                        │
│  Emergency Fund  $150/mo  [ Remove ]     │
│  New Laptop      $100/mo  [ Remove ]     │
│  [ + Add goal ]                          │
│                                          │
│  💰 Monthly Income                       │
│  $5,000 until May 31, 2026  [ Edit ]     │
│                                          │
│  🛡 Savings Buffer                       │
│  $500 minimum              [ Edit ]      │
└──────────────────────────────────────────┘
```

---

## Income decision matrix

Inherited from the main PXPense project:

| Statement uploaded? | Forecast set? | Income used | UI indicator |
|---|---|---|---|
| Yes | Yes | Actual statement data | ⓘ label |
| Yes | No | Actual statement data | ⓘ label |
| No | Yes | Forecast amount | ⓘ label |
| No | No | 3-month historical average | ⚠ warning banner |

---

## Visual design tokens

Inherited from main project:
- Background: `#0F0D0A`
- Accent amber: `#C7842E`
- Font: IBM Plex Sans / IBM Plex Mono (numbers)
- Popup width: 380px, max-height: 560px

---

## Data sources (DB tables used)

| Table | Purpose |
|---|---|
| `transactions` | Spending history parsed from uploaded CSV |
| `income_events` | User's forecasted monthly income |
| `goals` | Savings goals with monthly contribution |
| `user_profile` | Savings buffer threshold + monthly savings target |
