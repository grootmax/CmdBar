/**
 * Elgato Stream Deck Plugin & Integration Module for CmdBar.
 * Manages Stream Deck profiles, key bindings, visual button layouts,
 * feedback LEDs, dynamic labels, and performance-optimized grid rendering.
 * Runs in both GJS (GNOME Shell) and Node.js environments.
 *
 * @public
 */

import fs from 'fs';
import path from 'path';
import { loadConfig, saveConfig, getDefaultConfigPath } from './configSync.js';

/**
 * LED feedback state constants and visual themes.
 * @public
 */
export const LEDState = {
  IDLE: 'idle',
  RUNNING: 'running',
  SUCCESS: 'success',
  ERROR: 'error',

  COLOR_MAP: {
    idle: '#4A5568',      // Slate Gray
    running: '#ECC94B',   // Amber / Yellow
    success: '#48BB78',   // Green
    error: '#F56565',     // Red
  },

  SYMBOL_MAP: {
    idle: '⚪',
    running: '⚡',
    success: '✓',
    error: '✗',
  },
};

/**
 * Stream Deck device models and matrix specs.
 * @public
 */
export const DeviceModel = {
  MINI: 'MINI',          // 2x3 (6 keys)
  ORIGINAL: 'ORIGINAL',  // 3x5 (15 keys)
  XL: 'XL',              // 4x8 (32 keys)
  PLUS: 'PLUS',          // 2x4 (8 keys + dial strip)

  CONFIGS: {
    MINI: { rows: 2, cols: 3, keys: 6 },
    ORIGINAL: { rows: 3, cols: 5, keys: 15 },
    XL: { rows: 4, cols: 8, keys: 32 },
    PLUS: { rows: 2, cols: 4, keys: 8 },
  },
};

/**
 * Represents an individual Stream Deck button key binding.
 * @public
 */
export class StreamDeckKey {
  /**
   * @param {Object} options - Key properties
   * @public
   */
  constructor(options = {}) {
    this.keyIndex = Number(options.keyIndex ?? 0);
    this.commandName = String(options.commandName ?? '');
    this.labelTemplate = String(options.labelTemplate ?? '{name}');
    this.customLabel = String(options.customLabel ?? '');
    this.icon = String(options.icon ?? 'utilities-terminal-symbolic');
    this.bgColor = String(options.bgColor ?? '#1A202C');
    this.textColor = String(options.textColor ?? '#FFFFFF');
    this.ledState = String(options.ledState ?? LEDState.IDLE);
    this.actionType = String(options.actionType ?? 'command'); // 'command', 'switch_profile', 'brightness', 'toggle_led'
    this.targetProfile = String(options.targetProfile ?? '');
    this.parameters = options.parameters && typeof options.parameters === 'object' ? { ...options.parameters } : {};
    this.lastOutput = String(options.lastOutput ?? '');
    this.lastExecuted = Number(options.lastExecuted ?? 0);
    this.executionTimeMs = Number(options.executionTimeMs ?? 0);
  }

  /**
   * Converts key object to JSON-compatible record.
   * @public
   */
  toJSON() {
    return {
      keyIndex: this.keyIndex,
      commandName: this.commandName,
      labelTemplate: this.labelTemplate,
      customLabel: this.customLabel,
      icon: this.icon,
      bgColor: this.bgColor,
      textColor: this.textColor,
      ledState: this.ledState,
      actionType: this.actionType,
      targetProfile: this.targetProfile,
      parameters: this.parameters,
      lastOutput: this.lastOutput,
      lastExecuted: this.lastExecuted,
      executionTimeMs: this.executionTimeMs,
    };
  }

