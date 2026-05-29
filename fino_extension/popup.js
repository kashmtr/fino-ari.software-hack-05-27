// ── Config ──────────────────────────────────────────────────────────────────
const API_BASE = 'http://localhost:3000/api/modules/fino';

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmtMoney(n) {
  const abs = Math.abs(n);
  const str = abs.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (n < 0 ? '-$' : '$') + str;
}

function firstOfMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

/** Show one section, hide all others. */
function showScreen(id) {
  document.querySelectorAll('body > section').forEach(s => s.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

/** Replace #main-body innerHTML. */
function setMainBody(html) {
  document.getElementById('main-body').innerHTML = html;
}

function showSpinner(label = 'Analyzing…') {
  setMainBody(`
    <div class="spinner-wrap">
      <div class="spinner"></div>
      <div class="spinner-label">${label}</div>
    </div>
  `);
}

function showMainError(msg) {
  setMainBody(`<div class="error-msg" style="margin-top:0">${msg}</div>`);
}

/**
 * Fetch wrapper — all calls use credentials:include so the ARI session cookie
 * is sent automatically (user must be logged into ARI in this browser).
 */
async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      ...(options.body && !(options.body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...(options.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

// ── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  // Check if user is logged into ARI. GET /profile with credentials:include.
  // If 401 → show auth prompt. If profile returns (even null) → continue.
  let profile = null;
  try {
    profile = await api('/profile');
  } catch (e) {
    if (e.message.includes('401') || e.message.includes('Unauthorized')) {
      showScreen('main');
      setMainBody(`
        <div class="auth-prompt">
          <strong>Sign into ARI first</strong>
          Please <a href="http://localhost:3000/sign-in" target="_blank">open ARI</a> and sign in,
          then click the extension icon again.
        </div>
      `);
      return;
    }
    showScreen('main');
    showMainError('Could not reach ARI. Is it running at localhost:3000?');
    return;
  }

  // First boot: no profileSetup flag in local storage
  const { profileSetup } = await chrome.storage.local.get('profileSetup');
  if (!profileSetup) {
    setupOnboarding();
    showScreen('onboard-1');
    return;
  }

  // Settled user — go to main and auto-analyze if on checkout
  showScreen('main');
  const { cartTotal, onCheckout } = await chrome.storage.session.get(['cartTotal', 'onCheckout']);

  if (!onCheckout) {
    setMainBody(`
      <div class="neutral-prompt">
        <strong>Navigate to a checkout page</strong>
        I'll automatically check if you can afford your cart.
      </div>
      <div style="padding: 0 0 12px">
        <label for="manual-amount" style="display:block;margin-bottom:4px">Or enter an amount manually:</label>
        <div class="recheck-row">
          <input type="number" id="manual-amount" min="0" step="0.01" placeholder="0.00">
          <button class="btn btn-primary btn-small" id="manual-analyze-btn">Analyze</button>
        </div>
      </div>
    `);
    document.getElementById('manual-analyze-btn').addEventListener('click', () => {
      const val = parseFloat(document.getElementById('manual-amount').value);
      if (val > 0) autoAnalyze(val);
    });
    return;
  }

  if (cartTotal != null) {
    document.getElementById('cart-display').textContent = ` · ${fmtMoney(cartTotal)}`;
    autoAnalyze(cartTotal);
  } else {
    showManualInput();
  }
}

// ── Onboarding ────────────────────────────────────────────────────────────────

function makeGoalRow() {
  const div = document.createElement('div');
  div.style.cssText = 'border:1px solid #2E2820;border-radius:6px;padding:10px;margin-bottom:8px;position:relative';
  div.innerHTML = `
    <label>Goal name</label>
    <input type="text" class="goal-name-input" placeholder="Emergency Fund">
    <label>Target ($)</label>
    <input type="number" class="goal-target-input" min="0" step="100" placeholder="3000">
    <label>Monthly ($)</label>
    <input type="number" class="goal-monthly-input" min="0" step="50" placeholder="150">
    <button class="btn-danger" style="position:absolute;top:8px;right:8px" onclick="this.parentElement.remove()">✕</button>
  `;
  return div;
}

function setupOnboarding() {
  // Add initial goal row
  document.getElementById('goals-forms').appendChild(makeGoalRow());

  // Step 1: PDF upload
  document.getElementById('add-goal-btn').addEventListener('click', () => {
    document.getElementById('goals-forms').appendChild(makeGoalRow());
  });

  document.getElementById('upload-btn').addEventListener('click', async () => {
    const file = document.getElementById('pdf-input').files[0];
    if (!file) {
      const s = document.getElementById('upload-status');
      s.textContent = 'Please select a PDF file first.';
      s.classList.remove('hidden');
      return;
    }
    const btn = document.getElementById('upload-btn');
    btn.textContent = 'Uploading…'; btn.disabled = true;
    try {
      const form = new FormData();
      form.append('file', file);
      await api('/statements', { method: 'POST', body: form });
      showScreen('onboard-2');
    } catch (e) {
      const s = document.getElementById('upload-status');
      s.textContent = `Upload failed: ${e.message}`;
      s.classList.remove('hidden');
    } finally {
      btn.textContent = 'Upload & Continue →'; btn.disabled = false;
    }
  });

  document.getElementById('skip-upload-btn').addEventListener('click', () => {
    showScreen('onboard-2');
  });

  // Step 2: Goals
  document.getElementById('goals-next-btn').addEventListener('click', async () => {
    const rows = document.querySelectorAll('#goals-forms > div');
    const goals = [];
    rows.forEach(row => {
      const name    = row.querySelector('.goal-name-input').value.trim();
      const target  = parseFloat(row.querySelector('.goal-target-input').value);
      const monthly = parseFloat(row.querySelector('.goal-monthly-input').value);
      if (name && target > 0 && monthly >= 0) goals.push({ name, target_amount: target, monthly_contribution: monthly });
    });

    if (goals.length > 0) {
      try {
        await Promise.all(goals.map(g => api('/goals', { method: 'POST', body: JSON.stringify(g) })));
      } catch (e) {
        // Non-fatal: user can add goals later in settings
        console.warn('Goal creation failed:', e.message);
      }
    }
    showScreen('onboard-3');
  });

  // Step 3: Income + savings buffer
  document.getElementById('finish-btn').addEventListener('click', async () => {
    const amount = parseFloat(document.getElementById('income-amount').value);
    const buffer = parseFloat(document.getElementById('savings-buffer').value);

    if (isNaN(amount) || amount <= 0) {
      const s = document.getElementById('income-status');
      s.textContent = 'Please enter your expected monthly income.';
      s.classList.remove('hidden');
      return;
    }

    const btn = document.getElementById('finish-btn');
    btn.textContent = 'Saving…'; btn.disabled = true;
    try {
      await api('/income', {
        method: 'PUT',
        body: JSON.stringify({ amount, period_start: firstOfMonth() }),
      });
      if (!isNaN(buffer) && buffer >= 0) {
        await api('/profile', {
          method: 'PUT',
          body: JSON.stringify({ savings_buffer: buffer }),
        });
      }
      await chrome.storage.local.set({ profileSetup: true });
      showScreen('main');
      init();
    } catch (e) {
      const s = document.getElementById('income-status');
      s.textContent = `Error: ${e.message}`;
      s.classList.remove('hidden');
    } finally {
      btn.textContent = 'Finish — Let\'s go'; btn.disabled = false;
    }
  });

}

document.addEventListener('DOMContentLoaded', init);

// ── Main screen ───────────────────────────────────────────────────────────────

async function autoAnalyze(cartTotal) {
  showSpinner('Analyzing…');
  try {
    const result = await api('/affordability', {
      method: 'POST',
      body: JSON.stringify({ cart_total: cartTotal }),
    });
    renderVerdict(result, cartTotal);
  } catch (e) {
    showMainError(`Could not reach ARI Fino: ${e.message}`);
  }
}

function renderVerdict(result, cartTotal) {
  const { verdict, projected_month_end, income_warning, savings_buffer, current_month_spending, explanation } = result;

  const LABELS = { YES: 'Comfortable', MAYBE: 'Tight', NO: 'Risky' };
  const EMOJIS = { YES: '✅', MAYBE: '⚠️', NO: '❌' };
  const cls    = verdict.toLowerCase();
  const label  = LABELS[verdict];
  const emoji  = EMOJIS[verdict];
  const bufferRow = projected_month_end - savings_buffer;

  const warningHtml = income_warning
    ? `<div class="warning-banner">⚠ No statement or forecast found — result uses 3-month historical average.</div>`
    : '';

  const projClass = projected_month_end >= 0 ? 'positive' : 'negative';

  setMainBody(`
    ${warningHtml}
    <div class="verdict-card verdict-${cls}">
      <div class="verdict-emoji">${emoji}</div>
      <div class="verdict-label">${verdict} — ${label}</div>
      <div class="verdict-row">
        <span>Month-end balance after purchase</span>
        <span class="verdict-row-val ${projClass}">${fmtMoney(projected_month_end)}</span>
      </div>
      <div class="verdict-row">
        <span>Savings buffer (${fmtMoney(savings_buffer)} min)</span>
        <span class="verdict-row-val ${bufferRow >= 0 ? 'positive' : 'negative'}">${bufferRow >= 0 ? '✓ intact' : '✗ breached'}</span>
      </div>
      <div class="verdict-row">
        <span>Spent so far this month</span>
        <span class="verdict-row-val">${fmtMoney(current_month_spending)}</span>
      </div>
    </div>
    <div class="recheck-row">
      <input type="number" id="recheck-amount" min="0" step="0.01" placeholder="${cartTotal.toFixed(2)}" value="${cartTotal.toFixed(2)}">
      <button class="btn btn-secondary btn-small" id="recheck-btn">Re-check</button>
    </div>
    <div class="explanation-box" id="explanation-box"></div>
  `);

  if (explanation) {
    document.getElementById('explanation-box').textContent = explanation;
  }

  document.getElementById('recheck-btn').addEventListener('click', () => {
    const val = parseFloat(document.getElementById('recheck-amount').value);
    if (val > 0) {
      document.getElementById('cart-display').textContent = ` · ${fmtMoney(val)}`;
      autoAnalyze(val);
    }
  });
}

function showManualInput() {
  setMainBody(`
    <div class="neutral-prompt">
      <strong>Cart total not detected</strong>
      Enter the purchase amount to check affordability.
    </div>
    <div class="recheck-row" style="padding:0 0 12px">
      <input type="number" id="manual-amount" min="0" step="0.01" placeholder="0.00">
      <button class="btn btn-primary btn-small" id="manual-analyze-btn">Analyze</button>
    </div>
  `);
  document.getElementById('manual-analyze-btn').addEventListener('click', () => {
    const val = parseFloat(document.getElementById('manual-amount').value);
    if (val > 0) autoAnalyze(val);
  });
}

// Wire settings ⚙ button (on main screen)
document.getElementById('settings-btn').addEventListener('click', openSettings);

// ── Settings screen ──────────────────────────────────────────────────────────

async function openSettings() {
  showScreen('settings');
  await loadSettings();
}

document.getElementById('back-btn').addEventListener('click', () => {
  showScreen('main');
  init();
});

async function loadSettings() {
  // Load income
  try {
    const income = await api('/income');
    const incomeEl = document.getElementById('settings-income-meta');
    const incomeInput = document.getElementById('settings-income');
    if (income) {
      incomeEl.textContent = `Current: ${fmtMoney(income.amount)} for ${income.period_start.slice(0, 7)}`;
      incomeInput.value = income.amount;
    } else {
      incomeEl.textContent = 'No income set for this month.';
    }
  } catch (_) {}

  // Load profile (savings buffer)
  try {
    const profile = await api('/profile');
    if (profile) {
      document.getElementById('settings-buffer').value = profile.savings_buffer;
    }
  } catch (_) {}

  // Load goals
  await refreshGoalsList();
}

async function refreshGoalsList() {
  try {
    const { goals } = await api('/goals');
    const container = document.getElementById('settings-goals-list');
    if (goals.length === 0) {
      container.innerHTML = '<div style="font-size:12px;color:#9B8E82;margin-bottom:6px">No goals yet.</div>';
      return;
    }
    // Build DOM nodes to avoid XSS from user-supplied goal names
    container.innerHTML = '';
    goals.forEach(g => {
      const row = document.createElement('div');
      row.className = 'goal-row';

      const info = document.createElement('div');
      const nameEl = document.createElement('div');
      nameEl.className = 'goal-name';
      nameEl.textContent = g.name;
      const metaEl = document.createElement('div');
      metaEl.className = 'goal-meta';
      metaEl.textContent = `${fmtMoney(g.monthly_contribution)}/mo · target ${fmtMoney(g.target_amount)}`;
      info.appendChild(nameEl);
      info.appendChild(metaEl);

      const btn = document.createElement('button');
      btn.className = 'btn-danger';
      btn.dataset.goalId = g.id;
      btn.textContent = 'Remove';
      btn.addEventListener('click', async () => {
        btn.disabled = true; btn.textContent = '…';
        try {
          await api(`/goals/${btn.dataset.goalId}`, { method: 'DELETE' });
          await refreshGoalsList();
        } catch (e) {
          btn.disabled = false; btn.textContent = 'Remove';
          console.error('Delete goal failed:', e.message);
        }
      });

      row.appendChild(info);
      row.appendChild(btn);
      container.appendChild(row);
    });
  } catch (_) {}
}

// Add goal from settings
document.getElementById('settings-add-goal-btn').addEventListener('click', async () => {
  const name    = document.getElementById('sg-name').value.trim();
  const amount  = parseFloat(document.getElementById('sg-amount').value);
  const monthly = parseFloat(document.getElementById('sg-monthly').value);
  const date    = document.getElementById('sg-date').value || undefined;

  if (!name || isNaN(amount) || isNaN(monthly)) return;

  const btn = document.getElementById('settings-add-goal-btn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    await api('/goals', {
      method: 'POST',
      body: JSON.stringify({ name, target_amount: amount, monthly_contribution: monthly, target_date: date }),
    });
    document.getElementById('sg-name').value = '';
    document.getElementById('sg-amount').value = '';
    document.getElementById('sg-monthly').value = '';
    document.getElementById('sg-date').value = '';
    await refreshGoalsList();
  } catch (e) {
    console.error('Add goal failed:', e.message);
  } finally {
    btn.disabled = false; btn.textContent = '+ Add goal';
  }
});

// Income save
document.getElementById('settings-income-btn').addEventListener('click', async () => {
  const amount = parseFloat(document.getElementById('settings-income').value);
  if (isNaN(amount) || amount <= 0) return;
  const btn = document.getElementById('settings-income-btn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    await api('/income', {
      method: 'PUT',
      body: JSON.stringify({ amount, period_start: firstOfMonth() }),
    });
    document.getElementById('settings-income-meta').textContent = `Saved: ${fmtMoney(amount)} for ${firstOfMonth().slice(0, 7)}`;
  } catch (e) {
    console.error('Income save failed:', e.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Save';
  }
});

// Savings buffer save
document.getElementById('settings-buffer-btn').addEventListener('click', async () => {
  const buffer = parseFloat(document.getElementById('settings-buffer').value);
  if (isNaN(buffer) || buffer < 0) return;
  const btn = document.getElementById('settings-buffer-btn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    await api('/profile', {
      method: 'PUT',
      body: JSON.stringify({ savings_buffer: buffer }),
    });
    btn.textContent = 'Saved ✓';
    setTimeout(() => { btn.textContent = 'Save'; }, 1500);
  } catch (e) {
    console.error('Buffer save failed:', e.message);
  } finally {
    btn.disabled = false;
  }
});

// PDF re-upload from settings
document.getElementById('settings-upload-btn').addEventListener('click', async () => {
  const file = document.getElementById('settings-pdf-input').files[0];
  if (!file) return;
  const btn = document.getElementById('settings-upload-btn');
  btn.disabled = true; btn.textContent = 'Uploading…';
  const status = document.getElementById('settings-upload-status');
  status.classList.add('hidden');
  try {
    const form = new FormData();
    form.append('file', file);
    const result = await api('/statements', { method: 'POST', body: form });
    document.getElementById('statement-meta').textContent =
      `Uploaded: ${result.inserted} transactions parsed`;
    status.classList.add('hidden');
  } catch (e) {
    status.textContent = `Upload failed: ${e.message}`;
    status.classList.remove('hidden');
  } finally {
    btn.disabled = false; btn.textContent = 'Upload';
  }
});
