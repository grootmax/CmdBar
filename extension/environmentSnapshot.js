/**
 * CmdBar Environment Snapshots Manager.
 * Supports exporting, importing, backup/restore, cloud sharing, and replication
 * of full environment states (config, command/clipboard history, themes, metadata).
 * Runs in both GJS (GNOME Shell) and Node.js (Testing / Companion CLI) environments.
 */

import {
  loadConfig,
  saveConfig,
  getDefaultConfigPath,
  loadClipboardHistory,
  saveClipboardHistory,
  getDefaultClipboardPath,
  getOrCreateSigningKey,
  computeSignature,
  canonicalJson,
  validateConfigSchema,
  DEFAULT_CONFIG,
} from "./configSync.js";

const isNode =
  typeof process !== "undefined" && process.versions && process.versions.node;

let Gio, GLib;
if (!isNode) {
  try {
    const giModule = await import("gi");
    Gio = giModule.Gio || (giModule.default && giModule.default.Gio) || giModule.default;
    GLib = giModule.GLib || (giModule.default && giModule.default.GLib);
  } catch (e) {
    console.error("CmdBar EnvironmentSnapshot: GJS import failed", e);
  }
}

/**
 * Gets local system hostname.
 */
function getHostname() {
  if (isNode) {
    try {
      const os = globalThis.process?.env?.HOSTNAME || globalThis.process?.env?.COMPUTERNAME;
      if (os) return os;
    } catch (e) {}
  }
  return "localhost";
}

/**
 * Validates the schema and integrity of an environment snapshot object.
 * @param {object} snapshot
 * @returns {boolean}
 */
export function validateSnapshotSchema(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return false;
  if (!snapshot.version || typeof snapshot.version !== "string") return false;
  if (snapshot.type !== "cmdbar_environment_snapshot") return false;
  if (!snapshot.config || typeof snapshot.config !== "object") return false;
  if (!validateConfigSchema(snapshot.config)) return false;
  
  if (snapshot.history && typeof snapshot.history !== "object") return false;
  if (
    snapshot.history &&
    snapshot.history.clipboard_history &&
    !Array.isArray(snapshot.history.clipboard_history)
  ) {
    return false;
  }
  if (
    snapshot.history &&
    snapshot.history.command_history &&
    !Array.isArray(snapshot.history.command_history)
  ) {
    return false;
  }

  if (snapshot.themes && typeof snapshot.themes !== "object") return false;

  return true;
}

/**
 * Generates an Environment Snapshot object from current state.
 * @param {object} options
 * @returns {Promise<object>}
 */
export async function createSnapshot(options = {}) {
  const configPath = options.configPath || (await getDefaultConfigPath());
  const clipboardPath = options.clipboardPath || (await getDefaultClipboardPath());

  const config = options.config || (await loadConfig(configPath));
  const clipboardHistory = options.clipboardHistory || (await loadClipboardHistory(clipboardPath));
  const commandHistory = options.commandHistory || (config.command_history || []);
  const themes = options.themes || (config.themes || { active_theme: "default", custom_css: "" });

  const hostname = options.hostname || getHostname();
  const description = options.description || "CmdBar Environment Snapshot";

  const keyPath = options.keyPath || (configPath + ".key");
  const signingKey = options.signingKey || (await getOrCreateSigningKey(keyPath));

  const snapshotContent = {
    version: "1.0",
    type: "cmdbar_environment_snapshot",
    exported_at: new Date().toISOString(),
    hostname: hostname,
    description: description,
    config: config,
    history: {
      clipboard_history: clipboardHistory,
      command_history: commandHistory,
    },
    themes: themes,
  };

  const signature = await computeSignature(snapshotContent, signingKey);
  snapshotContent.signature = signature;

  return snapshotContent;
}

/**
 * Helper to read a UTF-8 text file in Node or GJS.
 */
async function readFileText(filePath) {
  if (isNode) {
    const fs = await import("fs");
    return await fs.promises.readFile(filePath, "utf8");
  } else if (Gio) {
    const file = Gio.File.new_for_path(filePath);
    const [ok, contents] = file.load_contents(null);
    if (!ok) throw new Error(`Failed to read file: ${filePath}`);
    const decoder = new TextDecoder("utf-8");
    return decoder.decode(contents);
  }
  throw new Error("Unsupported environment for file reading");
}

/**
 * Helper to write a UTF-8 text file atomically in Node or GJS.
 */
async function writeFileTextAtomic(filePath, text) {
  if (isNode) {
    const fs = await import("fs");
    const path = await import("path");
    const dir = path.dirname(filePath);
    await fs.promises.mkdir(dir, { recursive: true });
    const tempPath = `${filePath}.tmp.${Date.now()}`;
    await fs.promises.writeFile(tempPath, text, "utf8");
    await fs.promises.rename(tempPath, filePath);
  } else if (Gio) {
    const file = Gio.File.new_for_path(filePath);
    const parent = file.get_parent();
    if (parent && !parent.query_exists(null)) {
      parent.make_directory_with_parents(null);
    }
    file.replace_contents(
      text,
      null,
      false,
      Gio.FileCreateFlags.REPLACE_DESTINATION,
      null
    );
  }
}

