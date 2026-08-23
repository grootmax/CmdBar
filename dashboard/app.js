/**
 * CmdBar Web Dashboard Frontend Application
 * Drag-and-Drop Editor, Real-Time Preview, Team Collaboration, Mobile Responsive, Offline Capable.
 */

// Application State
export const state = {
  config: {
    categories: [
      {
        name: "Projects",
        commands: [
          { name: "Build Current Project", command: "make build" },
          { name: "Start Task", command: "echo Starting task <task-id>", placeholder: "task-id" }
        ]
      },
      {
        name: "Infrastructure",
        commands: [
          { name: "Deploy Service", command: "deploy <service-name>", placeholder: "service-name" },
          { name: "Scale ECS Task", command: "aws ecs update-service --service {{service-name}} --desired-count {{count}}", placeholder: "service-name & count" }
        ]
      }
    ]
  },
  workspaces: [
    { id: "default", name: "Personal Workspace", active: true },
    { id: "team-alpha", name: "Team Alpha (DevOps)", active: false }
  ],
  offline: false,
  editingItem: null, // { catIndex, cmdIndex }
  dragSource: null, // { type: 'category' | 'shortcut', catIndex, cmdIndex }
  previewFilter: ""
};

// Storage Keys
const LOCAL_STORAGE_KEY = "cmdbar_dashboard_config_v1";

// Register Service Worker for PWA / Offline Support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => {
      console.warn('CmdBar Service Worker registration failed:', err);
    });
  });
}

// Helper: Canonicalize config structure
export function sanitizeConfig(config) {
  if (!config || typeof config !== 'object') {
    return { categories: [] };
  }
  if (!Array.isArray(config.categories)) {
    config.categories = [];
  }
  config.categories.forEach(cat => {
    if (!cat.commands && cat.shortcuts) {
      cat.commands = cat.shortcuts;
      delete cat.shortcuts;
    }
    if (!Array.isArray(cat.commands)) {
      cat.commands = [];
    }
  });
  return config;
}

// Helper: Perform 2-Way Structural Merge of Local and Remote Team Configs
export function mergeConfigurations(localConfig, remoteConfig) {
  const local = sanitizeConfig(JSON.parse(JSON.stringify(localConfig)));
  const remote = sanitizeConfig(JSON.parse(JSON.stringify(remoteConfig)));

  const mergedCategories = [...local.categories];

  remote.categories.forEach(remoteCat => {
    const existingCat = mergedCategories.find(c => c.name.toLowerCase() === remoteCat.name.toLowerCase());
    if (existingCat) {
      remoteCat.commands.forEach(remoteCmd => {
        const existingCmd = existingCat.commands.find(c => c.name.toLowerCase() === remoteCmd.name.toLowerCase());
        if (!existingCmd) {
          existingCat.commands.push(remoteCmd);
        }
      });
    } else {
      mergedCategories.push(remoteCat);
    }
  });

  return { ...local, categories: mergedCategories };
}

// Drag & Drop Helpers
export function moveCategory(categories, fromIndex, toIndex) {
  const result = [...categories];
  const [removed] = result.splice(fromIndex, 1);
  result.splice(toIndex, 0, removed);
  return result;
}

export function moveShortcut(categories, fromCatIndex, fromCmdIndex, toCatIndex, toCmdIndex) {
  const newCategories = JSON.parse(JSON.stringify(categories));
  const [movedShortcut] = newCategories[fromCatIndex].commands.splice(fromCmdIndex, 1);
  newCategories[toCatIndex].commands.splice(toCmdIndex, 0, movedShortcut);
  return newCategories;
}

// UI Initialization & Event Wiring
export function initDashboard() {
  loadConfigFromStorageOrAPI();
  setupOnlineStatusListeners();
  setupTheme();
  setupEventListeners();
  renderAll();
}

async function loadConfigFromStorageOrAPI() {
  // First attempt to fetch from API server
  try {
    const res = await fetch('/api/config');
    if (res.ok) {
      const data = await res.json();
      state.config = sanitizeConfig(data);
      saveToLocalStorage(state.config);
      setOnlineStatus(true);
      renderAll();
      return;
    }
  } catch (err) {
    console.warn("API unavailable, attempting offline cache loading...");
  }

  // Fallback to local storage cache if offline or API fail
  const cached = localStorage.getItem(LOCAL_STORAGE_KEY);
  if (cached) {
    try {
      state.config = sanitizeConfig(JSON.parse(cached));
    } catch (e) {}
  }
  setOnlineStatus(false);
  renderAll();
}

