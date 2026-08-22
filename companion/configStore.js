import fs from 'fs';
import path from 'path';
import os from 'os';

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

    // 2. Generate temporary file path in the SAME directory using standardized .tmp naming
    const tempPath = targetPath + '.tmp';

    // Preserve permissions if destination exists
    let mode;
    if (fs.existsSync(targetPath)) {
        try {
            mode = fs.statSync(targetPath).mode;
        } catch (e) {}
    }

    try {
        const jsonString = typeof configData === 'string' ? configData : JSON.stringify(configData, null, 2);

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

    // 2. Generate temporary file path in the SAME directory using standardized .tmp naming
    const tempPath = targetPath + '.tmp';

    let mode;
    if (fs.existsSync(targetPath)) {
        try {
            const stats = await fs.promises.stat(targetPath);
            mode = stats.mode;
        } catch (e) {}
    }

    try {
        const jsonString = typeof configData === 'string' ? configData : JSON.stringify(configData, null, 2);

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
