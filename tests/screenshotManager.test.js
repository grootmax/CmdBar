/**
 * @file tests/screenshotManager.test.js
 * @description Unit and integration tests for Screenshot and Screen Capture module.
 */

import {
  normalizeCaptureOptions,
  generateScreenshotFilename,
  stripMetadata,
  annotateScreenshot,
  shareScreenshotUrl,
  captureScreenshot,
  ScreenshotManager,
  DEFAULT_SCREENSHOT_SHORTCUTS,
} from "../extension/screenshotManager.js";

describe("Screenshot & Screen Capture Options Normalization", () => {
  test("normalizeCaptureOptions applies defaults for empty options", () => {
    const opts = normalizeCaptureOptions({});
    expect(opts.mode).toBe("fullscreen");
    expect(opts.format).toBe("png");
    expect(opts.copyToClipboard).toBe(true);
    expect(opts.stripMetadata).toBe(true);
    expect(opts.share).toBe(false);
    expect(opts.annotate).toEqual([]);
    expect(opts.region).toBeNull();
  });

  test("normalizeCaptureOptions parses region array and object", () => {
    const optsArr = normalizeCaptureOptions({ mode: "region", region: [10, 20, 300, 200] });
    expect(optsArr.mode).toBe("region");
    expect(optsArr.region).toEqual({ x: 10, y: 20, width: 300, height: 200 });

    const optsObj = normalizeCaptureOptions({
      mode: "region",
      region: { x: 50, y: 60, width: 400, height: 300 },
    });
    expect(optsObj.region).toEqual({ x: 50, y: 60, width: 400, height: 300 });
  });

  test("normalizeCaptureOptions supports JPEG format and custom share URL", () => {
    const opts = normalizeCaptureOptions({ format: "jpeg", shareServiceUrl: "https://custom.share/api" });
    expect(opts.format).toBe("jpeg");
    expect(opts.shareServiceUrl).toBe("https://custom.share/api");
  });
});

describe("Screenshot Filename Generator", () => {
  test("generateScreenshotFilename produces timestamped filename with extension", () => {
    const d = new Date(2026, 7, 23, 14, 30, 15); // Aug 23, 2026 14:30:15
    const namePng = generateScreenshotFilename(d, "png");
    expect(namePng).toBe("screenshot_20260823_143015.png");

    const nameJpg = generateScreenshotFilename(d, "jpeg");
    expect(nameJpg).toBe("screenshot_20260823_143015.jpg");
  });
});

describe("Metadata Stripping (Privacy & Sanitization)", () => {
  test("stripMetadata removes PNG textual/time metadata chunks", () => {
    // PNG header + IHDR + tEXt metadata + IEND
    const pngWithMeta = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // Header
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
      0x00, 0x00, 0x00, 0x0f, 0x74, 0x45, 0x58, 0x74, // tEXt chunk (len 15)
      0x53, 0x6f, 0x66, 0x74, 0x77, 0x61, 0x72, 0x65,
      0x00, 0x43, 0x6d, 0x64, 0x42, 0x61, 0x72,
      0x00, 0x00, 0x00, 0x00,                        // CRC
      0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, // IEND chunk
      0xae, 0x42, 0x60, 0x82,
    ]);

    const sanitized = stripMetadata(pngWithMeta);
    expect(sanitized.length).toBeLessThan(pngWithMeta.length);

    // Verify tEXt is removed
    const str = String.fromCharCode(...sanitized);
    expect(str).not.toContain("tEXt");
    expect(str).not.toContain("Software");
  });

  test("stripMetadata handles JPEG EXIF segments", () => {
    // JPEG SOI + APP1 (EXIF) + EOI
    const jpegWithExif = new Uint8Array([
      0xff, 0xd8, // SOI
      0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // APP1 EXIF
      0xff, 0xd9, // EOI
    ]);

    const sanitized = stripMetadata(jpegWithExif);
    expect(sanitized.length).toBeLessThan(jpegWithExif.length);
  });

  test("stripMetadata returns untouched for non-image or empty buffers", () => {
    expect(stripMetadata(null)).toBeNull();
    const plain = new Uint8Array([1, 2, 3, 4]);
    expect(stripMetadata(plain)).toBe(plain);
  });
});

