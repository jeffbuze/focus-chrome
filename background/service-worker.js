// background/service-worker.js — Orchestrates all background modules
import {
  getGroups, saveGroups, getSettings, saveSettings, onStorageChanged,
  setPause, clearPause, getAllActivePauses, todayDateStr,
} from '../shared/storage.js';
import { rebuildAllRules, findMatchingGroups, shouldGroupBlockNow } from './rule-engine.js';
import {
  evaluateCurrentTab, stopTracking, onPersistAlarm, resumeTracking,
  getTrackingState,
} from './time-tracker.js';
import { updateIcon } from './icon-renderer.js';

const ALARM_PERSIST = 'persist-tick';
const ALARM_MIDNIGHT = 'midnight-rollover';
const ALARM_PAUSE_PREFIX = 'pause-expiry::';

// ── Event Listeners (registered synchronously at top level) ─────────────

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    // First install: open dashboard
    const settings = await getSettings();
    if (settings.firstRun) {
      await saveSettings({ ...settings, firstRun: false });
      chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
    }
  }

  // Migrate: ensure all groups are enabled (toggle was removed)
  const groups = await getGroups();
  const needsMigration = groups.some(g => !g.enabled);
  if (needsMigration) {
    groups.forEach(g => { g.enabled = true; });
    await saveGroups(groups);
  }

  await initialize();
});

chrome.runtime.onStartup.addListener(async () => {
  await initialize();
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' || changeInfo.url) {
    await evaluateCurrentTab();
  }
});

chrome.tabs.onActivated.addListener(async () => {
  await evaluateCurrentTab();
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // All windows lost focus — stop tracking
    await stopTracking();
    await updateIcon('default');
  } else {
    await evaluateCurrentTab();
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_PERSIST) {
    await onPersistAlarm();
  } else if (alarm.name === ALARM_MIDNIGHT) {
    await handleMidnightRollover();
  } else if (alarm.name.startsWith(ALARM_PAUSE_PREFIX)) {
    const groupId = alarm.name.slice(ALARM_PAUSE_PREFIX.length);
    await handlePauseExpiry(groupId);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'pause-activated') {
    handlePauseActivated(message.groupId, message.pausedUntil)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true; // async response
  }

  if (message.type === 'pause-ended') {
    chrome.alarms.clear(`${ALARM_PAUSE_PREFIX}${message.groupId}`)
      .then(() => handlePauseExpiry(message.groupId))
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (message.type === 'get-tracking-state') {
    sendResponse({ state: getTrackingState() });
    return false;
  }

  if (message.type === 'get-tab-status') {
    getTabStatus(message.url)
      .then((status) => sendResponse(status))
      .catch(() => sendResponse({ matched: false }));
    return true;
  }
});

// Listen for storage changes to rebuild rules
onStorageChanged(async (changes) => {
  if (changes.groups) {
    await rebuildAllRules();
    await evaluateCurrentTab();
  }
});

// ── Initialization ──────────────────────────────────────────────────────

async function initialize() {
  try {
    // Rebuild all blocking rules from storage
    await rebuildAllRules();

    // Set up persistent alarms
    await setupAlarms();

    // Evaluate current tab
    await evaluateCurrentTab();
  } catch (e) {
    console.error('BlankSlate Focus initialization error:', e);
  }
}

async function setupAlarms() {
  // Heartbeat alarm for persisting tracking data (every 30 seconds)
  await chrome.alarms.create(ALARM_PERSIST, { periodInMinutes: 0.5 });

  // Midnight rollover alarm
  await scheduleMidnightAlarm();

  // Restore any active pause expiry alarms
  const pauses = await getAllActivePauses();
  for (const [groupId, pause] of Object.entries(pauses)) {
    const alarmName = `${ALARM_PAUSE_PREFIX}${groupId}`;
    await chrome.alarms.create(alarmName, { when: pause.pausedUntil });
  }
}

async function scheduleMidnightAlarm() {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setDate(midnight.getDate() + 1);
  midnight.setHours(0, 0, 5, 0); // 00:00:05

  await chrome.alarms.create(ALARM_MIDNIGHT, {
    when: midnight.getTime(),
    periodInMinutes: 24 * 60, // Repeat daily
  });
}

// ── Pause Handling ──────────────────────────────────────────────────────

async function handlePauseActivated(groupId, pausedUntil) {
  await setPause(groupId, pausedUntil);

  // Set alarm for pause expiry
  const alarmName = `${ALARM_PAUSE_PREFIX}${groupId}`;
  await chrome.alarms.create(alarmName, { when: pausedUntil });

  // Rebuild rules (removes blocking for paused group)
  await rebuildAllRules();
  await evaluateCurrentTab();
}

async function handlePauseExpiry(groupId) {
  await clearPause(groupId);
  await rebuildAllRules();
  await evaluateCurrentTab();
}

// ── Midnight Rollover ───────────────────────────────────────────────────

async function handleMidnightRollover() {
  // Stop any active tracking (new day = fresh budgets)
  await stopTracking();
  await rebuildAllRules();
  await evaluateCurrentTab();

  // Reschedule next midnight alarm
  await scheduleMidnightAlarm();
}

// ── Tab Status Query ────────────────────────────────────────────────────

async function getTabStatus(url) {
  if (!url) return { matched: false };

  const groups = await getGroups();
  const matching = findMatchingGroups(url, groups);
  if (matching.length === 0) return { matched: false };

  const group = matching[0];
  const decision = await shouldGroupBlockNow(group);

  return {
    matched: true,
    groupId: group.id,
    groupName: group.name,
    ...decision,
  };
}

// Run initialization if loaded (handles service worker restart)
initialize();