export async function syncConfigToServer() {
  saveToLocalStorage(state.config);
  setSaveStatus("Saving...");

  if (state.offline) {
    setSaveStatus("Saved locally (Offline)");
    return;
  }

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: JSON.stringify(state.config)
    });

    if (res.ok) {
      setSaveStatus("All changes saved");
    } else {
      setSaveStatus("Saved locally (Sync pending)");
    }
  } catch (err) {
    setSaveStatus("Saved locally (Offline)");
    setOnlineStatus(false);
  }
}

function saveToLocalStorage(config) {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(config));
}

function setOnlineStatus(online) {
  state.offline = !online;
  const badge = document.getElementById('statusBadge');
  const statusText = document.getElementById('statusText');
  if (!badge || !statusText) return;

  if (online) {
    badge.classList.remove('offline');
    statusText.textContent = "Connected (Online)";
  } else {
    badge.classList.add('offline');
    statusText.textContent = "Offline Mode";
  }
}

function setSaveStatus(msg) {
  const el = document.getElementById('saveStatusIndicator');
  if (el) el.textContent = msg;
}

function setupOnlineStatusListeners() {
  window.addEventListener('online', () => {
    setOnlineStatus(true);
    syncConfigToServer();
  });
  window.addEventListener('offline', () => {
    setOnlineStatus(false);
  });
}

function setupTheme() {
  const themeBtn = document.getElementById('themeToggleBtn');
  const themeIcon = document.getElementById('themeIcon');
  const themeLabel = document.getElementById('themeLabel');

  const currentTheme = localStorage.getItem('cmdbar_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', currentTheme);

  if (themeIcon && themeLabel) {
    themeIcon.textContent = currentTheme === 'dark' ? '🌙' : '☀️';
    themeLabel.textContent = currentTheme === 'dark' ? 'Dark' : 'Light';
  }

  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      const newTheme = isDark ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', newTheme);
      localStorage.setItem('cmdbar_theme', newTheme);
      if (themeIcon && themeLabel) {
        themeIcon.textContent = newTheme === 'dark' ? '🌙' : '☀️';
        themeLabel.textContent = newTheme === 'dark' ? 'Dark' : 'Light';
      }
    });
  }
}

