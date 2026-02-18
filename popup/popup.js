// popup/popup.js — Popup UI logic
import { getGroups, getPause, getTrackingEntry, todayDateStr } from '../shared/storage.js';
import {
  findMatchingGroups, shouldGroupBlockNow, getActiveBlockForGroup,
} from '../background/rule-engine.js';

const CONFIRMATION_PHRASE = "i know i should be focusing, but i need to do something important right now instead.";

let currentGroupId = null;
let currentBlockedUrl = null;

async function init() {
  // Open dashboard link
  document.getElementById('openDashboard').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
    window.close();
  });

  // Get active tab
  let tabs;
  try {
    tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    showNoMatch();
    return;
  }

  if (!tabs || !tabs[0] || !tabs[0].url) {
    showNoMatch();
    return;
  }

  const url = tabs[0].url;

  // Detect our blocked page
  if (url.startsWith('chrome-extension://') && url.includes('blocked/blocked.html')) {
    const blockedParams = new URL(url).searchParams;
    const groupId = blockedParams.get('groupId');

    // Extract the blocked URL from the blocked page params
    // DNR regexSubstitution appends the URL unencoded, so parse raw query string
    const rawSearch = new URL(url).search;
    const urlMarker = '&url=';
    const markerIdx = rawSearch.indexOf(urlMarker);
    if (markerIdx !== -1) {
      const rawValue = rawSearch.substring(markerIdx + urlMarker.length);
      if (rawValue.startsWith('http://') || rawValue.startsWith('https://')) {
        currentBlockedUrl = rawValue;
      }
    }
    // Fallback to encoded param
    if (!currentBlockedUrl) {
      currentBlockedUrl = blockedParams.get('url') || null;
    }

    const groups = await getGroups();
    const group = groups.find(g => g.id === groupId);
    if (group) {
      currentGroupId = group.id;
      const decision = await shouldGroupBlockNow(group);
      showStatus(group, decision);
      // Check for active pause
      const pause = await getPause(group.id);
      if (pause && pause.pausedUntil > Date.now()) {
        showActivePause(pause.pausedUntil);
        return;
      }
      // Show pause option
      await setupPauseSection(group.id);
      return;
    }
    showNoMatch();
    return;
  }

  if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('about:')) {
    showNoMatch();
    return;
  }

  const groups = await getGroups();
  const matching = findMatchingGroups(url, groups);

  if (matching.length === 0) {
    showNoMatch();
    return;
  }

  // Use the first (most relevant) matching group
  const group = matching[0];
  currentGroupId = group.id;
  currentBlockedUrl = url;

  const decision = await shouldGroupBlockNow(group);
  showStatus(group, decision);

  // Check for active pause
  const pause = await getPause(group.id);
  if (pause && pause.pausedUntil > Date.now()) {
    showActivePause(pause.pausedUntil);
    return;
  }

  // Show pause option only when the site is blocked
  if (decision.block) {
    await setupPauseSection(group.id);
  }
}

function showNoMatch() {
  document.getElementById('noMatchSection').style.display = 'block';
}

function showStatus(group, decision) {
  const section = document.getElementById('statusSection');
  const indicator = document.getElementById('statusIndicator');
  const groupEl = document.getElementById('statusGroup');
  const detailEl = document.getElementById('statusDetail');

  section.style.display = 'block';
  groupEl.textContent = group.name;

  if (decision.block) {
    indicator.className = 'status-indicator blocked';
    switch (decision.reason) {
      case 'always-blocked':
        detailEl.textContent = 'Always blocked — no time windows set';
        break;
      case 'budget-exhausted':
        detailEl.textContent = `Time budget used (${decision.allowedMinutes}m)`;
        break;
      case 'outside-schedule':
        detailEl.textContent = 'Outside allowed time window';
        break;
      default:
        detailEl.textContent = 'Blocked';
    }
  } else if (decision.reason === 'paused') {
    indicator.className = 'status-indicator paused';
    detailEl.textContent = 'Paused';
  } else if (decision.reason === 'allowed') {
    const remaining = decision.remainingSeconds;
    if (remaining <= 60) {
      indicator.className = 'status-indicator urgent';
      detailEl.textContent = `${remaining}s remaining`;
    } else {
      indicator.className = 'status-indicator timer';
      const mins = Math.ceil(remaining / 60);
      detailEl.textContent = `${mins}m remaining`;
    }
  }
}

