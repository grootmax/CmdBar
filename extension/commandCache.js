/**
 * Command Result Caching Module for CmdBar.
 * Supports caching read-only commands with TTL, JSON persistence, manual refresh, and cache invalidation.
 * Compatible with Node.js and GJS (GNOME Shell) environments.
 */

const isNode =
  typeof process !== "undefined" && process.versions && process.versions.node;

let Gio, GLib, nodeFs, nodePath;
if (isNode) {
  try {
    nodeFs = await import("fs");
    nodePath = await import("path");
  } catch (e) {}
} else {
  try {
    const giModule = await import("gi");
    Gio = giModule.Gio || (giModule.default && giModule.default.Gio) || giModule.default;
    GLib = giModule.GLib || (giModule.default && giModule.default.GLib);
  } catch (e) {}
}

function getNodeUserConfigDir() {
  if (process.env.XDG_CONFIG_HOME) {
    return process.env.XDG_CONFIG_HOME;
  }
  const home = process.env.HOME || process.env.USERPROFILE;
  return home ? `${home}/.config` : "/tmp";
}

/**
 * Gets default path for cache.json.
 * @returns {Promise<string>}
 */
export async function getDefaultCachePath() {
  if (isNode) {
    const pathMod = nodePath || (await import("path"));
    return pathMod.join(getNodeUserConfigDir(), "cmdbar", "cache.json");
  } else {
    return GLib.build_filenamev([
      GLib.get_user_config_dir(),
      "cmdbar",
      "cache.json",
    ]);
  }
}

/**
 * Determines if a command object is tagged as cacheable.
 * Tagging options:
 * - `cacheable: true`
 * - `type: "cacheable"`
 * - `ttl > 0`, `cache_ttl > 0`, or `ttl_seconds > 0`
 *
 * Realtime tagging:
 * - `cacheable: false`
 * - `type: "realtime"`
 *
 * @param {object} cmdObj
 * @returns {boolean}
 */
export function isCommandCacheable(cmdObj) {
  if (!cmdObj || typeof cmdObj !== "object") return false;
  if (cmdObj.cacheable === false || cmdObj.type === "realtime") return false;
  if (cmdObj.cacheable === true || cmdObj.type === "cacheable") return true;
  if (typeof cmdObj.ttl === "number" && cmdObj.ttl > 0) return true;
  if (typeof cmdObj.cache_ttl === "number" && cmdObj.cache_ttl > 0) return true;
  if (typeof cmdObj.ttl_seconds === "number" && cmdObj.ttl_seconds > 0) return true;
  return false;
}

/**
 * Gets configured TTL in seconds for a command.
 * @param {object} cmdObj
 * @param {number} [defaultTTL=60]
 * @returns {number}
 */
export function getCommandTTL(cmdObj, defaultTTL = 60) {
  if (!cmdObj || typeof cmdObj !== "object") return defaultTTL;
  if (typeof cmdObj.ttl === "number" && cmdObj.ttl > 0) return cmdObj.ttl;
  if (typeof cmdObj.cache_ttl === "number" && cmdObj.cache_ttl > 0) return cmdObj.cache_ttl;
  if (typeof cmdObj.ttl_seconds === "number" && cmdObj.ttl_seconds > 0) return cmdObj.ttl_seconds;
  return defaultTTL;
}

/**
 * Validates if a cache entry is still valid (not expired).
 * @param {object} entry
 * @param {number} [now=Date.now()]
 * @returns {boolean}
 */
export function isCacheValid(entry, now = Date.now()) {
  if (!entry || typeof entry.timestamp !== "number" || typeof entry.ttl !== "number") {
    return false;
  }
  const ageSeconds = (now - entry.timestamp) / 1000;
  return ageSeconds >= 0 && ageSeconds < entry.ttl;
}

/**
 * Loads cache JSON file from disk.
 * @param {string} [cachePath]
 * @returns {Promise<object>} Map of entries
 */
