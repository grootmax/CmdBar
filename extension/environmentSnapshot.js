import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import {
  loadConfig,
  saveConfig,
  getDefaultConfigPath,
  loadClipboardHistory,
  saveClipboardHistory,
  getDefaultClipboardPath,
  canonicalJson
} from './configSync.js';

export function getBackupsDir(customPath = null) {
  if (customPath) return customPath;
  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(configHome, 'cmdbar', 'backups');
}

export function computeSnapshotSignature(snapshotObj, secretKey) {
  const clean = { ...snapshotObj };
  delete clean.signature;
  const canonical = canonicalJson(clean);
  return crypto.createHmac('sha256', secretKey).update(canonical).digest('hex');
}

function deriveKeys(passphrase, salt) {
  const dk = crypto.pbkdf2Sync(passphrase, salt, 100000, 64, 'sha256');
  return {
    encKey: dk.subarray(0, 32),
    macKey: dk.subarray(32, 64)
  };
}

function generateKeystream(encKey, length) {
  const blocks = [];
  let generated = 0;
  let counter = 0;
  while (generated < length) {
    const counterBuf = Buffer.alloc(4);
    counterBuf.writeUInt32BE(counter, 0);
    const block = crypto.createHmac('sha256', encKey).update(counterBuf).digest();
    blocks.push(block);
    generated += block.length;
    counter++;
  }
  return Buffer.concat(blocks).subarray(0, length);
}

export function encryptPayload(dataString, passphrase) {
  const salt = crypto.randomBytes(16);
  const { encKey, macKey } = deriveKeys(passphrase, salt);
  const dataBuf = Buffer.from(dataString, 'utf8');
  const keystream = generateKeystream(encKey, dataBuf.length);
  const cipherBuf = Buffer.alloc(dataBuf.length);
  for (let i = 0; i < dataBuf.length; i++) {
    cipherBuf[i] = dataBuf[i] ^ keystream[i];
  }
  const tag = crypto.createHmac('sha256', macKey).update(cipherBuf).digest('hex');

  return {
    encrypted: true,
    salt: salt.toString('hex'),
    tag: tag,
    data: cipherBuf.toString('hex')
  };
}

export function decryptPayload(encryptedObj, passphrase) {
  if (!encryptedObj || !encryptedObj.encrypted || !encryptedObj.salt || !encryptedObj.data || !encryptedObj.tag) {
    throw new Error('Invalid encrypted payload structure');
  }
  const salt = Buffer.from(encryptedObj.salt, 'hex');
  const cipherBuf = Buffer.from(encryptedObj.data, 'hex');
  const { encKey, macKey } = deriveKeys(passphrase, salt);

  const expectedTag = crypto.createHmac('sha256', macKey).update(cipherBuf).digest('hex');
  if (crypto.timingSafeEqual ? !crypto.timingSafeEqual(Buffer.from(encryptedObj.tag, 'hex'), Buffer.from(expectedTag, 'hex')) : encryptedObj.tag !== expectedTag) {
    throw new Error('Incorrect passphrase or corrupted encrypted payload');
  }

  const keystream = generateKeystream(encKey, cipherBuf.length);
  const plainBuf = Buffer.alloc(cipherBuf.length);
  for (let i = 0; i < cipherBuf.length; i++) {
    plainBuf[i] = cipherBuf[i] ^ keystream[i];
  }

  return plainBuf.toString('utf8');
}