function setupEventListeners() {
  // Sync Button
  const syncBtn = document.getElementById('syncNowBtn');
  if (syncBtn) {
    syncBtn.addEventListener('click', () => syncConfigToServer());
  }

  // Add Category Button
  const addCatBtn = document.getElementById('addCategoryBtn');
  if (addCatBtn) {
    addCatBtn.addEventListener('click', () => {
      const name = prompt("Enter new category name:");
      if (name && name.trim()) {
        state.config.categories.push({ name: name.trim(), commands: [] });
        syncConfigToServer();
        renderAll();
      }
    });
  }

  // Add Command Button
  const addShortcutBtn = document.getElementById('addShortcutBtn');
  if (addShortcutBtn) {
    addShortcutBtn.addEventListener('click', () => openShortcutModal(null, null));
  }

  // Search/Filter Inputs
  const editorFilter = document.getElementById('editorFilterInput');
  if (editorFilter) {
    editorFilter.addEventListener('input', (e) => {
      renderEditorCategories(e.target.value.toLowerCase());
    });
  }

  const previewSearch = document.getElementById('previewSearchInput');
  if (previewSearch) {
    previewSearch.addEventListener('input', (e) => {
      state.previewFilter = e.target.value.toLowerCase();
      renderLivePreview();
    });
  }

  // Modal Buttons
  const closeShortcutModalBtn = document.getElementById('closeShortcutModalBtn');
  const cancelShortcutBtn = document.getElementById('cancelShortcutBtn');
  if (closeShortcutModalBtn) closeShortcutModalBtn.addEventListener('click', closeShortcutModal);
  if (cancelShortcutBtn) cancelShortcutBtn.addEventListener('click', closeShortcutModal);

  const shortcutForm = document.getElementById('shortcutForm');
  if (shortcutForm) {
    shortcutForm.addEventListener('submit', handleShortcutFormSubmit);
  }

  // Export / Import
  const exportBtn = document.getElementById('exportBtn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      const jsonStr = JSON.stringify(state.config, null, 2);
      const blob = new Blob([jsonStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = "cmdbar_config.json";
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  const importBtn = document.getElementById('importBtn');
  const importFileInput = document.getElementById('importFileInput');
  if (importBtn && importFileInput) {
    importBtn.addEventListener('click', () => importFileInput.click());
    importFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const imported = JSON.parse(event.target.result);
          state.config = sanitizeConfig(imported);
          syncConfigToServer();
          renderAll();
          alert("Configuration imported successfully!");
        } catch (err) {
          alert("Invalid JSON configuration file.");
        }
      };
      reader.readAsText(file);
    });
  }

  // Team Collaboration Modal
  const collabBtn = document.getElementById('collabBtn');
  const collabModal = document.getElementById('collabModal');
  const closeCollabModalBtn = document.getElementById('closeCollabModalBtn');
  const copySharePayloadBtn = document.getElementById('copySharePayloadBtn');
  const mergeRemoteBtn = document.getElementById('mergeRemoteBtn');

  if (collabBtn && collabModal) {
    collabBtn.addEventListener('click', () => {
      const payloadArea = document.getElementById('collabJsonPayload');
      if (payloadArea) {
        payloadArea.value = JSON.stringify(state.config, null, 2);
      }
      collabModal.classList.add('open');
    });
  }

  if (closeCollabModalBtn && collabModal) {
    closeCollabModalBtn.addEventListener('click', () => collabModal.classList.remove('open'));
  }

  if (copySharePayloadBtn) {
    copySharePayloadBtn.addEventListener('click', () => {
      const payloadArea = document.getElementById('collabJsonPayload');
      if (payloadArea) {
        navigator.clipboard.writeText(payloadArea.value);
        alert("Team JSON payload copied to clipboard!");
      }
    });
  }

  if (mergeRemoteBtn) {
    mergeRemoteBtn.addEventListener('click', () => {
      const remoteStr = prompt("Paste remote team JSON configuration to merge:");
      if (!remoteStr) return;
      try {
        const remoteObj = JSON.parse(remoteStr);
        state.config = mergeConfigurations(state.config, remoteObj);
        syncConfigToServer();
        renderAll();
        if (collabModal) collabModal.classList.remove('open');
        alert("Remote team configuration merged successfully!");
      } catch (err) {
        alert("Failed to merge. Invalid JSON payload.");
      }
    });
  }
}

// Rendering Engine
export function renderAll() {
  renderWorkspaces();
  renderEditorCategories();
  renderLivePreview();
}

function renderWorkspaces() {
  const container = document.getElementById('workspaceList');
  if (!container) return;
  container.innerHTML = '';

  state.workspaces.forEach(ws => {
    const item = document.createElement('div');
    item.className = `workspace-item ${ws.active ? 'active' : ''}`;
    item.innerHTML = `
      <span>${ws.name}</span>
      <span class="workspace-badge">${ws.active ? 'Active' : 'Switch'}</span>
    `;
    item.addEventListener('click', () => {
      state.workspaces.forEach(w => w.active = (w.id === ws.id));
      renderWorkspaces();
    });
    container.appendChild(item);
  });
}