  /**
   * Instantiates StreamDeckKey from JSON record.
   * @param {Object} data
   * @public
   */
  static fromJSON(data = {}) {
    const key = new StreamDeckKey({
      keyIndex: data.keyIndex ?? data.key_index,
      commandName: data.commandName ?? data.command_name,
      labelTemplate: data.labelTemplate ?? data.label_template,
      customLabel: data.customLabel ?? data.custom_label,
      icon: data.icon,
      bgColor: data.bgColor ?? data.bg_color,
      textColor: data.textColor ?? data.text_color,
      ledState: data.ledState ?? data.led_state,
      actionType: data.actionType ?? data.action_type,
      targetProfile: data.targetProfile ?? data.target_profile,
      parameters: data.parameters,
    });
    key.lastOutput = String(data.lastOutput ?? data.last_output ?? '');
    key.lastExecuted = Number(data.lastExecuted ?? data.last_executed ?? 0);
    key.executionTimeMs = Number(data.executionTimeMs ?? data.execution_time_ms ?? 0);
    return key;
  }
}

/**
 * Stream Deck layout profile.
 * @public
 */
export class StreamDeckProfile {
  /**
   * @param {string} name
   * @param {string} deviceModel
   * @param {string} bgColor
   * @param {string|null} autoSwitchCategory
   * @public
   */
  constructor(name = 'Default', deviceModel = DeviceModel.ORIGINAL, bgColor = '#0D1117', autoSwitchCategory = null) {
    this.name = String(name).trim();
    this.deviceModel = DeviceModel.CONFIGS[deviceModel] ? deviceModel : DeviceModel.ORIGINAL;
    this.bgColor = String(bgColor);
    this.autoSwitchCategory = autoSwitchCategory ? String(autoSwitchCategory) : null;
    /** @type {Map<number, StreamDeckKey>} */
    this.keys = new Map();
  }

  /**
   * Returns max key count for device model.
   * @public
   */
  getMaxKeys() {
    return DeviceModel.CONFIGS[this.deviceModel]?.keys ?? 15;
  }

  /**
   * Assigns a key binding.
   * @param {StreamDeckKey} key
   * @public
   */
  setKey(key) {
    if (key.keyIndex >= 0 && key.keyIndex < this.getMaxKeys()) {
      this.keys.set(key.keyIndex, key);
    }
  }

  /**
   * Retrieves key by index.
   * @param {number} keyIndex
   * @public
   */
  getKey(keyIndex) {
    return this.keys.get(Number(keyIndex));
  }

  /**
   * Removes key binding by index.
   * @param {number} keyIndex
   * @public
   */
  removeKey(keyIndex) {
    return this.keys.delete(Number(keyIndex));
  }

  /**
   * Converts profile to JSON record.
   * @public
   */
  toJSON() {
    const keysObj = {};
    for (const [idx, key] of this.keys.entries()) {
      keysObj[idx] = key.toJSON();
    }
    return {
      name: this.name,
      deviceModel: this.deviceModel,
      bgColor: this.bgColor,
      autoSwitchCategory: this.autoSwitchCategory,
      keys: keysObj,
    };
  }

  /**
   * Creates StreamDeckProfile from JSON record.
   * @param {Object} data
   * @public
   */
  static fromJSON(data = {}) {
    const profile = new StreamDeckProfile(
      data.name ?? 'Default',
      data.deviceModel ?? data.device_model ?? DeviceModel.ORIGINAL,
      data.bgColor ?? data.bg_color ?? '#0D1117',
      data.autoSwitchCategory ?? data.auto_switch_category ?? null
    );
    const keysData = data.keys ?? {};
    if (typeof keysData === 'object') {
      for (const [idxStr, kData] of Object.entries(keysData)) {
        try {
          const keyObj = StreamDeckKey.fromJSON(kData);
          profile.setKey(keyObj);
        } catch (_) {}
      }
    }
    return profile;
  }
}

/**
 * Controller and Manager for Stream Deck integration.
 * @public
 */
