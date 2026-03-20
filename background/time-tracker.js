// background/time-tracker.js — Per-second tracking for the active foreground tab
import {
  getGroups, getTrackingEntry, setTrackingEntry, todayDateStr,
} from '../shared/storage.js';
import { updateIcon, formatBadgeTime } from './icon-renderer.js';
import {
  rebuildAllRules, findMatchingGroups, shouldGroupBlockNow,
} from './rule-engine.js';

export const IDLE_DETECTION_SECONDS = 60;
const TRACKABLE_WINDOW_TYPES = ['normal', 'popup'];

let trackingState = null;
// { groupId, blockId, usedSeconds, allowedSeconds, tabId, windowId, dateStr, intervalId }

let tickCounter = 0;
let currentIdleState = 'active';
let tickInFlight = false;

export function getTrackingState() {
  return trackingState ? { ...trackingState } : null;
}

export function setIdleState(idleState) {
  currentIdleState = idleState || 'active';
}

function isBlockedPageUrl(url) {
  return url.startsWith('chrome-extension://') && url.includes('blocked/blocked.html');
}

function isInternalUrl(url) {
  return url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('about:');
}

function extractOriginalUrl(blockedPageUrl) {
  try {
    const rawSearch = new URL(blockedPageUrl).search;
    const urlMarker = '&url=';
    const markerIdx = rawSearch.indexOf(urlMarker);
    if (markerIdx !== -1) {
      const rawValue = rawSearch.substring(markerIdx + urlMarker.length);
      if (rawValue.startsWith('http://') || rawValue.startsWith('https://')) {
        return rawValue;
      }
    }
    return new URL(blockedPageUrl).searchParams.get('url') || null;
  } catch {
    return null;
  }
}

function buildBlockedRedirectUrl(group, decision, url) {
  return chrome.runtime.getURL(
    `blocked/blocked.html?group=${encodeURIComponent(group.name)}&groupId=${encodeURIComponent(group.id)}&reason=${encodeURIComponent(decision.reason)}&allowedMinutes=${decision.allowedMinutes || ''}&url=${encodeURIComponent(url)}`
  );
}

async function getForegroundTabContext() {
  if (currentIdleState !== 'active') {
    return null;
  }

  let focusedWindow;
  try {
    focusedWindow = await chrome.windows.getLastFocused({
      populate: true,
      windowTypes: TRACKABLE_WINDOW_TYPES,
    });
  } catch {
    return null;
  }

  if (
    !focusedWindow ||
    focusedWindow.id == null ||
    !focusedWindow.focused ||
    focusedWindow.state === 'minimized' ||
    !Array.isArray(focusedWindow.tabs)
  ) {
    return null;
  }

  const tab = focusedWindow.tabs.find(candidate => candidate.active);
  if (!tab || tab.id == null || !tab.url) {
    return null;
  }

  return { tab, windowId: focusedWindow.id };
}

async function resolveForegroundTabState() {
  const context = await getForegroundTabContext();
  if (!context) {
    return { status: 'default' };
  }

  const { tab, windowId } = context;
  const url = tab.url;

  if (isBlockedPageUrl(url)) {
    const originalUrl = extractOriginalUrl(url);

    if (originalUrl) {
      const groups = await getGroups();
      const matchingGroups = findMatchingGroups(originalUrl, groups);

      let stillBlocked = false;
      for (const group of matchingGroups) {
        const decision = await shouldGroupBlockNow(group);
        if (decision.block) {
          stillBlocked = true;
          break;
        }
      }

      if (!stillBlocked && matchingGroups.length > 0) {
        return {
          status: 'restore-original',
          originalUrl,
          tabId: tab.id,
        };
      }
    }

    return { status: 'blocked' };
  }

  if (isInternalUrl(url)) {
    return { status: 'default' };
  }

  const groups = await getGroups();
  const matchingGroups = findMatchingGroups(url, groups);

  if (matchingGroups.length === 0) {
    return { status: 'default' };
  }

  let mostRestrictive = null;
  let bestDecision = null;

  for (const group of matchingGroups) {
    const decision = await shouldGroupBlockNow(group);

    if (decision.block) {
      return {
        status: 'redirect-blocked',
        decision,
        group,
        tabId: tab.id,
        url,
      };
    }

    if (decision.reason === 'paused') {
      return {
        status: 'paused',
        pauseRemaining: Math.ceil((decision.pausedUntil - Date.now()) / 1000),
      };
    }

    if (decision.reason === 'allowed') {
      if (!bestDecision || decision.remainingSeconds < bestDecision.remainingSeconds) {
        mostRestrictive = group;
        bestDecision = decision;
      }
    }
  }

  if (!mostRestrictive || !bestDecision) {
    return { status: 'default' };
  }

  return {
    status: 'track',
    allowedSeconds: bestDecision.activeBlock.allowedMinutes * 60,
    blockId: bestDecision.activeBlock.id,
    dateStr: todayDateStr(),
    groupId: mostRestrictive.id,
    tabId: tab.id,
    url,
    windowId,
  };
}

function matchesTrackingSession(resolvedState) {
  return (
    !!trackingState &&
    resolvedState.status === 'track' &&
    trackingState.groupId === resolvedState.groupId &&
    trackingState.blockId === resolvedState.blockId &&
    trackingState.tabId === resolvedState.tabId &&
    trackingState.windowId === resolvedState.windowId &&
    trackingState.dateStr === resolvedState.dateStr
  );
}

async function renderTrackingBadge(remainingSeconds) {
  const state = remainingSeconds <= 60 ? 'urgent' : 'timer';
  const badgeBg = remainingSeconds <= 60 ? '#F4B400' : '#34A853';
  await updateIcon(state, formatBadgeTime(remainingSeconds), badgeBg);
}

