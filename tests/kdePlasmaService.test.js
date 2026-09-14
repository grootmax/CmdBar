import fs from 'fs';
import path from 'path';
import os from 'os';
import {
    isKDEPlasma,
    getPlasmaThemePalette,
    formatForPlasmoid,
    getKWinRules,
    syncPlasmoidConfig,
    getKWalletConfig
} from '../extension/kdePlasmaService.js';

describe('KDE Plasma Integration Service Unit Tests', () => {
    const tempDir = path.join(os.tmpdir(), `cmdbar-kde-test-${Date.now()}`);
    const tempKdeglobals = path.join(tempDir, 'kdeglobals');

    beforeAll(() => {
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
    });

    afterAll(() => {
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('isKDEPlasma detects KDE desktop environment correctly', () => {
        expect(isKDEPlasma({ XDG_CURRENT_DESKTOP: 'KDE' })).toBe(true);
        expect(isKDEPlasma({ XDG_CURRENT_DESKTOP: 'KDE:Plasma' })).toBe(true);
        expect(isKDEPlasma({ KDE_FULL_SESSION: 'true' })).toBe(true);
        expect(isKDEPlasma({ CMDBAR_FORCE_KDE: '1' })).toBe(true);
        expect(isKDEPlasma({ XDG_CURRENT_DESKTOP: 'GNOME' })).toBe(false);
    });

    test('getPlasmaThemePalette parses kdeglobals correctly', () => {
        const kdeglobalsContent = `
[Colors:Window]
BackgroundNormal=42,46,50
ForegroundNormal=252,252,252

[Colors:Selection]
BackgroundNormal=61,174,233
`;
        fs.writeFileSync(tempKdeglobals, kdeglobalsContent, 'utf8');

        const palette = getPlasmaThemePalette(tempKdeglobals);
        expect(palette.darkMode).toBe(true);
        expect(palette.windowBackgroundColor).toBe('#2a2e32');
        expect(palette.windowTextColor).toBe('#fcfcfc');
        expect(palette.highlightColor).toBe('#3daee9');
    });

    test('getPlasmaThemePalette falls back gracefully when file is missing', () => {
        const palette = getPlasmaThemePalette('/non/existent/path/kdeglobals');
        expect(palette.darkMode).toBe(true);
        expect(palette.windowBackgroundColor).toBe('#2a2e32');
        expect(palette.highlightColor).toBe('#3daee9');
    });

    test('formatForPlasmoid converts category and command structures', () => {
        const sampleConfig = {
            categories: [
                {
                    name: 'Development',
                    commands: [
                        { name: 'Build', command: 'make build' },
                        { name: 'Deploy', command: 'kubectl deploy <app>', placeholder: 'app' }
                    ]
                }
            ]
        };

        const res = formatForPlasmoid(sampleConfig);
        expect(res.totalCommands).toBe(2);
        expect(res.categories.length).toBe(1);
        expect(res.categories[0].name).toBe('Development');
        expect(res.categories[0].commands[0].name).toBe('Build');
        expect(res.categories[0].commands[1].hasParameters).toBe(true);
    });

    test('getKWinRules provides expected window manager rules', () => {
        const rules = getKWinRules('CmdBar Popup');
        expect(rules.title).toBe('CmdBar Popup');
        expect(rules.keepAbove).toBe(true);
        expect(rules.defaultShortcut).toBe('Meta+Space');
    });

    test('syncPlasmoidConfig writes plasma configuration payload', () => {
        const targetConfig = path.join(tempDir, 'plasma_config.json');
        const sampleConfig = {
            categories: [
                { name: 'System', commands: [{ name: 'Uptime', command: 'uptime' }] }
            ]
        };

        const success = syncPlasmoidConfig(sampleConfig, targetConfig);
        expect(success).toBe(true);
        expect(fs.existsSync(targetConfig)).toBe(true);

        const content = JSON.parse(fs.readFileSync(targetConfig, 'utf8'));
        expect(content.plasmoidId).toBe('org.kde.cmdbar');
        expect(content.data.totalCommands).toBe(1);
    });

    test('getKWalletConfig returns correct D-Bus service parameter mapping', () => {
        const kwalletCfg = getKWalletConfig();
        expect(kwalletCfg.busName).toBe('org.kde.kwalletd5');
        expect(kwalletCfg.appName).toBe('CmdBar');
        expect(kwalletCfg.folder).toBe('CmdBar');
    });
});