export async function exportEnvironmentSnapshot(options = {}) {
  const {
    configPath,
    clipboardPath,
    stylesheetPath,
    description = 'CmdBar Environment Snapshot',
    includeHistory = true,
    includeThemes = true,
    includeConfig = true,
    passphrase = null,
    outputPath = null
  } = options;

  const cfgPath = configPath || (await getDefaultConfigPath());
  const clipPath = clipboardPath || (await getDefaultClipboardPath());
  const stylePath = stylesheetPath || path.join(path.dirname(cfgPath), 'stylesheet.css');

  let configData = null;
  if (includeConfig) {
    configData = await loadConfig(cfgPath);
  }

  let historyData = null;
  if (includeHistory) {
    historyData = await loadClipboardHistory(clipPath);
  }

  let themeData = null;
  if (includeThemes) {
    let customCss = '';
    if (fs.existsSync(stylePath)) {
      try {
        customCss = fs.readFileSync(stylePath, 'utf8');
      } catch (e) {}
    }
    themeData = {
      mode: (configData && configData.theme) ? configData.theme : 'dark',
      custom_stylesheet: customCss
    };
  }

  const timestamp = new Date().toISOString();
  const randomHex = crypto.randomBytes(6).toString('hex');
  const snapshotId = `snap_${Date.now()}_${randomHex}`;

  const snapshot = {
    $schema: 'cmdbar-environment-snapshot/v1',
    version: 1,
    snapshot_id: snapshotId,
    created_at: timestamp,
    description: description,
    metadata: {
      app_name: 'CmdBar',
      app_version: '1.0.0',
      hostname: os.hostname ? os.hostname() : 'localhost',
      platform: process.platform || 'linux',
      user: os.userInfo ? (os.userInfo().username || 'user') : 'user'
    },
    config: configData,
    history: historyData ? { clipboard: historyData } : null,
    themes: themeData
  };

  const secretKey = 'cmdbar_snapshot_secret_key_v1';
  snapshot.signature = computeSnapshotSignature(snapshot, secretKey);

  let finalOutput;
  if (passphrase) {
    const rawJson = JSON.stringify(snapshot, null, 2);
    const enc = encryptPayload(rawJson, passphrase);
    finalOutput = {
      $schema: 'cmdbar-environment-snapshot/v1',
      version: 1,
      snapshot_id: snapshotId,
      created_at: timestamp,
      encrypted_payload: enc
    };
  } else {
    finalOutput = snapshot;
  }

  const jsonStr = JSON.stringify(finalOutput, null, 2);

  if (outputPath) {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tempPath = `${outputPath}.${Date.now()}.${Math.random().toString(36).substring(2, 8)}.tmp`;
    fs.writeFileSync(tempPath, jsonStr, 'utf8');
    fs.renameSync(tempPath, outputPath);
  }

  return finalOutput;
}

export function validateSnapshotSchema(snapshotInput, passphrase = null) {
  let snapObj = snapshotInput;

  if (typeof snapshotInput === 'string') {
    try {
      if (fs.existsSync(snapshotInput) && fs.statSync(snapshotInput).isFile()) {
        const content = fs.readFileSync(snapshotInput, 'utf8');
        snapObj = JSON.parse(content);
      } else {
        snapObj = JSON.parse(snapshotInput);
      }
    } catch (e) {
      return { valid: false, error: `Invalid JSON or file not found: ${e.message}` };
    }
  }

  if (!snapObj || typeof snapObj !== 'object') {
    return { valid: false, error: 'Snapshot must be a non-null object' };
  }

  if (snapObj.encrypted_payload) {
    if (!passphrase) {
      return { valid: false, error: 'Passphrase required for encrypted snapshot' };
    }
    try {
      const decryptedStr = decryptPayload(snapObj.encrypted_payload, passphrase);
      snapObj = JSON.parse(decryptedStr);
    } catch (e) {
      return { valid: false, error: `Decryption failed: ${e.message}` };
    }
  }

  if (snapObj.$schema !== 'cmdbar-environment-snapshot/v1') {
    return { valid: false, error: `Unsupported schema version: ${snapObj.$schema}` };
  }

  if (!snapObj.snapshot_id || !snapObj.created_at) {
    return { valid: false, error: 'Missing required snapshot fields (snapshot_id, created_at)' };
  }

  if (snapObj.signature) {
    const secretKey = 'cmdbar_snapshot_secret_key_v1';
    const expectedSig = computeSnapshotSignature(snapObj, secretKey);
    if (snapObj.signature !== expectedSig) {
      return { valid: false, error: 'Cryptographic signature mismatch or tampered snapshot' };
    }
  }

  return { valid: true, snapshot: snapObj };
}

export function mergeConfigs(target, source) {
  const merged = JSON.parse(JSON.stringify(target || { categories: [] }));
  if (!merged.categories) merged.categories = [];

  const sourceCategories = (source && source.categories) || [];
  for (const srcCat of sourceCategories) {
    if (!srcCat.name) continue;
    let targetCat = merged.categories.find(c => c.name === srcCat.name);
    if (!targetCat) {
      targetCat = { name: srcCat.name, commands: [] };
      merged.categories.push(targetCat);
    }
    if (!targetCat.commands) targetCat.commands = [];

    const srcCmds = srcCat.commands || [];
    for (const srcCmd of srcCmds) {
      if (!srcCmd.name) continue;
      const existingIdx = targetCat.commands.findIndex(c => c.name === srcCmd.name);
      if (existingIdx >= 0) {
        targetCat.commands[existingIdx] = { ...targetCat.commands[existingIdx], ...srcCmd };
      } else {
        targetCat.commands.push({ ...srcCmd });
      }
    }
  }

  if (source && source.ai) {
    merged.ai = { ...(merged.ai || {}), ...source.ai };
  }
  if (source && source.profiles && Array.isArray(source.profiles)) {
    if (!merged.profiles) merged.profiles = [];
    for (const p of source.profiles) {
      if (!merged.profiles.some(existing => existing.name === p.name)) {
        merged.profiles.push(p);
      }
    }
  }
  if (source && source.favorites && Array.isArray(source.favorites)) {
    if (!merged.favorites) merged.favorites = [];
    for (const f of source.favorites) {
      if (!merged.favorites.includes(f)) {
        merged.favorites.push(f);
      }
    }
  }

  return merged;
}