describe("Screenshot Annotation Engine", () => {
  test("annotateScreenshot processes text, rectangle, arrow, and highlight annotations", () => {
    const rawBuffer = new Uint8Array([1, 2, 3, 4]);
    const annotations = [
      { type: "text", text: "Test Note", x: 10, y: 20, color: "#ff0000", fontSize: 18 },
      { type: "rectangle", x: 10, y: 10, width: 100, height: 50, color: "#00ff00" },
      { type: "arrow", x1: 0, y1: 0, x2: 50, y2: 50, color: "#0000ff" },
      { type: "highlight", x: 20, y: 20, width: 80, height: 30, color: "#ffff00", opacity: 0.5 },
    ];

    const res = annotateScreenshot(rawBuffer, annotations);
    expect(res.annotationsApplied).toBe(4);
    expect(res.annotationsList.length).toBe(4);
    expect(res.annotationsList[0].text).toBe("Test Note");
    expect(res.annotationsList[1].type).toBe("rectangle");
    expect(res.annotationsList[2].type).toBe("arrow");
    expect(res.annotationsList[3].type).toBe("highlight");
  });

  test("annotateScreenshot returns original buffer when empty annotations provided", () => {
    const buf = new Uint8Array([10, 20]);
    const res = annotateScreenshot(buf, []);
    expect(res.annotationsApplied).toBe(0);
    expect(res.annotatedBuffer).toBe(buf);
  });
});

describe("Screenshot URL Sharing", () => {
  test("shareScreenshotUrl generates valid share URL and metadata", async () => {
    const buf = new Uint8Array([1, 2, 3]);
    const shareRes = await shareScreenshotUrl(buf, { shareServiceUrl: "https://share.cmdbar.org" });

    expect(shareRes.success).toBe(true);
    expect(shareRes.shareUrl).toContain("https://share.cmdbar.org/scr_");
    expect(shareRes.shareId).toMatch(/^scr_/);
    expect(shareRes.timestamp).toBeDefined();
    expect(shareRes.expiresAt).toBeDefined();
  });
});

describe("Full Capture Execution Pipeline", () => {
  test("captureScreenshot executes fullscreen capture with annotations and metadata stripping", async () => {
    const res = await captureScreenshot({
      mode: "fullscreen",
      annotate: [{ type: "text", text: "System State", x: 10, y: 10 }],
      stripMetadata: true,
      share: true,
      copyToClipboard: true,
    });

    expect(res.success).toBe(true);
    expect(res.mode).toBe("fullscreen");
    expect(res.savePath).toContain(".png");
    expect(res.copyToClipboard).toBe(true);
    expect(res.annotationsCount).toBe(1);
    expect(res.metadataStripped).toBe(true);
    expect(res.shareUrl).toContain("https://cmdbar.share/upload/scr_");
    expect(res.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("captureScreenshot executes region mode capture with specified bounding box", async () => {
    const res = await captureScreenshot({
      mode: "region",
      region: [100, 150, 600, 400],
      copyToClipboard: false,
    });

    expect(res.success).toBe(true);
    expect(res.mode).toBe("region");
    expect(res.region).toEqual({ x: 100, y: 150, width: 600, height: 400 });
    expect(res.copyToClipboard).toBe(false);
  });

  test("captureScreenshot executes window mode capture", async () => {
    const res = await captureScreenshot({
      mode: "window",
      windowId: "win_12345",
    });

    expect(res.success).toBe(true);
    expect(res.mode).toBe("window");
  });
});

describe("ScreenshotManager Class", () => {
  test("ScreenshotManager exposes mode shortcuts and capture execution", async () => {
    const mgr = new ScreenshotManager({
      saveDir: "/tmp/screenshots",
      stripMetadata: true,
      autoCopy: true,
    });

    expect(mgr.getShortcut("fullscreen")).toBe("Super+Shift+3");
    expect(mgr.getShortcut("window")).toBe("Super+Shift+4");
    expect(mgr.getShortcut("region")).toBe("Super+Shift+5");

    const setSuccess = mgr.setShortcut("fullscreen", "Ctrl+Alt+S");
    expect(setSuccess).toBe(true);
    expect(mgr.getShortcut("fullscreen")).toBe("Ctrl+Alt+S");

    const captureRes = await mgr.capture("window", { copyToClipboard: true });
    expect(captureRes.success).toBe(true);
    expect(captureRes.mode).toBe("window");
    expect(captureRes.savePath).toContain("/tmp/screenshots/screenshot_");
  });
});