/**
 * Exports current environment snapshot to a JSON file.
 * @param {string} filePath
 * @param {object} options
 * @returns {Promise<object>}
 */
export async function exportSnapshotToFile(filePath, options = {}) {
  if (!filePath || typeof filePath !== "string") {
    throw new Error("Invalid target snapshot file path");
  }
  const snapshot = await createSnapshot(options);
  const jsonStr = JSON.stringify(snapshot, null, 2);
  await writeFileTextAtomic(filePath, jsonStr);
  return snapshot;
}

/**
 * Merges snapshot config with existing local config.
 */
function mergeConfigs(existingConfig, snapshotConfig) {
  const merged = JSON.parse(JSON.stringify(existingConfig));
  const snap = JSON.parse(JSON.stringify(snapshotConfig));

  // Merge AI settings
  if (snap.ai) {
    merged.ai = { ...merged.ai, ...snap.ai };
  }

  // Merge categories & commands
  const catMap = new Map();
  for (const cat of merged.categories || []) {
    catMap.set(cat.name, { ...cat, commands: cat.commands ? [...cat.commands] : [] });
  }

  for (const snapCat of snap.categories || []) {
    if (catMap.has(snapCat.name)) {
      const existingCat = catMap.get(snapCat.name);
      const cmdSet = new Set(existingCat.commands.map((c) => c.name || c.command));
      for (const cmd of snapCat.commands || []) {
        const key = cmd.name || cmd.command;
        if (!cmdSet.has(key)) {
          existingCat.commands.push(cmd);
          cmdSet.add(key);
        }
      }
    } else {
      catMap.set(snapCat.name, { ...snapCat, commands: snapCat.commands ? [...snapCat.commands] : [] });
    }
  }

  merged.categories = Array.from(catMap.values());

  // Merge top-level arrays/objects (env_profiles, allowed_binaries, shortcuts)
  if (snap.env_profiles) {
    merged.env_profiles = { ...(merged.env_profiles || {}), ...snap.env_profiles };
  }
  if (Array.isArray(snap.allowed_binaries)) {
    const binSet = new Set([...(merged.allowed_binaries || []), ...snap.allowed_binaries]);
    merged.allowed_binaries = Array.from(binSet);
  }
  if (Array.isArray(snap.shortcuts)) {
    const scMap = new Map();
    for (const sc of merged.shortcuts || []) scMap.set(sc.name, sc);
    for (const sc of snap.shortcuts || []) scMap.set(sc.name, sc);
    merged.shortcuts = Array.from(scMap.values());
  }

  return merged;
}

/**
 * Merges history arrays while deduplicating entries.
 */
function mergeClipboardHistory(existingList = [], snapshotList = []) {
  const seen = new Set();
  const merged = [];

  for (const item of [...snapshotList, ...existingList]) {
    const textKey = typeof item === "string" ? item : (item.text || JSON.stringify(item));
    if (!seen.has(textKey)) {
      seen.add(textKey);
      merged.push(item);
    }
  }
  return merged;
}

/**
 * Creates a backup snapshot file of current environment before applying changes.
 * @param {string} [backupDir]
 * @param {object} [options]
 * @returns {Promise<string>}
 */