async function redirectTabToBlockedPage(tabId, group, decision, url) {
  const redirectUrl = buildBlockedRedirectUrl(group, decision, url);
  try {
    await chrome.tabs.update(tabId, { url: redirectUrl });
  } catch {
    // Tab may have closed between evaluation and redirect
  }
}

export async function evaluateCurrentTab() {
  const resolvedState = await resolveForegroundTabState();

  if (resolvedState.status === 'restore-original') {
    await stopTracking();
    try {
      await chrome.tabs.update(resolvedState.tabId, { url: resolvedState.originalUrl });
    } catch {
      // Tab may have closed
    }
    await updateIcon('default');
    return;
  }

  if (resolvedState.status === 'blocked') {
    await stopTracking();
    await updateIcon('blocked', 'X', '#EA4335');
    return;
  }

  if (resolvedState.status === 'redirect-blocked') {
    await stopTracking();
    await updateIcon('blocked', 'X', '#EA4335');
    await redirectTabToBlockedPage(
      resolvedState.tabId,
      resolvedState.group,
      resolvedState.decision,
      resolvedState.url,
    );
    return;
  }

  if (resolvedState.status === 'paused') {
    await stopTracking();
    await updateIcon('paused', formatBadgeTime(resolvedState.pauseRemaining), '#9E9E9E');
    return;
  }

  if (resolvedState.status !== 'track') {
    await stopTracking();
    await updateIcon('default');
    return;
  }

  if (matchesTrackingSession(resolvedState)) {
    trackingState.allowedSeconds = resolvedState.allowedSeconds;

    if (trackingState.usedSeconds >= trackingState.allowedSeconds) {
      await stopTracking();
      await rebuildAllRules();
      await evaluateCurrentTab();
      return;
    }

    await renderTrackingBadge(trackingState.allowedSeconds - trackingState.usedSeconds);
    return;
  }

  await stopTracking();
  await startTracking(
    resolvedState.groupId,
    resolvedState.blockId,
    resolvedState.allowedSeconds / 60,
    resolvedState.tabId,
    resolvedState.windowId,
    resolvedState.dateStr,
  );
}

async function startTracking(groupId, blockId, allowedMinutes, tabId, windowId, dateStr) {
  const entry = await getTrackingEntry(groupId, dateStr, blockId);

  trackingState = {
    groupId,
    blockId,
    usedSeconds: entry.usedSeconds,
    allowedSeconds: allowedMinutes * 60,
    tabId,
    windowId,
    dateStr,
    intervalId: null,
  };

  tickCounter = 0;
  tickInFlight = false;

  // Start the tick interval
  trackingState.intervalId = setInterval(() => {
    if (tickInFlight) return;
    tickInFlight = true;
    tick().finally(() => {
      tickInFlight = false;
    });
  }, 1000);

  // Update icon immediately
  await renderTrackingBadge(trackingState.allowedSeconds - trackingState.usedSeconds);
}

export async function stopTracking() {
  if (!trackingState) return;

  // Persist final state
  await persistTracking();

  if (trackingState.intervalId) {
    clearInterval(trackingState.intervalId);
  }
  trackingState = null;
  tickCounter = 0;
  tickInFlight = false;
}

async function persistTracking() {
  if (!trackingState) return;
  await setTrackingEntry(trackingState.groupId, trackingState.dateStr, trackingState.blockId, {
    usedSeconds: trackingState.usedSeconds,
  });
}

async function tick() {
  if (!trackingState) return;

  const resolvedState = await resolveForegroundTabState();
  if (!trackingState) return;

  if (!matchesTrackingSession(resolvedState)) {
    await stopTracking();
    await evaluateCurrentTab();
    return;
  }

  trackingState.allowedSeconds = resolvedState.allowedSeconds;

  if (trackingState.usedSeconds >= trackingState.allowedSeconds) {
    await stopTracking();
    await rebuildAllRules();
    await evaluateCurrentTab();
    return;
  }

  trackingState.usedSeconds++;
  tickCounter++;

  const remaining = trackingState.allowedSeconds - trackingState.usedSeconds;

  // Persist every 30 ticks (alarm also persists periodically)
  if (tickCounter % 30 === 0) {
    await persistTracking();
  }

  if (remaining <= 0) {
    // Budget exhausted — capture state before stopping
    await persistTracking();
    const tabId = trackingState.tabId;
    const windowId = trackingState.windowId;
    const groupId = trackingState.groupId;
    const allowedMinutes = Math.floor(trackingState.allowedSeconds / 60);

    await stopTracking();
    await rebuildAllRules();

    // Redirect only if the exhausted tab is still the visible foreground tab.
    try {
      const context = await getForegroundTabContext();
      if (!context || context.windowId !== windowId || context.tab.id !== tabId) {
        await updateIcon('blocked', 'X', '#EA4335');
        return;
      }

      const tabUrl = context.tab.url || '';
      const group = (await getGroups()).find(g => g.id === groupId);
      const groupName = group ? group.name : 'Unknown';
      await redirectTabToBlockedPage(
        tabId,
        { id: groupId, name: groupName },
        { reason: 'budget-exhausted', allowedMinutes },
        tabUrl,
      );
    } catch (e) {
      console.warn('Failed to redirect tab after budget exhaustion:', e);
    }

    await updateIcon('blocked', 'X', '#EA4335');
    return;
  }

  // Update icon
  const state = remaining <= 60 ? 'urgent' : 'timer';
  const badgeBg = remaining <= 60 ? '#F4B400' : '#34A853';
  await updateIcon(state, formatBadgeTime(remaining), badgeBg);
}

// Called by alarm handler to persist state periodically
export async function onPersistAlarm() {
  if (trackingState) {
    await persistTracking();
  }
}
