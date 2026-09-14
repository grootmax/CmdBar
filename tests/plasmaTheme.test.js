import { PlasmaThemeAdapter } from '../extension/plasmaTheme.js';

describe('Plasma Theme Adapter Unit Tests', () => {
    let theme;

    beforeEach(() => {
        theme = new PlasmaThemeAdapter({ isDark: true });
    });

    test('should build dark and light theme palettes', () => {
        const darkPalette = theme.getPalette();
        expect(darkPalette.windowBackground).toBe('#2a2e32');

        const lightPalette = theme.setDark(false);
        expect(lightPalette.windowBackground).toBe('#eff0f1');
        expect(theme.isDark).toBe(false);
    });

    test('should set scheme by name', () => {
        theme.setScheme('BreezeLight');
        expect(theme.isDark).toBe(false);

        theme.setScheme('BreezeDark');
        expect(theme.isDark).toBe(true);
    });

    test('should generate CSS variables string', () => {
        const css = theme.toCssVariables();
        expect(css).toContain('--plasma-window-bg:');
        expect(css).toContain('--plasma-highlight:');
    });

    test('should provide formatting colors for output rendering', () => {
        const colors = theme.getFormattingColors();
        expect(colors).toHaveProperty('key');
        expect(colors).toHaveProperty('string');
        expect(colors).toHaveProperty('border');
    });

    test('should notify theme change listeners', () => {
        let notifiedDark = null;
        theme.onThemeChanged((dark) => {
            notifiedDark = dark;
        });

        theme.setDark(false);
        expect(notifiedDark).toBe(false);
    });
});
