import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

export function normalizePath(p) {
    return p.replace(/\\/g, '/');
}

export function isSourceFile(filePath) {
    const p = normalizePath(filePath);
    return p.startsWith('app/') || p.startsWith('extension/') || p.startsWith('companion/');
}

export function isDocFile(filePath) {
    const p = normalizePath(filePath);
    return p.startsWith('docs/') || p === 'README.md';
}

export function checkLineHasDocstring(line) {
    if (!line.startsWith('+') || line.startsWith('+++')) {
        return false;
    }
    const content = line.slice(1);

    if (content.includes('"""') || content.includes("'''")) {
        return true;
    }

    if (content.includes('/**') || content.includes('*/') || /\*\s*@/.test(content)) {
        return true;
    }

    if (/@(public|param|returns|return|description|module|class|function|see|example|typedef|property|doc|type)\b/.test(content) || content.includes(':visibility:')) {
        return true;
    }

    if (/^\s*#/.test(content)) {
        return true;
    }

    if (/^\s*\/\/(?!\/)/.test(content)) {
        return true;
    }

    return false;
}

export function getGitDiffFiles(rootDir = process.cwd()) {
    const files = new Set();
    const runGit = (cmd) => {
        try {
            return execSync(cmd, { cwd: rootDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
        } catch (e) {
            return '';
        }
    };

    const statusOutput = runGit('git status --porcelain');
    if (statusOutput) {
        statusOutput.split('\n').forEach(line => {
            if (line.length > 3) {
                const rawPath = line.substring(3).trim();
                if (rawPath.includes('->')) {
                    rawPath.split('->').forEach(p => files.add(normalizePath(p.trim())));
                } else {
                    files.add(normalizePath(rawPath));
                }
            }
        });
    }

    const diffHeadOutput = runGit('git diff --name-only HEAD');
    if (diffHeadOutput) {
        diffHeadOutput.split('\n').forEach(f => f.trim() && files.add(normalizePath(f.trim())));
    }

    let baseRef = '';
    const possibleBases = ['origin/main', 'main', 'origin/master', 'master'];
    for (const base of possibleBases) {
        const mb = runGit(`git merge-base ${base} HEAD`);
        if (mb) {
            baseRef = mb;
            break;
        }
    }

    if (baseRef) {
        const branchDiffOutput = runGit(`git diff --name-only ${baseRef}...HEAD`);
        if (branchDiffOutput) {
            branchDiffOutput.split('\n').forEach(f => f.trim() && files.add(normalizePath(f.trim())));
        }
    } else {
        const prevDiffOutput = runGit('git diff --name-only HEAD~1 HEAD');
        if (prevDiffOutput) {
            prevDiffOutput.split('\n').forEach(f => f.trim() && files.add(normalizePath(f.trim())));
        }
    }

    return Array.from(files);
}

export function checkFileHasDocstringEdits(filePath, rootDir = process.cwd()) {
    const runGit = (cmd) => {
        try {
            return execSync(cmd, { cwd: rootDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
        } catch (e) {
            return '';
        }
    };

    const uncommittedDiff = runGit(`git diff -U0 HEAD -- "${filePath}"`);
    if (uncommittedDiff) {
        const lines = uncommittedDiff.split('\n');
        for (const line of lines) {
            if (checkLineHasDocstring(line)) {
                return true;
            }
        }
    }

    let baseRef = '';
    const possibleBases = ['origin/main', 'main', 'origin/master', 'master'];
    for (const base of possibleBases) {
        const mb = runGit(`git merge-base ${base} HEAD`);
        if (mb) {
            baseRef = mb;
            break;
        }
    }

    if (baseRef) {
        const branchDiff = runGit(`git diff -U0 ${baseRef}...HEAD -- "${filePath}"`);
        if (branchDiff) {
            const lines = branchDiff.split('\n');
            for (const line of lines) {
                if (checkLineHasDocstring(line)) {
                    return true;
                }
            }
        }
    }

    return false;
}

export function checkDocFreshness(fileList = null, docstringChecker = null, rootDir = process.cwd()) {
    const files = fileList !== null ? fileList.map(normalizePath) : getGitDiffFiles(rootDir);
    const modifiedSourceFiles = files.filter(f => isSourceFile(f));

    if (modifiedSourceFiles.length === 0) {
        return {
            passed: true,
            modifiedSourceFiles: [],
            undocumentedFiles: [],
            message: 'No modified application or extension source files found in Git diff.'
        };
    }

    const modifiedDocFiles = files.filter(f => isDocFile(f));
    if (modifiedDocFiles.length > 0) {
        return {
            passed: true,
            modifiedSourceFiles,
            undocumentedFiles: [],
            message: `Documentation updates found in documentation directories/files (${modifiedDocFiles.join(', ')}).`
        };
    }

    const undocumentedFiles = [];
    for (const sourceFile of modifiedSourceFiles) {
        const hasDocstring = docstringChecker ? docstringChecker(sourceFile) : checkFileHasDocstringEdits(sourceFile, rootDir);
        if (!hasDocstring) {
            undocumentedFiles.push(sourceFile);
        }
    }

    if (undocumentedFiles.length > 0) {
        return {
            passed: false,
            modifiedSourceFiles,
            undocumentedFiles,
            message: `Documentation drift detected! The following modified source files require documentation updates in 'docs/' (or 'README.md') or inline docstrings:\n` +
                undocumentedFiles.map(f => `  - ${f}`).join('\n')
        };
    }

    return {
        passed: true,
        modifiedSourceFiles,
        undocumentedFiles: [],
        message: 'All modified source files include inline docstring or comment updates.'
    };
}

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

    test('Doc Freshness Assertion: Running checkDocFreshness on branch with application code changes and no documentation updates results in a failed test', () => {
        const result = checkDocFreshness(['app/main.py', 'extension/extension.js'], () => false);
        expect(result.passed).toBe(false);
        expect(result.undocumentedFiles).toEqual(['app/main.py', 'extension/extension.js']);
        expect(result.message).toContain('app/main.py');
        expect(result.message).toContain('extension/extension.js');
    });

    test('Doc Freshness Assertion: Running checkDocFreshness on branch with application code changes and documentation edits passes cleanly', () => {
        const resultWithDocs = checkDocFreshness(['app/main.py', 'docs/developer/index.md'], () => false);
        expect(resultWithDocs.passed).toBe(true);
        expect(resultWithDocs.undocumentedFiles).toEqual([]);

        const resultWithReadme = checkDocFreshness(['extension/extension.js', 'README.md'], () => false);
        expect(resultWithReadme.passed).toBe(true);
        expect(resultWithReadme.undocumentedFiles).toEqual([]);
    });

    test('Doc Freshness Assertion: Running checkDocFreshness on branch with application code changes and docstrings passes cleanly', () => {
        const resultWithDocstrings = checkDocFreshness(['app/main.py'], (file) => file === 'app/main.py');
        expect(resultWithDocstrings.passed).toBe(true);
        expect(resultWithDocstrings.undocumentedFiles).toEqual([]);
    });

    test('Doc Freshness Assertion: Live Git diff doc freshness check in test runner', () => {
        const result = checkDocFreshness();
        if (!result.passed) {
            throw new Error(result.message);
        }
        expect(result.passed).toBe(true);
    });
});

