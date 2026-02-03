// dashboard/dashboard.js — Dashboard UI logic
import {
  getGroups, onStorageChanged, todayDateStr, getTrackingEntry,
} from '../shared/storage.js';
import {
  createGroup, deleteGroup, updateGroup,
  addSiteToGroup, removeSiteFromGroup,
  addTimeBlock, updateTimeBlock, removeTimeBlock,
  normalizeSitePattern,
} from '../shared/group-manager.js';

const DAY_LABELS = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
const ALL_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

let selectedGroupId = null;
let groups = [];
let editingBlockId = null;
let nameDebounceTimer = null;

// ── Initialization ──────────────────────────────────────────────────────

async function init() {
  groups = await getGroups();
  renderSidebar();

  if (groups.length > 0) {
    selectGroup(groups[0].id);
  } else {
    showEmptyState();
  }

  setupEventListeners();

  // Listen for storage changes from other contexts
  onStorageChanged((changes) => {
    if (changes.groups) {
      groups = changes.groups.newValue || [];
      renderSidebar();
      if (selectedGroupId) {
        const group = groups.find(g => g.id === selectedGroupId);
        if (group) {
          renderGroupDetail(group);
        } else {
          selectedGroupId = null;
          if (groups.length > 0) {
            selectGroup(groups[0].id);
          } else {
            showEmptyState();
          }
        }
      }
    }
  });
}

function setupEventListeners() {
  // Add group buttons
  document.getElementById('addGroupBtn').addEventListener('click', handleAddGroup);
  document.getElementById('emptyAddGroupBtn').addEventListener('click', handleAddGroup);

  // Group name input (debounced auto-save)
  document.getElementById('groupNameInput').addEventListener('input', (e) => {
    clearTimeout(nameDebounceTimer);
    nameDebounceTimer = setTimeout(() => {
      if (selectedGroupId) {
        updateGroup(selectedGroupId, { name: e.target.value });
        showSaved();
      }
    }, 300);
  });

  // Delete group
  document.getElementById('deleteGroupBtn').addEventListener('click', () => {
    const group = groups.find(g => g.id === selectedGroupId);
    if (group) {
      document.getElementById('deleteGroupName').textContent = group.name;
      document.getElementById('deleteModal').style.display = 'flex';
    }
  });

  document.getElementById('confirmDeleteBtn').addEventListener('click', async () => {
    if (selectedGroupId) {
      await deleteGroup(selectedGroupId);
      document.getElementById('deleteModal').style.display = 'none';
      groups = await getGroups();
      renderSidebar();
      if (groups.length > 0) {
        selectGroup(groups[0].id);
      } else {
        selectedGroupId = null;
        showEmptyState();
      }
    }
  });

  document.getElementById('cancelDeleteBtn').addEventListener('click', () => {
    document.getElementById('deleteModal').style.display = 'none';
  });

  // Add site
  document.getElementById('addSiteBtn').addEventListener('click', handleAddSite);
  document.getElementById('siteInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleAddSite();
  });

  // Time block form
  document.getElementById('addTimeBlockBtn').addEventListener('click', () => {
    editingBlockId = null;
    resetTimeBlockForm();
    document.getElementById('timeBlockForm').style.display = 'block';
    document.getElementById('addTimeBlockBtn').style.display = 'none';
  });

  document.getElementById('cancelTimeBlockBtn').addEventListener('click', () => {
    document.getElementById('timeBlockForm').style.display = 'none';
    document.getElementById('addTimeBlockBtn').style.display = '';
    editingBlockId = null;
  });

  document.getElementById('saveTimeBlockBtn').addEventListener('click', handleSaveTimeBlock);

  document.getElementById('allDayCheck').addEventListener('change', (e) => {
    document.getElementById('timeInputRow').style.opacity = e.target.checked ? '0.4' : '1';
    document.getElementById('startTimeInput').disabled = e.target.checked;
    document.getElementById('endTimeInput').disabled = e.target.checked;
  });

  document.getElementById('selectAllDays').addEventListener('click', () => {
    document.querySelectorAll('#dayCheckboxes input').forEach(cb => cb.checked = true);
  });

  document.getElementById('deselectAllDays').addEventListener('click', () => {
    document.querySelectorAll('#dayCheckboxes input').forEach(cb => cb.checked = false);
  });
}

// ── Sidebar ─────────────────────────────────────────────────────────────