export function renderEditorCategories(filterText = "") {
  const container = document.getElementById('categoryContainer');
  if (!container) return;
  container.innerHTML = '';

  state.config.categories.forEach((cat, catIndex) => {
    // Filter commands if search text provided
    const filteredCmds = cat.commands.filter(cmd => {
      if (!filterText) return true;
      return cmd.name.toLowerCase().includes(filterText) || cmd.command.toLowerCase().includes(filterText);
    });

    if (filterText && filteredCmds.length === 0) return;

    const catCard = document.createElement('div');
    catCard.className = 'category-card';
    catCard.draggable = true;
    catCard.dataset.catIndex = catIndex;

    catCard.innerHTML = `
      <div class="category-header">
        <div class="category-title">
          <span class="drag-handle" title="Drag to reorder category">☰</span>
          <span>${cat.name}</span>
          <span style="font-size: 0.8rem; color: var(--text-muted); font-weight: normal;">(${cat.commands.length})</span>
        </div>
        <div class="shortcut-actions">
          <button class="btn btn-sm add-cmd-in-cat-btn" data-cat-index="${catIndex}" title="Add command here">+</button>
          <button class="btn btn-sm btn-danger delete-cat-btn" data-cat-index="${catIndex}" title="Delete category">&times;</button>
        </div>
      </div>
      <div class="shortcuts-dropzone" data-cat-index="${catIndex}"></div>
    `;

    // Category Drag and Drop handlers
    catCard.addEventListener('dragstart', (e) => {
      state.dragSource = { type: 'category', catIndex };
      e.dataTransfer.setData('text/plain', JSON.stringify(state.dragSource));
    });

    catCard.addEventListener('dragover', (e) => {
      e.preventDefault();
      catCard.classList.add('drag-over');
    });

    catCard.addEventListener('dragleave', () => catCard.classList.remove('drag-over'));

    catCard.addEventListener('drop', (e) => {
      e.preventDefault();
      catCard.classList.remove('drag-over');
      if (!state.dragSource) return;

      if (state.dragSource.type === 'category') {
        const fromIdx = state.dragSource.catIndex;
        const toIdx = catIndex;
        if (fromIdx !== toIdx) {
          state.config.categories = moveCategory(state.config.categories, fromIdx, toIdx);
          syncConfigToServer();
          renderAll();
        }
      }
    });

    // Populate shortcuts
    const dropzone = catCard.querySelector('.shortcuts-dropzone');
    filteredCmds.forEach((cmd, cmdIndex) => {
      const cmdItem = document.createElement('div');
      cmdItem.className = 'shortcut-item';
      cmdItem.draggable = true;
      cmdItem.dataset.catIndex = catIndex;
      cmdItem.dataset.cmdIndex = cmdIndex;

      cmdItem.innerHTML = `
        <div class="shortcut-info">
          <div class="shortcut-name">${cmd.name}</div>
          <div class="shortcut-cmd">${cmd.command}</div>
        </div>
        <div class="shortcut-actions">
          <button class="btn btn-sm edit-shortcut-btn" data-cat="${catIndex}" data-cmd="${cmdIndex}">✏️</button>
          <button class="btn btn-sm btn-danger delete-shortcut-btn" data-cat="${catIndex}" data-cmd="${cmdIndex}">&times;</button>
        </div>
      `;

      // Shortcut Drag and Drop handlers
      cmdItem.addEventListener('dragstart', (e) => {
        cmdItem.classList.add('dragging');
        state.dragSource = { type: 'shortcut', catIndex, cmdIndex };
        e.stopPropagation();
      });

      cmdItem.addEventListener('dragend', () => cmdItem.classList.remove('dragging'));

      dropzone.appendChild(cmdItem);
    });

    // Dropzone drop event for moving shortcuts between categories
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('drag-over-zone');
    });

    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over-zone'));

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('drag-over-zone');

      if (state.dragSource && state.dragSource.type === 'shortcut') {
        const fromCat = state.dragSource.catIndex;
        const fromCmd = state.dragSource.cmdIndex;
        const toCat = catIndex;
        const toCmd = dropzone.children.length;

        state.config.categories = moveShortcut(state.config.categories, fromCat, fromCmd, toCat, toCmd);
        syncConfigToServer();
        renderAll();
      }
    });

    container.appendChild(catCard);
  });

  // Attach button event listeners inside category cards
  container.querySelectorAll('.add-cmd-in-cat-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const catIdx = parseInt(e.target.dataset.catIndex, 10);
      openShortcutModal(catIdx, null);
    });
  });

  container.querySelectorAll('.delete-cat-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const catIdx = parseInt(e.target.dataset.catIndex, 10);
      if (confirm(`Are you sure you want to delete category "${state.config.categories[catIdx].name}"?`)) {
        state.config.categories.splice(catIdx, 1);
        syncConfigToServer();
        renderAll();
      }
    });
  });

  container.querySelectorAll('.edit-shortcut-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const catIdx = parseInt(e.target.dataset.cat, 10);
      const cmdIdx = parseInt(e.target.dataset.cmd, 10);
      openShortcutModal(catIdx, cmdIdx);
    });
  });

  container.querySelectorAll('.delete-shortcut-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const catIdx = parseInt(e.target.dataset.cat, 10);
      const cmdIdx = parseInt(e.target.dataset.cmd, 10);
      state.config.categories[catIdx].commands.splice(cmdIdx, 1);
      syncConfigToServer();
      renderAll();
    });
  });
}

