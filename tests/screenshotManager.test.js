import fs from 'fs';
import path from 'path';
import os from 'os';
import { jest } from '@jest/globals';

const mockSetText = jest.fn();

jest.unstable_mockModule('gi', () => ({
  St: {
    Clipboard: {
      get_default: () => ({ set_text: mockSetText }),
    },
    ClipboardType: { CLIPBOARD: 1 },
  },
  Gio: {
    DBusNodeInfo: { new_for_xml: () => ({ interfaces: [{}] }) },
    DBusExportedObject: {
      wrapJSObject: () => ({
        export: jest.fn(),
        unexport: jest.fn(),
        emit_signal: jest.fn(),
      }),
    },
    BusType: { SESSION: 1 },
    BusNameOwnerFlags: { NONE: 0 },
    bus_own_name: jest.fn(() => 123),
    bus_unown_name: jest.fn(),
  },
  GLib: {
    Variant: class {
      constructor(type, value) {
        this.type = type;
        this.value = value;
      }
    },
    getenv: jest.fn(),
  },
}), { virtual: true });

const {
  captureScreenshot,
  captureMode,
  generateScreenshotFilename,
  getScreenshotDirectory,
  stripMetadata,
  applyAnnotations,
  copyScreenshotToClipboard,
  shareScreenshotUrl,
  getScreenshotShortcuts,
  setScreenshotShortcut,
  parseScreenshotCommand,
  isScreenshotCommand,
  handleScreenshotCommandExecution,
  DEFAULT_SCREENSHOT_SHORTCUTS,
} = await import('../extension/screenshotManager.js');

const { CmdBarDBusService } = await import('../extension/dbusService.js');

