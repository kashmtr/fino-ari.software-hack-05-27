<img width="200" height="200" alt="ChatGPT Image May 28, 2026, 05_01_28 PM" src="https://github.com/user-attachments/assets/a12ad34e-3934-4fce-bb02-2a6c42709ad9" />

# Fino - Can I Actually Afford This?

> Your wallet's hype-check before you hit "Buy Now."

Fino is the little voice of reason that lives in your browser and your dashboard. Before you drop $80 on that thing you saw at 1am, Fino looks at your *real* bank data and tells you straight up: **YES**, **MAYBE**, or **NO**.

No guessing. Just math that actually has your back.

---

## 👩‍⚖️ For ARI Hackathon Judges — Quick Start

Wanna see Fino running on your own ARI setup? Here's how:

**1. Get the module into ARI**
- Download / clone this repo
- Drop the **`fino`** folder into your ARI project's **`modules-custom/`** directory
  (final path should be `modules-custom/fino/`)
- Restart ARI — it auto-loads `modules-custom` and applies the database schema on boot
- Open **`/fino`** in your browser, run through the quick onboarding (upload an RBC statement, set income + savings buffer), and you're in 🎉

**2. See the Chrome extension on your PC**
- The extension lives in the **`fino_extension/`** folder at the repo root
- Open Chrome → go to **`chrome://extensions`**
- Toggle on **Developer mode** (top-right)
- Click **Load unpacked** → select the **`fino_extension/`** folder
- Make sure you're **logged into ARI in the same browser**, then visit any shopping/checkout page — a green `$` badge pops up, click it for a live verdict 🛒

> 💡 You'll need an RBC chequing statement PDF to test — RBC is the only fully-supported format right now (see below). Got 3 months of them? Even better — that's when Fino is most accurate.

---

## 💡 What Is This?

Fino is an **affordability tracker** that connects to your real spending history and answers the one question that hits different: *"If I buy this, am I gonna be okay at the end of the month?"*