export class StreamDeckController {
  /**
   * @param {Object} [indicator=null] - Shell indicator or execution service
   * @param {string} [configPath=null] - Custom config path
   * @public
   */
  constructor(indicator = null, configPath = null) {
    this.indicator = indicator;
    this.configPath = configPath;
    /** @type {Map<string, StreamDeckProfile>} */
    this.profiles = new Map();
    this.activeProfileName = 'Default';
    this._renderCache = new Map();
    this._executionListeners = [];
    this._stats = {
      totalRenders: 0,
      cacheHits: 0,
      keyPresses: 0,
      avgRenderTimeMs: 0.0,
      avgPressLatencyMs: 0.0,
    };
  }

  /**
   * Adds execution listener callback.
   * @param {Function} listener
   * @public
   */
  addExecutionListener(listener) {
    if (typeof listener === 'function' && !this._executionListeners.includes(listener)) {
      this._executionListeners.push(listener);
    }
  }

  /**
   * Loads profiles from system config.
   * @public
   */
  async loadProfiles() {
    const config = await loadConfig(this.configPath);
    const sdConfig = config.stream_deck ?? config.streamDeck ?? {};
    this.activeProfileName = sdConfig.active_profile ?? sdConfig.activeProfile ?? 'Default';

    const rawProfiles = sdConfig.profiles ?? {};
    this.profiles.clear();

    if (typeof rawProfiles === 'object' && Object.keys(rawProfiles).length > 0) {
      for (const [pName, pData] of Object.entries(rawProfiles)) {
        this.profiles.set(pName, StreamDeckProfile.fromJSON(pData));
      }
    }

    if (!this.profiles.has('Default')) {
      const defaultProf = new StreamDeckProfile('Default', DeviceModel.ORIGINAL);
      // Populate with existing commands from config
      const categories = config.categories ?? [];
      let keyIdx = 0;
      const maxKeys = defaultProf.getMaxKeys();
      for (const cat of categories) {
        for (const cmd of cat.commands ?? []) {
          if (keyIdx >= maxKeys) break;
          const key = new StreamDeckKey({
            keyIndex: keyIdx,
            commandName: cmd.name ?? `Command ${keyIdx + 1}`,
            labelTemplate: '{name}',
            bgColor: '#1A202C',
          });
          defaultProf.setKey(key);
          keyIdx++;
        }
        if (keyIdx >= maxKeys) break;
      }
      this.profiles.set('Default', defaultProf);
    }

    if (!this.profiles.has(this.activeProfileName)) {
      this.activeProfileName = this.profiles.keys().next().value;
    }
  }

  /**
   * Saves profiles back to config.
   * @public
   */
  async saveProfiles() {
    const config = await loadConfig(this.configPath);
    const profilesObj = {};
    for (const [pName, prof] of this.profiles.entries()) {
      profilesObj[pName] = prof.toJSON();
    }

    config.stream_deck = {
      active_profile: this.activeProfileName,
      profiles: profilesObj,
    };

    return await saveConfig(config, this.configPath);
  }

  /**
   * Creates a new profile.
   * @param {string} name
   * @param {string} [deviceModel='ORIGINAL']
   * @param {string|null} [autoSwitchCategory=null]
   * @public
   */
  async createProfile(name, deviceModel = DeviceModel.ORIGINAL, autoSwitchCategory = null) {
    const cleanName = String(name).trim();
    if (!cleanName) {
      throw new Error('Profile name cannot be empty.');
    }
    const profile = new StreamDeckProfile(cleanName, deviceModel, '#0D1117', autoSwitchCategory);
    this.profiles.set(cleanName, profile);
    await this.saveProfiles();
    return profile;
  }

  /**
   * Deletes a profile by name.
   * @param {string} name
   * @public
   */
  async deleteProfile(name) {
    const cleanName = String(name).trim();
    if (!this.profiles.has(cleanName)) return false;
    if (this.profiles.size <= 1) return false;

    this.profiles.delete(cleanName);
    if (this.activeProfileName === cleanName) {
      this.activeProfileName = this.profiles.keys().next().value;
    }
    await this.saveProfiles();
    return true;
  }

  /**
   * Returns profile by name.
   * @param {string} name
   * @public
   */
  getProfile(name) {
    return this.profiles.get(String(name).trim());
  }

