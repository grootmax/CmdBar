/**
 * MIDI Controller Support Module for CmdBar.
 * Supports Button Mappings, LED Feedback, Value Sliders, Performance Mode, and DJ/Producer Workflows.
 */

export class MidiControllerManager {
  constructor(config = {}) {
    this._config = this._normalizeConfig(config);
    this._states = new Map(); // mapping_id -> toggle boolean state
    this._sliderValues = new Map(); // mapping_id -> current scaled value
    this._lastThrottleTimes = new Map(); // mapping_id -> timestamp ms
    this._onExecuteCallback = null;
    this._onLedFeedbackCallback = null;
    this._onBankChangedCallback = null;
    this._onPerformanceModeChangedCallback = null;
  }

  _normalizeConfig(config) {
    const midi = (config && config.midi) || {};
    return {
      enabled: midi.enabled !== false,
      performance_mode: Boolean(midi.performance_mode),
      active_bank: midi.active_bank || "Bank A",
      throttle_ms: typeof midi.throttle_ms === "number" ? midi.throttle_ms : 50,
      led_feedback: midi.led_feedback !== false,
      mappings: Array.isArray(midi.mappings) ? midi.mappings : this.getDefaultMappings(),
    };
  }

  updateConfig(config) {
    const oldBank = this._config.active_bank;
    const oldPerf = this._config.performance_mode;
    this._config = this._normalizeConfig(config);

    if (oldBank !== this._config.active_bank && this._onBankChangedCallback) {
      this._onBankChangedCallback(this._config.active_bank);
    }
    if (oldPerf !== this._config.performance_mode && this._onPerformanceModeChangedCallback) {
      this._onPerformanceModeChangedCallback(this._config.performance_mode);
    }
  }

  setCallbacks({ onExecute, onLedFeedback, onBankChanged, onPerformanceModeChanged } = {}) {
    if (onExecute) this._onExecuteCallback = onExecute;
    if (onLedFeedback) this._onLedFeedbackCallback = onLedFeedback;
    if (onBankChanged) this._onBankChangedCallback = onBankChanged;
    if (onPerformanceModeChanged) this._onPerformanceModeChangedCallback = onPerformanceModeChanged;
  }

  getDefaultMappings() {
    return [
      {
        id: "dj_deck_a_play",
        name: "Deck A Play/Pause",
        bank: "Bank A",
        type: "note",
        channel: 1,
        number: 60,
        mode: "toggle",
        action: "execute_command",
        command: "playerctl play-pause",
        led_on_value: 127,
        led_off_value: 0,
      },
      {
        id: "dj_deck_a_cue",
        name: "Deck A Cue Point 1",
        bank: "Bank A",
        type: "note",
        channel: 1,
        number: 61,
        mode: "momentary",
        action: "execute_command",
        command: "echo Cue Deck A",
        release_command: "echo Release Cue Deck A",
        led_on_value: 127,
        led_off_value: 0,
      },
      {
        id: "dj_volume_fader",
        name: "Master Volume Slider",
        bank: "Bank A",
        type: "cc",
        channel: 1,
        number: 7,
        mode: "trigger",
        action: "parameter_slider",
        command: "amixer set Master <value>%",
        min_value: 0,
        max_value: 100,
        led_on_value: 127,
        led_off_value: 0,
      },
      {
        id: "switch_bank_b",
        name: "Switch to Bank B",
        bank: "Global",
        type: "note",
        channel: 1,
        number: 64,
        mode: "trigger",
        action: "switch_bank",
        target_bank: "Bank B",
        led_on_value: 127,
        led_off_value: 0,
      },
      {
        id: "toggle_performance_mode",
        name: "Toggle Performance Mode",
        bank: "Global",
        type: "note",
        channel: 1,
        number: 65,
        mode: "trigger",
        action: "toggle_performance_mode",
        led_on_value: 127,
        led_off_value: 0,
      },
    ];
  }

