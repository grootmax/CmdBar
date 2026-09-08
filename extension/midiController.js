/**
 * MIDI Controller Manager for CmdBar Extension
 * Provides full MIDI hardware controller support: button mappings, LED feedback,
 * value sliders/knobs, performance mode, and DJ/producer workflows.
 */

/**
 * Parses raw MIDI byte array or Uint8Array into a structured MIDI event object.
 * @param {Array<number>|Uint8Array} bytes Raw MIDI bytes (2 or 3 bytes)
 * @returns {Object} Structured MIDI event object
 */
export function parseRawMidiBytes(bytes) {
  if (!bytes || !bytes.length || bytes.length < 2) {
    return {
      type: 'unknown',
      channel: 0,
      status: 0,
      note: null,
      velocity: null,
      cc: null,
      value: null,
      program: null,
      raw: Array.from(bytes || []),
      timestamp: Date.now(),
    };
  }

  const raw = Array.from(bytes);
  const status = raw[0];
  const commandNibble = status & 0xF0;
  const channel = status & 0x0F;
  const data1 = raw[1] !== undefined ? raw[1] : 0;
  const data2 = raw[2] !== undefined ? raw[2] : 0;

  let type = 'unknown';
  let note = null;
  let velocity = null;
  let cc = null;
  let value = null;
  let program = null;

  if (commandNibble === 0x90) {
    // Note On (or Note Off if velocity is 0)
    note = data1;
    velocity = data2;
    if (velocity === 0) {
      type = 'note_off';
    } else {
      type = 'note_on';
    }
  } else if (commandNibble === 0x80) {
    // Note Off
    type = 'note_off';
    note = data1;
    velocity = data2;
  } else if (commandNibble === 0xB0) {
    // Control Change (CC)
    type = 'cc';
    cc = data1;
    value = data2;
  } else if (commandNibble === 0xC0) {
    // Program Change
    type = 'program_change';
    program = data1;
  } else if (commandNibble === 0xE0) {
    // Pitch Bend (14-bit)
    type = 'pitch_bend';
    value = (data2 << 7) | data1;
  }

  return {
    status,
    channel,
    type,
    note,
    velocity,
    cc,
    value,
    program,
    raw,
    timestamp: Date.now(),
  };
}

/**
 * Scales a 7-bit (0-127) or 14-bit (0-16383) MIDI controller value to a target numeric range.
 * Supports linear, exponential, and logarithmic response curves as well as relative encoder modes.
 *
 * @param {number} value Raw MIDI value (0-127 or 0-16383)
 * @param {number} [min=0] Minimum output value
 * @param {number} [max=100] Maximum output value
 * @param {string} [curve='linear'] Curve type: 'linear', 'exponential', 'logarithmic'
 * @param {string} [encoderMode='absolute'] Mode: 'absolute' or 'relative'
 * @param {number} [lastValue=0] Previous scaled output value (used in relative mode)
 * @returns {number} Scaled numerical output
 */
export function scaleValue(value, min = 0, max = 100, curve = 'linear', encoderMode = 'absolute', lastValue = 0) {
  const minVal = Number(min);
  const maxVal = Number(max);

  if (encoderMode === 'relative') {
    // Relative encoder increment/decrement logic
    // 1-63 = positive increment, 65-127 = negative decrement (or 63 / 127 offset)
    let delta = 0;
    if (value > 0 && value < 64) {
      delta = value;
    } else if (value >= 64) {
      delta = value - 128;
    }
    const stepSize = (maxVal - minVal) / 100 || 1;
    let newValue = lastValue + delta * stepSize;
    return Math.min(maxVal, Math.max(minVal, Math.round(newValue * 100) / 100));
  }

  // Absolute scaling
  const maxMidiVal = value > 127 ? 16383 : 127;
  let normalized = Math.min(1.0, Math.max(0.0, value / maxMidiVal));

  if (curve === 'exponential') {
    normalized = Math.pow(normalized, 2);
  } else if (curve === 'logarithmic') {
    normalized = Math.sqrt(normalized);
  }

  const scaled = minVal + normalized * (maxVal - minVal);
  return Math.round(scaled * 100) / 100;
}