  /**
   * Lists available profile names.
   * @public
   */
  listProfiles() {
    return Array.from(this.profiles.keys());
  }

  /**
   * Switches active profile.
   * @param {string} name
   * @public
   */
  async setActiveProfile(name) {
    const cleanName = String(name).trim();
    if (this.profiles.has(cleanName)) {
      this.activeProfileName = cleanName;
      this.clearRenderCache();
      await this.saveProfiles();
      return true;
    }
    return false;
  }

  /**
   * Returns current active profile.
   * @public
   */
  getActiveProfile() {
    return this.profiles.get(this.activeProfileName);
  }

  /**
   * Binds key options.
   * @param {number} keyIndex
   * @param {string} commandName
   * @param {Object} [options={}]
   * @public
   */
  async setKeyBinding(keyIndex, commandName, options = {}) {
    const pName = options.profileName ?? this.activeProfileName;
    const profile = this.getProfile(pName);
    if (!profile) {
      throw new Error(`Profile '${pName}' not found.`);
    }

    const key = new StreamDeckKey({
      keyIndex,
      commandName,
      labelTemplate: options.labelTemplate ?? '{name}',
      customLabel: options.customLabel ?? '',
      icon: options.icon ?? 'utilities-terminal-symbolic',
      bgColor: options.bgColor ?? '#1A202C',
      actionType: options.actionType ?? 'command',
      targetProfile: options.targetProfile ?? '',
      parameters: options.parameters ?? {},
    });

    profile.setKey(key);
    this.clearRenderCache();
    await this.saveProfiles();
    return key;
  }

  /**
   * Clears key binding.
   * @param {number} keyIndex
   * @param {string} [profileName=null]
   * @public
   */
  async clearKeyBinding(keyIndex, profileName = null) {
    const pName = profileName ?? this.activeProfileName;
    const profile = this.getProfile(pName);
    if (!profile) return false;
    const res = profile.removeKey(keyIndex);
    if (res) {
      this.clearRenderCache();
      await this.saveProfiles();
    }
    return res;
  }

  /**
   * Auto-switches profile for category.
   * @param {string} categoryName
   * @public
   */
  async autoSwitchForCategory(categoryName) {
    if (!categoryName) return null;
    const catLower = String(categoryName).trim().toLowerCase();
    for (const [pName, profile] of this.profiles.entries()) {
      if (profile.autoSwitchCategory && profile.autoSwitchCategory.trim().toLowerCase() === catLower) {
        if (await this.setActiveProfile(pName)) {
          return pName;
        }
      }
    }
    return null;
  }

  /**
   * Updates key LED state.
   * @param {number} keyIndex
   * @param {string} state
   * @param {string|null} [lastOutput=null]
   * @param {string|null} [profileName=null]
   * @public
   */
  updateKeyLEDState(keyIndex, state, lastOutput = null, profileName = null) {
    const pName = profileName ?? this.activeProfileName;
    const profile = this.getProfile(pName);
    if (profile) {
      const key = profile.getKey(keyIndex);
      if (key) {
        key.ledState = state;
        if (lastOutput !== null) {
          key.lastOutput = String(lastOutput);
        }
        this.clearRenderCache(keyIndex);
      }
    }
  }

  /**
   * Resolves dynamic label string.
   * @param {StreamDeckKey} key
   * @param {Object} [context={}]
   * @public
   */
  resolveDynamicLabel(key, context = {}) {
    const tmpl = key.customLabel ? key.customLabel : (key.labelTemplate || '{name}');
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const ctx = {
      name: key.commandName || 'Unbound',
      status: key.ledState,
      time: timeStr,
      last_output: key.lastOutput ? key.lastOutput.slice(0, 20) : '',
      execution_time: key.executionTimeMs ? `${Math.round(key.executionTimeMs)}ms` : '',
      ...key.parameters,
      ...context,
    };

    const resolved = tmpl.replace(/\{([^}]+)\}/g, (match, varName) => {
      const v = varName.trim();
      return ctx[v] !== undefined ? String(ctx[v]) : match;
    });

