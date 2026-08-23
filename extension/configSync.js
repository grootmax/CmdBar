/**
 * Robust Lock-File Synchronization and Configuration Manager with Backup Recovery.
 * Runs in both GJS (GNOME Shell) and Node.js (Testing/Companion app) environments.
 */

export const DEFAULT_CONFIG = {
  ai: {
    provider: "openai",
    model: "gpt-4o",
    temperature: 0.2,
    require_confirmation: true,
    fallback_provider: "ollama",
    fallback_model: "llama3",
  },
  categories: [
    {
      name: "AI Assistant",
      commands: [
        {
          name: "AI Command Assistant",
          command: "/ai {prompt}",
          placeholder: "e.g. deploy latest build to staging",
        },
      ],
    },
    {
      name: "Projects",
      commands: [
        {
          name: "Build Current Project",
          command: "make build",
        },
        {
          name: "Start Task",
          command: "echo Starting task <task-id>",
          placeholder: "task-id",
        },
      ],
    },
    {
      name: "Infrastructure",
      commands: [
        {
          name: "Deploy Service",
          command: "deploy <service-name>",
          placeholder: "service-name",
        },
        {
          name: "Scale ECS Task",
          command:
            "aws ecs update-service --service {{service-name}} --desired-count {{count}}",
          placeholder: "service-name & count",
        },
      ],
    },
  ],
};

const isNode =
  typeof process !== "undefined" && process.versions && process.versions.node;

let Gio, GLib;
if (!isNode) {
  try {
    const giModule = await import("gi");
    Gio = giModule.Gio || (giModule.default && giModule.default.Gio) || giModule.default;
    GLib = giModule.GLib || (giModule.default && giModule.default.GLib);
  } catch (e) {
    console.error(
      "CmdBar: Failed to import gi inside non-Node environment:",
      e,
    );
  }
}

function getNodeUserConfigDir() {
  if (process.env.XDG_CONFIG_HOME) {
    return process.env.XDG_CONFIG_HOME;
  }
  const home = process.env.HOME || process.env.USERPROFILE;
  return home ? `${home}/.config` : "/tmp";
}

function sleep(ms) {
  return new Promise((resolve) => {
    if (typeof setTimeout !== "undefined") {
      setTimeout(resolve, ms);
    } else if (typeof GLib !== "undefined" && GLib.timeout_add) {
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
      });
    } else {
      resolve();
    }
  });
}

/**
 * Validates a configuration layout against schema and parsing requirements.
 * @param {object} config
 * @returns {boolean}
 */
export function validateConfigSchema(config) {
  if (!config || typeof config !== "object") return false;
  if (!Array.isArray(config.categories)) return false;
  for (const category of config.categories) {
    if (!category || typeof category !== "object") return false;
    if (typeof category.name !== "string" || category.name.trim() === "")
      return false;
    if (category.commands !== undefined && !Array.isArray(category.commands))
      return false;
    if (category.commands) {
      for (const cmd of category.commands) {
        if (!cmd || typeof cmd !== "object") return false;
        if (typeof cmd.name !== "string" || cmd.name.trim() === "")
          return false;
        if (typeof cmd.command !== "string" || cmd.command.trim() === "")
          return false;
        if (
          cmd.placeholder !== undefined &&
          typeof cmd.placeholder !== "string"
        )
          return false;
        if (
          cmd.favorite !== undefined &&
          typeof cmd.favorite !== "boolean"
        )
          return false;
        if (
          cmd.pinned !== undefined &&
          typeof cmd.pinned !== "boolean"
        )
          return false;
      }
    }
  }
  return true;
}

// Node-specific filesystem implementations
async function node_ensureDir(dirPath) {
  const fs = await import("fs");
  await fs.promises.mkdir(dirPath, { recursive: true });
}

async function node_readFile(filePath) {
  const fs = await import("fs");
  return await fs.promises.readFile(filePath, "utf8");
}

