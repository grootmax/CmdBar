import { jest } from '@jest/globals';
import {
  parseRawMidiBytes,
  scaleValue,
  HARDWARE_PROFILES,
  getHardwareProfile,
  MidiControllerManager,
} from '../extension/midiController.js';

describe('MIDI Controller Unit Tests', () => {
  let manager;

  beforeEach(() => {
    manager = new MidiControllerManager();
  });

  describe('Raw MIDI Byte Parser', () => {
    test('Parses Note On event correctly', () => {
      const bytes = [0x90, 60, 100]; // Note On, Channel 0, C4 (60), Velocity 100
      const evt = parseRawMidiBytes(bytes);
      expect(evt.type).toBe('note_on');
      expect(evt.channel).toBe(0);
      expect(evt.note).toBe(60);
      expect(evt.velocity).toBe(100);
    });

    test('Treats Note On with velocity 0 as Note Off', () => {
      const bytes = [0x90, 60, 0];
      const evt = parseRawMidiBytes(bytes);
      expect(evt.type).toBe('note_off');
      expect(evt.velocity).toBe(0);
    });

    test('Parses explicit Note Off event', () => {
      const bytes = [0x82, 64, 40]; // Note Off, Channel 2
      const evt = parseRawMidiBytes(bytes);
      expect(evt.type).toBe('note_off');
      expect(evt.channel).toBe(2);
      expect(evt.note).toBe(64);
      expect(evt.velocity).toBe(40);
    });

    test('Parses Control Change (CC) event', () => {
      const bytes = [0xB0, 7, 127]; // CC, Channel 0, Controller 7, Value 127
      const evt = parseRawMidiBytes(bytes);
      expect(evt.type).toBe('cc');
      expect(evt.channel).toBe(0);
      expect(evt.cc).toBe(7);
      expect(evt.value).toBe(127);
    });

    test('Parses Program Change event', () => {
      const bytes = [0xC1, 10]; // Program Change, Channel 1, Program 10
      const evt = parseRawMidiBytes(bytes);
      expect(evt.type).toBe('program_change');
      expect(evt.channel).toBe(1);
      expect(evt.program).toBe(10);
    });

    test('Parses Pitch Bend 14-bit event', () => {
      const bytes = [0xE0, 0x00, 0x40]; // Center pitch bend (8192)
      const evt = parseRawMidiBytes(bytes);
      expect(evt.type).toBe('pitch_bend');
      expect(evt.value).toBe(8192);
    });

    test('Handles empty or invalid bytes gracefully', () => {
      const evt1 = parseRawMidiBytes(null);
      expect(evt1.type).toBe('unknown');
      const evt2 = parseRawMidiBytes([0x90]);
      expect(evt2.type).toBe('unknown');
    });
  });

  describe('Value Scaling & Curves', () => {
    test('Scales linear range 0-127 to 0-100', () => {
      expect(scaleValue(0, 0, 100, 'linear')).toBe(0);
      expect(scaleValue(127, 0, 100, 'linear')).toBe(100);
      expect(scaleValue(63.5, 0, 100, 'linear')).toBeCloseTo(50, 0);
    });

    test('Scales custom min and max range (e.g., 20 to 80)', () => {
      expect(scaleValue(0, 20, 80)).toBe(20);
      expect(scaleValue(127, 20, 80)).toBe(80);
    });

    test('Applies exponential curve', () => {
      const midExp = scaleValue(63.5, 0, 100, 'exponential');
      expect(midExp).toBeLessThan(50); // Exponential curve grows slower at start
    });

    test('Applies logarithmic curve', () => {
      const midLog = scaleValue(63.5, 0, 100, 'logarithmic');
      expect(midLog).toBeGreaterThan(50); // Log curve grows faster at start
    });

    test('Handles relative encoder modes', () => {
      // Increments (+1)
      const inc = scaleValue(1, 0, 100, 'linear', 'relative', 50);
      expect(inc).toBeGreaterThan(50);

      // Decrements (-1 / 127)
      const dec = scaleValue(127, 0, 100, 'linear', 'relative', 50);
      expect(dec).toBeLessThan(50);
    });
  });

  describe('Hardware Profiles', () => {
    test('Retrieves correct preset profile specs', () => {
      const launchpad = getHardwareProfile('launchpad');
      expect(launchpad.name).toBe('Novation Launchpad');

      const lpd8 = getHardwareProfile('lpd8');
      expect(lpd8.name).toBe('Akai LPD8');

      const generic = getHardwareProfile('unknown');
      expect(generic.name).toBe('Generic MIDI Controller');
    });

    test('Loads hardware profile into manager', () => {
      const mappings = manager.loadProfile('lpd8');
      expect(mappings.length).toBe(16); // 8 pads + 8 knobs
      expect(manager.mappings.length).toBe(16);
    });
  });

  describe('Device Registration & Management', () => {
    test('Registers new device', () => {
      const dev = manager.registerDevice({ id: 'lpd8_1', name: 'My LPD8', profile: 'lpd8' });
      expect(dev.id).toBe('lpd8_1');
      expect(dev.connected).toBe(true);
      expect(manager.getConnectedDevices().length).toBe(1);
    });

    test('Disconnects device', () => {
      manager.registerDevice({ id: 'dev1', name: 'Device 1' });
      expect(manager.disconnectDevice('dev1')).toBe(true);
      expect(manager.getConnectedDevices().length).toBe(0);
    });

    test('Returns device details', () => {
      manager.registerDevice({ id: 'dev1', name: 'Device 1' });
      const details = manager.getDeviceDetails('dev1');
      expect(details.name).toBe('Device 1');
    });
  });

  describe('Button Mappings & Event Dispatcher', () => {
    test('Processes trigger mode mapping', async () => {
      const mockExec = jest.fn().mockResolvedValue('ok');
      manager.setCommandExecutor(mockExec);

      manager.addMapping({
        id: 'btn1',
        event_type: 'note_on',
        note: 60,
        mode: 'trigger',
        command: 'echo "Pressed"',
      });

      const res = await manager.processMidiEvent([0x90, 60, 100]);
      expect(res.executed).toBe(true);
      expect(res.command).toBe('echo "Pressed"');
      expect(mockExec).toHaveBeenCalledWith('echo "Pressed"', expect.anything());
    });

    test('Processes toggle mode mapping state changes', async () => {
      const mockExec = jest.fn().mockResolvedValue('ok');
      manager.setCommandExecutor(mockExec);

      manager.addMapping({
        id: 'toggle1',
        event_type: 'note_on',
        note: 60,
        mode: 'toggle',
        command: 'echo "ON"',
        release_command: 'echo "OFF"',
      });

      // First press: ON
      const res1 = await manager.processMidiEvent([0x90, 60, 100]);
      expect(res1.command).toBe('echo "ON"');

      // Second press: OFF
      const res2 = await manager.processMidiEvent([0x90, 60, 100]);
      expect(res2.command).toBe('echo "OFF"');
    });

    test('Processes momentary mode mapping press and release', async () => {
      const mockExec = jest.fn().mockResolvedValue('ok');
      manager.setCommandExecutor(mockExec);

      manager.addMapping({
        id: 'mom1',
        event_type: 'note_on',
        note: 60,
        mode: 'momentary',
        command: 'echo "START"',
        release_command: 'echo "STOP"',
      });

      // Press
      const resPress = await manager.processMidiEvent([0x90, 60, 100]);
      expect(resPress.command).toBe('echo "START"');

      // Release (Note Off)
      const resRelease = await manager.processMidiEvent([0x80, 60, 0]);
      expect(resRelease.command).toBe('echo "STOP"');
    });

    test('Substitutes parameter placeholders in command templates', async () => {
      const mockExec = jest.fn().mockResolvedValue('ok');
      manager.setCommandExecutor(mockExec);

      manager.addMapping({
        id: 'fader1',
        event_type: 'cc',
        cc: 7,
        min_value: 0,
        max_value: 100,
        command: 'volume set {value}% vel={velocity} ch={channel}',
      });

      const res = await manager.processMidiEvent([0xB0, 7, 64]);
      expect(res.executed).toBe(true);
      expect(res.command).toContain('volume set');
      expect(res.command).toContain('vel=64');
      expect(res.command).toContain('ch=0');
    });

    test('Throttles high frequency fader movements', async () => {
      const mockExec = jest.fn().mockResolvedValue('ok');
      manager.setCommandExecutor(mockExec);

      manager.addMapping({
        id: 'fast_fader',
        event_type: 'cc',
        cc: 10,
        throttle_ms: 50,
        command: 'fader {value}',
      });

      // First event executes
      const res1 = await manager.processMidiEvent([0xB0, 10, 10]);
      expect(res1.executed).toBe(true);

      // Immediate second event gets throttled
      const res2 = await manager.processMidiEvent([0xB0, 10, 20]);
      expect(res2.executed).toBe(false);
    });

    test('Processes hold mode mapping and built-in actions', async () => {
      const mockExec = jest.fn().mockResolvedValue('ok');
      manager.setCommandExecutor(mockExec);

      manager.addMapping({
        id: 'hold1',
        event_type: 'note_on',
        note: 64,
        mode: 'hold',
        hold_delay_ms: 10,
        command: 'echo "CLICK"',
        hold_command: 'echo "HELD"',
      });

      const resPress = await manager.processMidiEvent([0x90, 64, 100]);
      expect(resPress.command).toBe('echo "CLICK"');

      // Built-in switch bank action
      manager.addMapping({
        id: 'bank_act',
        event_type: 'note_on',
        note: 70,
        action: 'switch_bank',
        target_bank: 'Bank 2',
      });

      const resBank = await manager.processMidiEvent([0x90, 70, 100]);
      expect(resBank.executed).toBe(true);
      expect(manager.getActiveBank()).toBe('Bank 2');

      // Built-in switch deck action
      manager.addMapping({
        id: 'deck_act',
        event_type: 'note_on',
        note: 71,
        action: 'switch_deck',
        target_deck: 'Deck B',
        bank: 'Bank 2',
      });

      const resDeck = await manager.processMidiEvent([0x90, 71, 100]);
      expect(resDeck.executed).toBe(true);
      expect(manager.getActiveDeck()).toBe('Deck B');
    });

    test('Removes and clears mappings', () => {
      const m1 = manager.addMapping({ id: 'rem1', event_type: 'note_on', note: 60 });
      expect(manager.mappings.length).toBe(1);
      expect(manager.removeMapping('rem1')).toBe(true);
      expect(manager.mappings.length).toBe(0);

      manager.loadProfile('ddj');
      expect(manager.mappings.length).toBeGreaterThan(0);
      manager.clearMappings();
      expect(manager.mappings.length).toBe(0);
    });
  });

  describe('LED Feedback System', () => {
    test('Sends LED feedback bytes and tracks outbound messages', () => {
      const mapping = { id: 'm1', channel: 0, note: 60, event_type: 'note_on', led: { on_velocity: 127 } };
      const bytes = manager.sendLedFeedback('dev1', mapping, 'on');

      expect(bytes).toEqual([0x90, 60, 127]);
      expect(manager.outboundLedMessages.length).toBe(1);
      expect(manager.outboundLedMessages[0].state).toBe('on');
    });
  });

  describe('Performance Mode', () => {
    test('Toggles performance mode state', () => {
      expect(manager.isPerformanceMode()).toBe(false);
      manager.setPerformanceMode(true);
      expect(manager.isPerformanceMode()).toBe(true);
    });

    test('Passes performance mode flag to command executor', async () => {
      const mockExec = jest.fn().mockResolvedValue('ok');
      manager.setCommandExecutor(mockExec);
      manager.setPerformanceMode(true);

      manager.addMapping({
        id: 'm1',
        event_type: 'note_on',
        note: 60,
        command: 'echo "Perf"',
      });

      await manager.processMidiEvent([0x90, 60, 100]);
      expect(mockExec).toHaveBeenCalledWith('echo "Perf"', expect.objectContaining({ performanceMode: true }));
    });
  });

  describe('DJ / Producer Workflows', () => {
    test('Switches active bank and filters mappings', () => {
      manager.addMapping({ id: 'm1', bank: 'Bank 1', event_type: 'note_on', note: 60, command: 'cmd1' });
      manager.addMapping({ id: 'm2', bank: 'Bank 2', event_type: 'note_on', note: 60, command: 'cmd2' });

      expect(manager.getActiveBank()).toBe('Bank 1');
      manager.switchBank('Bank 2');
      expect(manager.getActiveBank()).toBe('Bank 2');

      const b2Mappings = manager.getMappings({ bank: 'Bank 2' });
      expect(b2Mappings.length).toBe(1);
      expect(b2Mappings[0].id).toBe('m2');
    });

    test('Switches active DJ Deck', () => {
      manager.setActiveDeck('Deck A');
      expect(manager.getActiveDeck()).toBe('Deck A');
      manager.switchDeck('Deck B');
      expect(manager.getActiveDeck()).toBe('Deck B');
    });

    test('Calculates DJ Crossfader mix ratios', () => {
      const linear = manager.crossfaderMix(64, 'linear');
      expect(linear.deckA).toBeCloseTo(0.5, 1);
      expect(linear.deckB).toBeCloseTo(0.5, 1);

      const scratch = manager.crossfaderMix(0, 'scratch');
      expect(scratch.deckA).toBe(1);
      expect(scratch.deckB).toBe(0);
    });

    test('Calculates Tap Tempo BPM', () => {
      manager.tapTempo();
      const res = manager.tapTempo();
      expect(res.bpm).toBeGreaterThan(0);
    });
  });

  describe('Performance Benchmark & Metrics', () => {
    test('Runs latency benchmark and passes <5ms criteria', () => {
      const bench = manager.runLatencyBenchmark(1000);
      expect(bench.iterations).toBe(1000);
      expect(bench.averageLatencyMs).toBeLessThan(5.0);
      expect(bench.passed).toBe(true);
    });

    test('Tracks performance stats during event processing', async () => {
      manager.addMapping({ id: 'm1', event_type: 'note_on', note: 60, command: 'cmd' });
      await manager.processMidiEvent([0x90, 60, 100]);

      const stats = manager.getPerformanceStats();
      expect(stats.totalEvents).toBe(1);
      expect(stats.commandsExecuted).toBe(1);
    });
  });

  describe('Import / Export Configuration', () => {
    test('Exports and imports full MIDI configuration state', () => {
      manager.setPerformanceMode(true);
      manager.setActiveBank('Bank 2');
      manager.addMapping({ id: 'exp_map', event_type: 'note_on', note: 72, command: 'exported_cmd' });

      const exported = manager.exportConfig();
      expect(exported.performanceMode).toBe(true);
      expect(exported.activeBank).toBe('Bank 2');
      expect(exported.mappings.length).toBe(1);

      const newManager = new MidiControllerManager();
      newManager.importConfig(exported);

      expect(newManager.isPerformanceMode()).toBe(true);
      expect(newManager.getActiveBank()).toBe('Bank 2');
      expect(newManager.mappings.length).toBe(1);
      expect(newManager.mappings[0].id).toBe('exp_map');
    });
  });
});
