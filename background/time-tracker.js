// background/time-tracker.js — Per-second tracking for the active focused tab
import {
  getGroups, getTrackingEntry, setTrackingEntry,
  todayDateStr, getPause,
} from '../shared/storage.js';
import { updateIcon, formatBadgeTime } from './icon-renderer.js';
import {
  rebuildAllRules, findMatchingGroups, shouldGroupBlockNow,
  getActiveBlockForGroup,
} from './rule-engine.js';

let trackingState = null;
// { groupId, blockId, usedSeconds, allowedSeconds, tabId, intervalId }

let tickCounter = 0;

export function getTrackingState() {
  return trackingState ? { ...trackingState } : null;
}

export async function evaluateCurrentTab() {
  // Query the active tab in the focused window
  let tabs;
  try {
    tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    return;
  }

  if (!tabs || tabs.length === 0 || !tabs[0].url) {
    await stopTracking();
    await updateIcon('default');
    return;
  }

  const tab = tabs[0];
  const url = tab.url;

  // Detect if we're on our own blocked page — check if the original URL is still blocked
  if (url.startsWith('chrome-extension://') && url.includes('blocked/blocked.html')) {
    let originalUrl = null;
    try {
      const rawSearch = new URL(url).search;
      const urlMarker = '&url=';
      const markerIdx = rawSearch.indexOf(urlMarker);
      if (markerIdx !== -1) {
        const rawValue = rawSearch.substring(markerIdx + urlMarker.length);
        if (rawValue.startsWith('http://') || rawValue.startsWith('https://')) {
          originalUrl = rawValue;
        }
      }
      if (!originalUrl) {
        originalUrl = new URL(url).searchParams.get('url') || null;
      }
    } catch {
      // URL parsing failed
    }

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
        try {
          await chrome.tabs.update(tab.id, { url: originalUrl });
        } catch (e) {
          // Tab may have closed
        }
        return;
      }
    }

    await stopTracking();
    await updateIcon('blocked', 'X', '#EA4335');
    return;
  }

  // Skip chrome:// and other extension pages
  if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('about:')) {
    await stopTracking();
    await updateIcon('default');
    return;
  }

  const groups = await getGroups();
  const matchingGroups = findMatchingGroups(url, groups);

  if (matchingGroups.length === 0) {
    await stopTracking();
    await updateIcon('default');
    return;
  }

  // Find the most restrictive match (blocked > least remaining time)
  let mostRestrictive = null;
  let bestDecision = null;

  for (const group of matchingGroups) {
    const decision = await shouldGroupBlockNow(group);

    if (decision.block) {
      await stopTracking();
      await updateIcon('blocked', 'X', '#EA4335');
      // Redirect already-open tab to block page
      const redirectUrl = chrome.runtime.getURL(
        `blocked/blocked.html?group=${encodeURIComponent(group.name)}&groupId=${encodeURIComponent(group.id)}&reason=${encodeURIComponent(decision.reason)}&allowedMinutes=${decision.allowedMinutes || ''}&url=${encodeURIComponent(url)}`
      );
      try {
        await chrome.tabs.update(tab.id, { url: redirectUrl });
      } catch (e) {
        // Tab may have closed between query and update
      }
      return;
    }

    if (decision.reason === 'paused') {
      // Show paused state
      const pauseRemaining = Math.ceil((decision.pausedUntil - Date.now()) / 1000);
      await stopTracking();
      await updateIcon('paused', formatBadgeTime(pauseRemaining), '#9E9E9E');
      return;
    }

    if (decision.reason === 'allowed') {
      if (!bestDecision || decision.remainingSeconds < bestDecision.remainingSeconds) {
        mostRestrictive = group;
        bestDecision = decision;
      }
    }
  }

  if (!mostRestrictive || !bestDecision) {
    await stopTracking();
    await updateIcon('default');
    return;
  }

  // Start or continue tracking
  const groupId = mostRestrictive.id;
  const blockId = bestDecision.activeBlock.id;

  if (trackingState && trackingState.groupId === groupId && trackingState.blockId === blockId) {
    // Already tracking this group/block — update tab reference
    trackingState.tabId = tab.id;
    return;
  }

  // Different group/block — stop old, start new
  await stopTracking();
  await startTracking(groupId, blockId, bestDecision.activeBlock.allowedMinutes, tab.id);
}

async function startTracking(groupId, blockId, allowedMinutes, tabId) {
  const dateStr = todayDateStr();
  const entry = await getTrackingEntry(groupId, dateStr, blockId);

  trackingState = {
    groupId,
    blockId,
    usedSeconds: entry.usedSeconds,
    allowedSeconds: allowedMinutes * 60,
    tabId,
    intervalId: null,
  };

  tickCounter = 0;

  // Start the tick interval
  trackingState.intervalId = setInterval(() => tick(), 1000);

  // Update icon immediately
  const remaining = trackingState.allowedSeconds - trackingState.usedSeconds;
  const state = remaining <= 60 ? 'urgent' : 'timer';
  const badgeBg = remaining <= 60 ? '#F4B400' : '#34A853';
  await updateIcon(state, formatBadgeTime(remaining), badgeBg);
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
}

async function persistTracking() {
  if (!trackingState) return;
  const dateStr = todayDateStr();
  await setTrackingEntry(trackingState.groupId, dateStr, trackingState.blockId, {
    usedSeconds: trackingState.usedSeconds,
  });
}

async function tick() {
  if (!trackingState) return;

  trackingState.usedSeconds++;
  tickCounter++;

  const remaining = trackingState.allowedSeconds - trackingState.usedSeconds;

  // Persist every 10 ticks
  if (tickCounter % 10 === 0) {
    await persistTracking();
  }

  if (remaining <= 0) {
    // Budget exhausted — capture state before stopping
    await persistTracking();
    const tabId = trackingState.tabId;
    const groupId = trackingState.groupId;
    const allowedMinutes = Math.floor(trackingState.allowedSeconds / 60);

    await stopTracking();
    await rebuildAllRules();

    // Redirect the active tab
    try {
      const tabInfo = await chrome.tabs.get(tabId);
      const tabUrl = tabInfo?.url || '';
      const group = (await getGroups()).find(g => g.id === groupId);
      const groupName = group ? group.name : 'Unknown';
      const redirectUrl = chrome.runtime.getURL(
        `blocked/blocked.html?group=${encodeURIComponent(groupName)}&groupId=${encodeURIComponent(groupId)}&reason=budget-exhausted&allowedMinutes=${allowedMinutes}&url=${encodeURIComponent(tabUrl)}`
      );
      await chrome.tabs.update(tabId, { url: redirectUrl });
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

// Resume tracking after service worker restart
export async function resumeTracking() {
  await evaluateCurrentTab();
}
