const CHECKOUT_KEYWORDS = ['checkout', 'cart', 'shipping', 'payment', 'order', 'billing', 'purchase'];

function setCheckoutBadge(tabId, url) {
  if (!url || !url.startsWith('http')) {
    chrome.action.setBadgeText({ text: '', tabId });
    return;
  }
  const lower = url.toLowerCase();
  const onCheckout = CHECKOUT_KEYWORDS.some(kw => lower.includes(kw));
  if (onCheckout) {
    chrome.action.setBadgeText({ text: '$', tabId });
    chrome.action.setBadgeBackgroundColor({ color: '#22c55e', tabId });
  } else {
    chrome.action.setBadgeText({ text: '', tabId });
  }
}

// Badge when a page finishes loading
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    setCheckoutBadge(tabId, tab.url);
  }
});

// Badge when the user switches tabs
chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError) return;
    if (tab.url) setCheckoutBadge(tabId, tab.url);
  });
});
