/**
 * Plasma Theme Adapter module for CmdBar KDE Plasma Integration.
 * Detects KDE Plasma theme settings (Breeze Light, Breeze Dark, custom KColorSchemes)
 * and generates matching UI styles, CSS variables, and output formatting colors.
 */

export class PlasmaThemeAdapter {
  constructor(options = {}) {
    this.isDark = options.isDark ?? true;
    this.schemeName = options.schemeName || (this.isDark ? "BreezeDark" : "BreezeLight");
    this._listeners = new Set();
    this._palette = this._buildPalette(this.isDark);
  }

  /**
   * Builds theme color palette map based on dark/light mode or custom scheme.
   * @param {boolean} dark
   * @returns {Object} Color values in hex
   */
  _buildPalette(dark) {
    if (dark) {
      return {
        windowBackground: "#2a2e32",
        windowText: "#fcfcfc",
        viewBackground: "#232629",
        viewText: "#fcfcfc",
        headerBackground: "#31363b",
        headerText: "#eff0f1",
        buttonBackground: "#31363b",
        buttonText: "#eff0f1",
        highlight: "#3daee9",
        highlightedText: "#ffffff",
        tooltipBackground: "#31363b",
        tooltipText: "#eff0f1",
        borderColor: "#4d4d4d",
        codeBackground: "#1b1e20",
        successColor: "#2ecc71",
        errorColor: "#e74c3c",
      };
    } else {
      return {
        windowBackground: "#eff0f1",
        windowText: "#232629",
        viewBackground: "#ffffff",
        viewText: "#232629",
        headerBackground: "#e3e5e7",
        headerText: "#232629",
        buttonBackground: "#e3e5e7",
        buttonText: "#232629",
        highlight: "#3daee9",
        highlightedText: "#ffffff",
        tooltipBackground: "#fcfcfc",
        tooltipText: "#232629",
        borderColor: "#bcbebf",
        codeBackground: "#f5f5f5",
        successColor: "#27ae60",
        errorColor: "#c0392b",
      };
    }
  }

  /**
   * Set theme mode (dark or light).
   * @param {boolean} dark
   */
  setDark(dark) {
    this.isDark = Boolean(dark);
    this.schemeName = this.isDark ? "BreezeDark" : "BreezeLight";
    this._palette = this._buildPalette(this.isDark);
    this._notify();
    return this._palette;
  }

  /**
   * Set scheme by name.
   * @param {string} scheme
   */
  setScheme(scheme) {
    if (!scheme || typeof scheme !== "string") return this._palette;
    const name = scheme.trim();
    this.schemeName = name;
    this.isDark = name.toLowerCase().includes("dark");
    this._palette = this._buildPalette(this.isDark);
    this._notify();
    return this._palette;
  }

  /**
   * Get active theme palette.
   * @returns {Object}
   */
  getPalette() {
    return { ...this._palette };
  }

  /**
   * Generates CSS custom variables string for Plasma theme styling.
   * @returns {string} CSS declaration string
   */
  toCssVariables() {
    const p = this._palette;
    return `
      :root {
        --plasma-window-bg: ${p.windowBackground};
        --plasma-window-fg: ${p.windowText};
        --plasma-view-bg: ${p.viewBackground};
        --plasma-view-fg: ${p.viewText};
        --plasma-button-bg: ${p.buttonBackground};
        --plasma-button-fg: ${p.buttonText};
        --plasma-highlight: ${p.highlight};
        --plasma-highlight-fg: ${p.highlightedText};
        --plasma-border: ${p.borderColor};
        --plasma-code-bg: ${p.codeBackground};
      }
    `.trim();
  }

  /**
   * Returns syntax highlighting colors for output formatters.
   * @returns {Object} Pango / HTML color tags
   */
  getFormattingColors() {
    const p = this._palette;
    return {
      key: p.highlight,
      string: p.successColor,
      number: "#f39c12",
      boolean: "#9b59b6",
      nullValue: "#95a5a6",
      border: p.borderColor,
      bg: p.codeBackground,
      fg: p.viewText,
    };
  }

  /**
   * Subscribe to theme change events.
   * @param {Function} callback
   */
  onThemeChanged(callback) {
    if (typeof callback === "function") {
      this._listeners.add(callback);
    }
    return () => this._listeners.delete(callback);
  }

  _notify() {
    for (const listener of this._listeners) {
      try {
        listener(this.isDark, this._palette);
      } catch (e) {}
    }
  }
}