async function node_writeFileAtomic(filePath, content) {
  const fs = await import("fs");
  const tempPath = filePath + ".tmp";

  let mode;
  if (fs.existsSync(filePath)) {
    try {
      const stats = await fs.promises.stat(filePath);
      mode = stats.mode;
    } catch (e) {}
  }

  try {
    await fs.promises.writeFile(tempPath, content, "utf8");
    if (mode !== undefined) {
      try {
        await fs.promises.chmod(tempPath, mode);
      } catch (e) {}
    }
    await fs.promises.rename(tempPath, filePath);
  } catch (err) {
    try {
      if (fs.existsSync(tempPath)) {
        await fs.promises.unlink(tempPath);
      }
    } catch (cleanupErr) {}
    throw err;
  }
}

async function node_deleteFile(filePath) {
  const fs = await import("fs");
  if (fs.existsSync(filePath)) {
    await fs.promises.unlink(filePath);
  }
}

async function node_backupFile(filePath, backupPath) {
  const fs = await import("fs");
  if (fs.existsSync(filePath)) {
    await fs.promises.rename(filePath, backupPath);
  }
}

async function node_acquireLock(lockPath, timeoutMs = 200) {
  const fs = await import("fs");
  const start = Date.now();
  while (true) {
    try {
      await fs.promises.writeFile(
        lockPath,
        JSON.stringify({ pid: process.pid, timestamp: Date.now() }),
        { flag: "wx" },
      );
      return true;
    } catch (err) {
      try {
        const stats = await fs.promises.stat(lockPath);
        if (Date.now() - stats.mtimeMs > 1000) {
          await fs.promises.unlink(lockPath);
        }
      } catch (statErr) {
        // Ignore stat/unlink failures
      }

      if (Date.now() - start >= timeoutMs) {
        throw new Error("Lock acquisition timeout");
      }
      await sleep(15);
    }
  }
}

// GJS-specific filesystem implementations
function gjs_ensureDir(dirPath) {
  return new Promise((resolve, reject) => {
    try {
      let file = Gio.File.new_for_path(dirPath);
      if (file.query_exists(null)) {
        resolve();
        return;
      }
      file.make_directory_with_parents(null);
      resolve();
    } catch (e) {
      if (file.query_exists(null)) {
        resolve();
      } else {
        reject(e);
      }
    }
  });
}

function gjs_readFile(filePath) {
  return new Promise((resolve, reject) => {
    try {
      let file = Gio.File.new_for_path(filePath);
      file.load_contents_async(null, (obj, res) => {
        try {
          let [success, contents] = obj.load_contents_finish(res);
          if (success) {
            let decoder = new TextDecoder("utf-8");
            resolve(decoder.decode(contents));
          } else {
            reject(new Error("Failed to load file contents"));
          }
        } catch (e) {
          reject(e);
        }
      });
    } catch (e) {
      reject(e);
    }
  });
}

function gjs_writeFileAtomic(filePath, content) {
  return new Promise((resolve, reject) => {
    const tmpPath = filePath + ".tmp";
    try {
      let file = Gio.File.new_for_path(filePath);
      let tmpFile = Gio.File.new_for_path(tmpPath);
      let encoder = new TextEncoder();
      let bytes = encoder.encode(content);
      tmpFile.replace_contents_async(
        bytes,
        null,
        false,
        Gio.FileCreateFlags.NONE,
        null,
        (obj, res) => {
          try {
            let [success] = obj.replace_contents_finish(res);
            if (!success) {
              throw new Error("Failed to replace contents");
            }
            tmpFile.move_async(
              file,
              Gio.FileCopyFlags.OVERWRITE,
              GLib.PRIORITY_DEFAULT,
              null,
              null,
              (moveObj, moveRes) => {
                try {
                  moveObj.move_finish(moveRes);
                  resolve();
                } catch (moveErr) {
                  gjs_deleteFile(tmpPath).then(() => reject(moveErr));
                }
              },
            );
          } catch (e) {
            gjs_deleteFile(tmpPath).then(() => reject(e));
          }
        },
      );
    } catch (e) {
      gjs_deleteFile(tmpPath).then(() => reject(e));
    }
  });
}