    const lines = resolved.split('\n');
    const truncatedLines = lines.slice(0, 3).map((l) => l.slice(0, 16));
    return truncatedLines.join('\n');
  }

  /**
   * Renders visual key presentation with SVG/data URL, LED indicator, and label.
   * @param {number} keyIndex
   * @param {Object} [context={}]
   * @public
   */
  renderKeyVisual(keyIndex, context = {}) {
    const startT = performance.now();
    const profile = this.getActiveProfile();
    const key = profile ? profile.getKey(keyIndex) : null;

    const cacheKey = `${profile ? profile.name : 'empty'}:${keyIndex}:${JSON.stringify(key)}:${JSON.stringify(context)}`;

    if (this._renderCache.has(cacheKey)) {
      this._stats.cacheHits++;
      return this._renderCache.get(cacheKey);
    }

    let label = '';
    let bgColor = profile ? profile.bgColor : '#0D1117';
    let ledState = LEDState.IDLE;
    let ledColor = LEDState.COLOR_MAP.idle;
    let icon = '';
    let actionType = 'none';

    if (key) {
      label = this.resolveDynamicLabel(key, context);
      bgColor = key.bgColor;
      ledState = key.ledState;
      ledColor = LEDState.COLOR_MAP[ledState] ?? LEDState.COLOR_MAP.idle;
      icon = key.icon;
      actionType = key.actionType;
    }

    const svg = this._generateKeySVG(label, bgColor, ledColor, ledState, icon);
    const svgBase64 = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');

    const result = {
      keyIndex,
      label,
      bgColor,
      ledState,
      ledColor,
      ledSymbol: LEDState.SYMBOL_MAP[ledState] ?? '⚪',
      actionType,
      svg,
      svgBase64,
    };

    this._renderCache.set(cacheKey, result);
    const elapsedMs = performance.now() - startT;
    this._stats.totalRenders++;
    const n = this._stats.totalRenders;
    this._stats.avgRenderTimeMs = ((n - 1) * this._stats.avgRenderTimeMs + elapsedMs) / n;

    return result;
  }

  /**
   * Helper method generating vector SVG layout.
   * @private
   */
  _generateKeySVG(label, bgColor, ledColor, ledState, icon) {
    const lines = label ? label.split('\n') : [];
    const yStart = lines.length <= 1 ? 42 : (lines.length === 2 ? 36 : 28);
    const textMarkup = lines
      .map(
        (line, idx) =>
          `<text x="36" y="${yStart + idx * 16}" font-family="sans-serif" font-size="11" font-weight="bold" fill="#FFFFFF" text-anchor="middle">${this._escapeXML(line)}</text>`
      )
      .join('\n');

    const pulseAnim =
      ledState === LEDState.RUNNING
        ? '<animate attributeName="opacity" values="0.4;1.0;0.4" dur="1s" repeatCount="indefinite" />'
        : '';

    return `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72">
  <rect width="72" height="72" rx="10" ry="10" fill="${bgColor}" stroke="#2D3748" stroke-width="2"/>
  <circle cx="60" cy="12" r="5" fill="${ledColor}">${pulseAnim}</circle>
  ${textMarkup}
</svg>`;
  }

  /**
   * Escapes XML characters.
   * @private
   */
  _escapeXML(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Renders active profile grid.
   * @param {Object} [context={}]
   * @public
   */
  renderProfileGrid(context = {}) {
    const profile = this.getActiveProfile();
    const maxKeys = profile ? profile.getMaxKeys() : 15;
    const grid = [];
    for (let i = 0; i < maxKeys; i++) {
      grid.push(this.renderKeyVisual(i, context));
    }
    return grid;
  }

  /**
   * Triggers key press event.
   * @param {number} keyIndex
   * @param {Object} [contextParams={}]
   * @public
   */
  async pressKey(keyIndex, contextParams = {}) {
    const startT = performance.now();
    const profile = this.getActiveProfile();
    const key = profile ? profile.getKey(keyIndex) : null;

    if (!key) {
      return {
        success: false,
        keyIndex,
        error: 'No binding assigned to key index.',
      };
    }

    this._stats.keyPresses++;

    if (key.actionType === 'switch_profile') {
      const target = key.targetProfile;
      const switched = await this.setActiveProfile(target);
      const elapsedMs = performance.now() - startT;
      return {
        success: switched,
        keyIndex,
        actionType: 'switch_profile',
        targetProfile: target,
        executionTimeMs: elapsedMs,
      };
    }

    // Set LED to RUNNING
    this.updateKeyLEDState(keyIndex, LEDState.RUNNING);

    const subStart = performance.now();
    let success = false;
    let code = 0;
    let stdout = '';
    let stderr = '';

    if (this.indicator && typeof this.indicator.executeCommand === 'function') {
      try {
        await this.indicator.executeCommand(key.commandName, null, contextParams, { name: key.commandName });
        success = true;
        stdout = `Executed ${key.commandName}`;
      } catch (err) {
        success = false;
        stderr = err.message || String(err);
        code = 1;
      }
    } else {
      // Standalone/Mock execution
      success = true;
      stdout = `Executed ${key.commandName}`;
    }

    const execMs = performance.now() - subStart;
    const output = success ? stdout.trim() : stderr.trim();

    key.lastOutput = output;
    key.lastExecuted = Date.now();
    key.executionTimeMs = execMs;

    const ledSt = success ? LEDState.SUCCESS : LEDState.ERROR;
    this.updateKeyLEDState(keyIndex, ledSt, output);

    const resultMeta = {
      success,
      keyIndex,
      commandName: key.commandName,
      code,
      stdout,
      stderr,
      executionTimeMs: execMs,
    };

    for (const listener of this._executionListeners) {
      try {
        listener(keyIndex, key.commandName, resultMeta);
      } catch (_) {}
    }

    const totalLatencyMs = performance.now() - startT;
    const n = this._stats.keyPresses;
    this._stats.avgPressLatencyMs = ((n - 1) * this._stats.avgPressLatencyMs + totalLatencyMs) / n;
    resultMeta.totalLatencyMs = totalLatencyMs;

    return resultMeta;
  }

  /**
   * Clears render cache.
   * @param {number|null} [keyIndex=null]
   * @public
   */
  clearRenderCache(keyIndex = null) {
    if (keyIndex === null) {
      this._renderCache.clear();
    } else {
      for (const k of this._renderCache.keys()) {
        if (k.includes(`:${keyIndex}:`)) {
          this._renderCache.delete(k);
        }
      }
    }
  }

  /**
   * Exports profile to JSON string.
   * @param {string} profileName
   * @public
   */
  exportProfileJson(profileName) {
    const profile = this.getProfile(profileName);
    if (!profile) {
      throw new Error(`Profile '${profileName}' not found.`);
    }
    return JSON.stringify(profile.toJSON(), null, 2);
  }

  /**
   * Imports profile from JSON string.
   * @param {string} jsonStr
   * @public
   */
  async importProfileJson(jsonStr) {
    const data = JSON.parse(jsonStr);
    const profile = StreamDeckProfile.fromJSON(data);
    this.profiles.set(profile.name, profile);
    await this.saveProfiles();
    return profile;
  }

  /**
   * Returns performance stats.
   * @public
   */
  getPerformanceStats() {
    return {
      activeProfile: this.activeProfileName,
      totalProfiles: this.profiles.size,
      cachedRendersCount: this._renderCache.size,
      totalRenders: this._stats.totalRenders,
      cacheHits: this._stats.cacheHits,
      keyPresses: this._stats.keyPresses,
      avgRenderTimeMs: Number(this._stats.avgRenderTimeMs.toFixed(4)),
      avgPressLatencyMs: Number(this._stats.avgPressLatencyMs.toFixed(4)),
    };
  }
}
