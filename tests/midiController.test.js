import { jest } from '@jest/globals';
import { MidiControllerManager } from '../extension/midiController.js';

describe('MIDI Controller Support Unit Tests', () => {
  let controller;
  let executedCommands;
  let ledFeedbacks;
  let bankChanges;
  let perfModeChanges;

  beforeEach(() => {
    executedCommands = [];
    ledFeedbacks = [];
    bankChanges = [];
    perfModeChanges = [];

    controller = new MidiControllerManager();
    controller.setCallbacks({
      onExecute: (name, cmdStr, metadata) => {
        executedCommands.push({ name, cmdStr, metadata });
      },
      onLedFeedback: (ledData) => {
        ledFeedbacks.push(ledData);
      },
      onBankChanged: (bank) => {
        bankChanges.push(bank);
      },
      onPerformanceModeChanged: (enabled) => {
        perfModeChanges.push(enabled);
      },
    });
  });

  describe('Initialization and Configuration', () => {
    test('should initialize with default config and default mappings', () => {
      const cfg = controller.getConfig();
      expect(cfg.enabled).toBe(true);
      expect(cfg.performance_mode).toBe(false);
      expect(cfg.active_bank).toBe('Bank A');
      expect(Array.isArray(cfg.mappings)).toBe(true);
      expect(cfg.mappings.length).toBeGreaterThan(0);
    });

    test('should update configuration dynamically', () => {
      controller.updateConfig({
        midi: {
          enabled: true,
          performance_mode: true,
          active_bank: 'Bank B',
          throttle_ms: 20,
          mappings: [],
        },
      });

      const cfg = controller.getConfig();
      expect(cfg.performance_mode).toBe(true);
      expect(cfg.active_bank).toBe('Bank B');
      expect(cfg.throttle_ms).toBe(20);
      expect(bankChanges).toContain('Bank B');
      expect(perfModeChanges).toContain(true);
    });

    test('should handle disabled MIDI state gracefully', () => {
      controller.updateConfig({
        midi: { enabled: false },
      });

      const res = controller.processMidiMessage('note_on', 1, 60, 127);
      expect(res.handled).toBe(false);
      expect(res.reason).toBe('MIDI disabled');
    });
  });

  describe('Raw MIDI Parsing', () => {
    test('should parse raw bytes into MIDI message objects', () => {
      // Note On channel 1 note 60 velocity 100 -> [0x90, 60, 100]
      const noteOn = controller.parseRawBytes([0x90, 60, 100]);
      expect(noteOn).toEqual({
        type: 'note_on',
        channel: 1,
        number: 60,
        value: 100,
        raw: [0x90, 60, 100],
      });

      // Note On velocity 0 -> note_off
      const noteOffVelocityZero = controller.parseRawBytes([0x90, 60, 0]);
      expect(noteOffVelocityZero.type).toBe('note_off');

      // Note Off status -> note_off
      const noteOff = controller.parseRawBytes([0x80, 60, 64]);
      expect(noteOff.type).toBe('note_off');

      // Control Change channel 2 CC 7 value 127 -> [0xB1, 7, 127]
      const cc = controller.parseRawBytes([0xb1, 7, 127]);
      expect(cc).toEqual({
        type: 'cc',
        channel: 2,
        number: 7,
        value: 127,
        raw: [0xb1, 7, 127],
      });

      // Program Change channel 1 -> [0xC0, 5]
      const pc = controller.parseRawBytes([0xc0, 5, 0]);
      expect(pc.type).toBe('program_change');

      // Pitch Bend channel 1 -> [0xE0, 0, 64]
      const pb = controller.parseRawBytes([0xe0, 0, 64]);
      expect(pb.type).toBe('pitch_bend');

      // Invalid input
      expect(controller.parseRawBytes(null)).toBeNull();
      expect(controller.parseRawBytes([0x90])).toBeNull();
    });
  });

  describe('Button Trigger Modes & LED Feedback', () => {
    test('should process toggle button mode correctly with LED feedback', () => {
      // Deck A Play/Pause mapping (note 60, channel 1, toggle)
      const res1 = controller.processMidiMessage('note_on', 1, 60, 127);
      expect(res1.handled).toBe(true);
      expect(executedCommands.length).toBe(1);
      expect(executedCommands[0].cmdStr).toBe('playerctl play-pause');
      expect(controller.getMappingState('dj_deck_a_play')).toBe(true);

      // Check LED feedback
      expect(ledFeedbacks.length).toBe(1);
      expect(ledFeedbacks[0]).toEqual({
        type: 'note_on',
        channel: 1,
        number: 60,
        value: 127,
      });

      // Toggle off
      const res2 = controller.processMidiMessage('note_on', 1, 60, 127);
      expect(res2.handled).toBe(true);
      expect(controller.getMappingState('dj_deck_a_play')).toBe(false);
      expect(ledFeedbacks[1].value).toBe(0);
    });

    test('should process momentary button mode on press and release', () => {
      // Deck A Cue mapping (note 61, channel 1, momentary)
      // Press
      controller.processMidiMessage('note_on', 1, 61, 127);
      expect(executedCommands.length).toBe(1);
      expect(executedCommands[0].cmdStr).toBe('echo Cue Deck A');
      expect(ledFeedbacks[0].value).toBe(127);

      // Release
      controller.processMidiMessage('note_off', 1, 61, 0);
      expect(executedCommands.length).toBe(2);
      expect(executedCommands[1].cmdStr).toBe('echo Release Cue Deck A');
      expect(ledFeedbacks[1].value).toBe(0);
    });

    test('should handle custom toggle_state with on_command and off_command', () => {
      controller.updateConfig({
        midi: {
          enabled: true,
          active_bank: 'Bank A',
          mappings: [
            {
              id: 'mute_deck_a',
              bank: 'Bank A',
              type: 'note',
              channel: 1,
              number: 10,
              mode: 'toggle',
              action: 'toggle_state',
              command: 'amixer set DeckA mute',
              off_command: 'amixer set DeckA unmute',
              led_on_value: 127,
              led_off_value: 0,
            },
          ],
        },
      });

      // Press to mute
      controller.processMidiMessage('note_on', 1, 10, 127);
      expect(executedCommands[0].cmdStr).toBe('amixer set DeckA mute');

      // Press again to unmute
      controller.processMidiMessage('note_on', 1, 10, 127);
      expect(executedCommands[1].cmdStr).toBe('amixer set DeckA unmute');
    });
  });

  describe('Value Sliders & Continuous CC Knobs', () => {
    test('should scale slider values from 0-127 raw range to target min/max range', () => {
      expect(controller.scaleSliderValue(0, 0, 100)).toBe(0);
      expect(controller.scaleSliderValue(127, 0, 100)).toBe(100);
      expect(controller.scaleSliderValue(63, 0, 100)).toBe(50);
      expect(controller.scaleSliderValue(127, 0.0, 1.0)).toBe(1);
      expect(controller.scaleSliderValue(0, 0.0, 1.0)).toBe(0);
      expect(controller.scaleSliderValue(63, 0.0, 1.0)).toBe(0.5);
    });

    test('should process CC value slider inputs with variable substitution', () => {
      // Master Volume Slider mapping (CC 7, channel 1)
      const res = controller.processMidiMessage('cc', 1, 7, 95);
      expect(res.handled).toBe(true);
      expect(executedCommands.length).toBe(1);
      // 95 raw scaled to 0-100 range = 75
      expect(executedCommands[0].cmdStr).toBe('amixer set Master 75%');
      expect(controller.getSliderValue('dj_volume_fader')).toBe(75);
    });

    test('should apply CC continuous controller throttling', async () => {
      controller.updateConfig({
        midi: {
          enabled: true,
          throttle_ms: 100,
          active_bank: 'Bank A',
          mappings: [
            {
              id: 'fader',
              bank: 'Bank A',
              type: 'cc',
              channel: 1,
              number: 7,
              mode: 'trigger',
              action: 'parameter_slider',
              command: 'echo <value>',
            },
          ],
        },
      });

      // First movement
      controller.processMidiMessage('cc', 1, 7, 10);
      // Rapid second movement (within throttle window)
      controller.processMidiMessage('cc', 1, 7, 20);

      // Should only have executed the first message due to 100ms throttle
      expect(executedCommands.length).toBe(1);
      expect(executedCommands[0].cmdStr).toBe('echo 8');
    });
  });

  describe('Bank / Profile Switching & LED Feedback Dump', () => {
    test('should switch active bank and dump LED states for new bank', () => {
      // Global switch_bank mapping (note 64, channel 1)
      controller.processMidiMessage('note_on', 1, 64, 127);

      expect(controller.getConfig().active_bank).toBe('Bank B');
      expect(bankChanges).toContain('Bank B');
    });

    test('should dump LED feedback states for all active mappings in active bank', () => {
      const dump = controller.dumpBankLedStates();
      expect(Array.isArray(dump)).toBe(true);
      expect(dump.length).toBeGreaterThan(0);
      expect(dump[0]).toHaveProperty('type');
      expect(dump[0]).toHaveProperty('channel');
      expect(dump[0]).toHaveProperty('number');
      expect(dump[0]).toHaveProperty('value');
    });

    test('should retrieve all unique bank names', () => {
      const bankNames = controller.getBankNames();
      expect(bankNames).toContain('Bank A');
      expect(bankNames).toContain('Bank B');
    });
  });

  describe('Performance Mode & DJ/Producer Workflows', () => {
    test('should toggle performance mode and reduce throttling interval', () => {
      // Global toggle_performance_mode mapping (note 65, channel 1)
      controller.processMidiMessage('note_on', 1, 65, 127);

      expect(controller.getConfig().performance_mode).toBe(true);
      expect(perfModeChanges).toContain(true);
    });

    test('should execute custom function if provided during processMidiMessage', () => {
      const customFn = jest.fn();
      controller.processMidiMessage('note_on', 1, 60, 127, customFn);
      expect(customFn).toHaveBeenCalledWith(
        'Deck A Play/Pause',
        'playerctl play-pause',
        { state: true }
      );
    });
  });

  describe('High Throughput Performance Benchmark', () => {
    test('should process 1000 MIDI messages in under 50ms', () => {
      controller.setPerformanceMode(true);
      const startTime = performance.now();

      for (let i = 0; i < 1000; i++) {
        const note = (i % 12) + 60;
        controller.processMidiMessage('note_on', 1, note, 127);
      }

      const duration = performance.now() - startTime;
      expect(duration).toBeLessThan(50);
    });
  });
});
