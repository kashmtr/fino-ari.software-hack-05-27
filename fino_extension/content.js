const CHECKOUT_KEYWORDS = ['checkout', 'cart', 'shipping', 'payment', 'order', 'billing', 'purchase'];
const url = window.location.href.toLowerCase();
const onCheckout = CHECKOUT_KEYWORDS.some(kw => url.includes(kw));

const SELECTORS = [
  // Generic testid patterns
  '[data-testid="order-total"]',
  '[data-testid="order-summary-total"] .price-value',
  // Common class patterns
  '.order-summary__total .price',
  '.cart-total .amount',
  '#checkout-total',
  '.summary-total',
  '.order-total',
  // Wildcard class combos
  '[class*="total"] [class*="price"]',
  '[class*="order"] [class*="total"]',
  '[class*="OrderTotal"]',
  '[class*="CartTotal"]',
  '[class*="cart-total"]',
  '[class*="order-total"]',
  // H&M / Aritzia / Shopify / common SPA patterns
  '[class*="Total"] [class*="Price"]',
  '[class*="summary"] [class*="total"]',
  '.price-package__total',
  '.checkout-order-summary__total',
];

function tryParseTotal() {
  // Selector-based approach
  for (const sel of SELECTORS) {
    try {
      const el = document.querySelector(sel);
      if (el) {
        const parsed = parseFloat(el.textContent.replace(/[^0-9.]/g, ''));
        if (!isNaN(parsed) && parsed > 0) return parsed;
      }
    } catch { /* invalid selector — skip */ }
  }

  // Generic text-based fallback: find any element containing "total" label
  // whose text also contains a $XX.XX price pattern
  const priceRe = /\$\s*([\d,]+\.\d{2})/;
  const totalCandidates = document.querySelectorAll(
    '[class*="total" i], [class*="Total"], [id*="total" i], [id*="Total"]'
  );
  for (const el of totalCandidates) {
    // Only look at leaf-ish nodes to avoid matching entire page sections
    if (el.children.length > 6) continue;
    const m = el.textContent.match(priceRe);
    if (m) {
      const val = parseFloat(m[1].replace(/,/g, ''));
      if (!isNaN(val) && val > 0) return val;
    }
  }

  return null;
}

if (onCheckout) {
  // Retry up to 5 times with 600 ms gaps — handles React/SPA pages that
  // render the cart total after document_idle fires.
  function attempt(retriesLeft) {
    const total = tryParseTotal();
    if (total !== null || retriesLeft <= 0) {
      chrome.storage.session.set({ cartTotal: total, onCheckout: true });
    } else {
      setTimeout(() => attempt(retriesLeft - 1), 600);
    }
  }
  attempt(5);
} else {
  chrome.storage.session.set({ cartTotal: null, onCheckout: false });
}