export function mergeHistories(target, source) {
  const merged = Array.isArray(target) ? [...target] : [];
  if (!Array.isArray(source)) return merged;

  for (const item of source) {
    const isDup = merged.some(existing => {
      if (typeof existing === 'string' && typeof item === 'string') {
        return existing === item;
      }
      if (typeof existing === 'object' && typeof item === 'object') {
        return existing.text === item.text || existing.command === item.command;
      }
      return false;
    });
    if (!isDup) {
      merged.push(item);
    }
  }
  return merged;
}

export async function createBackup(options = {}) {
  const {
    backupsDir = null,
    description = 'Automatic backup',
    configPath,
    clipboardPath,
    stylesheetPath
  } = options;

  const targetDir = getBackupsDir(backupsDir);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const timestamp = Date.now();
  const backupFileName = `backup_${timestamp}_${Math.random().toString(36).substring(2, 8)}.json`;
  const backupFilePath = path.join(targetDir, backupFileName);

  const snapshot = await exportEnvironmentSnapshot({
    configPath,
    clipboardPath,
    stylesheetPath,
    description,
    includeHistory: true,
    includeThemes: true,
    includeConfig: true,
    outputPath: backupFilePath
  });

  return {
    success: true,
    backup_path: backupFilePath,
    file_name: backupFileName,
    snapshot_id: snapshot.snapshot_id,
    timestamp: snapshot.created_at
  };
}

export function listBackups(backupsDir = null) {
  const dir = getBackupsDir(backupsDir);
  if (!fs.existsSync(dir)) {
    return [];
  }

  const files = fs.readdirSync(dir);
  const backups = [];

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const filePath = path.join(dir, file);
    try {
      const stats = fs.statSync(filePath);
      const content = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(content);

      if (data && data.$schema === 'cmdbar-environment-snapshot/v1') {
        backups.push({
          backup_id: file.replace('.json', ''),
          file_name: file,
          file_path: filePath,
          snapshot_id: data.snapshot_id || 'unknown',
          timestamp: data.created_at || stats.mtime.toISOString(),
          description: data.description || '',
          size: stats.size
        });
      }
    } catch (e) {
      // Ignore corrupted or non-snapshot backup files
    }
  }

  backups.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return backups;
}

