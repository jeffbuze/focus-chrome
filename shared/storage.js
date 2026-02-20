// shared/storage.js — Thin async abstraction over chrome.storage.local

export function todayDateStr() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// ── Groups ──────────────────────────────────────────────────────────────

export async function getGroups() {
  const { groups } = await chrome.storage.local.get({ groups: [] });
  return groups;
}

export async function saveGroups(groups) {
  await chrome.storage.local.set({ groups });
}

export async function getGroupById(id) {
  const groups = await getGroups();
  return groups.find(g => g.id === id) || null;
}

// ── Time-Tracking ───────────────────────────────────────────────────────
// Keys: tracking::{groupId}::{YYYY-MM-DD}::{blockId}
// Value: { usedSeconds: number }

function trackingKey(groupId, dateStr, blockId) {
  return `tracking::${groupId}::${dateStr}::${blockId}`;
}

export async function getTrackingEntry(groupId, dateStr, blockId) {
  const key = trackingKey(groupId, dateStr, blockId);
  const result = await chrome.storage.local.get({ [key]: { usedSeconds: 0 } });
  return result[key];
}

export async function setTrackingEntry(groupId, dateStr, blockId, entry) {
  const key = trackingKey(groupId, dateStr, blockId);
  await chrome.storage.local.set({ [key]: entry });
}

export async function getAllTrackingForDate(dateStr) {
  const all = await chrome.storage.local.get(null);
  const prefix = `tracking::`;
  const suffix = `::${dateStr}::`;
  const entries = {};
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith(prefix) && key.includes(suffix)) {
      entries[key] = value;
    }
  }
  return entries;
}

// ── Pause ───────────────────────────────────────────────────────────────
// Keys: pause::{groupId}
// Value: { pausedUntil: timestamp }

function pauseKey(groupId) {
  return `pause::${groupId}`;
}

export async function getPause(groupId) {
  const key = pauseKey(groupId);
  const result = await chrome.storage.local.get({ [key]: null });
  return result[key];
}

export async function setPause(groupId, pausedUntilTimestamp) {
  const key = pauseKey(groupId);
  await chrome.storage.local.set({ [key]: { pausedUntil: pausedUntilTimestamp } });
}

export async function clearPause(groupId) {
  const key = pauseKey(groupId);
  await chrome.storage.local.remove(key);
}

export async function getAllActivePauses() {
  const all = await chrome.storage.local.get(null);
  const now = Date.now();
  const pauses = {};
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith('pause::') && value && value.pausedUntil > now) {
      const groupId = key.slice('pause::'.length);
      pauses[groupId] = value;
    }
  }
  return pauses;
}

// ── Pause Count ────────────────────────────────────────────────────────
// Keys: pauseCount::{groupId}::{YYYY-MM-DD}
// Value: { count: number }

function pauseCountKey(groupId, dateStr) {
  return `pauseCount::${groupId}::${dateStr}`;
}

export async function getPauseCount(groupId, dateStr) {
  const key = pauseCountKey(groupId, dateStr);
  const result = await chrome.storage.local.get({ [key]: { count: 0 } });
  return result[key];
}

export async function incrementPauseCount(groupId, dateStr) {
  const key = pauseCountKey(groupId, dateStr);
  const current = await chrome.storage.local.get({ [key]: { count: 0 } });
  const newCount = current[key].count + 1;
  await chrome.storage.local.set({ [key]: { count: newCount } });
  return newCount;
}

// ── Rule ID Management ──────────────────────────────────────────────────

export async function getRuleIdMap() {
  const { ruleIdMap } = await chrome.storage.local.get({ ruleIdMap: {} });
  return ruleIdMap;
}

export async function saveRuleIdMap(map) {
  await chrome.storage.local.set({ ruleIdMap: map });
}

export async function getNextRuleId() {
  const { nextRuleId } = await chrome.storage.local.get({ nextRuleId: 1 });
  return nextRuleId;
}

export async function saveNextRuleId(id) {
  await chrome.storage.local.set({ nextRuleId: id });
}

// ── Settings ────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  showBadge: true,
  firstRun: true,
  maxDailyPauses: 3,
};

export async function getSettings() {
  const { settings } = await chrome.storage.local.get({ settings: DEFAULT_SETTINGS });
  return { ...DEFAULT_SETTINGS, ...settings };
}

export async function saveSettings(settings) {
  await chrome.storage.local.set({ settings });
}

// ── Change Listener ─────────────────────────────────────────────────────

export function onStorageChanged(callback) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
      callback(changes);
    }
  });
}