export function renderLivePreview() {
  const container = document.getElementById('previewMenuContent');
  if (!container) return;
  container.innerHTML = '';

  const filter = state.previewFilter.toLowerCase();

  state.config.categories.forEach(cat => {
    const matchingCmds = cat.commands.filter(cmd => {
      if (!filter) return true;
      return cmd.name.toLowerCase().includes(filter) || cmd.command.toLowerCase().includes(filter);
    });

    if (matchingCmds.length === 0) return;

    const catHeader = document.createElement('div');
    catHeader.className = 'menu-category-header';
    catHeader.textContent = cat.name;
    container.appendChild(catHeader);

    matchingCmds.forEach(cmd => {
      const item = document.createElement('div');
      item.className = 'menu-item-preview';

      item.innerHTML = `
        <div>
          <div style="font-weight: 600;">${cmd.name}</div>
          <div style="font-size: 0.75rem; color: #aaa;">${cmd.command}</div>
        </div>
        <button class="copy-btn" title="Copy command">📋</button>
      `;

      item.querySelector('.copy-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(cmd.command);
        alert(`Copied "${cmd.command}" to clipboard!`);
      });

      item.addEventListener('click', () => {
        updateFormatterPreview(cmd);
      });

      container.appendChild(item);
    });
  });
}

function updateFormatterPreview(cmd) {
  const box = document.getElementById('formatterPreviewBox');
  if (!box) return;

  box.textContent = JSON.stringify({
    status: "executed",
    command_name: cmd.name,
    raw_command: cmd.command,
    mode: cmd.mode || "shell-quoted",
    parsed_output: {
      result: "OK",
      timestamp: new Date().toISOString()
    }
  }, null, 2);
}

// Modal Handlers
function openShortcutModal(catIndex = null, cmdIndex = null) {
  const modal = document.getElementById('shortcutModal');
  const catSelect = document.getElementById('modalCategorySelect');
  const nameInput = document.getElementById('modalShortcutName');
  const cmdInput = document.getElementById('modalShortcutCmd');
  const modeSelect = document.getElementById('modalShortcutMode');
  const placeholderInput = document.getElementById('modalShortcutPlaceholder');

  if (!modal || !catSelect) return;

  // Populate category options
  catSelect.innerHTML = '';
  state.config.categories.forEach((cat, idx) => {
    const opt = document.createElement('option');
    opt.value = idx;
    opt.textContent = cat.name;
    catSelect.appendChild(opt);
  });

  if (catIndex !== null && catSelect.options[catIndex]) {
    catSelect.selectedIndex = catIndex;
  }

  if (catIndex !== null && cmdIndex !== null) {
    state.editingItem = { catIndex, cmdIndex };
    const cmd = state.config.categories[catIndex].commands[cmdIndex];
    nameInput.value = cmd.name || '';
    cmdInput.value = cmd.command || '';
    modeSelect.value = cmd.mode || 'shell-quoted';
    placeholderInput.value = cmd.placeholder || '';
  } else {
    state.editingItem = null;
    nameInput.value = '';
    cmdInput.value = '';
    modeSelect.value = 'shell-quoted';
    placeholderInput.value = '';
  }

  modal.classList.add('open');
}

function closeShortcutModal() {
  const modal = document.getElementById('shortcutModal');
  if (modal) modal.classList.remove('open');
}

function handleShortcutFormSubmit(e) {
  e.preventDefault();
  const catIndex = parseInt(document.getElementById('modalCategorySelect').value, 10);
  const name = document.getElementById('modalShortcutName').value.trim();
  const command = document.getElementById('modalShortcutCmd').value.trim();
  const mode = document.getElementById('modalShortcutMode').value;
  const placeholder = document.getElementById('modalShortcutPlaceholder').value.trim();

  if (!name || !command) return;

  const shortcutData = { name, command, mode };
  if (placeholder) shortcutData.placeholder = placeholder;

  if (state.editingItem) {
    const { catIndex: oldCat, cmdIndex: oldCmd } = state.editingItem;
    state.config.categories[oldCat].commands.splice(oldCmd, 1);
    state.config.categories[catIndex].commands.push(shortcutData);
  } else {
    state.config.categories[catIndex].commands.push(shortcutData);
  }

  syncConfigToServer();
  closeShortcutModal();
  renderAll();
}

// Auto-start when DOM is ready
if (typeof window !== 'undefined' && document.readyState !== 'loading') {
  initDashboard();
} else if (typeof window !== 'undefined') {
  document.addEventListener('DOMContentLoaded', initDashboard);
}
