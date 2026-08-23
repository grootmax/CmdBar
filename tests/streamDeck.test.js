import fs from 'fs';
import path from 'path';
import os from 'os';
import { jest } from '@jest/globals';
import {
  LEDState,
  DeviceModel,
  StreamDeckKey,
  StreamDeckProfile,
  StreamDeckController,
} from '../extension/streamDeck.js';
import { saveConfig } from '../extension/configSync.js';

describe('Stream Deck Integration Unit & Performance Tests', () => {
  let tempDir;
  let configPath;
  let mockIndicator;
  let controller;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmdbar-streamdeck-test-'));
    configPath = path.join(tempDir, 'config.json');

    const initialConfig = {
      categories: [
        {
          name: 'Projects',
          commands: [{ name: 'Build System', command: 'make build' }],
        },
        {
          name: 'Media',
          commands: [{ name: 'Play Music', command: 'playerctl play' }],
        },
      ],
      stream_deck: {
        active_profile: 'Default',
        profiles: {
          Default: {
            name: 'Default',
            deviceModel: 'ORIGINAL',
            bgColor: '#0D1117',
            keys: {},
          },
        },
      },
    };
    await saveConfig(initialConfig, configPath);

    mockIndicator = {
      _getConfigPath: () => configPath,
      _reloadMenu: jest.fn(),
      executeCommand: jest.fn().mockResolvedValue(true),
    };

    controller = new StreamDeckController(mockIndicator, configPath);
    await controller.loadProfiles();
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('LEDState and DeviceModel constants', () => {
    expect(LEDState.IDLE).toBe('idle');
    expect(LEDState.RUNNING).toBe('running');
    expect(LEDState.SUCCESS).toBe('success');
    expect(LEDState.ERROR).toBe('error');

    expect(DeviceModel.CONFIGS.MINI.keys).toBe(6);
    expect(DeviceModel.CONFIGS.ORIGINAL.keys).toBe(15);
    expect(DeviceModel.CONFIGS.XL.keys).toBe(32);
    expect(DeviceModel.CONFIGS.PLUS.keys).toBe(8);
  });

  test('StreamDeckKey and StreamDeckProfile serialization', () => {
    const key = new StreamDeckKey({
      keyIndex: 1,
      commandName: 'Test Command',
      labelTemplate: '{name}\n{status}',
      bgColor: '#333333',
      parameters: { env: 'staging' },
    });

    const jsonKey = key.toJSON();
    expect(jsonKey.keyIndex).toBe(1);
    expect(jsonKey.commandName).toBe('Test Command');
    expect(jsonKey.parameters.env).toBe('staging');

    const restoredKey = StreamDeckKey.fromJSON(jsonKey);
    expect(restoredKey.keyIndex).toBe(1);
    expect(restoredKey.commandName).toBe('Test Command');

    const profile = new StreamDeckProfile('TestProf', DeviceModel.MINI);
    profile.setKey(key);

    const jsonProf = profile.toJSON();
    const restoredProf = StreamDeckProfile.fromJSON(jsonProf);
    expect(restoredProf.name).toBe('TestProf');
    expect(restoredProf.getKey(1).commandName).toBe('Test Command');
  });

  test('Controller profile CRUD and switching', async () => {
    expect(controller.listProfiles()).toContain('Default');

    const mediaProf = await controller.createProfile('Media', DeviceModel.MINI, 'Media');
    expect(controller.listProfiles()).toContain('Media');
    expect(mediaProf.deviceModel).toBe(DeviceModel.MINI);

    const switched = await controller.setActiveProfile('Media');
    expect(switched).toBe(true);
    expect(controller.getActiveProfile().name).toBe('Media');

    const deleted = await controller.deleteProfile('Media');
    expect(deleted).toBe(true);
    expect(controller.getActiveProfile().name).toBe('Default');

    await expect(controller.createProfile('  ')).rejects.toThrow();
  });

  test('Key binding, unbinding, and dynamic label formatting', async () => {
    const key = await controller.setKeyBinding(2, 'Build System', {
      labelTemplate: '{name}\n{status}',
      parameters: { target: 'release' },
    });

    expect(key.keyIndex).toBe(2);
    expect(key.commandName).toBe('Build System');

    const label = controller.resolveDynamicLabel(key);
    expect(label).toContain('Build System');
    expect(label).toContain('idle');

    key.customLabel = 'Custom Title';
    expect(controller.resolveDynamicLabel(key)).toBe('Custom Title');

    const cleared = await controller.clearKeyBinding(2);
    expect(cleared).toBe(true);
    expect(controller.getActiveProfile().getKey(2)).toBeUndefined();
  });

  test('Visual button rendering and cache optimization', async () => {
    await controller.setKeyBinding(0, 'Build System', { bgColor: '#1A1A1A' });

    const visual = controller.renderKeyVisual(0);
    expect(visual.keyIndex).toBe(0);
    expect(visual.bgColor).toBe('#1A1A1A');
    expect(visual.svg).toContain('<svg');
    expect(visual.svgBase64).toContain('data:image/svg+xml;base64,');

    const statsBefore = controller.getPerformanceStats();
    const cachedVisual = controller.renderKeyVisual(0);
    const statsAfter = controller.getPerformanceStats();

    expect(statsAfter.cacheHits).toBeGreaterThan(statsBefore.cacheHits);
    expect(cachedVisual.svg).toBe(visual.svg);

    const grid = controller.renderProfileGrid();
    expect(grid.length).toBe(DeviceModel.CONFIGS.ORIGINAL.keys);
  });

  test('Key press execution and LED feedback state updates', async () => {
    await controller.setKeyBinding(0, 'Build System');

    const executionEvents = [];
    controller.addExecutionListener((idx, name, meta) => executionEvents.push({ idx, name, meta }));

    const res = await controller.pressKey(0);
    expect(res.success).toBe(true);
    expect(res.commandName).toBe('Build System');
    expect(mockIndicator.executeCommand).toHaveBeenCalledWith(
      'Build System',
      null,
      {},
      expect.objectContaining({ name: 'Build System' })
    );

    const key = controller.getActiveProfile().getKey(0);
    expect(key.ledState).toBe(LEDState.SUCCESS);

    expect(executionEvents.length).toBe(1);
    expect(executionEvents[0].idx).toBe(0);
    expect(executionEvents[0].name).toBe('Build System');
  });

  test('Profile switch action and category auto-switching', async () => {
    await controller.createProfile('DevProf', DeviceModel.XL, 'Projects');

    await controller.setKeyBinding(3, '', {
      actionType: 'switch_profile',
      targetProfile: 'DevProf',
    });

    const pressRes = await controller.pressKey(3);
    expect(pressRes.success).toBe(true);
    expect(pressRes.actionType).toBe('switch_profile');
    expect(controller.getActiveProfile().name).toBe('DevProf');

    const autoSwitched = await controller.autoSwitchForCategory('Projects');
    expect(autoSwitched).toBe('DevProf');
  });

  test('Export and import profile JSON', async () => {
    await controller.setKeyBinding(0, 'Build System');

    const jsonStr = controller.exportProfileJson('Default');
    expect(jsonStr).toContain('Default');
    expect(jsonStr).toContain('Build System');

    const parsed = JSON.parse(jsonStr);
    parsed.name = 'ImportedProfile';

    const imported = await controller.importProfileJson(JSON.stringify(parsed));
    expect(imported.name).toBe('ImportedProfile');
    expect(controller.listProfiles()).toContain('ImportedProfile');
  });

  test('Performance benchmarks (<5ms key render time)', async () => {
    for (let i = 0; i < 15; i++) {
      await controller.setKeyBinding(i, `Command ${i}`);
    }

    const startT = performance.now();
    for (let cycle = 0; cycle < 100; cycle++) {
      controller.clearRenderCache();
      for (let i = 0; i < 15; i++) {
        controller.renderKeyVisual(i);
      }
    }
    const totalTimeMs = performance.now() - startT;
    const avgRenderTimeMs = totalTimeMs / (100 * 15);

    expect(avgRenderTimeMs).toBeLessThan(5.0);

    const stats = controller.getPerformanceStats();
    expect(stats.totalRenders).toBeGreaterThanOrEqual(1500);
  });
});