function renderSidebar() {
  const list = document.getElementById('groupList');
  list.innerHTML = '';

  groups.forEach(group => {
    const item = document.createElement('div');
    item.className = `group-item${group.id === selectedGroupId ? ' active' : ''}`;
    item.dataset.id = group.id;

    item.innerHTML = `
      <span class="group-item-name">${escapeHtml(group.name)}</span>
      <span class="group-item-badge">${group.sites.length}</span>
    `;

    item.addEventListener('click', () => selectGroup(group.id));
    list.appendChild(item);
  });
}

function selectGroup(groupId) {
  selectedGroupId = groupId;
  const group = groups.find(g => g.id === groupId);
  if (!group) return;

  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('groupDetail').style.display = 'flex';

  renderSidebar();
  renderGroupDetail(group);
}

function showEmptyState() {
  document.getElementById('emptyState').style.display = 'block';
  document.getElementById('groupDetail').style.display = 'none';
}

// ── Group Detail Rendering ──────────────────────────────────────────────

async function renderGroupDetail(group) {
  // Header
  document.getElementById('groupNameInput').value = group.name;

  // Sites
  renderSiteChips(group);

  // Time blocks
  renderTimeBlocks(group);

  // Hide the time block form
  document.getElementById('timeBlockForm').style.display = 'none';
  document.getElementById('addTimeBlockBtn').style.display = '';
  editingBlockId = null;

  // Usage
  await renderUsage(group);
}

function renderSiteChips(group) {
  const container = document.getElementById('siteChips');
  container.innerHTML = '';

  group.sites.forEach(site => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = `
      ${escapeHtml(site.pattern)}
      <button class="chip-remove" data-site-id="${site.id}" title="Remove">&times;</button>
    `;
    chip.querySelector('.chip-remove').addEventListener('click', async () => {
      await removeSiteFromGroup(group.id, site.id);
      groups = await getGroups();
      renderSidebar();
      renderGroupDetail(groups.find(g => g.id === group.id));
      showSaved();
    });
    container.appendChild(chip);
  });

  if (group.sites.length === 0) {
    container.innerHTML = '<span class="usage-empty">No sites added yet.</span>';
  }
}

function renderTimeBlocks(group) {
  const container = document.getElementById('timeBlocksList');
  container.innerHTML = '';

  group.allowedTimeBlocks.forEach(block => {
    const card = document.createElement('div');
    card.className = 'time-block-card';

    const daysStr = block.days.map(d => DAY_LABELS[d] || d).join(', ') || 'No days';
    const timeStr = block.allDay ? 'All Day' : `${formatTime12h(block.startTime)} – ${formatTime12h(block.endTime)}`;

    card.innerHTML = `
      <div class="time-block-info">
        <div class="time-block-days">${escapeHtml(daysStr)}</div>
        <div class="time-block-time">${escapeHtml(timeStr)}</div>
        <div class="time-block-budget">${block.allowedMinutes} minute${block.allowedMinutes !== 1 ? 's' : ''} allowed</div>
      </div>
      <div class="time-block-actions">
        <button class="btn btn-link btn-xs edit-block-btn">Edit</button>
        <button class="btn btn-link btn-xs remove-block-btn" style="color:var(--color-danger)">Remove</button>
      </div>
    `;

    card.querySelector('.edit-block-btn').addEventListener('click', () => {
      editTimeBlock(block);
    });

    card.querySelector('.remove-block-btn').addEventListener('click', async () => {
      await removeTimeBlock(group.id, block.id);
      groups = await getGroups();
      renderGroupDetail(groups.find(g => g.id === group.id));
      showSaved();
    });

    container.appendChild(card);
  });
}

async function renderUsage(group) {
  const container = document.getElementById('usageSection');
  container.innerHTML = '';
  const dateStr = todayDateStr();
  const todayDay = DAY_NAMES[new Date().getDay()];

  if (group.allowedTimeBlocks.length === 0) {
    container.innerHTML = '<p class="usage-empty">No time windows configured.</p>';
    return;
  }

  let hasBlocks = false;

  for (const block of group.allowedTimeBlocks) {
    if (!block.days.includes(todayDay)) continue;

    hasBlocks = true;
    const tracking = await getTrackingEntry(group.id, dateStr, block.id);
    const usedMinutes = Math.round(tracking.usedSeconds / 60 * 10) / 10;
    const pct = Math.min(100, (tracking.usedSeconds / (block.allowedMinutes * 60)) * 100);

    const wrapper = document.createElement('div');
    wrapper.className = 'usage-bar-wrapper';

    const timeStr = block.allDay ? 'All Day' : `${formatTime12h(block.startTime)} – ${formatTime12h(block.endTime)}`;
    const fillClass = pct >= 100 ? 'danger' : pct >= 75 ? 'warning' : '';

    wrapper.innerHTML = `
      <div class="usage-label">
        <span>${escapeHtml(timeStr)}</span>
        <span>${usedMinutes} of ${block.allowedMinutes} min used</span>
      </div>
      <div class="usage-bar">
        <div class="usage-bar-fill ${fillClass}" style="width:${pct}%"></div>
      </div>
    `;

    container.appendChild(wrapper);
  }

  if (!hasBlocks) {
    container.innerHTML = '<p class="usage-empty">No time windows active today.</p>';
  }
}