describe('Screenshot Manager Unit Tests', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmdbar-screenshot-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Directory and Filename Generation', () => {
    test('getScreenshotDirectory returns custom directory when specified', () => {
      const dir = getScreenshotDirectory(tempDir);
      expect(dir).toBe(tempDir);
    });

    test('getScreenshotDirectory fallback returns valid path string', () => {
      const dir = getScreenshotDirectory();
      expect(typeof dir).toBe('string');
      expect(dir.length).toBeGreaterThan(0);
    });

    test('generateScreenshotFilename formats default PNG filename correctly', () => {
      const filename = generateScreenshotFilename('TestCapture', 'png');
      expect(filename).toMatch(/^TestCapture_\d{4}-\d{2}-\d{2}_\d{6}\.png$/);
    });
  });

  describe('Capture Modes & Destinations', () => {
    test('captures full screen screenshot and saves to file and clipboard', async () => {
      const result = await captureScreenshot({
        mode: 'fullscreen',
        saveTo: 'both',
        directory: tempDir,
      });

      expect(result.success).toBe(true);
      expect(result.mode).toBe('fullscreen');
      expect(result.filePath).toBeDefined();
      expect(fs.existsSync(result.filePath)).toBe(true);
      expect(result.inClipboard).toBe(true);
    });

    test('captures active window screenshot', async () => {
      const result = await captureMode('window', {
        directory: tempDir,
        saveTo: 'file',
      });

      expect(result.success).toBe(true);
      expect(result.mode).toBe('window');
      expect(result.filePath).toBeDefined();
      expect(fs.existsSync(result.filePath)).toBe(true);
    });

    test('captures selected region screenshot', async () => {
      const result = await captureMode('region', {
        directory: tempDir,
        saveTo: 'file',
      });

      expect(result.success).toBe(true);
      expect(result.mode).toBe('region');
      expect(result.filePath).toBeDefined();
      expect(fs.existsSync(result.filePath)).toBe(true);
    });

    test('captures to clipboard only', async () => {
      const result = await captureScreenshot({
        mode: 'fullscreen',
        saveTo: 'clipboard',
        directory: tempDir,
      });

      expect(result.success).toBe(true);
      expect(result.filePath).toBeNull();
      expect(result.inClipboard).toBe(true);
    });
  });

  describe('Image Annotations', () => {
    test('applies text, shape, blur, and crop annotations', async () => {
      const annotations = [
        { type: 'text', text: 'Bug Here', x: 50, y: 50, fontSize: 18, color: '#ff0000' },
        { type: 'rectangle', x: 40, y: 40, width: 100, height: 60, strokeColor: '#00ff00' },
        { type: 'arrow', startX: 10, startY: 10, endX: 40, endY: 40, color: '#ff0000' },
        { type: 'blur', x: 200, y: 200, width: 80, height: 40, radius: 10 },
        { type: 'crop', x: 0, y: 0, width: 500, height: 500 },
      ];

      const result = await captureScreenshot({
        mode: 'fullscreen',
        directory: tempDir,
        annotations,
      });

      expect(result.success).toBe(true);
      expect(result.annotationsApplied).toBe(5);
    });

    test('applyAnnotations handles object data structures', () => {
      const objData = { width: 1000, height: 800, annotations: [] };
      const updated = applyAnnotations(objData, [
        { type: 'highlight', x: 10, y: 10, width: 100, height: 20 },
      ]);

      expect(updated.annotationsApplied).toBe(1);
      expect(updated.annotations.length).toBe(1);
      expect(updated.annotations[0].type).toBe('highlight');
    });
  });

  describe('Metadata Removal (Privacy & Security)', () => {
    test('strips metadata from PNG buffer chunks', () => {
      // Construct sample PNG buffer with tEXt metadata chunk
      const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

      // IHDR chunk
      const ihdrChunk = Buffer.alloc(25);
      ihdrChunk.writeUInt32BE(13, 0);
      ihdrChunk.write('IHDR', 4);

      // tEXt chunk (metadata)
      const textData = Buffer.from('Software\0CmdBar ScreenCapture', 'utf8');
      const textChunk = Buffer.alloc(12 + textData.length);
      textChunk.writeUInt32BE(textData.length, 0);
      textChunk.write('tEXt', 4);
      textData.copy(textChunk, 8);

      // IEND chunk
      const iendChunk = Buffer.alloc(12);
      iendChunk.writeUInt32BE(0, 0);
      iendChunk.write('IEND', 4);

      const fullPng = Buffer.concat([pngHeader, ihdrChunk, textChunk, iendChunk]);

      const stripped = stripMetadata(fullPng);
      expect(stripped.length).toBeLessThan(fullPng.length);
      expect(stripped.includes(Buffer.from('tEXt'))).toBe(false);
      expect(stripped.includes(Buffer.from('IHDR'))).toBe(true);
      expect(stripped.includes(Buffer.from('IEND'))).toBe(true);
    });

    test('strips metadata from JPEG EXIF APP1 marker', () => {
      const jpegHeader = Buffer.from([0xff, 0xd8]); // SOI

      // APP1 (EXIF) segment
      const exifData = Buffer.from('Exif\0\0Location: Latitude 37', 'utf8');
      const app1Segment = Buffer.alloc(4 + exifData.length);
      app1Segment[0] = 0xff;
      app1Segment[1] = 0xe1;
      app1Segment.writeUInt16BE(2 + exifData.length, 2);
      exifData.copy(app1Segment, 4);

      // EOI segment
      const eoiSegment = Buffer.from([0xff, 0xd9]);

      const fullJpeg = Buffer.concat([jpegHeader, app1Segment, eoiSegment]);

      const stripped = stripMetadata(fullJpeg);
      expect(stripped.includes(Buffer.from('Exif'))).toBe(false);
      expect(stripped[0]).toBe(0xff);
      expect(stripped[1]).toBe(0xd8);
    });

    test('strips metadata object properties from JavaScript object representation', () => {
      const rawData = {
        exif: { location: 'GPS 123' },
        timestamp: 12345678,
        device_info: 'Linux GNOME',
        width: 1920,
        height: 1080,
      };

      const cleaned = stripMetadata(rawData);
      expect(cleaned.exif).toBeUndefined();
      expect(cleaned.device_info).toBeUndefined();
      expect(cleaned.width).toBe(1920);
      expect(cleaned.metadataRemoved).toBe(true);
    });
  });

  describe('Share via URL', () => {
    test('shareScreenshotUrl returns upload share URL', async () => {
      const res = await shareScreenshotUrl(Buffer.from('TEST_IMAGE_BYTES'), {
        serviceUrl: 'https://share.cmdbar.org/upload',
      });

      expect(res.success).toBe(true);
      expect(res.url).toMatch(/^https:\/\/share\.cmdbar\.org\/s\/[a-z0-9]+$/);
    });

    test('captureScreenshot with share flag includes shareUrl in output', async () => {
      const result = await captureScreenshot({
        mode: 'fullscreen',
        directory: tempDir,
        share: true,
      });

      expect(result.success).toBe(true);
      expect(result.shareUrl).toBeDefined();
      expect(result.shareUrl).toContain('share.cmdbar.org');
    });
  });

  describe('Shortcuts Configuration', () => {
    test('DEFAULT_SCREENSHOT_SHORTCUTS contains keybindings for all modes', () => {
      expect(DEFAULT_SCREENSHOT_SHORTCUTS.fullscreen).toBe('<Super><Shift>3');
      expect(DEFAULT_SCREENSHOT_SHORTCUTS.window).toBe('<Super><Shift>4');
      expect(DEFAULT_SCREENSHOT_SHORTCUTS.region).toBe('<Super><Shift>5');
    });

    test('getScreenshotShortcuts extracts shortcuts from config or defaults', () => {
      const config = {
        screenshot: {
          shortcuts: {
            fullscreen: '<Control><Alt>s',
            window: '<Super><Shift>4',
            region: '<Super><Shift>5',
          },
        },
      };

      const shortcuts = getScreenshotShortcuts(config);
      expect(shortcuts.fullscreen).toBe('<Control><Alt>s');
      expect(shortcuts.window).toBe('<Super><Shift>4');
    });

    test('setScreenshotShortcut updates action shortcut in config', () => {
      const updated = setScreenshotShortcut('region', '<Super><Shift>r', {});
      expect(updated.screenshot.shortcuts.region).toBe('<Super><Shift>r');
    });

    test('setScreenshotShortcut throws error for invalid action', () => {
      expect(() => setScreenshotShortcut('invalid', 'Ctrl+S')).toThrow();
    });
  });

  describe('CLI Command Parsing & Execution', () => {
    test('parseScreenshotCommand parses mode and flag options', () => {
      const parsed = parseScreenshotCommand('/screenshot region --share --clipboard');
      expect(parsed.mode).toBe('region');
      expect(parsed.options.share).toBe(true);
      expect(parsed.options.saveTo).toBe('clipboard');
    });

    test('isScreenshotCommand identifies /screenshot and /capture triggers', () => {
      expect(isScreenshotCommand('/screenshot window')).toBe(true);
      expect(isScreenshotCommand('/capture region')).toBe(true);
      expect(isScreenshotCommand('echo hello')).toBe(false);
    });

    test('handleScreenshotCommandExecution executes parsed screenshot command', async () => {
      const result = await handleScreenshotCommandExecution('/screenshot window --share', {
        screenshot: { directory: tempDir },
      });

      expect(result.success).toBe(true);
      expect(result.mode).toBe('window');
      expect(result.shareUrl).toBeDefined();
    });
  });

  describe('D-Bus Interface Integration', () => {
    test('CaptureScreenshot D-Bus method returns valid JSON output', async () => {
      const service = new CmdBarDBusService({});
      const jsonStr = await service.CaptureScreenshot('fullscreen', 'both', JSON.stringify({ directory: tempDir }));

      const res = JSON.parse(jsonStr);
      expect(res.success).toBe(true);
      expect(res.mode).toBe('fullscreen');
      expect(res.filePath).toBeDefined();
    });
  });

  describe('Performance Benchmarks', () => {
    test('executes capture, annotation, and metadata stripping pipeline in <100ms', async () => {
      const start = performance.now();

      const result = await captureScreenshot({
        mode: 'fullscreen',
        directory: tempDir,
        removeMetadata: true,
        annotations: [
          { type: 'text', text: 'Benchmark', x: 10, y: 10 },
          { type: 'rectangle', x: 0, y: 0, width: 100, height: 100 },
        ],
      });

      const elapsed = performance.now() - start;

      expect(result.success).toBe(true);
      expect(elapsed).toBeLessThan(100); // Must meet <100ms benchmark
    });
  });
});
