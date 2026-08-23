import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

function canonicalJson(obj) {
    if (obj === null || typeof obj !== 'object') {
        return JSON.stringify(obj);
    }
    if (Array.isArray(obj)) {
        return '[' + obj.map(canonicalJson).join(',') + ']';
    }
    const sortedKeys = Object.keys(obj).filter(k => k !== 'signature').sort();
    const parts = sortedKeys.map(k => JSON.stringify(k) + ':' + canonicalJson(obj[k]));
    return '{' + parts.join(',') + '}';
}

function getOrCreateSigningKeySync(keyPath) {
    const dir = path.dirname(keyPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    if (fs.existsSync(keyPath)) {
        return fs.readFileSync(keyPath, 'utf8').trim();
    }
    const key = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(keyPath, key, { mode: 0o600 });
    return key;
}

async function getOrCreateSigningKeyAsync(keyPath) {
    const dir = path.dirname(keyPath);
    await fs.promises.mkdir(dir, { recursive: true });
    if (fs.existsSync(keyPath)) {
        return (await fs.promises.readFile(keyPath, 'utf8')).trim();
    }
    const key = crypto.randomBytes(32).toString('hex');
    await fs.promises.writeFile(keyPath, key, { mode: 0o600 });
    return key;
}

function computeSignatureSync(config, key) {
    const str = canonicalJson(config);
    return crypto.createHmac('sha256', key).update(str).digest('hex');
}

/**
 * Gets the standard configuration directory for cmdbar.
 * Respects XDG_CONFIG_HOME if set, otherwise defaults to ~/.config/cmdbar
 */
export function getConfigDir() {
    const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    return path.join(configHome, 'cmdbar');
}

/**
 * Gets the standard commands.json file path.
 * @public
 */
export function getConfigPath() {
    return path.join(getConfigDir(), 'config.json');
}

/**
 * Acquires a cooperative lock file synchronously.
 */
export function acquireLockSync(lockPath, timeoutMs = 500) {
    const start = Date.now();
    while (true) {
        try {
            fs.writeFileSync(
                lockPath,
                JSON.stringify({ pid: process.pid, timestamp: Date.now() }),
                { flag: 'wx' }
            );
            return true;
        } catch (err) {
            try {
                const stats = fs.statSync(lockPath);
                if (Date.now() - stats.mtimeMs > 1000) {
                    fs.unlinkSync(lockPath);
                }
            } catch (statErr) {
                // Ignore stat/unlink errors
            }

            if (Date.now() - start >= timeoutMs) {
                throw new Error('Lock acquisition timeout');
            }
            const endSleep = Date.now() + 15;
            while (Date.now() < endSleep) {}
        }
    }
}

/**
 * Releases a cooperative lock file.
 */
export function releaseLockSync(lockPath) {
    try {
        if (fs.existsSync(lockPath)) {
            fs.unlinkSync(lockPath);
        }
    } catch (err) {
        // Ignore
    }
}

/**
 * Writes the configuration data atomically (synchronously).
 * 1. Ensures the target directory exists.
 * 2. Writes the JSON content to a temporary file in the same directory.
 * 3. Atomic rename/swap to replace the target file.
 * 
 * @param {object} configData - The configuration object to save.
 * @param {string} [customPath] - Optional custom path for testing.
 * @public
 */
export function saveConfigAtomically(configData, customPath) {
    const targetPath = customPath || getConfigPath();
    const targetDir = path.dirname(targetPath);

    // 1. Ensure target directory exists
    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }

    if (configData && typeof configData === 'object' && (Array.isArray(configData.categories) || configData.commands || configData.signature !== undefined)) {
        const keyPath = path.join(targetDir, '.key');
        const key = getOrCreateSigningKeySync(keyPath);
        configData.signature = computeSignatureSync(configData, key);
    }

    let mode;
    if (fs.existsSync(targetPath)) {
        try {
            mode = fs.statSync(targetPath).mode;
        } catch (e) {}
    }

    // 2. Generate temporary file path in the SAME directory
    // Same directory is critical to guarantee the temp file resides on the same filesystem/mount point,
    // enabling an atomic `rename` operation.
    const tempPath = `${targetPath}.${Date.now()}.${Math.random().toString(36).substring(2, 8)}.tmp`;

    let mode;
    if (fs.existsSync(targetPath)) {
        try {
            mode = fs.statSync(targetPath).mode;
        } catch (e) {}
    }

    try {
        const jsonString = JSON.stringify(configData, null, 2);

        // 3. Write JSON content to temporary file
        fs.writeFileSync(tempPath, jsonString, 'utf8');
        if (mode !== undefined) {
            try {
                fs.chmodSync(tempPath, mode);
            } catch (e) {}
        }

        // 4. Atomic rename/swap operation
        fs.renameSync(tempPath, targetPath);
    } catch (error) {
        // Clean up the temporary file if it was created and write failed/errored
        try {
            if (fs.existsSync(tempPath)) {
                fs.unlinkSync(tempPath);
            }
        } catch (cleanupError) {
            // Ignore cleanup errors
        }
        throw error;
    }
}

/**
 * Writes the configuration data atomically (asynchronously).
 * 1. Ensures the target directory exists.
 * 2. Writes the JSON content to a temporary file in the same directory.
 * 3. Atomic rename/swap to replace the target file.
 * 
 * @param {object} configData - The configuration object to save.
 * @param {string} [customPath] - Optional custom path for testing.
 */
export async function saveConfigAtomicallyAsync(configData, customPath) {
    const targetPath = customPath || getConfigPath();
    const targetDir = path.dirname(targetPath);

    // 1. Ensure target directory exists
    await fs.promises.mkdir(targetDir, { recursive: true });

    if (configData && typeof configData === 'object' && (Array.isArray(configData.categories) || configData.commands || configData.signature !== undefined)) {
        const keyPath = path.join(targetDir, '.key');
        const key = await getOrCreateSigningKeyAsync(keyPath);
        configData.signature = computeSignatureSync(configData, key);
    }

    // 2. Generate temporary file path in the SAME directory
    const tempPath = `${targetPath}.${Date.now()}.${Math.random().toString(36).substring(2, 8)}.tmp`;

    let mode;
    if (fs.existsSync(targetPath)) {
        try {
            const stats = await fs.promises.stat(targetPath);
            mode = stats.mode;
        } catch (e) {}
    }

    try {
        const jsonString = JSON.stringify(configData, null, 2);

        // 3. Write JSON content to temporary file
        await fs.promises.writeFile(tempPath, jsonString, 'utf8');
        if (mode !== undefined) {
            try {
                await fs.promises.chmod(tempPath, mode);
            } catch (e) {}
        }

        // 4. Atomic rename/swap operation
        await fs.promises.rename(tempPath, targetPath);
    } catch (error) {
        // Clean up the temporary file if it was created and write failed/errored
        try {
            if (fs.existsSync(tempPath)) {
                await fs.promises.unlink(tempPath);
            }
        } catch (cleanupError) {
            // Ignore cleanup errors
        }
        throw error;
    }
}
