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
      el.textContent = 'This site is currently blocked by Focus Guard.';
  }
}

// Display meta information
function displayMeta() {
  const referrer = document.referrer || '';
  // Try to extract the original URL from the referrer or show group info
  const urlEl = document.getElementById('blockedUrl');
  if (referrer && !referrer.includes('chrome-extension://')) {
    urlEl.textContent = referrer;
  } else {
    urlEl.textContent = '';
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