function gjs_deleteFile(filePath) {
  return new Promise((resolve) => {
    try {
      let file = Gio.File.new_for_path(filePath);
      if (!file.query_exists(null)) {
        resolve();
        return;
      }
      file.delete_async(GLib.PRIORITY_DEFAULT, null, (obj, res) => {
        try {
          obj.delete_finish(res);
        } catch (e) {
          // Ignore deletion error
        }
        resolve();
      });
    } catch (e) {
      resolve();
    }
  });
}

function gjs_backupFile(filePath, backupPath) {
  return new Promise((resolve, reject) => {
    try {
      let src = Gio.File.new_for_path(filePath);
      let dst = Gio.File.new_for_path(backupPath);
      if (!src.query_exists(null)) {
        resolve();
        return;
      }
      src.move_async(
        dst,
        Gio.FileCopyFlags.OVERWRITE,
        GLib.PRIORITY_DEFAULT,
        null,
        null,
        (obj, res) => {
          try {
            obj.move_finish(res);
            resolve();
          } catch (e) {
            reject(e);
          }
        },
      );
    } catch (e) {
      reject(e);
    }
  });
}

function gjs_tryCreateLockFile(lockPath) {
  return new Promise((resolve, reject) => {
    try {
      let file = Gio.File.new_for_path(lockPath);
      file.create_async(
        Gio.FileCreateFlags.NONE,
        GLib.PRIORITY_DEFAULT,
        null,
        (obj, res) => {
          try {
            let stream = obj.create_finish(res);
            resolve(stream);
          } catch (e) {
            reject(e);
          }
        },
      );
    } catch (e) {
      reject(e);
    }
  });
}

function gjs_writeAndCloseStream(stream, content) {
  return new Promise((resolve) => {
    try {
      let encoder = new TextEncoder();
      let bytes = encoder.encode(content);
      stream.write_all_async(bytes, GLib.PRIORITY_DEFAULT, null, (obj, res) => {
        try {
          obj.write_all_finish(res);
        } catch (e) {}
        stream.close_async(GLib.PRIORITY_DEFAULT, null, (obj2, res2) => {
          try {
            obj2.close_finish(res2);
          } catch (e) {}
          resolve();
        });
      });
    } catch (e) {
      resolve();
    }
  });
}

async function gjs_acquireLock(lockPath, timeoutMs = 200) {
  const start = Date.now();
  while (true) {
    try {
      let stream = await gjs_tryCreateLockFile(lockPath);
      let info = JSON.stringify({ pid: GLib.get_pid(), timestamp: Date.now() });
      await gjs_writeAndCloseStream(stream, info);
      return true;
    } catch (err) {
      try {
        let file = Gio.File.new_for_path(lockPath);
        let info = file.query_info(
          "standard::fast-content-type,time::modified",
          Gio.FileQueryInfoFlags.NONE,
          null,
        );
        let mtime = info.get_modification_date_time();
        if (mtime) {
          let mtimeMs = mtime.to_unix() * 1000;
          if (Date.now() - mtimeMs > 1000) {
            await gjs_deleteFile(lockPath);
          }
        }
      } catch (infoErr) {
        // Ignore query/delete failures
      }

      if (Date.now() - start >= timeoutMs) {
        throw new Error("Lock acquisition timeout");
      }
      await sleep(15);
    }
  }
}

export function getKeyPath(configPath) {
  if (!configPath) return null;
  const lastSlash = configPath.lastIndexOf("/");
  if (lastSlash === -1) return ".key";
  return configPath.slice(0, lastSlash) + "/.key";
}

export function canonicalJson(obj) {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return "[" + obj.map(canonicalJson).join(",") + "]";
  }
  const sortedKeys = Object.keys(obj)
    .filter((k) => k !== "signature")
    .sort();
  const parts = sortedKeys.map(
    (k) => JSON.stringify(k) + ":" + canonicalJson(obj[k]),
  );
  return "{" + parts.join(",") + "}";
}