export async function loadCache(cachePath) {
  if (!cachePath) {
    cachePath = await getDefaultCachePath();
  }
  try {
    let content = "";
    if (isNode) {
      const fsMod = nodeFs || (await import("fs"));
      if (!fsMod.existsSync(cachePath)) return {};
      content = await fsMod.promises.readFile(cachePath, "utf8");
    } else {
      let file = Gio.File.new_for_path(cachePath);
      if (!file.query_exists(null)) return {};
      let [success, contents] = file.load_contents(null);
      if (success) {
        let decoder = new TextDecoder("utf-8");
        content = decoder.decode(contents);
      }
    }
    if (!content) return {};
    let parsed = JSON.parse(content);
    if (parsed && typeof parsed === "object" && parsed.entries) {
      return parsed.entries;
    } else if (parsed && typeof parsed === "object") {
      return parsed;
    }
    return {};
  } catch (e) {
    return {};
  }
}

/**
 * Saves cache entries map to JSON file on disk atomically.
 * @param {object} entries
 * @param {string} [cachePath]
 */
export async function saveCache(entries, cachePath) {
  if (!cachePath) {
    cachePath = await getDefaultCachePath();
  }
  const data = {
    version: 1,
    entries: entries || {},
  };
  const jsonStr = JSON.stringify(data, null, 2);

  if (isNode) {
    const fsMod = nodeFs || (await import("fs"));
    const pathMod = nodePath || (await import("path"));
    const dir = pathMod.dirname(cachePath);
    if (!fsMod.existsSync(dir)) {
      await fsMod.promises.mkdir(dir, { recursive: true });
    }
    const tmp = cachePath + ".tmp";
    try {
      await fsMod.promises.writeFile(tmp, jsonStr, "utf8");
      await fsMod.promises.rename(tmp, cachePath);
    } catch (err) {
      if (fsMod.existsSync(tmp)) {
        await fsMod.promises.unlink(tmp).catch(() => {});
      }
      throw err;
    }
  } else {
    try {
      let lastSlash = cachePath.lastIndexOf("/");
      if (lastSlash !== -1) {
        let dirPath = cachePath.slice(0, lastSlash);
        let dirFile = Gio.File.new_for_path(dirPath);
        if (!dirFile.query_exists(null)) {
          dirFile.make_directory_with_parents(null);
        }
      }
      let file = Gio.File.new_for_path(cachePath);
      let tmpFile = Gio.File.new_for_path(cachePath + ".tmp");
      let encoder = new TextEncoder();
      let bytes = encoder.encode(jsonStr);
      tmpFile.replace_contents(bytes, null, false, Gio.FileCreateFlags.NONE, null);
      tmpFile.move(file, Gio.FileCopyFlags.OVERWRITE, null, null);
    } catch (e) {
      console.error("CmdBar Cache Save Error:", e);
    }
  }
}

/**
 * Command Cache Store Manager
 */
export class CommandCacheStore {
  constructor(cachePath = null) {
    this.cachePath = cachePath;
    this.entries = {};
    this.loaded = false;
  }

  async init() {
    if (!this.cachePath) {
      this.cachePath = await getDefaultCachePath();
    }
    this.entries = await loadCache(this.cachePath);
    this.loaded = true;
  }

  get(key, now = Date.now()) {
    const entry = this.entries[key];
    if (entry && isCacheValid(entry, now)) {
      return entry;
    }
    if (entry && !isCacheValid(entry, now)) {
      delete this.entries[key];
    }
    return null;
  }

  async set(key, command, result, ttl = 60, timestamp = Date.now()) {
    const entry = {
      key,
      command,
      stdout: (result && result.stdout) || "",
      stderr: (result && result.stderr) || "",
      exitStatus: result && result.exitStatus !== undefined ? String(result.exitStatus) : "0",
      timestamp,
      ttl,
    };
    this.entries[key] = entry;
    await this.persist();
    return entry;
  }

  async invalidate(key) {
    if (key in this.entries) {
      delete this.entries[key];
      await this.persist();
      return true;
    }
    return false;
  }

  async clear() {
    this.entries = {};
    await this.persist();
  }

  async prune(now = Date.now()) {
    let prunedCount = 0;
    for (const key of Object.keys(this.entries)) {
      if (!isCacheValid(this.entries[key], now)) {
        delete this.entries[key];
        prunedCount++;
      }
    }
    if (prunedCount > 0) {
      await this.persist();
    }
    return prunedCount;
  }

  async persist() {
    try {
      return await saveCache(this.entries, this.cachePath);
    } catch (e) {
      console.error("CmdBar Cache Persist Error:", e);
    }
  }
}
