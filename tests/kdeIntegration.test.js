import fs from 'fs';
import path from 'path';

describe('KDE Plasma Plasmoid & Environment Integration Tests', () => {
    const rootDir = process.cwd();
    const plasmoidDir = path.join(rootDir, 'plasma', 'plasmoids', 'org.kde.cmdbar');
    const metadataPath = path.join(plasmoidDir, 'metadata.json');
    const mainQmlPath = path.join(plasmoidDir, 'contents', 'ui', 'main.qml');
    const compactQmlPath = path.join(plasmoidDir, 'contents', 'ui', 'CompactRepresentation.qml');
    const fullQmlPath = path.join(plasmoidDir, 'contents', 'ui', 'FullRepresentation.qml');
    const configQmlPath = path.join(plasmoidDir, 'contents', 'ui', 'ConfigGeneral.qml');
    const makefilePath = path.join(rootDir, 'Makefile');

    test('Plasmoid metadata.json exists and contains valid KPlugin specification', () => {
        expect(fs.existsSync(metadataPath)).toBe(true);
        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));

        expect(metadata).toHaveProperty('KPlugin');
        expect(metadata.KPlugin.Id).toBe('org.kde.cmdbar');
        expect(metadata.KPlugin.Name).toBe('CmdBar');
        expect(metadata.KPlugin.Category).toBe('Utilities');
        expect(metadata.KPackageStructure).toBe('Plasma/Applet');
        expect(metadata['X-Plasma-API']).toBe('declarativeappletscript');
    });

    test('All required QML UI representation files exist', () => {
        expect(fs.existsSync(mainQmlPath)).toBe(true);
        expect(fs.existsSync(compactQmlPath)).toBe(true);
        expect(fs.existsSync(fullQmlPath)).toBe(true);
        expect(fs.existsSync(configQmlPath)).toBe(true);

        const mainContent = fs.readFileSync(mainQmlPath, 'utf8');
        expect(mainContent).toContain('Plasmoid.compactRepresentation');
        expect(mainContent).toContain('Plasmoid.fullRepresentation');

        const fullContent = fs.readFileSync(fullQmlPath, 'utf8');
        expect(fullContent).toContain('Search commands');
        expect(fullContent).toContain('Kirigami');

        const configContent = fs.readFileSync(configQmlPath, 'utf8');
        expect(configContent).toContain('cfg_shortcut');
        expect(configContent).toContain('cfg_enableKWallet');
    });

    test('Makefile defines install-kde and uninstall-kde targets', () => {
        expect(fs.existsSync(makefilePath)).toBe(true);
        const makefileContent = fs.readFileSync(makefilePath, 'utf8');

        expect(makefileContent).toContain('install-kde:');
        expect(makefileContent).toContain('uninstall-kde:');
        expect(makefileContent).toContain('org.kde.cmdbar');
    });
});