export async function getOrCreateSigningKey(keyPath) {
  if (isNode) {
    const fs = await import("fs");
    const pathModule = await import("path");
    const cryptoModule = await import("crypto");
    if (fs.existsSync(keyPath)) {
      return (await fs.promises.readFile(keyPath, "utf8")).trim();
    }
    const key = cryptoModule.randomBytes(32).toString("hex");
    const dir = pathModule.dirname(keyPath);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(keyPath, key, { mode: 0o600 });
    return key;
  } else {
    if (await fileExists(keyPath)) {
      const content = await gjs_readFile(keyPath);
      return content.trim();
    }
    let key = "";
    for (let i = 0; i < 64; i++) {
      key += Math.floor(Math.random() * 16).toString(16);
    }
    await ensureConfigDir(keyPath);
    await gjs_writeFileAtomic(keyPath, key);
    try {
      let file = Gio.File.new_for_path(keyPath);
      let info = new Gio.FileInfo();
      info.set_attribute_uint32("unix::mode", 0o600);
      file.set_attributes_from_info(info, Gio.FileQueryInfoFlags.NONE, null);
    } catch (e) {}
    return key;
  }
}

export async function computeSignature(config, key) {
  const str = canonicalJson(config);
  if (isNode) {
    const cryptoModule = await import("crypto");
    return cryptoModule.createHmac("sha256", key).update(str).digest("hex");
  } else {
    let encoder = new TextEncoder();
    let keyBytes = encoder.encode(key);
    return GLib.compute_hmac_for_string(
      GLib.ChecksumType.SHA256,
      keyBytes,
      str,
      -1,
    );
  }
}

export async function verifyConfigSignature(config, keyPath) {
  if (!config || typeof config !== "object" || !config.signature) {
    return false;
  }
  try {
    const key = await getOrCreateSigningKey(keyPath);
    const expected = await computeSignature(config, key);
    return config.signature === expected;
  } catch (e) {
    return false;
  }
}

// Exported public API functions
export async function getDefaultConfigPath() {
  if (isNode) {
    const pathModule = await import("path");
    return pathModule.join(getNodeUserConfigDir(), "cmdbar", "config.json");
  } else {
    return GLib.build_filenamev([
      GLib.get_user_config_dir(),
      "cmdbar",
      "config.json",
    ]);
  }
}

export async function fileExists(filePath) {
  if (isNode) {
    const fs = await import("fs");
    return fs.existsSync(filePath);
  } else {
    let file = Gio.File.new_for_path(filePath);
    return file.query_exists(null);
  }
}

export async function ensureConfigDir(configPath) {
  const lastSlash = configPath.lastIndexOf("/");
  if (lastSlash === -1) return;
  const dirPath = configPath.slice(0, lastSlash);
  if (isNode) {
    await node_ensureDir(dirPath);
  } else {
    await gjs_ensureDir(dirPath);
  }
}

export async function acquireLock(lockPath, timeoutMs = 200) {
  if (isNode) {
    return await node_acquireLock(lockPath, timeoutMs);
  } else {
    return await gjs_acquireLock(lockPath, timeoutMs);
  }
}

export async function releaseLock(lockPath) {
  if (isNode) {
    await node_deleteFile(lockPath);
  } else {
    await gjs_deleteFile(lockPath);
  }
}

/**
 * Loads configuration file asynchronously.
 * Automatically handles directory/file creation, validation, and archiving.
 * @param {string} configPath
 * @param {string} [extensionPath]
 * @returns {Promise<object>}
 */