export async function importEnvironmentSnapshot(snapshotDataOrPath, options = {}) {
  const {
    mode = 'merge',
    configPath,
    clipboardPath,
    stylesheetPath,
    backupsDir = null,
    passphrase = null,
    createBackupBeforeImport = true,
    validateOnly = false
  } = options;

  const validation = validateSnapshotSchema(snapshotDataOrPath, passphrase);
  if (!validation.valid) {
    throw new Error(`Snapshot validation failed: ${validation.error}`);
  }

  const snap = validation.snapshot;

  if (validateOnly) {
    return { success: true, validated: true, snapshot: snap };
  }

  const cfgPath = configPath || (await getDefaultConfigPath());
  const clipPath = clipboardPath || (await getDefaultClipboardPath());
  const stylePath = stylesheetPath || path.join(path.dirname(cfgPath), 'stylesheet.css');

  let backupInfo = null;
  if (createBackupBeforeImport) {
    backupInfo = await createBackup({
      backupsDir,
      description: `Pre-import backup before loading ${snap.snapshot_id}`,
      configPath: cfgPath,
      clipboardPath: clipPath,
      stylesheetPath: stylePath
    });
  }

  if (mode === 'replace') {
    if (snap.config) {
      await saveConfig(snap.config, cfgPath);
    }
    if (snap.history && Array.isArray(snap.history.clipboard)) {
      await saveClipboardHistory(snap.history.clipboard, clipPath);
    }
    if (snap.themes && snap.themes.custom_stylesheet !== undefined) {
      const dir = path.dirname(stylePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(stylePath, snap.themes.custom_stylesheet || '', 'utf8');
    }
  } else if (mode === 'merge') {
    if (snap.config) {
      const currentConfig = await loadConfig(cfgPath);
      const mergedConfig = mergeConfigs(currentConfig, snap.config);
      await saveConfig(mergedConfig, cfgPath);
    }
    if (snap.history && Array.isArray(snap.history.clipboard)) {
      const currentHistory = await loadClipboardHistory(clipPath);
      const mergedHistory = mergeHistories(currentHistory, snap.history.clipboard);
      await saveClipboardHistory(mergedHistory, clipPath);
    }
    if (snap.themes && snap.themes.custom_stylesheet) {
      const dir = path.dirname(stylePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      let currentCss = '';
      if (fs.existsSync(stylePath)) {
        currentCss = fs.readFileSync(stylePath, 'utf8');
      }
      if (!currentCss.includes(snap.themes.custom_stylesheet)) {
        const mergedCss = currentCss ? `${currentCss}\n/* Imported Theme */\n${snap.themes.custom_stylesheet}` : snap.themes.custom_stylesheet;
        fs.writeFileSync(stylePath, mergedCss, 'utf8');
      }
    }
  } else {
    throw new Error(`Invalid import mode: ${mode}. Must be 'merge' or 'replace'.`);
  }

  return {
    success: true,
    snapshot_id: snap.snapshot_id,
    mode: mode,
    backup_path: backupInfo ? backupInfo.backup_path : null
  };
}

export async function restoreFromBackup(backupIdOrPath, options = {}) {
  const { backupsDir = null, configPath, clipboardPath, stylesheetPath } = options;
  let targetFile = backupIdOrPath;

  if (!fs.existsSync(targetFile)) {
    const dir = getBackupsDir(backupsDir);
    const candidate1 = path.join(dir, `${backupIdOrPath}.json`);
    const candidate2 = path.join(dir, backupIdOrPath);
    if (fs.existsSync(candidate1)) {
      targetFile = candidate1;
    } else if (fs.existsSync(candidate2)) {
      targetFile = candidate2;
    } else {
      throw new Error(`Backup file not found: ${backupIdOrPath}`);
    }
  }

  return await importEnvironmentSnapshot(targetFile, {
    mode: 'replace',
    configPath,
    clipboardPath,
    stylesheetPath,
    backupsDir,
    createBackupBeforeImport: true
  });
}

export function deleteBackup(backupIdOrPath, backupsDir = null) {
  let targetFile = backupIdOrPath;
  if (!fs.existsSync(targetFile)) {
    const dir = getBackupsDir(backupsDir);
    const candidate1 = path.join(dir, `${backupIdOrPath}.json`);
    const candidate2 = path.join(dir, backupIdOrPath);
    if (fs.existsSync(candidate1)) {
      targetFile = candidate1;
    } else if (fs.existsSync(candidate2)) {
      targetFile = candidate2;
    } else {
      return false;
    }
  }

  try {
    fs.unlinkSync(targetFile);
    return true;
  } catch (e) {
    return false;
  }
}

export function encodeShareablePayload(snapshot) {
  const jsonStr = typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot);
  const base64Str = Buffer.from(jsonStr, 'utf8').toString('base64url');
  return `cmdbar-snap://${base64Str}`;
}

export function decodeShareablePayload(encodedStr) {
  if (!encodedStr || typeof encodedStr !== 'string') {
    throw new Error('Invalid encoded shareable payload string');
  }
  let cleanStr = encodedStr.trim();
  if (cleanStr.startsWith('cmdbar-snap://')) {
    cleanStr = cleanStr.substring('cmdbar-snap://'.length);
  }
  const jsonStr = Buffer.from(cleanStr, 'base64url').toString('utf8');
  return JSON.parse(jsonStr);
}

export async function shareSnapshotToCloud(snapshot, cloudConfig = {}) {
  const { endpoint = 'https://api.cmdbar.dev/v1/snapshots/share', apiKey = null } = cloudConfig;
  const payload = typeof snapshot === 'string' ? JSON.parse(snapshot) : snapshot;
  if (typeof endpoint === 'function') {
    return await endpoint(payload, cloudConfig);
  }
  const encoded = encodeShareablePayload(payload);
  return {
    success: true,
    snapshot_id: payload.snapshot_id,
    share_url: `${endpoint}/${payload.snapshot_id}`,
    shareable_link: encoded
  };
}

export async function fetchSnapshotFromCloud(cloudConfig = {}) {
  const { endpoint = null, shareLink = null } = cloudConfig;
  if (typeof endpoint === 'function') {
    return await endpoint(cloudConfig);
  }
  if (shareLink) {
    return decodeShareablePayload(shareLink);
  }
  throw new Error('Cloud fetch requires endpoint function or shareLink string.');
}