/**
 * Built-in MIDI hardware presets and control surface profiles.
 */
export const HARDWARE_PROFILES = {
  launchpad: {
    name: 'Novation Launchpad',
    type: 'pad_matrix',
    banks: ['Bank 1', 'Bank 2', 'Bank 3', 'Bank 4'],
    pads: { note_start: 0, note_end: 63 },
    scene_buttons: { cc_start: 104, cc_end: 111 },
    led_colors: { off: 0, green: 60, amber: 62, red: 15, bright_green: 127 },
  },
  lpd8: {
    name: 'Akai LPD8',
    type: 'pads_and_knobs',
    banks: ['Bank A', 'Bank B', 'Bank C', 'Bank D'],
    pads: { note_start: 36, note_end: 43 },
    knobs: { cc_start: 1, cc_end: 8 },
    led_colors: { off: 0, on: 127, active: 64 },
  },
  nanokontrol2: {
    name: 'Korg nanoKONTROL2',
    type: 'faders_and_buttons',
    banks: ['Mixer', 'FX', 'Transport'],
    faders: { cc_start: 0, cc_end: 7 },
    knobs: { cc_start: 16, cc_end: 23 },
    solo_mute_rec: { cc_start: 32, cc_end: 55 },
    transport: { cc_start: 41, cc_end: 46 },
    led_colors: { off: 0, on: 127 },
  },
  ddj: {
    name: 'Pioneer DDJ',
    type: 'dj_controller',
    decks: ['Deck A', 'Deck B', 'Deck C', 'Deck D'],
    hot_cues: { note_start: 0, note_end: 7 },
    crossfader: { cc: 8 },
    volume_faders: { cc_start: 16, cc_end: 19 },
    eq_knobs: { cc_start: 20, cc_end: 31 },
    pitch_bend: { pitch_bend: true },
    led_colors: { off: 0, cue_blue: 40, play_green: 60, active_red: 127 },
  },
  generic: {
    name: 'Generic MIDI Controller',
    type: 'custom',
    banks: ['Default'],
    led_colors: { off: 0, on: 127 },
  },
};

/**
 * Returns preset specs for a named hardware profile.
 * @param {string} profileName
 * @returns {Object} Hardware profile
 */
export function getHardwareProfile(profileName) {
  const key = String(profileName || 'generic').toLowerCase();
  return HARDWARE_PROFILES[key] || HARDWARE_PROFILES.generic;
}

/**
 * Core MIDI Controller Manager class for CmdBar.
 */
export class MidiControllerManager {
  constructor(options = {}) {
    this.devices = new Map();
    this.mappings = [];
    this.activeBank = options.activeBank || 'Bank 1';
    this.activeDeck = options.activeDeck || 'Deck A';
    this.performanceMode = !!options.performanceMode;
    this.ledFeedbackEnabled = options.ledFeedbackEnabled !== false;

    this.outboundLedMessages = [];
    this.commandExecutor = options.commandExecutor || null;
    this.executedCommands = [];

    this.tapTimestamps = [];
    this.bpm = 120;

    this.faderThrottleTimers = new Map();
    this.faderLastValues = new Map();
    this.holdTimers = new Map();
    this.toggleStates = new Map();

    this.stats = {
      totalEvents: 0,
      totalLatencyMs: 0,
      maxLatencyMs: 0,
      commandsExecuted: 0,
    };
  }

  /**
   * Registers a connected MIDI hardware device.
   * @param {Object} deviceInfo Device information
   * @returns {Object} Registered device object
   */
  registerDevice(deviceInfo) {
    if (!deviceInfo || typeof deviceInfo !== 'object') {
      throw new Error('Invalid device info provided.');
    }
    const id = deviceInfo.id || `midi_device_${this.devices.size + 1}`;
    const profile = deviceInfo.profile ? getHardwareProfile(deviceInfo.profile) : getHardwareProfile('generic');

    const deviceObj = {
      id,
      name: deviceInfo.name || 'Generic MIDI Device',
      profile: deviceInfo.profile || 'generic',
      profileDetails: profile,
      connected: true,
      registeredAt: Date.now(),
    };

    this.devices.set(id, deviceObj);
    return deviceObj;
  }

