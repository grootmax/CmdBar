import assert from 'assert';
import { validateInput, hasPlaceholder, substituteCommand } from './extension/commandProcessor.js';

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
    assert.strictEqual(hasPlaceholder('make build'), false, 'Should return false when no placeholders exist');
    assert.strictEqual(hasPlaceholder(''), false, 'Should handle empty string gracefully');

    // 3. substituteCommand Tests
    assert.strictEqual(substituteCommand('echo <task-id>', '999'), 'echo 999', 'Should replace angle bracket placeholder');
    assert.strictEqual(substituteCommand('deploy {{service}}', 'api'), 'deploy api', 'Should replace double curly placeholder');
    assert.strictEqual(substituteCommand('echo <task-id> and <task-id>', '123'), 'echo 123 and 123', 'Should replace multiple placeholders');
    assert.strictEqual(substituteCommand(null, 'val'), '', 'Should handle null template gracefully');

    console.log('✅ Standalone verification tests completed successfully!');
    process.exit(0);
} catch (error) {
    console.error('❌ Standalone verification tests failed:');
    console.error(error);
    process.exit(1);
}
