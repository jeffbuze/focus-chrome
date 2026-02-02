// shared/group-manager.js — Higher-level CRUD for site-blocking groups
import { getGroups, saveGroups, getGroupById } from './storage.js';

// ── Pattern Helpers ─────────────────────────────────────────────────────

export function normalizeSitePattern(raw) {
  let pattern = raw.trim().toLowerCase();
  // Strip protocol
  pattern = pattern.replace(/^https?:\/\//, '');
  // Strip www.
  pattern = pattern.replace(/^www\./, '');
  // Strip trailing slash (but keep paths)
  pattern = pattern.replace(/\/+$/, '');
  return pattern;
}

export function validateSitePattern(pattern) {
  if (!pattern || pattern.length === 0) {
    return { valid: false, error: 'Pattern cannot be empty.' };
  }
  // Must contain at least one dot (domain)
  if (!pattern.includes('.')) {
    return { valid: false, error: 'Enter a valid domain (e.g. facebook.com).' };
  }
  // No spaces
  if (/\s/.test(pattern)) {
    return { valid: false, error: 'Pattern cannot contain spaces.' };
  }
  // No protocol should remain
  if (/^https?:\/\//.test(pattern)) {
    return { valid: false, error: 'Do not include http:// or https://.' };
  }
  // Basic domain format check
  const domainPart = pattern.split('/')[0];
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domainPart)) {
    return { valid: false, error: 'Invalid domain format.' };
  }
  return { valid: true, error: null };
}

// ── Group CRUD ──────────────────────────────────────────────────────────

export async function createGroup(name) {
  const groups = await getGroups();
  const group = {
    id: crypto.randomUUID(),
    name: name || 'New Group',
    enabled: true,
    sites: [],
    allowedTimeBlocks: [],
  };
  groups.push(group);
  await saveGroups(groups);
  return group;
}

export async function deleteGroup(groupId) {
  let groups = await getGroups();
  groups = groups.filter(g => g.id !== groupId);
  await saveGroups(groups);
}

export async function updateGroup(groupId, updates) {
  const groups = await getGroups();
  const idx = groups.findIndex(g => g.id === groupId);
  if (idx === -1) return null;
  Object.assign(groups[idx], updates);
  await saveGroups(groups);
  return groups[idx];
}

export async function toggleGroup(groupId, enabled) {
  return updateGroup(groupId, { enabled });
}

// ── Site Management ─────────────────────────────────────────────────────

export async function addSiteToGroup(groupId, rawPattern) {
  const pattern = normalizeSitePattern(rawPattern);
  const validation = validateSitePattern(pattern);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  const groups = await getGroups();
  const group = groups.find(g => g.id === groupId);
  if (!group) return { success: false, error: 'Group not found.' };

  // Check for duplicates
  if (group.sites.some(s => s.pattern === pattern)) {
    return { success: false, error: 'Site already exists in this group.' };
  }

  const site = { id: crypto.randomUUID(), pattern };
  group.sites.push(site);
  await saveGroups(groups);
  return { success: true, site };
}

export async function removeSiteFromGroup(groupId, siteId) {
  const groups = await getGroups();
  const group = groups.find(g => g.id === groupId);
  if (!group) return;
  group.sites = group.sites.filter(s => s.id !== siteId);
  await saveGroups(groups);
}

// ── Time Block Management ───────────────────────────────────────────────

export async function addTimeBlock(groupId, blockConfig) {
  const groups = await getGroups();
  const group = groups.find(g => g.id === groupId);
  if (!group) return null;

  const block = {
    id: crypto.randomUUID(),
    days: blockConfig.days || [],
    startTime: blockConfig.allDay ? '00:00' : (blockConfig.startTime || '09:00'),
    endTime: blockConfig.allDay ? '23:59' : (blockConfig.endTime || '17:00'),
    allDay: blockConfig.allDay || false,
    allowedMinutes: blockConfig.allowedMinutes || 15,
  };

  group.allowedTimeBlocks.push(block);
  await saveGroups(groups);
  return block;
}

export async function updateTimeBlock(groupId, blockId, updates) {
  const groups = await getGroups();
  const group = groups.find(g => g.id === groupId);
  if (!group) return null;

  const idx = group.allowedTimeBlocks.findIndex(b => b.id === blockId);
  if (idx === -1) return null;

  if (updates.allDay) {
    updates.startTime = '00:00';
    updates.endTime = '23:59';
  }

  Object.assign(group.allowedTimeBlocks[idx], updates);
  await saveGroups(groups);
  return group.allowedTimeBlocks[idx];
}

export async function removeTimeBlock(groupId, blockId) {
  const groups = await getGroups();
  const group = groups.find(g => g.id === groupId);
  if (!group) return;
  group.allowedTimeBlocks = group.allowedTimeBlocks.filter(b => b.id !== blockId);
  await saveGroups(groups);
}
