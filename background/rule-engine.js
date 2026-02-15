// background/rule-engine.js — Translates group state into declarativeNetRequest rules
import {
  getGroups, getNextRuleId, saveNextRuleId,
  getRuleIdMap, saveRuleIdMap, getPause,
  getTrackingEntry, todayDateStr, getAllActivePauses,
} from '../shared/storage.js';

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export function sitePatternToUrlFilter(pattern) {
  // "facebook.com" → "||facebook.com/"
  // "reddit.com/r/funny" → "||reddit.com/r/funny"
  if (pattern.includes('/')) {
    return `||${pattern}`;
  }
  return `||${pattern}/`;
}

export function sitePatternToRegexFilter(pattern) {
  // "facebook.com" → "^https?://([a-zA-Z0-9-]+\\.)*facebook\\.com/"
  // "reddit.com/r/funny" → "^https?://([a-zA-Z0-9-]+\\.)*reddit\\.com/r/funny"
  const parts = pattern.split('/');
  const domain = parts[0];
  const path = parts.length > 1 ? '/' + parts.slice(1).join('/') : '/';

  // Escape regex-special chars in domain (dots become \.)
  const escapedDomain = domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Escape regex-special chars in path
  const escapedPath = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  return `^https?://([a-zA-Z0-9-]+\\.)*${escapedDomain}${escapedPath}`;
}

export function getCurrentDayStr() {
  return DAY_NAMES[new Date().getDay()];
}

export function getCurrentTimeMinutes() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function timeStrToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

export function isInsideTimeBlock(block) {
  const currentDay = getCurrentDayStr();
  if (!block.days.includes(currentDay)) return false;

  const now = getCurrentTimeMinutes();
  const start = timeStrToMinutes(block.startTime);
  const end = timeStrToMinutes(block.endTime);
  return now >= start && now <= end;
}

export async function getActiveBlockForGroup(group) {
  const today = getCurrentDayStr();
  const nowMinutes = getCurrentTimeMinutes();

  for (const block of group.allowedTimeBlocks) {
    if (!block.days.includes(today)) continue;
    const start = timeStrToMinutes(block.startTime);
    const end = timeStrToMinutes(block.endTime);
    if (nowMinutes >= start && nowMinutes <= end) {
      return block;
    }
  }
  return null;
}

export function getNextTimeWindowBoundary(groups) {
  const now = new Date();
  const today = getCurrentDayStr();
  const nowMinutes = getCurrentTimeMinutes();

  let soonestMs = null;

  for (const group of groups) {
    for (const block of group.allowedTimeBlocks) {
      if (!block.days.includes(today)) continue;

      const start = timeStrToMinutes(block.startTime);
      const end = timeStrToMinutes(block.endTime);

      // Candidate boundaries that are still in the future today
      const boundaries = [];

      if (start > nowMinutes) {
        boundaries.push(start);
      }

      // end+1: isInsideTimeBlock uses <= for end, so at end+1 the window closes
      const endBoundary = end + 1;
      if (endBoundary > nowMinutes && endBoundary <= 24 * 60) {
        boundaries.push(endBoundary);
      }

      for (const boundaryMinutes of boundaries) {
        const boundaryDate = new Date(now);
        boundaryDate.setHours(Math.floor(boundaryMinutes / 60), boundaryMinutes % 60, 0, 0);
        const boundaryMs = boundaryDate.getTime();

        if (boundaryMs > now.getTime()) {
          if (soonestMs === null || boundaryMs < soonestMs) {
            soonestMs = boundaryMs;
          }
        }
      }
    }
  }

  return soonestMs;
}

export async function shouldGroupBlockNow(group) {
  // Check pause
  const pause = await getPause(group.id);
  if (pause && pause.pausedUntil > Date.now()) {
    return { block: false, reason: 'paused', pausedUntil: pause.pausedUntil };
  }

  // No time blocks → always block
  if (group.allowedTimeBlocks.length === 0) {
    return { block: true, reason: 'always-blocked' };
  }

  // Check if inside any active time block
  const activeBlock = await getActiveBlockForGroup(group);
  if (!activeBlock) {
    return { block: true, reason: 'outside-schedule' };
  }

  // Inside active block — check budget
  const dateStr = todayDateStr();
  const tracking = await getTrackingEntry(group.id, dateStr, activeBlock.id);
  const usedMinutes = tracking.usedSeconds / 60;

  if (usedMinutes >= activeBlock.allowedMinutes) {
    return { block: true, reason: 'budget-exhausted', allowedMinutes: activeBlock.allowedMinutes };
  }

  return {
    block: false,
    reason: 'allowed',
    activeBlock,
    remainingSeconds: (activeBlock.allowedMinutes * 60) - tracking.usedSeconds,
  };
}

export function doesUrlMatchSite(hostname, pathname, site) {
  const pattern = site.pattern;
  const patternParts = pattern.split('/');
  const patternDomain = patternParts[0];
  const patternPath = patternParts.length > 1 ? '/' + patternParts.slice(1).join('/') : null;

  // Subdomain-inclusive matching: hostname must equal or end with .pattern
  const hostLower = hostname.toLowerCase();
  const domainLower = patternDomain.toLowerCase();

  if (hostLower !== domainLower && !hostLower.endsWith('.' + domainLower)) {
    return false;
  }

  // Path prefix matching if pattern has a path
  if (patternPath) {
    const pathLower = pathname.toLowerCase();
    if (!pathLower.startsWith(patternPath.toLowerCase())) {
      return false;
    }
  }

  return true;
}

export function findMatchingGroups(url, groups) {
  let hostname, pathname;
  try {
    const parsed = new URL(url);
    hostname = parsed.hostname;
    pathname = parsed.pathname;
  } catch {
    return [];
  }

  const matches = [];
  for (const group of groups) {
    for (const site of group.sites) {
      if (doesUrlMatchSite(hostname, pathname, site)) {
        matches.push(group);
        break;
      }
    }
  }
  return matches;
}

export async function rebuildAllRules() {
  const groups = await getGroups();
  const addRules = [];
  let nextId = await getNextRuleId();
  const newRuleIdMap = {};

  for (const group of groups) {
    const decision = await shouldGroupBlockNow(group);
    if (!decision.block) continue;

    // Generate a redirect rule for each site in the group
    for (const site of group.sites) {
      const regexFilter = sitePatternToRegexFilter(site.pattern);
      const baseRedirectUrl = chrome.runtime.getURL(
        `blocked/blocked.html?group=${encodeURIComponent(group.name)}&groupId=${encodeURIComponent(group.id)}&reason=${encodeURIComponent(decision.reason)}&allowedMinutes=${decision.allowedMinutes || ''}&url=`
      );

      addRules.push({
        id: nextId,
        priority: 1,
        action: {
          type: 'redirect',
          redirect: { regexSubstitution: baseRedirectUrl + '\\0' },
        },
        condition: {
          regexFilter,
          resourceTypes: ['main_frame'],
        },
      });

      newRuleIdMap[`${group.id}::${site.id}`] = nextId;
      nextId++;
    }
  }

  // Get existing dynamic rules to remove
  const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existingRules.map(r => r.id);

  // Atomically update rules
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
    addRules,
  });

  await saveRuleIdMap(newRuleIdMap);
  await saveNextRuleId(nextId);

  return { addedCount: addRules.length, removedCount: removeRuleIds.length };
}