  parseRawBytes(bytes) {
    if (!bytes || !bytes.length || bytes.length < 2) return null;
    const status = bytes[0];
    const data1 = bytes[1];
    const data2 = bytes.length > 2 ? bytes[2] : 0;

    const channel = (status & 0x0f) + 1;
    const msgTypeNum = status & 0xf0;

    let type = "unknown";
    if (msgTypeNum === 0x90) {
      type = data2 > 0 ? "note_on" : "note_off";
    } else if (msgTypeNum === 0x80) {
      type = "note_off";
    } else if (msgTypeNum === 0xb0) {
      type = "cc";
    } else if (msgTypeNum === 0xc0) {
      type = "program_change";
    } else if (msgTypeNum === 0xe0) {
      type = "pitch_bend";
    }

    return { type, channel, number: data1, value: data2, raw: bytes };
  }

  findMatchingMappings(type, channel, number) {
    if (!this._config.enabled) return [];

    const normType = type === "note_on" || type === "note_off" ? "note" : type;

    return this._config.mappings.filter((m) => {
      // Check bank match ("Global" matches any bank)
      if (m.bank && m.bank !== "Global" && m.bank !== this._config.active_bank) {
        return false;
      }
      // Check type match
      if (m.type !== normType) return false;
      // Check channel match (if specified and not 0/null/any)
      if (m.channel && m.channel !== 0 && m.channel !== channel) return false;
      // Check number (note/cc number)
      if (typeof m.number === "number" && m.number !== number) return false;

      return true;
    });
  }

  scaleSliderValue(rawValue, minVal = 0, maxVal = 100) {
    const clampedRaw = Math.max(0, Math.min(127, rawValue));
    const normalized = clampedRaw / 127.0;
    const scaled = minVal + normalized * (maxVal - minVal);
    if (Number.isInteger(minVal) && Number.isInteger(maxVal) && Math.abs(maxVal - minVal) > 1) {
      return Math.round(scaled);
    }
    return Math.round(scaled * 100) / 100;
  }