It doesn't just look at what's in your account *right now* (because that number lies - the rent hasn't come out yet, buddy). Instead, it understands your spending rhythm and **projects where you'll actually land** by month-end.

## 🎯 Who's It For?

- 🛍️ The impulse-buyer who needs a reality check at online shopping checkout/payment pages
- 🎯 Anyone juggling savings goals + bills + "treat yourself" money
- 📊 People who want money decisions backed by data, not anxiety
- 💸 You, at 1am, cart full, finger hovering over another awesome jacket

## ✨ How It Works

Fino lives in **two places**:

1. **ARI Dashboard Widget** → your overall money health for the month, at a glance
2. **Chrome Extension** → pops up *right at checkout* with a verdict on your cart

You feed it a bank statement, set a couple of preferences, and it does the rest.

---

## 🧮 The Math (what you don't do and regret later)

Fino projects your **month-end balance** like this:

```
projected_month_end =  income
                     −  projected_total_spending
                     −  cart_total           ← the thing you wanna buy
                     −  goals_commitment      ← your savings goals' monthly $$
                     −  monthly_savings_target
```

### 🧠 The clever bit: projected spending

Most apps just subtract what you've *already* spent. Fino is smarter — it predicts what you'll spend for the **rest** of the month based on your actual habits:

```
daily_rate               =  historical_daily_rate   (from your last 3 months)
projected_remaining      =  daily_rate × days_left_in_month
projected_total_spending =  spent_so_far + projected_remaining
```

And that `historical_daily_rate`? It's pulled straight from your past statements:

```
historical_daily_rate = total_expenses_last_3_months ÷ days_in_that_period
```

So on day 5 of the month, Fino doesn't think you're rich just because you've only spent $40. It knows your average and plans accordingly. 

📈 It even tells you where you *historically* stood by this day of the month — so you know if you're ahead of or behind your usual pace.

### 💰 Where "income" comes from (in order of trust)

1. **Statement income** — actual deposits this month ✅ (most trusted)
2. **Forecast income** — what you told it you'd earn
3. **3-month average** — estimated from history ⚠️ (shows a warning)
4. **Nothing** — defaults to $0

### 🚦 The verdict

| If your projected month-end is... | Verdict |
|---|---|
| Above your savings buffer | **YES** — go for it, you're comfy 💚 |
| Above $0 but below buffer | **MAYBE** — it's tight, think about it 💛 |
| At or below $0 | **NO** — don't do it 💔 |

Your **savings buffer** is the minimum cushion you wanna keep (default $500). That's *your* line in the sand.

Every verdict also comes with a **plain-English explanation** so you actually understand *why* — no black box.

## 🛡️ How It Fights Impulse Buys

- **Real receipts** — it's your actual bank transactions, stored on your local database, not a guess
- **Pattern brain** — "I've only spent a little so far" energy gets checked against your real average
- **3-second friction** — that tiny pause at checkout is often all you need to *NOT* suffer the regret
- **Full context** — it factors in your goals and savings *before* greenlighting a purchase
- **Math in plain English** — it explains the reasoning so the "NO" actually lands

---

## 🏦 Heads Up: RBC Only (for now)

Fino's PDF parser is tuned for **RBC (Royal Bank of Canada)** chequing statements. It reads the actual column positions in your statement to pull out transactions accurately.

| Bank | Status |
|---|---|
| 🏦 RBC | ✅ Fully supported |
| 🏦 TD / BMO / Scotia / CIBC / others | ⚠️ Might work, not tested — upload and check |

Other banks *may or may not* parse correctly in this version. More bank support is on the roadmap.

## 📅 Pro tip: feed it 3 months

Fino works **best when you upload your last 3 months of bank statements.** That's when the historical daily rate becomes accurate and the verdicts get *chef's kiss* reliable.

- **Month 1 (cold start):** uses just this month's rate — a bit rough, refine your inputs as you go
- **3+ months in:** historical rate is locked in, verdicts are solid 🎯

---

## 🚀 Get Started

### Inside ARI (the dashboard)

1. Start & Log into ARI (./ari start) and head to **`/fino`**
2. Run through onboarding:
   - 📄 Upload your most recent RBC statement PDF
   - 💵 Set your monthly income (or let it estimate from the statement)
   - 🛡️ Set your savings buffer + monthly savings target
3. Drop a purchase amount into the **Affordability Check** and get your verdict
4. Manage your **goals, income, and settings** from the tabs

You'll also see a Fino widget on your main ARI dashboard showing this month's vibe check.

### Chrome Extension (the checkout sidekick)

1. Grab the extension folder: **`fino_extension/`**
2. Load it into Chrome:
   - Go to `chrome://extensions`
   - Flip on **Developer mode** (top-right)
   - Click **Load unpacked** → select the `fino_extension/` folder
3. Make sure you're **logged into ARI in the same browser** (it shares your session)
4. Go shopping 🛒 — when you hit a checkout page, a green `$` badge appears on the icon
5. Click it → Fino grabs your cart total and gives you the verdict *right there*

> ⚡ The extension needs you logged into ARI in the same browser, and ARI running/reachable.

---

## 🧑‍🍳 What You Need to Input

| Input | Why |
|---|---|
| 📄 Bank statement PDF(s) | So Fino knows your real income + spending (3 months = best results) |
| 💵 Monthly income | Used when the statement doesn't show income yet |
| 🛡️ Savings buffer | Your minimum month-end cushion (the YES/MAYBE line) |
| 🎯 Monthly savings target | Money set aside before anything else |
| 🎯 Savings goals (optional) | Each goal's monthly contribution is factored into every verdict |

---

## 🔮 Future Scope: Fino x AI

Next up, we want to plug in an **LLM via API** for next-level money reasoning:

- 🏷️ **Smart categorization** — "groceries" vs "impulse" vs "recurring," auto-tagged
- 🔍 **Spending insights** — *"You're up 40% on dining out vs your usual — heads up."*
- 📡 **Predictive nudges** — *"At this pace you'll blow through your buffer in 5 days."*
- 🎯 **Goal coaching** — *"Bump your goal by $50/mo and you'll hit it 2 weeks early."*

Deeper analysis, real reasoning, all powered by AI APIs — while keeping your data private. 🔐

---

## 🛠️ Tech Stack

- **Backend:** Next.js API routes · Drizzle ORM · PostgreSQL · Better Auth
- **Frontend:** React 19 · TypeScript · Tailwind CSS · TanStack Query
- **PDF Parsing:** pdfjs-dist (coordinate-aware extraction)
- **Extension:** Chrome Manifest V3 · vanilla JS
- **Deploy:** Vercel (ARI) · Chrome (unpacked extension)

---

## 🏆 Built at the ARI Hackathon

Fino was built for the **ARI Hackathon** in **Toronto on May 27th, 2026.** 🇨🇦

### The Team 🦫

1. **Ritvik Pande**
2. **Cindy Mai**
3. **Kashish Malhotra**


### Shoutout to Noem Eppel for building this exceptional open-source platform ARI - so we can build & vibe-code better 🦫💸
