// dashboard/dashboard.js — Dashboard UI logic
import {
  getGroups, onStorageChanged, todayDateStr, getAllTrackingForDate,
  DEFAULT_DAILY_PAUSE_LIMIT, sanitizeDailyPauseLimit,
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

const WINDOW_PRESETS = [
  { key: 'work',  label: 'Work hours',  range: '9–17',  start: '09:00', end: '17:00' },
  { key: 'morn',  label: 'Morning',     range: '6–12',  start: '06:00', end: '12:00' },
  { key: 'lunch', label: 'Lunch',       range: '12–13', start: '12:00', end: '13:00' },
  { key: 'eve',   label: 'Evening',     range: '18–22', start: '18:00', end: '22:00' },
  { key: 'after', label: 'After-hours', range: '17–24', start: '17:00', end: '23:59' },
];
const BUDGET_PRESETS = [15, 25, 45, 60, 120];
const DAY_PRESETS = {
  weekdays: ['mon','tue','wed','thu','fri'],
  weekends: ['sat','sun'],
  everyday: ['mon','tue','wed','thu','fri','sat','sun'],
};

let selectedGroupId = null;
let groups = [];
let editingBlockId = null;
let nameDebounceTimer = null;
let formState = null;

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

  document.getElementById('pauseLimitInput').addEventListener('change', async (e) => {
    if (!selectedGroupId) return;
    const nextValue = sanitizeDailyPauseLimit(e.target.value);
    e.target.value = nextValue;
    await updateGroup(selectedGroupId, { pauseLimitPerDay: nextValue });
    showSaved();
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
  buildStaticTimeBlockControls();

  document.getElementById('addTimeBlockBtn').addEventListener('click', () => {
    openTimeBlockForm(null);
  });

  document.getElementById('cancelTimeBlockBtn').addEventListener('click', closeTimeBlockForm);

  document.getElementById('saveTimeBlockBtn').addEventListener('click', handleSaveTimeBlock);

  document.getElementById('allDayCheck').addEventListener('change', (e) => {
    if (!formState) return;
    formState.allDay = e.target.checked;
    renderEditor();
  });

  document.getElementById('startTimeInput').addEventListener('input', (e) => {
    if (!formState) return;
    formState.startTime = e.target.value || '00:00';
    renderEditor();
  });

  document.getElementById('endTimeInput').addEventListener('input', (e) => {
    if (!formState) return;
    formState.endTime = e.target.value || '00:00';
    renderEditor();
  });

  document.getElementById('dayPills').addEventListener('click', (e) => {
    const btn = e.target.closest('.day-pill');
    if (!btn || !formState) return;
    const day = btn.dataset.day;
    if (formState.days.has(day)) formState.days.delete(day);
    else formState.days.add(day);
    renderEditor();
  });

  document.querySelectorAll('[data-day-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!formState) return;
      formState.days = new Set(DAY_PRESETS[btn.dataset.dayPreset]);
      renderEditor();
    });
  });

  document.getElementById('windowPresets').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-preset-key]');
    if (!btn || !formState) return;
    const preset = WINDOW_PRESETS.find(p => p.key === btn.dataset.presetKey);
    if (!preset) return;
    formState.startTime = preset.start;
    formState.endTime = preset.end;
    formState.allDay = false;
    renderEditor();
  });

  document.getElementById('budgetChips').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-budget]');
    if (!btn || !formState) return;
    formState.allowedMinutes = parseInt(btn.dataset.budget, 10);
    renderEditor();
  });

  const budgetInput = document.getElementById('budgetNumber');
  budgetInput.addEventListener('input', () => {
    if (!formState) return;
    const digits = budgetInput.value.replace(/\D/g, '').slice(0, 4);
    if (digits !== budgetInput.value) budgetInput.value = digits;
    const n = parseInt(digits, 10);
    if (Number.isFinite(n) && n > 0) {
      formState.allowedMinutes = Math.min(n, 1440);
      renderEditor();
    }
  });
  budgetInput.addEventListener('blur', () => {
    if (!formState) return;
    const n = parseInt(budgetInput.value, 10);
    const clamped = Number.isFinite(n) && n > 0 ? Math.min(n, 1440) : formState.allowedMinutes;
    formState.allowedMinutes = clamped;
    budgetInput.value = String(clamped);
    renderEditor();
  });
  budgetInput.addEventListener('focus', () => budgetInput.select());
  budgetInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); budgetInput.blur(); }
  });
}

