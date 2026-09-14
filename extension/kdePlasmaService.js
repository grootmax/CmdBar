import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * KDE Plasma Integration Service for CmdBar.
 * Handles environment detection, Plasmoid data formatting, KWin window rules,
 * Breeze theme palette extraction, and KWallet D-Bus configuration.
 */

export function isKDEPlasma(env = process.env) {
    if (env.CMDBAR_FORCE_KDE === '1') {
        return true;
    }
    const desktop = (env.XDG_CURRENT_DESKTOP || '').toUpperCase();
    const session = (env.KDE_FULL_SESSION || '').toLowerCase();
    return desktop.includes('KDE') || desktop.includes('PLASMA') || session === 'true';
}

export function getPlasmaThemePalette(kdeglobalsPath = null) {
    const configPath = kdeglobalsPath || path.join(os.homedir(), '.config', 'kdeglobals');
    const defaultDark = {
        darkMode: true,
        windowBackgroundColor: '#2a2e32',
        windowTextColor: '#fcfcfc',
        viewBackgroundColor: '#232629',
        viewTextColor: '#fcfcfc',
        buttonBackgroundColor: '#31363b',
        buttonTextColor: '#fcfcfc',
        highlightColor: '#3daee9',
        highlightedTextColor: '#ffffff',
        borderColor: '#4d4d4d'
    };

    if (!fs.existsSync(configPath)) {
        return defaultDark;
    }

    try {
        const content = fs.readFileSync(configPath, 'utf8');
        const sections = {};
        let currentSection = null;

        for (const line of content.split('\n')) {
            const trimmed = line.trim();
            if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
                currentSection = trimmed.slice(1, -1);
                sections[currentSection] = {};
            } else if (currentSection && trimmed.includes('=')) {
                const [key, ...valParts] = trimmed.split('=');
                sections[currentSection][key.trim()] = valParts.join('=').trim();
            }
        }

        const parseRgb = (sec, key, fallback) => {
            if (sections[sec] && sections[sec][key]) {
                const parts = sections[sec][key].split(',').map(p => parseInt(p.trim(), 10)).filter(n => !isNaN(n));
                if (parts.length >= 3) {
                    const toHex = (n) => n.toString(16).padStart(2, '0');
                    return `#${toHex(parts[0])}${toHex(parts[1])}${toHex(parts[2])}`;
                }
            }
            return fallback;
        };

        const windowBg = parseRgb('Colors:Window', 'BackgroundNormal', '#2a2e32');
        const windowFg = parseRgb('Colors:Window', 'ForegroundNormal', '#fcfcfc');

        // Estimate luminance
        const rgbMatch = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(windowBg);
        let darkMode = true;
        if (rgbMatch) {
            const r = parseInt(rgbMatch[1], 16);
            const g = parseInt(rgbMatch[2], 16);
            const b = parseInt(rgbMatch[3], 16);
            const lum = 0.299 * r + 0.587 * g + 0.114 * b;
            darkMode = lum < 128;
        }

        return {
            darkMode,
            windowBackgroundColor: windowBg,
            windowTextColor: windowFg,
            viewBackgroundColor: parseRgb('Colors:View', 'BackgroundNormal', darkMode ? '#232629' : '#ffffff'),
            viewTextColor: parseRgb('Colors:View', 'ForegroundNormal', darkMode ? '#fcfcfc' : '#232629'),
            buttonBackgroundColor: parseRgb('Colors:Button', 'BackgroundNormal', darkMode ? '#31363b' : '#eff0f1'),
            buttonTextColor: parseRgb('Colors:Button', 'ForegroundNormal', darkMode ? '#fcfcfc' : '#232629'),
            highlightColor: parseRgb('Colors:Selection', 'BackgroundNormal', '#3daee9'),
            highlightedTextColor: parseRgb('Colors:Selection', 'ForegroundNormal', '#ffffff'),
            borderColor: darkMode ? '#4d4d4d' : '#bcbebf'
        };
    } catch (err) {
        return defaultDark;
    }
}

export function formatForPlasmoid(configData) {
    if (!configData || typeof configData !== 'object') {
        return { categories: [], totalCommands: 0 };
    }

    const categories = configData.categories || [];
    let totalCount = 0;

    const formattedCategories = categories.map(cat => {
        const rawCmds = cat.commands || cat.shortcuts || [];
        const formattedCmds = rawCmds.map(cmd => {
            totalCount++;
            const templateStr = cmd.template || cmd.command || '';
            const hasParams = templateStr.includes('<') || templateStr.includes('{') || templateStr.includes('{{');
            return {
                name: cmd.name || 'Unnamed Command',
                command: templateStr,
                category: cat.name || 'General',
                hasParameters: hasParams,
                placeholder: cmd.placeholder || '',
                parameters: cmd.parameters || {},
                icon: cmd.icon || 'utilities-terminal'
            };
        });

        return {
            name: cat.name || 'Uncategorized',
            commands: formattedCmds,
            count: formattedCmds.length
        };
    });

    return {
        categories: formattedCategories,
        totalCommands: totalCount
    };
}

export function getKWinRules(windowTitle = 'CmdBar') {
    return {
        title: windowTitle,
        keepAbove: true,
        skipTaskbar: true,
        skipPager: true,
        noBorder: true,
        centerOnScreen: true,
        defaultShortcut: 'Meta+Space',
        placement: 'Center',
        windowType: 'Normal'
    };
}

export function syncPlasmoidConfig(configData, targetPath = null) {
    const destPath = targetPath || path.join(os.homedir(), '.config', 'cmdbar', 'plasma_config.json');
    const formatted = formatForPlasmoid(configData);
    const plasmaPayload = {
        updatedAt: new Date().toISOString(),
        plasmoidId: 'org.kde.cmdbar',
        version: '1.0.0',
        kwinRules: getKWinRules(),
        theme: getPlasmaThemePalette(),
        data: formatted
    };

    try {
        const dir = path.dirname(destPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(destPath, JSON.stringify(plasmaPayload, null, 2), 'utf8');
        return true;
    } catch (err) {
        return false;
    }
}

export function getKWalletConfig() {
    return {
        busName: 'org.kde.kwalletd5',
        alternateBusName: 'org.kde.kwalletd6',
        objectPath: '/modules/kwalletd5',
        interfaceName: 'org.kde.KWallet',
        appName: 'CmdBar',
        defaultWallet: 'kdewallet',
        folder: 'CmdBar'
    };
}