  /**
   * Disconnects a MIDI device by ID.
   * @param {string} deviceId
   * @returns {boolean} Success status
   */
  disconnectDevice(deviceId) {
    if (this.devices.has(deviceId)) {
      const dev = this.devices.get(deviceId);
      dev.connected = false;
      return true;
    }
    return false;
  }

  /**
   * Returns list of all connected devices.
   * @returns {Array<Object>}
   */
  getConnectedDevices() {
    return Array.from(this.devices.values()).filter((d) => d.connected);
  }

  /**
   * Returns details for a specific device.
   * @param {string} deviceId
   * @returns {Object|null}
   */
  getDeviceDetails(deviceId) {
    return this.devices.get(deviceId) || null;
  }

  /**
   * Loads preset mappings for a given hardware profile.
   * @param {string} profileName
   * @param {Object} [options={}] Custom mapping overrides
   * @returns {Array<Object>} Loaded mappings
   */
  loadProfile(profileName, options = {}) {
    const profile = getHardwareProfile(profileName);
    const newMappings = [];

    if (profile.name === 'Akai LPD8') {
      // Create pad mappings 36-43
      for (let i = 0; i < 8; i++) {
        newMappings.push({
          id: `lpd8_pad_${i + 1}`,
          device_id: options.deviceId || '*',
          event_type: 'note_on',
          channel: '*',
          note: 36 + i,
          mode: 'trigger',
          command: options.commands ? options.commands[i] || `echo "LPD8 Pad ${i + 1} pressed velocity={velocity}"` : `echo "Pad ${i + 1}"`,
          bank: 'Bank A',
          led: { on_velocity: 127, off_velocity: 0 },
        });
      }
      // Create knob mappings CC 1-8
      for (let i = 0; i < 8; i++) {
        newMappings.push({
          id: `lpd8_knob_${i + 1}`,
          device_id: options.deviceId || '*',
          event_type: 'cc',
          channel: '*',
          cc: 1 + i,
          min_value: 0,
          max_value: 100,
          command: `echo "LPD8 Knob ${i + 1} set to {value}"`,
          bank: 'Bank A',
          throttle_ms: 10,
        });
      }
    } else if (profile.name === 'Pioneer DDJ') {
      // Create DJ Deck mappings
      ['Deck A', 'Deck B'].forEach((deck) => {
        for (let i = 0; i < 4; i++) {
          newMappings.push({
            id: `ddj_${deck.replace(' ', '_')}_cue_${i + 1}`,
            device_id: options.deviceId || '*',
            event_type: 'note_on',
            channel: deck === 'Deck A' ? 0 : 1,
            note: i,
            deck: deck,
            mode: 'trigger',
            command: `echo "Hot Cue ${i + 1} on ${deck}"`,
            led: { on_velocity: 40, active_velocity: 127 },
          });
        }
      });
      // Crossfader
      newMappings.push({
        id: 'ddj_crossfader',
        device_id: options.deviceId || '*',
        event_type: 'cc',
        cc: 8,
        action: 'crossfader',
        min_value: 0,
        max_value: 100,
        command: 'echo "Crossfader level: {value}"',
      });
    } else {
      // Default Generic mapping
      newMappings.push({
        id: 'generic_btn_1',
        device_id: '*',
        event_type: 'note_on',
        channel: '*',
        note: 60,
        mode: 'trigger',
        command: 'echo "Generic Note 60 trigger"',
        bank: 'Bank 1',
      });
    }

    newMappings.forEach((m) => this.addMapping(m));
    return newMappings;
  }

