import {
  formatShortcutHint,
  parseAccel,
} from "../extension/commandProcessor.js";

describe("Global Shortcut Formatting and Parsing", () => {
  test("formatShortcutHint should format Super+Space by default", () => {
    expect(formatShortcutHint([])).toBe("Super+Space");
    expect(formatShortcutHint(null)).toBe("Super+Space");
    expect(formatShortcutHint(["<Super>space"])).toBe("Super+Space");
  });

  test("formatShortcutHint should format alternative shortcuts and custom shortcuts", () => {
    expect(formatShortcutHint(["<Alt>space"])).toBe("Alt+Space");
    expect(formatShortcutHint(["<Super><Shift>space"])).toBe(
      "Super+Shift+Space",
    );
    expect(formatShortcutHint(["<Control><Alt>a"])).toBe("Ctrl+Alt+A");
  });

  test("parseAccel should parse modifier combinations and base keys", () => {
    expect(parseAccel("Super+Space")).toEqual(["<Super>space"]);
    expect(parseAccel("Alt+Space")).toEqual(["<Alt>space"]);
    expect(parseAccel("Super+Shift+Space")).toEqual(["<Super><Shift>space"]);
    expect(parseAccel("Ctrl+Alt+x")).toEqual(["<Control><Alt>x"]);
    expect(parseAccel("<Super>space")).toEqual(["<Super>space"]);
  });
});
