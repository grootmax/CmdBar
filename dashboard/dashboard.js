/**
 * CmdBar Web Dashboard Core Application Logic
 * Implements Configuration Management, Drag-and-Drop Editor, Real-Time Preview,
 * Team Collaboration, and Offline Capabilities.
 * @module dashboard
 */

// =====================================================================
// UTILITY & PREVIEW ENGINE FUNCTIONS
// =====================================================================

/**
 * Validates a parameter value against forbidden characters and regex pattern.
 * @param {string} value - User input value
 * @param {object} paramSchema - Parameter validation schema
 * @returns {{isValid: boolean, errorMessage: string|null}}
 * :visibility: public
 */
export function validateParameterValue(value, paramSchema = {}) {
  const strVal =
    value !== undefined && value !== null ? String(value).trim() : "";
  const forbidden = [";", "&&", "||", "|", "&", "`", "$", "(", ")", ">", "<"];

  for (const char of forbidden) {
    if (strVal.includes(char)) {
      let err = `Input contains forbidden character '${char}'!`;
      if (paramSchema.secure) {
        err = "Input contains forbidden character!";
      }
      return { isValid: false, errorMessage: err };
    }
  }

  if (paramSchema.regex) {
    try {
      const re = new RegExp(paramSchema.regex);
      if (!re.test(strVal)) {
        return {
          isValid: false,
          errorMessage:
            paramSchema.error_message ||
            "Input format does not match regex requirements.",
        };
      }
    } catch (e) {
      return {
        isValid: false,
        errorMessage: `Invalid regex rule: ${e.message}`,
      };
    }
  }

  return { isValid: true, errorMessage: null };
}

/**
 * Escapes shell arguments for shell-quoted execution mode.
 * @param {string} arg
 * @returns {string}
 * :visibility: public
 */
export function shellQuote(arg) {
  if (!arg) return "''";
  if (/^[a-zA-Z0-9_.-]+$/.test(arg)) return arg;
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

/**
 * Resolves dry-run command preview and parameter validation errors.
 * @param {string} template - Command template with placeholders like <param>, {param}, or {{param}}
 * @param {string} mode - Execution mode ('shell-quoted' or 'direct-array')
 * @param {object} paramValues - Key-value pair of parameter inputs
 * @param {object} paramSchemas - Parameter definitions and validation rules
 * @returns {{resolved: string, errors: object}}
 * :visibility: public
 */
export function resolveCommandPreview(
  template = "",
  mode = "shell-quoted",
  paramValues = {},
  paramSchemas = {},
) {
  const errors = {};
  const valuesForPreview = {};

  // Validate parameters
  for (const [key, schema] of Object.entries(paramSchemas)) {
    const val = paramValues[key] !== undefined ? paramValues[key] : "";
    const validation = validateParameterValue(val, schema);
    if (!validation.isValid) {
      errors[key] = validation.errorMessage;
    }

    if (schema.secure && val) {
      valuesForPreview[key] = "*".repeat(String(val).length);
    } else {
      valuesForPreview[key] = String(val);
    }
  }

  const placeholderRegex = /\{\{([^}]+)\}\}|<([^>]+)>|\{([^}]+)\}/g;

  if (mode === "shell-quoted") {
    const resolved = template.replace(placeholderRegex, (match, p1, p2, p3) => {
      const paramName = p1 || p2 || p3;
      if (paramName in valuesForPreview) {
        return shellQuote(valuesForPreview[paramName]);
      }
      return match;
    });
    return { resolved, errors };
  } else {
    // direct-array mode
    const parts = template.split(/\s+/).filter(Boolean);
    const resolvedParts = parts.map((part) => {
      return part.replace(placeholderRegex, (match, p1, p2, p3) => {
        const paramName = p1 || p2 || p3;
        if (paramName in valuesForPreview) {
          return valuesForPreview[paramName];
        }
        return match;
      });
    });

    const previewText = `Direct Array: ${resolvedParts.map(shellQuote).join(" ")}\nArgs List: ${JSON.stringify(resolvedParts)}`;
    return { resolved: previewText, errors };
  }
}

/**
 * Reorders items in an array immutably or in-place.
 * @param {Array} array
 * @param {number} fromIndex
 * @param {number} toIndex
 * @returns {Array}
 * :visibility: public
 */