function buildStaticTimeBlockControls() {
  const dayPills = document.getElementById('dayPills');
  dayPills.innerHTML = ALL_DAYS.map(d =>
    `<button type="button" class="day-pill" data-day="${d}">${DAY_LABELS[d]}</button>`
  ).join('');

  const windowPresets = document.getElementById('windowPresets');
  windowPresets.innerHTML = WINDOW_PRESETS.map(p =>
    `<button type="button" class="chip preset-chip" data-preset-key="${p.key}">
       <span class="preset-label">${p.label}</span>
       <span class="preset-range">${p.range}</span>
     </button>`
  ).join('');

  const budgetChips = document.getElementById('budgetChips');
  budgetChips.innerHTML = BUDGET_PRESETS.map(m =>
    `<button type="button" class="chip budget-chip" data-budget="${m}">${m}</button>`
  ).join('');
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
  document.getElementById('pauseLimitInput').value = sanitizeDailyPauseLimit(
    group.pauseLimitPerDay ?? DEFAULT_DAILY_PAUSE_LIMIT,
  );

  // Sites
  renderSiteChips(group);

  // Time blocks
  renderTimeBlocks(group);

  // Hide the time block form
  document.getElementById('timeBlockForm').hidden = true;
  document.getElementById('addTimeBlockBtn').style.display = '';
  editingBlockId = null;
  formState = null;

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
      <button class="chip-remove" title="Remove">&times;</button>
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

  group.allowedTimeBlocks.forEach((block, index) => {
    const card = document.createElement('div');
    card.className = 'time-block-card';
    if (editingBlockId === block.id) card.classList.add('editing');

    const daysStr = formatDayRange(block.days);
    const timeStr = block.allDay
      ? 'All day'
      : `${block.startTime} → ${block.endTime}`;
    const budgetStr = block.allDay ? '' : ` · ${block.allowedMinutes}m allowed`;

    card.innerHTML = `
      <div class="time-block-info">
        <div class="time-block-days">${escapeHtml(daysStr)}</div>
        <div class="time-block-time">${escapeHtml(timeStr + budgetStr)}</div>
      </div>
      <div class="time-block-actions">
        <button class="time-block-btn edit-block-btn">Edit</button>
        <button class="time-block-btn remove-block-btn">Remove</button>
      </div>
    `;

    card.querySelector('.edit-block-btn').addEventListener('click', () => {
      openTimeBlockForm(block, index);
    });

    card.querySelector('.remove-block-btn').addEventListener('click', async () => {
      await removeTimeBlock(group.id, block.id);
      if (editingBlockId === block.id) {
        editingBlockId = null;
        closeTimeBlockForm();
      }
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

  const todaysBlocks = group.allowedTimeBlocks.filter(block => block.days.includes(todayDay));
  if (todaysBlocks.length === 0) {
    container.innerHTML = '<p class="usage-empty">No time windows active today.</p>';
    return;
  }

  const trackingMap = await getAllTrackingForDate(dateStr);

  for (const block of todaysBlocks) {

    const trackingKey = `tracking::${group.id}::${dateStr}::${block.id}`;
    const tracking = trackingMap[trackingKey] || { usedSeconds: 0 };
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

function openTimeBlockForm(block, index) {
  if (block) {
    editingBlockId = block.id;
    formState = {
      days: new Set(block.days),
      startTime: block.startTime || '09:00',
      endTime: block.endTime || '12:00',
      allDay: !!block.allDay,
      allowedMinutes: block.allowedMinutes || 25,
      editingIndex: typeof index === 'number' ? index : null,
    };
  } else {
    editingBlockId = null;
    formState = {
      days: new Set(DAY_PRESETS.weekdays),
      startTime: '09:00',
      endTime: '12:00',
      allDay: false,
      allowedMinutes: 25,
      editingIndex: null,
    };
  }

  document.getElementById('timeBlockForm').hidden = false;
  document.getElementById('addTimeBlockBtn').style.display = 'none';

  // Re-render the list so the active card gets highlighted
  const group = groups.find(g => g.id === selectedGroupId);
  if (group) renderTimeBlocks(group);

  renderEditor();
}

function closeTimeBlockForm() {
  editingBlockId = null;
  formState = null;
  document.getElementById('timeBlockForm').hidden = true;
  document.getElementById('addTimeBlockBtn').style.display = '';
  const group = groups.find(g => g.id === selectedGroupId);
  if (group) renderTimeBlocks(group);
}

function renderEditor() {
  if (!formState) return;

  // Day pills
  document.querySelectorAll('#dayPills .day-pill').forEach(pill => {
    pill.classList.toggle('active', formState.days.has(pill.dataset.day));
  });

  // Day quick-selects
  document.querySelectorAll('[data-day-preset]').forEach(btn => {
    const preset = DAY_PRESETS[btn.dataset.dayPreset];
    btn.classList.toggle('active', daySetsEqual(formState.days, preset));
  });

  // All-day switch + time inputs
  const allDay = formState.allDay;
  const startInput = document.getElementById('startTimeInput');
  const endInput = document.getElementById('endTimeInput');
  document.getElementById('allDayCheck').checked = allDay;
  startInput.disabled = allDay;
  endInput.disabled = allDay;
  if (startInput.value !== formState.startTime) startInput.value = formState.startTime;
  if (endInput.value !== formState.endTime) endInput.value = formState.endTime;
  document.querySelector('.window-inputs').classList.toggle('disabled', allDay);

  // Duration
  document.getElementById('durationDisplay').textContent =
    `= ${formatDuration(formState.startTime, formState.endTime, formState.allDay)}`;

  // Window preset highlighting
  document.querySelectorAll('#windowPresets [data-preset-key]').forEach(chip => {
    const preset = WINDOW_PRESETS.find(p => p.key === chip.dataset.presetKey);
    const active = !allDay && preset.start === formState.startTime && preset.end === formState.endTime;
    chip.classList.toggle('active', active);
  });

  // Budget readout + chips
  const budgetInput = document.getElementById('budgetNumber');
  if (document.activeElement !== budgetInput) {
    budgetInput.value = String(formState.allowedMinutes);
  }
  document.querySelectorAll('#budgetChips [data-budget]').forEach(chip => {
    chip.classList.toggle('active', parseInt(chip.dataset.budget, 10) === formState.allowedMinutes);
  });

  // Header status: "Editing window X of N" or "New window · X of N+1"
  const group = groups.find(g => g.id === selectedGroupId);
  const total = group ? group.allowedTimeBlocks.length : 0;
  const statusEl = document.getElementById('windowEditorStatus');
  if (editingBlockId && formState.editingIndex !== null) {
    statusEl.textContent = `Editing window ${formState.editingIndex + 1} of ${total}`;
  } else {
    statusEl.textContent = total === 0 ? 'New window' : `New window · ${total + 1} of ${total + 1}`;
  }

  // Summary + Save enablement
  const summaryEl = document.getElementById('formSummary');
  const saveBtn = document.getElementById('saveTimeBlockBtn');
  const err = validateFormState(formState);
  if (err) {
    summaryEl.textContent = err;
    summaryEl.classList.add('error');
    saveBtn.disabled = true;
  } else {
    summaryEl.textContent = formatSummary(formState);
    summaryEl.classList.remove('error');
    saveBtn.disabled = false;
  }
}

function validateFormState(state) {
  if (state.days.size === 0) return 'Select at least one day';
  if (!state.allDay) {
    const s = timeToMinutes(state.startTime);
    const e = timeToMinutes(state.endTime);
    if (e <= s) return 'End must be after start';
  }
  return null;
}

async function handleSaveTimeBlock() {
  if (!formState) return;
  const err = validateFormState(formState);
  if (err) return;

  const orderedDays = ALL_DAYS.filter(d => formState.days.has(d));
  const config = formState.allDay
    ? { days: orderedDays, allDay: true, startTime: '00:00', endTime: '23:59', allowedMinutes: formState.allowedMinutes }
    : { days: orderedDays, allDay: false, startTime: formState.startTime, endTime: formState.endTime, allowedMinutes: formState.allowedMinutes };

  if (editingBlockId) {
    await updateTimeBlock(selectedGroupId, editingBlockId, config);
  } else {
    await addTimeBlock(selectedGroupId, config);
  }

  editingBlockId = null;
  formState = null;
  document.getElementById('timeBlockForm').hidden = true;
  document.getElementById('addTimeBlockBtn').style.display = '';

  groups = await getGroups();
  renderGroupDetail(groups.find(g => g.id === selectedGroupId));
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

function formatTime12hCompact(time24) {
  const [h, m] = time24.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 || 12;
  return m === 0 ? `${hour12} ${ampm}` : `${hour12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function timeToMinutes(time24) {
  const [h, m] = time24.split(':').map(Number);
  return h * 60 + m;
}

function formatDuration(startTime, endTime, allDay) {
  if (allDay) return '24 hours';
  const diff = timeToMinutes(endTime) - timeToMinutes(startTime);
  if (diff <= 0) return '—';
  const hours = Math.floor(diff / 60);
  const mins = diff % 60;
  if (hours === 0) return `${mins} minute${mins === 1 ? '' : 's'}`;
  if (mins === 0) return `${hours} hour${hours === 1 ? '' : 's'}`;
  return `${hours}h ${mins}m`;
}

function formatDayRange(days) {
  if (!days || days.length === 0) return 'No days';
  if (days.length === 7) return 'Every day';
  const set = new Set(days);
  if (daySetsEqual(set, DAY_PRESETS.weekdays)) return 'Mon – Fri';
  if (daySetsEqual(set, DAY_PRESETS.weekends)) return 'Sat – Sun';
  const indices = days.map(d => ALL_DAYS.indexOf(d)).sort((a, b) => a - b);
  const consecutive = indices.length > 2 &&
    indices.every((n, i) => i === 0 || n === indices[i - 1] + 1);
  if (consecutive) {
    return `${DAY_LABELS[ALL_DAYS[indices[0]]]} – ${DAY_LABELS[ALL_DAYS[indices[indices.length - 1]]]}`;
  }
  return indices.map(i => DAY_LABELS[ALL_DAYS[i]]).join(', ');
}

function formatSummary(state) {
  const count = state.days.size;
  let daysLabel;
  if (count === 7) daysLabel = 'Every day';
  else if (daySetsEqual(state.days, DAY_PRESETS.weekdays)) daysLabel = 'Weekdays';
  else if (daySetsEqual(state.days, DAY_PRESETS.weekends)) daysLabel = 'Weekends';
  else daysLabel = `${count} day${count === 1 ? '' : 's'}`;

  const windowLabel = state.allDay
    ? 'All day'
    : `${formatTime12hCompact(state.startTime)} – ${formatTime12hCompact(state.endTime)}`;

  return `${daysLabel} · ${windowLabel} · ${state.allowedMinutes} min budget`;
}

function daySetsEqual(setA, arrOrSetB) {
  const b = arrOrSetB instanceof Set ? arrOrSetB : new Set(arrOrSetB);
  if (setA.size !== b.size) return false;
  for (const v of setA) if (!b.has(v)) return false;
  return true;
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
