import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

describe('Centralized Documentation Structure & Build Automation', () => {
    const rootDir = process.cwd();
    const docsDir = path.join(rootDir, 'docs');
    const configPath = path.join(docsDir, 'config.json');
    const buildDir = path.join(rootDir, 'build');

    beforeAll(() => {
        // Run compile step to ensure build folder is fresh and compiled
        execSync('make compile', { cwd: rootDir });
    });

    test('Required documentation directories must exist', () => {
        const publicDir = path.join(docsDir, 'public');
        const developerDir = path.join(docsDir, 'developer');
        const brainstormingDir = path.join(docsDir, 'brainstorming');

        expect(fs.existsSync(publicDir)).toBe(true);
        expect(fs.existsSync(developerDir)).toBe(true);
        expect(fs.existsSync(brainstormingDir)).toBe(true);

        expect(fs.statSync(publicDir).isDirectory()).toBe(true);
        expect(fs.statSync(developerDir).isDirectory()).toBe(true);
        expect(fs.statSync(brainstormingDir).isDirectory()).toBe(true);
    });

    test('Configuration file docs/config.json must exist and be valid JSON', () => {
        expect(fs.existsSync(configPath)).toBe(true);
        const configContent = fs.readFileSync(configPath, 'utf8');
        const config = JSON.parse(configContent);

        expect(config).toHaveProperty('targets');
        expect(config.targets).toHaveProperty('public');
        expect(config.targets).toHaveProperty('developer');

        expect(config.targets.public.sources).toContain('docs/public');
        expect(config.targets.public.exclude).toContain('docs/brainstorming');
        expect(config.targets.public.exclude).toContain('docs/developer');

        expect(config.targets.developer.sources).toContain('docs/developer');
        expect(config.targets.developer.exclude).toContain('docs/brainstorming');
    });

    test('Running make compile must generate distinct public and developer HTML documentation targets', () => {
        const publicOutputIndex = path.join(buildDir, 'public', 'index.html');
        const developerOutputIndex = path.join(buildDir, 'developer', 'index.html');

        expect(fs.existsSync(publicOutputIndex)).toBe(true);
        expect(fs.existsSync(developerOutputIndex)).toBe(true);
    });

    test('Brainstorming folders and internal developer files must be omitted from the generated public HTML output', () => {
        const publicOutputDir = path.join(buildDir, 'public');
        
        // Ensure only public index.html is present under build/public
        const publicFiles = fs.readdirSync(publicOutputDir);
        expect(publicFiles).toContain('index.html');
        
        // Ensure no brainstorming or developer specific content exists in public index.html
        const publicIndexContent = fs.readFileSync(path.join(publicOutputDir, 'index.html'), 'utf8');
        expect(publicIndexContent).not.toContain('CmdBar Developer Specifications');
        expect(publicIndexContent).not.toContain('Raw Product Brainstorming Notes');
    });

    test('The generated pages must have relative sidebar links and correct active navigation highlight', () => {
        const publicIndexContent = fs.readFileSync(path.join(buildDir, 'public', 'index.html'), 'utf8');
        const developerIndexContent = fs.readFileSync(path.join(buildDir, 'developer', 'index.html'), 'utf8');

        // Check sidebar pages list
        expect(publicIndexContent).toContain('href="index.html"');
        expect(publicIndexContent).toContain('class="active"');

        expect(developerIndexContent).toContain('href="index.html"');
        expect(developerIndexContent).toContain('class="active"');
    });

    test('The generated API Reference pages must correctly apply visibility filters separating public versus internal targets', () => {
        const publicApiFile = path.join(buildDir, 'public', 'api.html');
        const developerApiFile = path.join(buildDir, 'developer', 'api.html');

        expect(fs.existsSync(publicApiFile)).toBe(true);
        expect(fs.existsSync(developerApiFile)).toBe(true);

        const publicApiContent = fs.readFileSync(publicApiFile, 'utf8');
        const developerApiContent = fs.readFileSync(developerApiFile, 'utf8');

        // Public API must contain public-annotated functions
        expect(publicApiContent).toContain('substituteCommand');
        expect(publicApiContent).toContain('validateInput');
        expect(publicApiContent).toContain('resolve_command_preview');
        expect(publicApiContent).toContain('validate_input');

        // Public API must NOT contain private/internal helper functions or GObject UI rendering logic
        expect(publicApiContent).not.toContain('_create_sidebar');
        expect(publicApiContent).not.toContain('getNodeUserConfigDir');
        expect(publicApiContent).not.toContain('CmdBarApp');

        // Developer API must contain both public and internal/private APIs
        expect(developerApiContent).toContain('substituteCommand');
        expect(developerApiContent).toContain('validateInput');
        expect(developerApiContent).toContain('resolve_command_preview');
        expect(developerApiContent).toContain('validate_input');
        
        expect(developerApiContent).toContain('_create_sidebar');
        expect(developerApiContent).toContain('getNodeUserConfigDir');
        expect(developerApiContent).toContain('CmdBarApp');
    });
});