export function reorderArray(array, fromIndex, toIndex) {
  if (
    fromIndex < 0 ||
    fromIndex >= array.length ||
    toIndex < 0 ||
    toIndex >= array.length
  ) {
    return array;
  }
  const result = Array.from(array);
  const [removed] = result.splice(fromIndex, 1);
  result.splice(toIndex, 0, removed);
  return result;
}

/**
 * Moves a command item between categories in configuration object.
 * @param {object} config
 * @param {number} srcCatIdx
 * @param {number} srcCmdIdx
 * @param {number} targetCatIdx
 * @param {number} targetCmdIdx
 * @returns {object} updated config
 * :visibility: public
 */
export function moveCommandBetweenCategories(
  config,
  srcCatIdx,
  srcCmdIdx,
  targetCatIdx,
  targetCmdIdx,
) {
  if (!config || !config.categories) return config;
  if (!config.categories[srcCatIdx] || !config.categories[targetCatIdx])
    return config;

  const srcCmds = config.categories[srcCatIdx].commands || [];
  if (srcCmdIdx < 0 || srcCmdIdx >= srcCmds.length) return config;

  const [movedCmd] = srcCmds.splice(srcCmdIdx, 1);
  const targetCmds = config.categories[targetCatIdx].commands || [];
  const insertIdx = targetCmdIdx >= 0 ? targetCmdIdx : targetCmds.length;
  targetCmds.splice(insertIdx, 0, movedCmd);

  config.categories[srcCatIdx].commands = srcCmds;
  config.categories[targetCatIdx].commands = targetCmds;
  return config;
}

/**
 * Applies a pre-packaged Team Preset to a configuration object.
 * @param {string} presetName ('DevOps', 'Frontend', 'SRE')
 * @param {object} currentConfig
 * @returns {object} merged configuration
 * :visibility: public
 */
export function applyTeamPreset(presetName, currentConfig = {}) {
  const presets = {
    DevOps: {
      name: "DevOps & Infrastructure",
      commands: [
        {
          name: "Docker Logs",
          command: "docker logs -f <container>",
          mode: "shell-quoted",
          parameters: { container: { regex: "^[a-zA-Z0-9_-]+$" } },
        },
        {
          name: "Kubectl Get Pods",
          command: "kubectl get pods -n <namespace>",
          mode: "shell-quoted",
          parameters: { namespace: { regex: "^[a-zA-Z0-9_-]+$" } },
        },
      ],
    },
    Frontend: {
      name: "Frontend Development",
      commands: [
        {
          name: "Run Dev Server",
          command: "npm run dev",
          mode: "shell-quoted",
        },
        { name: "Run Tests", command: "npm test", mode: "shell-quoted" },
        {
          name: "Build Production",
          command: "npm run build",
          mode: "shell-quoted",
        },
      ],
    },
    SRE: {
      name: "SRE & Diagnostics",
      commands: [
        {
          name: "Ping Endpoint",
          command: "ping -c 4 <host>",
          mode: "shell-quoted",
          parameters: { host: { regex: "^[a-zA-Z0-9.-]+$" } },
        },
        { name: "System Load", command: "uptime", mode: "shell-quoted" },
      ],
    },
  };

  const preset = presets[presetName] || presets.DevOps;
  const config = JSON.parse(JSON.stringify(currentConfig));
  if (!config.categories) config.categories = [];

  let targetCat = config.categories.find((c) => c.name === preset.name);
  if (!targetCat) {
    targetCat = { name: preset.name, commands: [] };
    config.categories.push(targetCat);
  }

  for (const cmd of preset.commands) {
    if (!targetCat.commands.some((c) => c.name === cmd.name)) {
      targetCat.commands.push(cmd);
    }
  }

  return config;
}

/**
 * Exports configuration as a formatted JSON string with team signature metadata.
 * @param {object} config
 * @returns {string} JSON string
 * :visibility: public
 */
export function exportConfigJSON(config) {
  const exportData = JSON.parse(JSON.stringify(config));
  exportData._export_timestamp = new Date().toISOString();
  exportData._exported_by = "CmdBar Web Dashboard";
  return JSON.stringify(exportData, null, 2);
}