export async function loadConfig(configPath, extensionPath) {
  await ensureConfigDir(configPath);
  const keyPath = getKeyPath(configPath);

  const exists = await fileExists(configPath);
  if (!exists) {
    // Fallback to importing legacy commands.json if it exists and config.json does not
    const legacyPath = configPath.endsWith("config.json")
      ? configPath.replace(/config\.json$/, "commands.json")
      : null;
    if (legacyPath && (await fileExists(legacyPath))) {
      let legacyContent;
      try {
        if (isNode) {
          legacyContent = await node_readFile(legacyPath);
        } else {
          legacyContent = await gjs_readFile(legacyPath);
        }
      } catch (e) {
        legacyContent = "";
      }
      let legacyConfig;
      let isLegacyValid = false;
      try {
        legacyConfig = JSON.parse(legacyContent);
        isLegacyValid = validateConfigSchema(legacyConfig);
      } catch (e) {
        isLegacyValid = false;
      }
      if (isLegacyValid) {
        // Automatically migrate legacy file to config.json
        const key = await getOrCreateSigningKey(keyPath);
        legacyConfig.signature = await computeSignature(legacyConfig, key);
        if (isNode) {
          await node_writeFileAtomic(
            configPath,
            JSON.stringify(legacyConfig, null, 2),
          );
          await node_deleteFile(legacyPath);
        } else {
          await gjs_writeFileAtomic(
            configPath,
            JSON.stringify(legacyConfig, null, 2),
          );
          await gjs_deleteFile(legacyPath);
        }
        delete legacyConfig.signature;
        return legacyConfig;
      }
    }

    let defaultLoaded = false;
    let defaultContent = "";
    if (extensionPath) {
      try {
        let templatePath;
        if (isNode) {
          const pathModule = await import("path");
          templatePath = pathModule.join(extensionPath, "commands.json");
        } else {
          templatePath = GLib.build_filenamev([extensionPath, "commands.json"]);
        }
        const templateExists = await fileExists(templatePath);
        if (templateExists) {
          if (isNode) {
            defaultContent = await node_readFile(templatePath);
          } else {
            defaultContent = await gjs_readFile(templatePath);
          }
          defaultLoaded = true;
        }
      } catch (e) {
        console.error(
          `CmdBar: Failed to read extension template config: ${e.message}`,
        );
      }
    }

    if (!defaultLoaded) {
      defaultContent = JSON.stringify(DEFAULT_CONFIG, null, 2);
    }

    let configObj;
    try {
      configObj = JSON.parse(defaultContent);
      if (!validateConfigSchema(configObj)) {
        configObj = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
      }
    } catch (e) {
      configObj = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    }

    const key = await getOrCreateSigningKey(keyPath);
    configObj.signature = await computeSignature(configObj, key);

    if (isNode) {
      await node_writeFileAtomic(
        configPath,
        JSON.stringify(configObj, null, 2),
      );
    } else {
      await gjs_writeFileAtomic(configPath, JSON.stringify(configObj, null, 2));
    }

    delete configObj.signature;
    return configObj;
  }

  let content;
  try {
    if (isNode) {
      content = await node_readFile(configPath);
    } else {
      content = await gjs_readFile(configPath);
    }
  } catch (e) {
    content = "";
  }

  let parsedConfig;
  let isValidSchema = false;
  let isValidSignature = false;
  try {
    parsedConfig = JSON.parse(content);
    isValidSchema = validateConfigSchema(parsedConfig);
    if (isValidSchema) {
      isValidSignature = await verifyConfigSignature(parsedConfig, keyPath);
    }
  } catch (e) {
    isValidSchema = false;
    isValidSignature = false;
  }

  if (!isValidSchema) {
    let configObj = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    Object.defineProperty(configObj, "_isInvalid", {
      value: true,
      enumerable: false,
      writable: true,
      configurable: true,
    });
    return configObj;
  }

  if (!isValidSignature) {
    // Archive corrupted or untrusted file to .bak and restore clean signed default config
    const backupPath = configPath + ".bak";
    try {
      if (isNode) {
        await node_backupFile(configPath, backupPath);
      } else {
        await gjs_backupFile(configPath, backupPath);
      }
    } catch (e) {
      console.error(
        `CmdBar: Failed to archive corrupted/untrusted config file: ${e.message}`,
      );
    }

    try {
      if (!isNode) {
        if (
          typeof Main !== "undefined" &&
          Main &&
          typeof Main.notify === "function"
        ) {
          Main.notify(
            "Security Alert: Config Verification Failed",
            "Untrusted or tampered configuration file detected. Archived to .bak and restored safe defaults.",
          );
        } else if (typeof Gio !== "undefined" && Gio.Subprocess) {
          let proc = Gio.Subprocess.new(
            [
              "notify-send",
              "Security Alert: Config Verification Failed",
              "Untrusted or tampered configuration file detected. Archived to .bak and restored safe defaults.",
            ],
            Gio.SubprocessFlags.NONE,
          );
          proc.communicate_utf8_async(null, null, null);
        }
      }
    } catch (e) {
      // Ignore notification error
    }

    let configObj = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    const key = await getOrCreateSigningKey(keyPath);
    configObj.signature = await computeSignature(configObj, key);

    if (isNode) {
      await node_writeFileAtomic(
        configPath,
        JSON.stringify(configObj, null, 2),
      );
    } else {
      await gjs_writeFileAtomic(configPath, JSON.stringify(configObj, null, 2));
    }

    delete configObj.signature;
    return configObj;
  }

  delete parsedConfig.signature;
  return parsedConfig;
}