  processMidiMessage(type, channel, number, value, customExecuteFn = null) {
    if (!this._config.enabled) {
      return { handled: false, reason: "MIDI disabled" };
    }

    const matches = this.findMatchingMappings(type, channel, number);
    if (!matches.length) {
      return { handled: false, reason: "No matching mapping" };
    }

    const now = Date.now();
    const effectiveThrottle = this._config.performance_mode
      ? Math.min(15, this._config.throttle_ms)
      : this._config.throttle_ms;

    const results = [];

    for (const mapping of matches) {
      const mappingId = mapping.id || `${mapping.type}_${mapping.channel}_${mapping.number}`;
      const isPress = type === "note_on" || (type === "cc" && value > 0);
      const isRelease = type === "note_off" || (type === "cc" && value === 0);

      // Throttling for CC continuous controls
      if (mapping.action === "parameter_slider" || mapping.type === "cc") {
        const lastTime = this._lastThrottleTimes.get(mappingId) || 0;
        if (now - lastTime < effectiveThrottle && value !== 0 && value !== 127) {
          continue;
        }
        this._lastThrottleTimes.set(mappingId, now);
      }

      let executedAction = null;
      let executedCommand = null;
      let ledFeedback = null;

      if (mapping.action === "parameter_slider") {
        const minVal = typeof mapping.min_value === "number" ? mapping.min_value : 0;
        const maxVal = typeof mapping.max_value === "number" ? mapping.max_value : 100;
        const scaledVal = this.scaleSliderValue(value, minVal, maxVal);
        this._sliderValues.set(mappingId, scaledVal);

        if (mapping.command) {
          executedCommand = mapping.command
            .replace(/<value>/g, String(scaledVal))
            .replace(/<slider_val>/g, String(scaledVal))
            .replace(/\{value\}/g, String(scaledVal))
            .replace(/\{val\}/g, String(scaledVal));
          executedAction = "parameter_slider";
          this._dispatchExecution(mapping.name || mappingId, executedCommand, { value: scaledVal }, customExecuteFn);
        }

        if (this._config.led_feedback) {
          ledFeedback = {
            type: mapping.type === "note" ? "note_on" : "cc",
            channel: mapping.channel || channel,
            number: mapping.number,
            value: value,
          };
          this._sendLedFeedback(ledFeedback);
        }
      } else if (mapping.action === "switch_bank") {
        if (isPress) {
          const targetBank = mapping.target_bank || "Bank A";
          this.switchBank(targetBank);
          executedAction = "switch_bank";
        }
      } else if (mapping.action === "toggle_performance_mode") {
        if (isPress) {
          this.setPerformanceMode(!this._config.performance_mode);
          executedAction = "toggle_performance_mode";
        }
      } else if (mapping.action === "toggle_state") {
        if (isPress) {
          const currentState = Boolean(this._states.get(mappingId));
          const newState = !currentState;
          this._states.set(mappingId, newState);

          if (newState && mapping.command) {
            executedCommand = mapping.command;
            this._dispatchExecution(mapping.name || mappingId, executedCommand, { state: true }, customExecuteFn);
          } else if (!newState && mapping.off_command) {
            executedCommand = mapping.off_command;
            this._dispatchExecution(mapping.name || mappingId, executedCommand, { state: false }, customExecuteFn);
          }

          executedAction = "toggle_state";
          if (this._config.led_feedback) {
            const ledVal = newState
              ? (mapping.led_on_value !== undefined ? mapping.led_on_value : 127)
              : (mapping.led_off_value !== undefined ? mapping.led_off_value : 0);
            ledFeedback = {
              type: mapping.type === "note" ? "note_on" : "cc",
              channel: mapping.channel || channel,
              number: mapping.number,
              value: ledVal,
            };
            this._sendLedFeedback(ledFeedback);
          }
        }
      } else {
        // Standard command execution
        const mode = mapping.mode || "trigger";

        if (mode === "momentary") {
          if (isPress && mapping.command) {
            executedCommand = mapping.command;
            executedAction = "momentary_press";
            this._dispatchExecution(mapping.name || mappingId, executedCommand, { event: "press" }, customExecuteFn);

            if (this._config.led_feedback) {
              ledFeedback = {
                type: mapping.type === "note" ? "note_on" : "cc",
                channel: mapping.channel || channel,
                number: mapping.number,
                value: mapping.led_on_value !== undefined ? mapping.led_on_value : 127,
              };
              this._sendLedFeedback(ledFeedback);
            }
          } else if (isRelease) {
            if (mapping.release_command) {
              executedCommand = mapping.release_command;
              executedAction = "momentary_release";
              this._dispatchExecution(mapping.name || mappingId, executedCommand, { event: "release" }, customExecuteFn);
            }
            if (this._config.led_feedback) {
              ledFeedback = {
                type: mapping.type === "note" ? "note_on" : "cc",
                channel: mapping.channel || channel,
                number: mapping.number,
                value: mapping.led_off_value !== undefined ? mapping.led_off_value : 0,
              };
              this._sendLedFeedback(ledFeedback);
            }
          }
        } else if (mode === "toggle") {
          if (isPress) {
            const currentState = Boolean(this._states.get(mappingId));
            const newState = !currentState;
            this._states.set(mappingId, newState);

            if (mapping.command) {
              executedCommand = mapping.command;
              executedAction = "toggle";
              this._dispatchExecution(mapping.name || mappingId, executedCommand, { state: newState }, customExecuteFn);
            }

            if (this._config.led_feedback) {
              const ledVal = newState
                ? (mapping.led_on_value !== undefined ? mapping.led_on_value : 127)
                : (mapping.led_off_value !== undefined ? mapping.led_off_value : 0);
              ledFeedback = {
                type: mapping.type === "note" ? "note_on" : "cc",
                channel: mapping.channel || channel,
                number: mapping.number,
                value: ledVal,
              };
              this._sendLedFeedback(ledFeedback);
            }
          }
        } else {
          // trigger mode
          if (isPress && mapping.command) {
            executedCommand = mapping.command;
            executedAction = "trigger";
            this._dispatchExecution(mapping.name || mappingId, executedCommand, {}, customExecuteFn);

            if (this._config.led_feedback) {
              ledFeedback = {
                type: mapping.type === "note" ? "note_on" : "cc",
                channel: mapping.channel || channel,
                number: mapping.number,
                value: mapping.led_on_value !== undefined ? mapping.led_on_value : 127,
              };
              this._sendLedFeedback(ledFeedback);
            }
          }
        }
      }

      results.push({
        mapping_id: mappingId,
        mapping_name: mapping.name,
        action: executedAction,
        command: executedCommand,
        led_feedback: ledFeedback,
      });
    }

    return {
      handled: true,
      bank: this._config.active_bank,
      performance_mode: this._config.performance_mode,
      results,
    };
  }