/**
 * Parses and validates an imported JSON configuration string.
 * @param {string} jsonStr
 * @returns {{valid: boolean, config: object|null, error: string|null}}
 * :visibility: public
 */
export function importConfigJSON(jsonStr) {
  try {
    const parsed = JSON.parse(jsonStr);
    if (typeof parsed !== "object" || parsed === null) {
      return {
        valid: false,
        config: null,
        error: "Invalid JSON format: Root must be an object.",
      };
    }
    if (!Array.isArray(parsed.categories)) {
      return {
        valid: false,
        config: null,
        error: "Invalid schema: Missing 'categories' array.",
      };
    }
    return { valid: true, config: parsed, error: null };
  } catch (e) {
    return {
      valid: false,
      config: null,
      error: `JSON Parse Error: ${e.message}`,
    };
  }
}

// =====================================================================
// DASHBOARD APP CLASS (DOM & Event Handling)
// =====================================================================

export class DashboardApp {
  constructor() {
    this.config = {
      ai: { provider: "openai", model: "gpt-4o", require_confirmation: true },
      categories: [
        {
          name: "Projects",
          commands: [
            {
              name: "Run Dev Server",
              command: "npm run dev",
              mode: "shell-quoted",
            },
            {
              name: "Docker Logs",
              command: "docker logs -f <container>",
              mode: "shell-quoted",
              parameters: {
                container: {
                  regex: "^[a-zA-Z0-9_-]+$",
                  placeholder: "e.g. app-web",
                },
              },
            },
          ],
        },
      ],
    };
    this.activeCategoryIndex = 0;
    this.activeCommandIndex = 0;
    this.userRole = "Admin"; // Admin, Editor, Viewer
    this.isOnline = true;
    this.draggedType = null; // 'category' or 'command'
    this.draggedIndex = null;
    this.draggedSourceCat = null;
  }

  init() {
    if (typeof window === "undefined" || typeof document === "undefined")
      return;

    this.registerServiceWorker();
    this.bindEvents();
    this.loadConfig();
  }

