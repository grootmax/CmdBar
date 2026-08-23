import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { validateInput, hasPlaceholder, substituteCommand, fuzzyMatch, highlightMatches, rankCommands, detectGitRepo, getGitStateSync, substituteGitPlaceholders, hasNonGitPlaceholders } from './extension/commandProcessor.js';
import { saveConfigAtomically, saveConfigAtomicallyAsync } from './companion/configStore.js';

console.log('Running standalone verification tests...');

try {
    // 1. validateInput Tests
    assert.strictEqual(validateInput(''), false, 'Empty input should fail validation');
    assert.strictEqual(validateInput('   '), false, 'Whitespace input should fail validation');
    assert.strictEqual(validateInput(null), false, 'Null input should fail validation');
    assert.strictEqual(validateInput(undefined), false, 'Undefined input should fail validation');
    assert.strictEqual(validateInput('my-val'), true, 'Valid string input should pass validation');
    assert.strictEqual(validateInput('  my-val  '), true, 'Padded string input should pass validation');

    // 2. hasPlaceholder Tests
    assert.strictEqual(hasPlaceholder('echo <task-id>'), true, 'Should detect <...> placeholder');
    assert.strictEqual(hasPlaceholder('deploy {{service}}'), true, 'Should detect {{...}} placeholder');
    assert.strictEqual(hasPlaceholder('git checkout {branch}'), true, 'Should detect {...} single brace placeholder');
    assert.strictEqual(hasPlaceholder('make build'), false, 'Should return false when no placeholders exist');
    assert.strictEqual(hasPlaceholder(''), false, 'Should handle empty string gracefully');

    // 3. substituteCommand Tests
    assert.strictEqual(substituteCommand('echo <task-id>', '999'), 'echo 999', 'Should replace angle bracket placeholder');
    assert.strictEqual(substituteCommand('deploy {{service}}', 'api'), 'deploy api', 'Should replace double curly placeholder');
    assert.strictEqual(substituteCommand('git checkout {branch}', 'main'), 'git checkout main', 'Should replace single curly placeholder');
    assert.strictEqual(substituteCommand('echo <task-id> and <task-id>', '123'), 'echo 123 and 123', 'Should replace multiple placeholders');
    assert.strictEqual(substituteCommand(null, 'val'), '', 'Should handle null template gracefully');

    // 4. Fuzzy Matching & Highlighting Tests
    const res = fuzzyMatch('gp', 'git push origin');
    assert.strictEqual(res.match, true, 'gp should match git push origin');
    assert.deepStrictEqual(res.matches, [0, 4], 'gp should match indices 0 and 4');
    assert.strictEqual(highlightMatches('git push origin', res.matches), '<b>g</b>it <b>p</b>ush origin', 'Should highlight matched chars');

    const ranked = rankCommands([
        { name: 'Git Push', command: 'git push origin' },
        { name: 'Git Pull', command: 'git pull origin' }
    ], 'gp', { 'git pull origin': 5 });
    assert.strictEqual(ranked[0].command.name, 'Git Pull', 'Should rank higher usage frequency first');

    // 5. Git Integration Tests
    assert.strictEqual(detectGitRepo('/app/CmdBar'), true, 'Should detect /app/CmdBar as a git repository');
    const gitState = getGitStateSync('/app/CmdBar');
    assert.strictEqual(gitState.isGitRepo, true, 'Git state should confirm git repo');
    assert.strictEqual(typeof gitState.branch, 'string', 'Branch should be string');
    assert.strictEqual(substituteGitPlaceholders('git push origin {git-branch}', { branch: 'main' }), 'git push origin main', 'Should substitute {git-branch}');
    assert.strictEqual(hasNonGitPlaceholders('git push origin {git-branch}'), false, 'Should have no non-git placeholders');
    assert.strictEqual(hasNonGitPlaceholders('git commit -m "<msg>" on {git-branch}'), true, 'Should detect <msg> non-git placeholder');

    // 4. Atomic Persistence Tests (Sync & Async)
    const tempDir = path.join(os.tmpdir(), `cmdbar-standalone-test-${Date.now()}`);
    const tempFile = path.join(tempDir, 'config.json');

    // Synchronous write test
    const testDataSync = { val: 'sync-data' };
    saveConfigAtomically(testDataSync, tempFile);
    assert.strictEqual(fs.existsSync(tempFile), true, 'Temp file should be created synchronously');
    const readDataSync = JSON.parse(fs.readFileSync(tempFile, 'utf8'));
    assert.deepStrictEqual(readDataSync, testDataSync, 'Written data should match source data (sync)');

    // Asynchronous write test
    const testDataAsync = { val: 'async-data' };
    await saveConfigAtomicallyAsync(testDataAsync, tempFile);
    assert.strictEqual(fs.existsSync(tempFile), true, 'Temp file should be created asynchronously');
    const readDataAsync = JSON.parse(fs.readFileSync(tempFile, 'utf8'));
    assert.deepStrictEqual(readDataAsync, testDataAsync, 'Written data should match source data (async)');

    // Cleanup temp files & dir
    if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }

    console.log('✅ Standalone verification tests completed successfully!');
    process.exit(0);
} catch (error) {
    console.error('❌ Standalone verification tests failed:');
    console.error(error);
    process.exit(1);
}