// ── Handlers ────────────────────────────────────────────────────────────

async function handleAddGroup() {
  const group = await createGroup('New Group');
  groups = await getGroups();
  renderSidebar();
  selectGroup(group.id);
  // Focus the name input for immediate editing
  document.getElementById('groupNameInput').focus();
  document.getElementById('groupNameInput').select();
}

async function handleAddSite() {
  const input = document.getElementById('siteInput');
  const errorEl = document.getElementById('siteError');
  const raw = input.value.trim();

  if (!raw) return;

  const result = await addSiteToGroup(selectedGroupId, raw);
  if (!result.success) {
    errorEl.textContent = result.error;
    return;
  }

  errorEl.textContent = '';
  input.value = '';
  groups = await getGroups();
  renderSidebar();
  renderGroupDetail(groups.find(g => g.id === selectedGroupId));
  showSaved();
}

function editTimeBlock(block) {
  editingBlockId = block.id;
  const form = document.getElementById('timeBlockForm');

  // Set days
  document.querySelectorAll('#dayCheckboxes input').forEach(cb => {
    cb.checked = block.days.includes(cb.value);
  });

  // Set all day
  document.getElementById('allDayCheck').checked = block.allDay;
  document.getElementById('timeInputRow').style.opacity = block.allDay ? '0.4' : '1';
  document.getElementById('startTimeInput').disabled = block.allDay;
  document.getElementById('endTimeInput').disabled = block.allDay;

  // Set times
  document.getElementById('startTimeInput').value = block.startTime;
  document.getElementById('endTimeInput').value = block.endTime;

  // Set minutes
  document.getElementById('allowedMinutesInput').value = block.allowedMinutes;

  form.style.display = 'block';
  document.getElementById('addTimeBlockBtn').style.display = 'none';
}

function resetTimeBlockForm() {
  document.querySelectorAll('#dayCheckboxes input').forEach(cb => cb.checked = false);
  document.getElementById('allDayCheck').checked = false;
  document.getElementById('timeInputRow').style.opacity = '1';
  document.getElementById('startTimeInput').disabled = false;
  document.getElementById('endTimeInput').disabled = false;
  document.getElementById('startTimeInput').value = '09:00';
  document.getElementById('endTimeInput').value = '17:00';
  document.getElementById('allowedMinutesInput').value = '15';
}

async function handleSaveTimeBlock() {
  const days = [];
  document.querySelectorAll('#dayCheckboxes input:checked').forEach(cb => {
    days.push(cb.value);
  });

  if (days.length === 0) return;

  const allDay = document.getElementById('allDayCheck').checked;
  const startTime = document.getElementById('startTimeInput').value;
  const endTime = document.getElementById('endTimeInput').value;
  const allowedMinutes = parseInt(document.getElementById('allowedMinutesInput').value) || 15;

  const config = { days, allDay, startTime, endTime, allowedMinutes };

  if (editingBlockId) {
    await updateTimeBlock(selectedGroupId, editingBlockId, config);
  } else {
    await addTimeBlock(selectedGroupId, config);
  }

  editingBlockId = null;
  document.getElementById('timeBlockForm').style.display = 'none';
  document.getElementById('addTimeBlockBtn').style.display = '';

  showSaved();
}

// ── Utilities ───────────────────────────────────────────────────────────

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatTime12h(time24) {
  const [h, m] = time24.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${ampm}`;
}

let savedTimeout = null;
function showSaved() {
  const el = document.getElementById('savedIndicator');
  el.classList.add('visible');
  clearTimeout(savedTimeout);
  savedTimeout = setTimeout(() => el.classList.remove('visible'), 1500);
}

// ── Start ───────────────────────────────────────────────────────────────
init();