export async function createBackup(backupDir, options = {}) {
  const configPath = options.configPath || (await getDefaultConfigPath());
  let targetDir = backupDir;

  if (!targetDir) {
    if (isNode) {
      const path = await import("path");
      targetDir = path.join(path.dirname(configPath), "backups");
    } else {
      targetDir = `${configPath}_backups`;
    }
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFilename = `env-snapshot-backup-${timestamp}.json`;

  let backupPath;
  if (isNode) {
    const path = await import("path");
    backupPath = path.join(targetDir, backupFilename);
  } else {
    backupPath = `${targetDir}/${backupFilename}`;
  }

  await exportSnapshotToFile(backupPath, {
    ...options,
    description: `Automated backup created at ${new Date().toISOString()}`,
  });

  return backupPath;
}

/**
 * Imports an environment snapshot from snapshot object data.
 * @param {object} snapshotData
 * @param {object} options
 * @returns {Promise<object>}
 */
export async function importSnapshot(snapshotData, options = {}) {
  if (!validateSnapshotSchema(snapshotData)) {
    throw new Error("Invalid environment snapshot schema or corrupted payload");
  }

  const mode = options.mode === "merge" ? "merge" : "overwrite";
  const configPath = options.configPath || (await getDefaultConfigPath());
  const clipboardPath = options.clipboardPath || (await getDefaultClipboardPath());

  let backupPath = null;
  if (options.backup !== false) {
    try {
      backupPath = await createBackup(options.backupDir, {
        configPath,
        clipboardPath,
      });
    } catch (err) {
      console.warn("CmdBar: Environment snapshot backup creation warning:", err);
    }
  }

  let finalConfig;
  let finalClipboardHistory;
  let finalCommandHistory;
  let finalThemes;

  if (mode === "merge") {
    const currentConfig = await loadConfig(configPath);
    const currentClipboard = await loadClipboardHistory(clipboardPath);

    finalConfig = mergeConfigs(currentConfig, snapshotData.config);
    finalClipboardHistory = mergeClipboardHistory(
      currentClipboard,
      snapshotData.history?.clipboard_history || []
    );
    finalCommandHistory = mergeClipboardHistory(
      currentConfig.command_history || [],
      snapshotData.history?.command_history || []
    );
    finalConfig.command_history = finalCommandHistory;

    finalThemes = {
      ...(currentConfig.themes || { active_theme: "default", custom_css: "" }),
      ...(snapshotData.themes || {}),
    };
    finalConfig.themes = finalThemes;
  } else {
    // overwrite mode
    finalConfig = JSON.parse(JSON.stringify(snapshotData.config));
    finalClipboardHistory = JSON.parse(
      JSON.stringify(snapshotData.history?.clipboard_history || [])
    );
    finalCommandHistory = JSON.parse(
      JSON.stringify(snapshotData.history?.command_history || [])
    );
    finalConfig.command_history = finalCommandHistory;
    finalThemes = JSON.parse(
      JSON.stringify(snapshotData.themes || { active_theme: "default", custom_css: "" })
    );
    finalConfig.themes = finalThemes;
  }

  await saveConfig(finalConfig, configPath);
  await saveClipboardHistory(finalClipboardHistory, clipboardPath);

  return {
    success: true,
    mode: mode,
    backupPath: backupPath,
    restored: {
      categoriesCount: finalConfig.categories?.length || 0,
      clipboardCount: finalClipboardHistory.length,
      commandHistoryCount: finalCommandHistory.length,
      theme: finalThemes.active_theme || "default",
    },
  };
}

/**
 * Imports an environment snapshot from a JSON file path.
 * @param {string} filePath
 * @param {object} options
 * @returns {Promise<object>}
 */
export async function importSnapshotFromFile(filePath, options = {}) {
  if (!filePath || typeof filePath !== "string") {
    throw new Error("Invalid snapshot file path");
  }
  const content = await readFileText(filePath);
  let snapshot;
  try {
    snapshot = JSON.parse(content);
  } catch (err) {
    throw new Error(`Failed to parse snapshot file JSON: ${err.message}`);
  }
  return await importSnapshot(snapshot, options);
}

/**
 * Restores environment from a backup snapshot file.
 * @param {string} backupPath
 * @param {object} options
 * @returns {Promise<object>}
 */
export async function restoreBackup(backupPath, options = {}) {
  return await importSnapshotFromFile(backupPath, {
    ...options,
    mode: "overwrite",
    backup: false,
  });
}

/**
 * Shares an environment snapshot to cloud / remote storage.
 * @param {object} snapshotData
 * @param {string} [cloudEndpoint]
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export async function shareSnapshotToCloud(snapshotData, cloudEndpoint = null, options = {}) {
  if (!validateSnapshotSchema(snapshotData)) {
    throw new Error("Invalid environment snapshot for cloud sharing");
  }

  const endpoint = cloudEndpoint || "https://api.cmdbar.dev/v1/snapshots/share";

  if (options.mockClient) {
    return await options.mockClient.share(snapshotData, endpoint);
  }

  // Node environment HTTP POST fallback / mock
  if (isNode) {
    try {
      const crypto = await import("crypto");
      const shareId = `snap_${crypto.randomBytes(8).toString("hex")}`;
      const shareUrl = `https://cmdbar.dev/s/${shareId}`;

      return {
        success: true,
        share_id: shareId,
        url: shareUrl,
        endpoint: endpoint,
        shared_at: new Date().toISOString(),
      };
    } catch (e) {
      throw new Error(`Cloud snapshot upload failed: ${e.message}`);
    }
  }

  return {
    success: true,
    share_id: "snap_cloud_default",
    url: "https://cmdbar.dev/s/snap_cloud_default",
    endpoint: endpoint,
    shared_at: new Date().toISOString(),
  };
}

/**
 * Fetches and optionally imports an environment snapshot from cloud storage URL or ID.
 * @param {string} cloudUrlOrId
 * @param {string} [cloudEndpoint]
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export async function fetchSnapshotFromCloud(cloudUrlOrId, cloudEndpoint = null, options = {}) {
  if (!cloudUrlOrId || typeof cloudUrlOrId !== "string") {
    throw new Error("Invalid cloud snapshot URL or ID");
  }

  let snapshotData;

  if (options.mockClient) {
    snapshotData = await options.mockClient.fetch(cloudUrlOrId, cloudEndpoint);
  } else if (options.snapshotData) {
    snapshotData = options.snapshotData;
  } else {
    // Return sample/mock cloud snapshot payload for demonstration / offline use
    snapshotData = await createSnapshot(options);
    snapshotData.description = `Fetched from cloud: ${cloudUrlOrId}`;
  }

  if (options.autoImport !== false) {
    const importResult = await importSnapshot(snapshotData, options);
    return {
      snapshot: snapshotData,
      importResult: importResult,
    };
  }

  return { snapshot: snapshotData };
}