/**
 * Saves configuration layout atomically, with validation and cooperative file locking.
 * @param {object} config
 * @param {string} configPath
 */
export async function saveConfig(config, configPath) {
  if (!validateConfigSchema(config)) {
    throw new Error("Invalid configuration schema");
  }

  await ensureConfigDir(configPath);
  const keyPath = getKeyPath(configPath);
  const key = await getOrCreateSigningKey(keyPath);
  config.signature = await computeSignature(config, key);

  const lockPath = configPath + ".lock";
  await acquireLock(lockPath, 180);

  try {
    const content = JSON.stringify(config, null, 2);
    if (isNode) {
      await node_writeFileAtomic(configPath, content);
    } else {
      await gjs_writeFileAtomic(configPath, content);
    }
  } finally {
    await releaseLock(lockPath);
  }
}

export async function getDefaultClipboardPath() {
  if (isNode) {
    const pathModule = await import("path");
    return pathModule.join(getNodeUserConfigDir(), "cmdbar", "clipboard.json");
  } else {
    return GLib.build_filenamev([
      GLib.get_user_config_dir(),
      "cmdbar",
      "clipboard.json",
    ]);
  }
}

export async function loadClipboardHistory(clipboardPath) {
  if (!clipboardPath) {
    clipboardPath = await getDefaultClipboardPath();
  }
  await ensureConfigDir(clipboardPath);
  const exists = await fileExists(clipboardPath);
  if (!exists) {
    return [];
  }
  let content;
  try {
    if (isNode) {
      content = await node_readFile(clipboardPath);
    } else {
      content = await gjs_readFile(clipboardPath);
    }
  } catch (e) {
    return [];
  }
  try {
    let parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && (typeof item === "string" || typeof item.text === "string"))
      .map((item) => {
        if (typeof item === "string") {
          return { text: item, pinned: false, timestamp: Date.now() };
        }
        return {
          text: item.text,
          pinned: Boolean(item.pinned),
          timestamp: typeof item.timestamp === "number" ? item.timestamp : Date.now(),
        };
      });
  } catch (e) {
    return [];
  }
}

export async function saveClipboardHistory(history, clipboardPath) {
  if (!Array.isArray(history)) {
    throw new Error("Invalid clipboard history schema");
  }
  if (!clipboardPath) {
    clipboardPath = await getDefaultClipboardPath();
  }
  await ensureConfigDir(clipboardPath);
  const lockPath = clipboardPath + ".lock";
  await acquireLock(lockPath, 180);
  try {
    const content = JSON.stringify(history, null, 2);
    if (isNode) {
      await node_writeFileAtomic(clipboardPath, content);
    } else {
      await gjs_writeFileAtomic(clipboardPath, content);
    }
  } finally {
    await releaseLock(lockPath);
  }
}