  /**
   * Adds or updates a MIDI mapping definition.
   * @param {Object} mapping
   * @returns {Object} Sanitized mapping object
   */
  addMapping(mapping) {
    if (!mapping || typeof mapping !== 'object') {
      throw new Error('Mapping must be an object.');
    }

    const sanitized = {
      id: mapping.id || `map_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      device_id: mapping.device_id || '*',
      event_type: mapping.event_type || 'note_on', // 'note_on', 'note_off', 'cc', 'program_change', 'pitch_bend'
      channel: mapping.channel !== undefined ? mapping.channel : '*',
      note: mapping.note !== undefined ? mapping.note : '*',
      cc: mapping.cc !== undefined ? mapping.cc : '*',
      mode: mapping.mode || 'trigger', // 'trigger', 'toggle', 'momentary', 'hold'
      command: mapping.command || '',
      release_command: mapping.release_command || '',
      hold_command: mapping.hold_command || '',
      hold_delay_ms: Number(mapping.hold_delay_ms) || 500,
      min_value: mapping.min_value !== undefined ? Number(mapping.min_value) : 0,
      max_value: mapping.max_value !== undefined ? Number(mapping.max_value) : 100,
      curve: mapping.curve || 'linear',
      encoder_mode: mapping.encoder_mode || 'absolute',
      throttle_ms: mapping.throttle_ms !== undefined ? Number(mapping.throttle_ms) : 0,
      bank: mapping.bank || null,
      deck: mapping.deck || null,
      action: mapping.action || null, // built-in actions e.g. 'switch_bank', 'switch_deck', 'tap_tempo', 'crossfader'
      target_bank: mapping.target_bank || null,
      target_deck: mapping.target_deck || null,
      led: mapping.led || { on_velocity: 127, off_velocity: 0, active_velocity: 60 },
    };

    // Replace existing mapping with same ID if present
    const index = this.mappings.findIndex((m) => m.id === sanitized.id);
    if (index >= 0) {
      this.mappings[index] = sanitized;
    } else {
      this.mappings.push(sanitized);
    }

    return sanitized;
  }

  /**
   * Removes a mapping by ID.
   * @param {string} id
   * @returns {boolean} True if removed
   */
  removeMapping(id) {
    const initLen = this.mappings.length;
    this.mappings = this.mappings.filter((m) => m.id !== id);
    return this.mappings.length < initLen;
  }

  /**
   * Gets mappings filtered by bank, deck, event_type, device_id.
   * @param {Object} [filter={}]
   * @returns {Array<Object>}
   */
  getMappings(filter = {}) {
    return this.mappings.filter((m) => {
      if (filter.bank && m.bank && m.bank !== '*' && m.bank !== filter.bank) return false;
      if (filter.deck && m.deck && m.deck !== '*' && m.deck !== filter.deck) return false;
      if (filter.event_type && m.event_type !== filter.event_type) return false;
      if (filter.device_id && m.device_id !== '*' && m.device_id !== filter.device_id) return false;
      return true;
    });
  }

  /**
   * Clears all loaded mappings.
   */
  clearMappings() {
    this.mappings = [];
  }

  /**
   * Sets callback function for command execution.
   * @param {Function} executor
   */
  setCommandExecutor(executor) {
    this.commandExecutor = executor;
  }

  /**
   * Sets Performance Mode state.
   * @param {boolean} enabled
   */
  setPerformanceMode(enabled) {
    this.performanceMode = !!enabled;
  }

  /**
   * Returns current Performance Mode state.
   * @returns {boolean}
   */
  isPerformanceMode() {
    return this.performanceMode;
  }

  /**
   * Sets current active bank.
   * @param {string|number} bank
   */
  setActiveBank(bank) {
    this.activeBank = bank;
  }

  /**
   * Gets current active bank.
   * @returns {string|number}
   */
  getActiveBank() {
    return this.activeBank;
  }

  /**
   * Sets current active DJ Deck ('Deck A', 'Deck B', 'Deck C', 'Deck D').
   * @param {string} deck
   */
  setActiveDeck(deck) {
    this.activeDeck = deck;
  }

  /**
   * Gets current active DJ Deck.
   * @returns {string}
   */
  getActiveDeck() {
    return this.activeDeck;
  }

  /**
   * Switches active bank and updates state.
   * @param {string|number} bank
   * @returns {Array<Object>} Mappings active in new bank
   */
  switchBank(bank) {
    this.setActiveBank(bank);
    return this.getMappings({ bank: this.activeBank });
  }

  /**
   * Switches active DJ deck and updates state.
   * @param {string} deck
   * @returns {Array<Object>} Mappings active in new deck
   */
  switchDeck(deck) {
    this.setActiveDeck(deck);
    return this.getMappings({ deck: this.activeDeck });
  }

  /**
   * Calculates DJ crossfader volume/gain mix between Deck A and Deck B.
   * @param {number} ccValue CC value 0-127 (0 = 100% Deck A, 127 = 100% Deck B)
   * @param {string} [curve='linear'] Curve type: 'linear', 'scratch', 'constant_power'
   * @returns {Object} Gain ratios `{ deckA: number, deckB: number }`
   */
  crossfaderMix(ccValue, curve = 'linear') {
    const normalized = Math.min(1.0, Math.max(0.0, ccValue / 127));

    if (curve === 'scratch') {
      // Cut curve: fast transition at center
      const deckA = normalized > 0.9 ? 0 : 1;
      const deckB = normalized < 0.1 ? 0 : 1;
      return { deckA, deckB };
    } else if (curve === 'constant_power') {
      const angle = normalized * (Math.PI / 2);
      return {
        deckA: Math.round(Math.cos(angle) * 100) / 100,
        deckB: Math.round(Math.sin(angle) * 100) / 100,
      };
    }

    // Linear curve
    return {
      deckA: Math.round((1 - normalized) * 100) / 100,
      deckB: Math.round(normalized * 100) / 100,
    };
  }

  /**
   * Registers a tap tempo press and updates current calculated BPM.
   * @returns {Object} `{ bpm: number, intervalMs: number }`
   */
  tapTempo() {
    const now = Date.now();
    this.tapTimestamps.push(now);

    // Keep last 5 taps
    if (this.tapTimestamps.length > 5) {
      this.tapTimestamps.shift();
    }

    if (this.tapTimestamps.length >= 2) {
      let totalInterval = 0;
      for (let i = 1; i < this.tapTimestamps.length; i++) {
        totalInterval += this.tapTimestamps[i] - this.tapTimestamps[i - 1];
      }
      const avgInterval = totalInterval / (this.tapTimestamps.length - 1);
      if (avgInterval > 0) {
        this.bpm = Math.round((60000 / avgInterval) * 10) / 10;
        return { bpm: this.bpm, intervalMs: avgInterval };
      }
    }

    return { bpm: this.bpm, intervalMs: 0 };
  }

  /**
   * Sends LED feedback to the MIDI device.
   * @param {string} deviceId Target device ID
   * @param {Object} mapping Mapping object
   * @param {string} state State: 'off', 'on', 'active', 'success', 'error', 'toggled'
   * @returns {Array<number>} Raw outgoing LED bytes sent
   */
  sendLedFeedback(deviceId, mapping, state) {
    if (!this.ledFeedbackEnabled) return null;

    const channel = (mapping.channel !== '*' && typeof mapping.channel === 'number') ? mapping.channel : 0;
    const noteOrCc = mapping.note !== '*' && mapping.note !== null ? mapping.note : (mapping.cc !== '*' ? mapping.cc : 0);
    const ledConfig = mapping.led || {};

    let velocity = 0;
    if (state === 'on' || state === 'success') {
      velocity = ledConfig.on_velocity !== undefined ? ledConfig.on_velocity : 127;
    } else if (state === 'active' || state === 'running') {
      velocity = ledConfig.active_velocity !== undefined ? ledConfig.active_velocity : 60;
    } else if (state === 'error') {
      velocity = ledConfig.error_velocity !== undefined ? ledConfig.error_velocity : 15;
    } else if (state === 'toggled') {
      velocity = ledConfig.toggled_velocity !== undefined ? ledConfig.toggled_velocity : 127;
    } else {
      velocity = ledConfig.off_velocity !== undefined ? ledConfig.off_velocity : 0;
    }

    const statusByte = (mapping.event_type === 'cc' ? 0xB0 : 0x90) | channel;
    const bytes = [statusByte, noteOrCc, velocity];

    this.outboundLedMessages.push({
      deviceId,
      mappingId: mapping.id,
      state,
      bytes,
      timestamp: Date.now(),
    });

    return bytes;
  }

  /**
   * Processes an incoming MIDI event or raw byte array.
   * Matches event to configured mappings, evaluates button modes / slider values,
   * performs parameter substitution, executes commands, and updates LED state.
   *
   * @param {Object|Array<number>|Uint8Array} eventOrBytes MIDI event or raw bytes
   * @param {string} [deviceId='default'] Source device ID
   * @returns {Promise<Object>} Execution result object
   */
  async processMidiEvent(eventOrBytes, deviceId = 'default') {
    const startTime = Date.now();

    const event = Array.isArray(eventOrBytes) || eventOrBytes instanceof Uint8Array
      ? parseRawMidiBytes(eventOrBytes)
      : eventOrBytes;

    this.stats.totalEvents++;

    // Find matching mappings
    const matchingMappings = this.mappings.filter((m) => {
      if (m.device_id !== '*' && m.device_id !== deviceId) return false;
      if (m.bank !== null && m.bank !== '*' && m.bank !== this.activeBank) return false;
      if (m.deck !== null && m.deck !== '*' && m.deck !== this.activeDeck) return false;
      const isNoteTypeMatch = (m.event_type === 'note_on' || m.event_type === 'note_off') && (event.type === 'note_on' || event.type === 'note_off');
      if (m.event_type !== event.type && !isNoteTypeMatch) return false;
      if (m.channel !== '*' && m.channel !== event.channel) return false;
      if (event.type === 'note_on' || event.type === 'note_off') {
        if (m.note !== '*' && m.note !== event.note) return false;
      }
      if (event.type === 'cc') {
        if (m.cc !== '*' && m.cc !== event.cc) return false;
      }
      if (event.type === 'program_change') {
        if (m.program !== undefined && m.program !== '*' && m.program !== event.program) return false;
      }
      return true;
    });

    if (matchingMappings.length === 0) {
      const elapsed = Date.now() - startTime;
      this._recordLatency(elapsed);
      return { executed: false, command: null, result: null, latencyMs: elapsed };
    }

    let lastResult = null;
    let executedCommandStr = null;
    let scaledVal = event.value;

    for (const mapping of matchingMappings) {
      let cmdToRun = null;

      // Handle Built-in Actions
      if (mapping.action === 'switch_bank') {
        const newBank = mapping.target_bank || (this.activeBank === 'Bank 1' ? 'Bank 2' : 'Bank 1');
        this.switchBank(newBank);
        this.sendLedFeedback(deviceId, mapping, 'on');
        cmdToRun = `echo "Switched bank to ${newBank}"`;
      } else if (mapping.action === 'switch_deck') {
        const newDeck = mapping.target_deck || (this.activeDeck === 'Deck A' ? 'Deck B' : 'Deck A');
        this.switchDeck(newDeck);
        this.sendLedFeedback(deviceId, mapping, 'on');
        cmdToRun = `echo "Switched deck to ${newDeck}"`;
      } else if (mapping.action === 'tap_tempo') {
        const tapResult = this.tapTempo();
        cmdToRun = `echo "Tap Tempo BPM set to ${tapResult.bpm}"`;
      } else if (mapping.action === 'crossfader' || event.type === 'cc' || event.type === 'pitch_bend') {
        // Value Sliders / Knobs
        const lastVal = this.faderLastValues.get(mapping.id) || 0;
        scaledVal = scaleValue(
          event.value !== null ? event.value : event.velocity,
          mapping.min_value,
          mapping.max_value,
          mapping.curve,
          mapping.encoder_mode,
          lastVal
        );
        this.faderLastValues.set(mapping.id, scaledVal);

        // Check throttle
        if (mapping.throttle_ms > 0) {
          const lastTime = this.faderThrottleTimers.get(mapping.id) || 0;
          if (startTime - lastTime < mapping.throttle_ms) {
            continue; // Skip execution due to throttle
          }
          this.faderThrottleTimers.set(mapping.id, startTime);
        }

        cmdToRun = mapping.command;
      } else if (mapping.mode === 'toggle') {
        // Toggle mode
        if (event.type === 'note_on' || (event.type === 'cc' && event.value > 0)) {
          const currentState = !!this.toggleStates.get(mapping.id);
          const newState = !currentState;
          this.toggleStates.set(mapping.id, newState);

          this.sendLedFeedback(deviceId, mapping, newState ? 'toggled' : 'off');
          cmdToRun = newState ? mapping.command : (mapping.release_command || mapping.command);
        }
      } else if (mapping.mode === 'momentary') {
        if (event.type === 'note_on' || (event.type === 'cc' && event.value > 0)) {
          cmdToRun = mapping.command;
          this.sendLedFeedback(deviceId, mapping, 'on');
        } else if (event.type === 'note_off' || (event.type === 'cc' && event.value === 0)) {
          cmdToRun = mapping.release_command;
          this.sendLedFeedback(deviceId, mapping, 'off');
        }
      } else if (mapping.mode === 'hold') {
        if (event.type === 'note_on' || (event.type === 'cc' && event.value > 0)) {
          // Schedule hold timer
          const timer = setTimeout(() => {
            if (mapping.hold_command && this.commandExecutor) {
              this.commandExecutor(mapping.hold_command, { mode: 'hold', mapping });
            }
          }, mapping.hold_delay_ms);
          this.holdTimers.set(mapping.id, timer);
          cmdToRun = mapping.command;
        } else if (event.type === 'note_off' || (event.type === 'cc' && event.value === 0)) {
          const timer = this.holdTimers.get(mapping.id);
          if (timer) {
            clearTimeout(timer);
            this.holdTimers.delete(mapping.id);
          }
        }
      } else {
        // Default trigger mode
        if (event.type === 'note_on' || (event.type === 'cc' && event.value > 0)) {
          cmdToRun = mapping.command;
          this.sendLedFeedback(deviceId, mapping, 'active');
        }
      }

      if (cmdToRun) {
        // Substitute parameter placeholders
        const normalizedVal = event.value !== null ? event.value / 127 : (event.velocity !== null ? event.velocity / 127 : 0);
        const percentVal = Math.round(normalizedVal * 100);
        const effectiveVel = event.velocity !== null && event.velocity !== undefined ? event.velocity : (event.value !== null ? event.value : 0);

        cmdToRun = cmdToRun
          .replace(/\{value\}/g, String(scaledVal))
          .replace(/\{velocity\}/g, String(effectiveVel))
          .replace(/\{cc\}/g, String(event.cc !== null ? event.cc : 0))
          .replace(/\{note\}/g, String(event.note !== null ? event.note : 0))
          .replace(/\{channel\}/g, String(event.channel))
          .replace(/\{percent\}/g, String(percentVal))
          .replace(/\{normalized\}/g, String(Math.round(normalizedVal * 100) / 100))
          .replace(/\{bpm\}/g, String(this.bpm))
          .replace(/\{bank\}/g, String(this.activeBank))
          .replace(/\{deck\}/g, String(this.activeDeck));

        executedCommandStr = cmdToRun;

        // Execute Command
        this.sendLedFeedback(deviceId, mapping, 'active');

        try {
          if (this.commandExecutor) {
            lastResult = await this.commandExecutor(cmdToRun, {
              performanceMode: this.performanceMode,
              mapping,
              event,
            });
          } else {
            lastResult = { status: 'mock_executed', command: cmdToRun };
          }
          this.sendLedFeedback(deviceId, mapping, 'success');
          this.stats.commandsExecuted++;
        } catch (err) {
          this.sendLedFeedback(deviceId, mapping, 'error');
          throw err;
        }

        this.executedCommands.push({
          command: cmdToRun,
          timestamp: Date.now(),
          mode: mapping.mode,
          deviceId,
        });
      }
    }

    const elapsedMs = Date.now() - startTime;
    this._recordLatency(elapsedMs);

    return {
      executed: !!executedCommandStr,
      command: executedCommandStr,
      value: scaledVal,
      result: lastResult,
      latencyMs: elapsedMs,
    };
  }

  /**
   * Helper to track processing latency metrics.
   * @private
   */
  _recordLatency(latencyMs) {
    this.stats.totalLatencyMs += latencyMs;
    if (latencyMs > this.stats.maxLatencyMs) {
      this.stats.maxLatencyMs = latencyMs;
    }
  }

  /**
   * Returns performance metrics and event statistics.
   * @returns {Object}
   */
  getPerformanceStats() {
    const avgLatency = this.stats.totalEvents > 0
      ? this.stats.totalLatencyMs / this.stats.totalEvents
      : 0;

    return {
      totalEvents: this.stats.totalEvents,
      averageLatencyMs: Math.round(avgLatency * 100) / 100,
      maxLatencyMs: this.stats.maxLatencyMs,
      commandsExecuted: this.stats.commandsExecuted,
      performanceMode: this.performanceMode,
    };
  }

  /**
   * Runs a latency benchmark processing simulated MIDI events to verify performance.
   * @param {number} [iterations=1000]
   * @returns {Object} Benchmark summary
   */
  runLatencyBenchmark(iterations = 1000) {
    const startTime = performance ? performance.now() : Date.now();

    for (let i = 0; i < iterations; i++) {
      const note = 36 + (i % 8);
      const vel = (i % 2 === 0) ? 100 : 0;
      const rawBytes = [0x90, note, vel];
      parseRawMidiBytes(rawBytes);
      scaleValue(i % 128, 0, 100, 'linear', 'absolute');
    }

    const endTime = performance ? performance.now() : Date.now();
    const totalTimeMs = endTime - startTime;
    const avgLatencyMs = totalTimeMs / iterations;

    return {
      iterations,
      totalTimeMs: Math.round(totalTimeMs * 100) / 100,
      averageLatencyMs: Math.round(avgLatencyMs * 1000) / 1000,
      passed: avgLatencyMs < 5.0, // Criteria: < 5ms processing overhead
    };
  }

  /**
   * Exports full MIDI configuration state to JSON object.
   * @returns {Object}
   */
  exportConfig() {
    return {
      activeBank: this.activeBank,
      activeDeck: this.activeDeck,
      performanceMode: this.performanceMode,
      ledFeedbackEnabled: this.ledFeedbackEnabled,
      bpm: this.bpm,
      mappings: this.mappings,
    };
  }

  /**
   * Imports MIDI configuration from JSON object.
   * @param {Object} configData
   */
  importConfig(configData) {
    if (!configData || typeof configData !== 'object') return;
    if (configData.activeBank) this.setActiveBank(configData.activeBank);
    if (configData.activeDeck) this.setActiveDeck(configData.activeDeck);
    if (configData.performanceMode !== undefined) this.setPerformanceMode(configData.performanceMode);
    if (configData.ledFeedbackEnabled !== undefined) this.ledFeedbackEnabled = !!configData.ledFeedbackEnabled;
    if (configData.bpm) this.bpm = configData.bpm;
    if (Array.isArray(configData.mappings)) {
      this.clearMappings();
      configData.mappings.forEach((m) => this.addMapping(m));
    }
  }
}