function showActivePause(pausedUntil) {
  const section = document.getElementById('activePauseSection');
  section.style.display = 'block';

  function updateRemaining() {
    const remaining = Math.max(0, Math.ceil((pausedUntil - Date.now()) / 1000));
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    document.getElementById('pauseRemaining').textContent =
      mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

    if (remaining <= 0) {
      clearInterval(interval);
      section.style.display = 'none';
      init(); // Re-initialize
    }
  }

  updateRemaining();
  const interval = setInterval(updateRemaining, 1000);

  document.getElementById('endPauseBtn').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({
      type: 'pause-ended',
      groupId: currentGroupId,
    });
    clearInterval(interval);
    window.close();
  });
}

async function setupPauseSection(groupId) {
  const section = document.getElementById('pauseSection');
  section.style.display = 'block';

  const input = document.getElementById('pauseInput');
  const buttons = document.querySelectorAll('.pause-btn');
  const pasteWarning = document.getElementById('pasteWarning');
  const pauseLimitInfo = document.getElementById('pauseLimitInfo');
  const pauseLimitStatus = await chrome.runtime.sendMessage({
    type: 'get-pause-limit-status',
    groupId,
  });
  let remainingPauses = null;

  if (pauseLimitStatus && pauseLimitStatus.ok) {
    remainingPauses = pauseLimitStatus.remaining;
    pauseLimitInfo.classList.remove('warning');
    if (remainingPauses <= 0) {
      pauseLimitInfo.classList.add('warning');
      pauseLimitInfo.textContent = `Daily pause limit reached (${pauseLimitStatus.used}/${pauseLimitStatus.limit}).`;
    } else {
      pauseLimitInfo.textContent = `Pauses today: ${pauseLimitStatus.used}/${pauseLimitStatus.limit}`;
    }
  } else {
    pauseLimitInfo.textContent = '';
  }

  input.addEventListener('paste', (e) => {
    e.preventDefault();
    pasteWarning.style.display = 'block';
    setTimeout(() => {
      pasteWarning.style.display = 'none';
    }, 3000);
  });

  input.addEventListener('input', () => {
    const typed = input.value.trim().toLowerCase().replace(/[""]/g, '"').replace(/['']/g, "'");
    const matches = typed === CONFIRMATION_PHRASE;
    const canPause = remainingPauses === null ? matches : (matches && remainingPauses > 0);
    buttons.forEach(btn => {
      btn.disabled = !canPause;
    });
  });

  buttons.forEach(btn => {
    btn.addEventListener('click', async () => {
      const minutes = parseInt(btn.dataset.minutes);
      const pausedUntil = Date.now() + minutes * 60 * 1000;

      // Send message to service worker to activate pause
      const activationResult = await chrome.runtime.sendMessage({
        type: 'pause-activated',
        groupId,
        pausedUntil,
      });
      if (!activationResult || !activationResult.ok) {
        if (activationResult?.reason === 'pause-limit-reached') {
          remainingPauses = 0;
          pauseLimitInfo.classList.add('warning');
          pauseLimitInfo.textContent = `Daily pause limit reached (${activationResult.used}/${activationResult.limit}).`;
          buttons.forEach(button => { button.disabled = true; });
        }
        return;
      }
      remainingPauses = activationResult.remaining;
      pauseLimitInfo.classList.remove('warning');
      pauseLimitInfo.textContent = `Pauses today: ${activationResult.used}/${activationResult.limit}`;

      // Navigate the tab to the originally blocked URL
      if (currentBlockedUrl) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) {
          await chrome.tabs.update(tab.id, { url: currentBlockedUrl });
        }
      }

      window.close();
    });
  });
}

init();