  _dispatchExecution(name, commandStr, metadata, customExecuteFn) {
    if (customExecuteFn && typeof customExecuteFn === "function") {
      customExecuteFn(name, commandStr, metadata);
    } else if (this._onExecuteCallback) {
      this._onExecuteCallback(name, commandStr, metadata);
    }
  }

  _sendLedFeedback(ledData) {
    if (this._onLedFeedbackCallback) {
      this._onLedFeedbackCallback(ledData);
    }
  }

  switchBank(bankName) {
    if (!bankName || typeof bankName !== "string") return false;
    this._config.active_bank = bankName;

    if (this._onBankChangedCallback) {
      this._onBankChangedCallback(bankName);
    }

    if (this._config.led_feedback) {
      this.dumpBankLedStates().forEach((msg) => this._sendLedFeedback(msg));
    }
    return true;
  }

  setPerformanceMode(enabled) {
    this._config.performance_mode = Boolean(enabled);
    if (this._onPerformanceModeChangedCallback) {
      this._onPerformanceModeChangedCallback(this._config.performance_mode);
    }
    return true;
  }

  dumpBankLedStates() {
    const feedbackMsgs = [];
    if (!this._config.enabled || !this._config.led_feedback) return feedbackMsgs;

    const activeMappings = this._config.mappings.filter(
      (m) => m.bank === "Global" || m.bank === this._config.active_bank
    );

    for (const m of activeMappings) {
      const mappingId = m.id || `${m.type}_${m.channel}_${m.number}`;
      const state = Boolean(this._states.get(mappingId));
      let ledVal = m.led_off_value !== undefined ? m.led_off_value : 0;

      if (m.action === "switch_bank") {
        if (m.target_bank === this._config.active_bank) {
          ledVal = m.led_on_value !== undefined ? m.led_on_value : 127;
        }
      } else if (m.action === "toggle_performance_mode") {
        if (this._config.performance_mode) {
          ledVal = m.led_on_value !== undefined ? m.led_on_value : 127;
        }
      } else if (state) {
        ledVal = m.led_on_value !== undefined ? m.led_on_value : 127;
      }

      feedbackMsgs.push({
        type: m.type === "note" ? "note_on" : "cc",
        channel: m.channel || 1,
        number: m.number,
        value: ledVal,
      });
    }

    return feedbackMsgs;
  }

  getBankNames() {
    const set = new Set(["Bank A", "Bank B"]);
    if (this._config.mappings) {
      this._config.mappings.forEach((m) => {
        if (m.bank && m.bank !== "Global") set.add(m.bank);
      });
    }
    return Array.from(set);
  }

  getMappingState(mappingId) {
    return Boolean(this._states.get(mappingId));
  }

  getSliderValue(mappingId) {
    return this._sliderValues.get(mappingId);
  }

  getConfig() {
    return JSON.parse(JSON.stringify(this._config));
  }
}
