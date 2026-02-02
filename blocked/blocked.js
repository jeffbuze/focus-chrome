// blocked/blocked.js — Block page logic

const params = new URLSearchParams(window.location.search);
const groupName = params.get('group') || 'Unknown Group';
const groupId = params.get('groupId') || '';
const reason = params.get('reason') || 'always-blocked';
const allowedMinutes = params.get('allowedMinutes') || '';

// Load and display a random quote
async function loadQuote() {
  try {
    const resp = await fetch(chrome.runtime.getURL('assets/inspirational-quotes.json'));
    const quotes = await resp.json();
    const quote = quotes[Math.floor(Math.random() * quotes.length)];
    document.getElementById('quoteText').textContent = `"${quote.text}"`;
    document.getElementById('quoteAuthor').textContent = `— ${quote.author}`;
  } catch (e) {
    document.getElementById('quoteText').textContent = '"Focus on being productive instead of busy."';
    document.getElementById('quoteAuthor').textContent = '— Tim Ferriss';
  }
}

// Display the reason for blocking
function displayReason() {
  const el = document.getElementById('reasonText');
  switch (reason) {
    case 'always-blocked':
      el.textContent = 'Sites in this group are always blocked — no access windows have been set up.';
      break;
    case 'budget-exhausted':
      el.textContent = allowedMinutes
        ? `You've used your ${allowedMinutes} minute${allowedMinutes === '1' ? '' : 's'} of allowed time for today.`
        : "You've used all your allowed time for today.";
      break;
    case 'outside-schedule':
      el.textContent = 'No access window is currently active for this group.';
      break;
    default:
      el.textContent = 'This site is currently blocked by BlankSlate Focus.';
  }
}

// Display meta information
function displayMeta() {
  // Try encoded url param first (from time-tracker paths)
  let urlParam = params.get('url') || '';

  // Also extract raw substring after &url= for DNR regexSubstitution,
  // which appends the matched URL unencoded (e.g. &url=https://reddit.com/r/funny?sort=hot)
  const rawSearch = window.location.search;
  const urlMarker = '&url=';
  const markerIdx = rawSearch.indexOf(urlMarker);
  if (markerIdx !== -1) {
    const rawValue = rawSearch.substring(markerIdx + urlMarker.length);
    // If the raw value starts with an unencoded scheme, use it instead
    if (rawValue.startsWith('http://') || rawValue.startsWith('https://')) {
      urlParam = rawValue;
    }
  }

  const referrer = document.referrer || '';
  // Prefer the explicit url param, fall back to referrer
  const originalUrl = urlParam || (referrer && !referrer.includes('chrome-extension://') ? referrer : '');

  const rowEl = document.getElementById('blockedUrlRow');
  const urlEl = document.getElementById('blockedUrl');

  if (originalUrl) {
    urlEl.textContent = originalUrl;
    rowEl.style.display = 'flex';

    document.getElementById('copyUrlBtn').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(originalUrl);
        const btn = document.getElementById('copyUrlBtn');
        const original = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = original; }, 1500);
      } catch {
        // clipboard write may fail in some contexts
      }
    });
  }

  document.getElementById('groupName').innerHTML = `Group: <strong>${escapeHtml(groupName)}</strong>`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Button handlers
document.getElementById('goBackBtn').addEventListener('click', () => {
  // Going back would re-trigger the block redirect, so open a new tab instead
  chrome.tabs.update({ url: 'chrome://newtab' });
});

document.getElementById('dashboardLink').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.update({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
});

// Initialize
loadQuote();
displayReason();
displayMeta();