  registerServiceWorker() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    }
  }

  async loadConfig() {
    try {
      const res = await fetch("/api/config");
      if (res.ok) {
        this.config = await res.json();
        this.setOnlineStatus(true);
      } else {
        this.loadLocalStorage();
      }
    } catch (e) {
      this.setOnlineStatus(false);
      this.loadLocalStorage();
    }
    this.render();
  }

  loadLocalStorage() {
    const saved = localStorage.getItem("cmdbar_config");
    if (saved) {
      const result = importConfigJSON(saved);
      if (result.valid) {
        this.config = result.config;
      }
    }
  }

  async saveConfig() {
    localStorage.setItem("cmdbar_config", JSON.stringify(this.config));
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(this.config),
      });
      if (res.ok) {
        this.setOnlineStatus(true);
        alert("Configuration saved successfully!");
      } else {
        alert("Saved to local offline storage (Server returned non-200).");
      }
    } catch (e) {
      this.setOnlineStatus(false);
      alert("Saved to local offline storage (Operating Offline).");
    }
  }

  setOnlineStatus(online) {
    this.isOnline = online;
    const badge = document.getElementById("status-badge");
    if (badge) {
      if (online) {
        badge.className = "badge badge-online";
        badge.textContent = "Online";
      } else {
        badge.className = "badge badge-offline";
        badge.textContent = "Offline";
      }
    }
  }

  bindEvents() {
    // Role & Theme
    document.getElementById("btn-theme")?.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme");
      document.documentElement.setAttribute(
        "data-theme",
        current === "dark" ? "light" : "dark",
      );
    });

    document
      .getElementById("team-role-select")
      ?.addEventListener("change", (e) => {
        this.userRole = e.target.value;
        document.getElementById("role-badge").textContent =
          `Role: ${this.userRole}`;
        this.render();
      });

    // Top Controls
    document
      .getElementById("btn-save")
      ?.addEventListener("click", () => this.saveConfig());
    document
      .getElementById("btn-export")
      ?.addEventListener("click", () => this.handleExport());
    document
      .getElementById("btn-import")
      ?.addEventListener("click", () =>
        document.getElementById("file-import-input").click(),
      );
    document
      .getElementById("file-import-input")
      ?.addEventListener("change", (e) => this.handleImportFile(e));

    // Category Actions
    document
      .getElementById("btn-add-category")
      ?.addEventListener("click", () => {
        if (this.userRole === "Viewer") return alert("Read-only role!");
        const name = prompt("Enter new category name:");
        if (name) {
          this.config.categories.push({ name, commands: [] });
          this.activeCategoryIndex = this.config.categories.length - 1;
          this.render();
        }
      });

    // Command Actions
    document
      .getElementById("btn-add-command")
      ?.addEventListener("click", () => {
        if (this.userRole === "Viewer") return alert("Read-only role!");
        this.openCommandEditor(-1);
      });

    // Modals Close
    document.querySelectorAll(".btn-close-modal").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.target.closest(".modal-overlay").classList.add("hidden");
      });
    });

    // AI & Presets & Team
    document
      .getElementById("btn-ai-settings")
      ?.addEventListener("click", () => {
        document.getElementById("modal-ai-settings").classList.remove("hidden");
      });

    document.getElementById("btn-presets")?.addEventListener("click", () => {
      document.getElementById("modal-team").classList.remove("hidden");
    });

    document.getElementById("btn-team")?.addEventListener("click", () => {
      document.getElementById("modal-team").classList.remove("hidden");
    });

    document
      .getElementById("preset-devops")
      ?.addEventListener("click", () => this.applyPreset("DevOps"));
    document
      .getElementById("preset-frontend")
      ?.addEventListener("click", () => this.applyPreset("Frontend"));
    document
      .getElementById("preset-sre")
      ?.addEventListener("click", () => this.applyPreset("SRE"));

    document
      .getElementById("btn-save-command")
      ?.addEventListener("click", () => this.saveCommandEditor());
    document
      .getElementById("btn-save-ai")
      ?.addEventListener("click", () => this.saveAISettings());

    // Search Input
    document
      .getElementById("search-input")
      ?.addEventListener("input", (e) => this.renderCommands(e.target.value));
  }

  applyPreset(name) {
    if (this.userRole === "Viewer") return alert("Read-only role!");
    this.config = applyTeamPreset(name, this.config);
    this.render();
    document.getElementById("modal-team").classList.add("hidden");
    alert(`Applied ${name} preset!`);
  }

  handleExport() {
    const jsonStr = exportConfigJSON(this.config);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cmdbar-config-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  handleImportFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const res = importConfigJSON(e.target.result);
      if (res.valid) {
        this.config = res.config;
        this.activeCategoryIndex = 0;
        this.render();
        alert("Configuration imported successfully!");
      } else {
        alert(`Import Error: ${res.error}`);
      }
    };
    reader.readAsText(file);
  }

  render() {
    this.renderCategories();
    this.renderCommands();
    this.renderPreview();
  }

  renderCategories() {
    const list = document.getElementById("category-list");
    if (!list) return;
    list.innerHTML = "";

    this.config.categories.forEach((cat, idx) => {
      const li = document.createElement("li");
      li.className = `category-item ${idx === this.activeCategoryIndex ? "active" : ""}`;
      li.draggable = this.userRole !== "Viewer";

      li.innerHTML = `
                <span class="drag-handle">⋮⋮</span>
                <span class="cat-name">${cat.name}</span>
                <span class="badge" style="background: rgba(255,255,255,0.1); margin-left: auto;">${cat.commands ? cat.commands.length : 0}</span>
            `;

      li.addEventListener("click", () => {
        this.activeCategoryIndex = idx;
        this.activeCommandIndex = 0;
        this.render();
      });

      // Drag and Drop for Categories
      li.addEventListener("dragstart", (e) => {
        this.draggedType = "category";
        this.draggedIndex = idx;
        e.dataTransfer.setData("text/plain", idx);
      });

      li.addEventListener("dragover", (e) => {
        e.preventDefault();
        if (this.draggedType === "category") li.classList.add("drag-over");
      });

      li.addEventListener("dragleave", () => li.classList.remove("drag-over"));

      li.addEventListener("drop", (e) => {
        e.preventDefault();
        li.classList.remove("drag-over");
        if (this.draggedType === "category" && this.draggedIndex !== null) {
          this.config.categories = reorderArray(
            this.config.categories,
            this.draggedIndex,
            idx,
          );
          this.activeCategoryIndex = idx;
          this.render();
        }
      });

      list.appendChild(li);
    });
  }

  renderCommands(filterText = "") {
    const grid = document.getElementById("commands-grid");
    const title = document.getElementById("active-category-title");
    if (!grid) return;

    const cat = this.config.categories[this.activeCategoryIndex];
    if (!cat) {
      grid.innerHTML = '<p class="text-muted">No category selected.</p>';
      return;
    }

    if (title)
      title.textContent = `${cat.name} (${cat.commands ? cat.commands.length : 0} Commands)`;
    grid.innerHTML = "";

    let commands = cat.commands || [];
    if (filterText) {
      commands = commands.filter(
        (c) =>
          c.name.toLowerCase().includes(filterText.toLowerCase()) ||
          (c.command &&
            c.command.toLowerCase().includes(filterText.toLowerCase())),
      );
    }

    commands.forEach((cmd, idx) => {
      const card = document.createElement("div");
      card.className = "card";
      card.draggable = this.userRole !== "Viewer";

      const modeBadge =
        cmd.mode === "direct-array" ? "direct-array" : "shell-quoted";
      const cmdTemplate = cmd.command || cmd.template || "";

      card.innerHTML = `
                <div class="card-header">
                    <span class="drag-handle">⋮⋮</span>
                    <span class="card-title">${cmd.name}</span>
                    <span class="badge badge-role">${modeBadge}</span>
                </div>
                <div class="command-code">${cmdTemplate}</div>
                <div class="card-actions">
                    <button class="btn btn-secondary btn-sm btn-test-cmd">⚡ Test</button>
                    ${
                      this.userRole !== "Viewer"
                        ? `
                        <button class="btn btn-secondary btn-sm btn-edit-cmd">✏️ Edit</button>
                        <button class="btn btn-danger btn-sm btn-del-cmd">🗑️ Delete</button>
                        <button class="btn btn-secondary btn-sm btn-touch-reorder btn-move-up">▲</button>
                        <button class="btn btn-secondary btn-sm btn-touch-reorder btn-move-down">▼</button>
                    `
                        : ""
                    }
                </div>
            `;

      card.querySelector(".btn-test-cmd")?.addEventListener("click", () => {
        this.activeCommandIndex = idx;
        this.renderPreview();
      });

      card
        .querySelector(".btn-edit-cmd")
        ?.addEventListener("click", () => this.openCommandEditor(idx));

      card.querySelector(".btn-del-cmd")?.addEventListener("click", () => {
        cat.commands.splice(idx, 1);
        this.render();
      });

      // Touch fallback reorder buttons
      card.querySelector(".btn-move-up")?.addEventListener("click", () => {
        if (idx > 0) {
          cat.commands = reorderArray(cat.commands, idx, idx - 1);
          this.render();
        }
      });

      card.querySelector(".btn-move-down")?.addEventListener("click", () => {
        if (idx < cat.commands.length - 1) {
          cat.commands = reorderArray(cat.commands, idx, idx + 1);
          this.render();
        }
      });

      // Drag and drop for commands
      card.addEventListener("dragstart", (e) => {
        this.draggedType = "command";
        this.draggedIndex = idx;
        this.draggedSourceCat = this.activeCategoryIndex;
        card.classList.add("dragging");
      });

      card.addEventListener("dragend", () => card.classList.remove("dragging"));

      card.addEventListener("dragover", (e) => {
        e.preventDefault();
        if (this.draggedType === "command") card.classList.add("drag-over");
      });

      card.addEventListener("dragleave", () =>
        card.classList.remove("drag-over"),
      );

      card.addEventListener("drop", (e) => {
        e.preventDefault();
        card.classList.remove("drag-over");
        if (this.draggedType === "command" && this.draggedIndex !== null) {
          if (this.draggedSourceCat === this.activeCategoryIndex) {
            cat.commands = reorderArray(cat.commands, this.draggedIndex, idx);
          } else {
            moveCommandBetweenCategories(
              this.config,
              this.draggedSourceCat,
              this.draggedIndex,
              this.activeCategoryIndex,
              idx,
            );
          }
          this.render();
        }
      });

      grid.appendChild(card);
    });
  }

  renderPreview() {
    const cat = this.config.categories[this.activeCategoryIndex];
    const cmd =
      cat && cat.commands ? cat.commands[this.activeCommandIndex] : null;

    const inputsContainer = document.getElementById(
      "preview-parameters-container",
    );
    const outputBox = document.getElementById("preview-output");
    const errorsBox = document.getElementById("preview-errors");

    if (!cmd) {
      if (outputBox) outputBox.textContent = "No command selected for preview.";
      if (errorsBox) errorsBox.textContent = "";
      if (inputsContainer) inputsContainer.innerHTML = "";
      return;
    }

    const template = cmd.command || cmd.template || "";
    const mode = cmd.mode || "shell-quoted";
    const paramsSchema = cmd.parameters || {};

    if (inputsContainer) {
      inputsContainer.innerHTML = "";
      for (const [paramName, schema] of Object.entries(paramsSchema)) {
        const group = document.createElement("div");
        group.className = "form-group";
        group.style.flex = "1 1 200px";

        group.innerHTML = `
                    <label class="form-label">${paramName}</label>
                    <input type="text" class="form-control preview-param-input" data-param="${paramName}" placeholder="${schema.placeholder || "Enter value..."}">
                `;

        group
          .querySelector("input")
          .addEventListener("input", () => this.updatePreviewComputation(cmd));
        inputsContainer.appendChild(group);
      }
    }

    this.updatePreviewComputation(cmd);
  }

  updatePreviewComputation(cmd) {
    const outputBox = document.getElementById("preview-output");
    const errorsBox = document.getElementById("preview-errors");
    if (!cmd || !outputBox) return;

    const template = cmd.command || cmd.template || "";
    const mode = cmd.mode || "shell-quoted";
    const paramsSchema = cmd.parameters || {};

    const values = {};
    document.querySelectorAll(".preview-param-input").forEach((input) => {
      values[input.getAttribute("data-param")] = input.value;
    });

    const previewResult = resolveCommandPreview(
      template,
      mode,
      values,
      paramsSchema,
    );

    outputBox.textContent = previewResult.resolved;
    if (errorsBox) {
      const errList = Object.values(previewResult.errors);
      errorsBox.textContent =
        errList.length > 0
          ? `⚠️ Validation Warnings: ${errList.join(" | ")}`
          : "";
    }
  }

  openCommandEditor(cmdIndex) {
    this.editingCmdIndex = cmdIndex;
    const modal = document.getElementById("modal-command-editor");
    if (!modal) return;

    const cat = this.config.categories[this.activeCategoryIndex];
    const cmd =
      cmdIndex >= 0 && cat
        ? cat.commands[cmdIndex]
        : { name: "", command: "", mode: "shell-quoted", parameters: {} };

    document.getElementById("edit-cmd-name").value = cmd.name || "";
    document.getElementById("edit-cmd-mode").value = cmd.mode || "shell-quoted";
    document.getElementById("edit-cmd-template").value =
      cmd.command || cmd.template || "";

    modal.classList.remove("hidden");
  }

  saveCommandEditor() {
    const cat = this.config.categories[this.activeCategoryIndex];
    if (!cat) return;

    const name = document.getElementById("edit-cmd-name").value.trim();
    const mode = document.getElementById("edit-cmd-mode").value;
    const template = document.getElementById("edit-cmd-template").value.trim();

    if (!name || !template) return alert("Name and Template are required.");

    const cmdData = { name, command: template, mode, parameters: {} };

    if (this.editingCmdIndex >= 0) {
      cat.commands[this.editingCmdIndex] = cmdData;
    } else {
      cat.commands.push(cmdData);
      this.activeCommandIndex = cat.commands.length - 1;
    }

    document.getElementById("modal-command-editor").classList.add("hidden");
    this.render();
  }

  saveAISettings() {
    this.config.ai = {
      provider: document.getElementById("ai-provider").value,
      model: document.getElementById("ai-model").value,
      fallback_provider: document.getElementById("ai-fallback-provider").value,
      fallback_model: document.getElementById("ai-fallback-model").value,
      require_confirmation: document.getElementById("ai-require-confirmation")
        .checked,
    };

    document.getElementById("modal-ai-settings").classList.add("hidden");
    alert("AI Settings updated!");
  }
}

// Auto-initialize if running in browser window
if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => {
    window.dashboardApp = new DashboardApp();
    window.dashboardApp.init();
  });
}
