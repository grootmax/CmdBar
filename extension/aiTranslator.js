/**
 * AI Command Translator module for CmdBar extension.
 * Translates natural language prompts to executable shell commands.
 * Supports OpenAI, Anthropic (Claude), and Ollama (local model), with fallback.
 */

let GLib, Gio;
const isNode = typeof process !== "undefined" && process.versions && process.versions.node;

if (!isNode) {
  try {
    const gi = await import("gi");
    GLib = gi.GLib;
    Gio = gi.Gio;
  } catch (e) {}
}

/**
 * Extracts raw shell command from LLM response text.
 * @param {string} responseText
 * @returns {string}
 */
export function parseCommandFromAIResponse(responseText) {
  if (!responseText || typeof responseText !== "string") {
    return "";
  }
  const text = responseText.trim();

  // 1. Markdown code block ```bash ... ``` or ```sh ... ``` or ``` ... ```
  const codeBlockRegex = /```(?:[a-zA-Z0-9_-]+)?\s*\n?([\s\S]*?)\n?```/;
  const matchBlock = codeBlockRegex.exec(text);
  if (matchBlock && matchBlock[1] && matchBlock[1].trim()) {
    return matchBlock[1].trim();
  }

  // 2. Inline backticks `...`
  const inlineRegex = /`([^`\n]+)`/;
  const matchInline = inlineRegex.exec(text);
  if (matchInline && matchInline[1] && matchInline[1].trim()) {
    return matchInline[1].trim();
  }

  // 3. Fallback: filter line by line
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const cleanLines = lines.filter((line) => {
    const lower = line.toLowerCase();
    return (
      !lower.startsWith("here is") &&
      !lower.startsWith("you can") &&
      !lower.startsWith("note:") &&
      !lower.startsWith("explanation:") &&
      !lower.startsWith("command:")
    );
  });

  return cleanLines.join(" ").trim() || text;
}

/**
 * Strips trigger prefix (e.g. "/ai ") from prompt string.
 * @param {string} prompt
 * @returns {string}
 */
export function cleanAIPrompt(prompt) {
  if (!prompt || typeof prompt !== "string") {
    return "";
  }
  return prompt.trim().replace(/^\/ai\s*/i, "").trim();
}

/**
 * Checks if input starts with AI mode prefix.
 * @param {string} text
 * @returns {boolean}
 */
export function isAICommand(text) {
  if (!text || typeof text !== "string") {
    return false;
  }
  return text.trim().toLowerCase().startsWith("/ai");
}

/**
 * Gets API key for specified provider from config or environment variables.
 * @param {string} provider
 * @param {object} [config]
 * @returns {string}
 */
export function getAIApiKey(provider, config = {}) {
  const aiCfg = config.ai || config || {};
  if (aiCfg.api_key && typeof aiCfg.api_key === "string" && aiCfg.api_key.trim()) {
    return aiCfg.api_key.trim();
  }
  if (aiCfg.apiKey && typeof aiCfg.apiKey === "string" && aiCfg.apiKey.trim()) {
    return aiCfg.apiKey.trim();
  }

  const prov = (provider || aiCfg.provider || "openai").toLowerCase();

  let envVal = "";
  if (isNode) {
    if (prov === "openai") envVal = process.env.OPENAI_API_KEY || "";
    else if (prov === "anthropic" || prov === "claude") envVal = process.env.ANTHROPIC_API_KEY || "";
    else if (prov === "ollama") envVal = process.env.OLLAMA_API_KEY || "";
  } else {
    try {
      if (typeof GLib !== "undefined" && GLib.getenv) {
        if (prov === "openai") envVal = GLib.getenv("OPENAI_API_KEY") || "";
        else if (prov === "anthropic" || prov === "claude") envVal = GLib.getenv("ANTHROPIC_API_KEY") || "";
        else if (prov === "ollama") envVal = GLib.getenv("OLLAMA_API_KEY") || "";
      }
    } catch (e) {}
  }

  return envVal ? envVal.trim() : "";
}

/**
 * Universal HTTP POST helper supporting Node.js fetch and GJS / curl fallback.
 * @param {string} url
 * @param {object} headers
 * @param {object} body
 * @returns {Promise<object>}
 */
export async function httpPost(url, headers = {}, body = {}) {
  const jsonBody = JSON.stringify(body);

  // 1. Try global fetch if available (Node.js or modern GJS)
  if (typeof fetch === "function") {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: jsonBody,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${res.statusText} - ${errText}`);
    }
    return await res.json();
  }

  // 2. Node.js fallback using child_process curl if fetch unavailable
  if (isNode) {
    const { execFile } = await import("child_process");
    const util = await import("util");
    const execFilePromise = util.promisify(execFile);

    const args = ["-s", "-S", "-X", "POST", url];
    for (const [k, v] of Object.entries(headers)) {
      args.push("-H", `${k}: ${v}`);
    }
    args.push("-d", jsonBody);

    const { stdout, stderr } = await execFilePromise("curl", args);
    if (!stdout && stderr) {
      throw new Error(`Curl request failed: ${stderr}`);
    }
    return JSON.parse(stdout);
  }

  // 3. GJS environment fallback using Gio.Subprocess curl
  if (typeof Gio !== "undefined" && Gio.Subprocess) {
    const args = ["curl", "-s", "-S", "-X", "POST", url];
    for (const [k, v] of Object.entries(headers)) {
      args.push("-H", `${k}: ${v}`);
    }
    args.push("-d", jsonBody);

    return new Promise((resolve, reject) => {
      try {
        const proc = Gio.Subprocess.new(
          args,
          Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
        );
        proc.communicate_utf8_async(null, null, (subprocess, result) => {
          try {
            const [stdout, stderr] = subprocess.communicate_utf8_finish(result);
            if (!subprocess.get_successful()) {
              reject(new Error(`Curl error: ${stderr || "Process failed"}`));
              return;
            }
            resolve(JSON.parse(stdout));
          } catch (e) {
            reject(e);
          }
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  throw new Error("No available HTTP client environment found.");
}

/**
 * Builds API request configuration object for provider.
 * @param {string} provider
 * @param {string} rawPrompt
 * @param {object} [options]
 * @returns {object}
 */
export function buildAIRequest(provider, rawPrompt, options = {}) {
  const prov = (provider || "openai").toLowerCase();
  const prompt = cleanAIPrompt(rawPrompt);
  const systemPrompt =
    options.systemPrompt ||
    "You are an expert Linux shell command assistant. Translate the natural language prompt into a concise, correct executable shell command. Output ONLY the raw executable command inside a ```bash ... ``` code block. Do not include explanation or Markdown outside the code block.";
  const temp = options.temperature ?? 0.2;
  const apiKey = getAIApiKey(prov, options);

  if (prov === "openai") {
    const endpoint = options.endpoint || "https://api.openai.com/v1/chat/completions";
    const model = options.model || "gpt-4o";
    const headers = {
      "Content-Type": "application/json",
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }
    const body = {
      model,
      temperature: temp,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
    };
    return { endpoint, headers, body, provider: "openai" };
  } else if (prov === "anthropic" || prov === "claude") {
    const endpoint = options.endpoint || "https://api.anthropic.com/v1/messages";
    const model = options.model || "claude-3-5-sonnet-20241022";
    const headers = {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
    };
    if (apiKey) {
      headers["x-api-key"] = apiKey;
    }
    const body = {
      model,
      max_tokens: 1024,
      temperature: temp,
      messages: [
        { role: "user", content: `${systemPrompt}\n\nUser Prompt: ${prompt}` },
      ],
    };
    return { endpoint, headers, body, provider: "anthropic" };
  } else if (prov === "ollama") {
    let endpoint = options.endpoint || "http://localhost:11434/api/generate";
    const model = options.model || "llama3";
    const headers = {
      "Content-Type": "application/json",
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    if (endpoint.includes("/chat/completions")) {
      const body = {
        model,
        temperature: temp,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
      };
      return { endpoint, headers, body, provider: "ollama" };
    } else {
      const body = {
        model,
        prompt: `${systemPrompt}\n\nUser Prompt: ${prompt}`,
        stream: false,
        options: { temperature: temp },
      };
      return { endpoint, headers, body, provider: "ollama" };
    }
  } else {
    throw new Error(`Unsupported AI provider: ${provider}`);
  }
}

/**
 * Extracts response text from provider JSON output.
 * @param {string} provider
 * @param {object} responseData
 * @returns {string}
 */
export function extractAIResponseText(provider, responseData) {
  if (!responseData || typeof responseData !== "object") {
    return "";
  }
  const prov = (provider || "").toLowerCase();

  if (prov === "openai") {
    return responseData.choices?.[0]?.message?.content || "";
  } else if (prov === "anthropic" || prov === "claude") {
    if (Array.isArray(responseData.content)) {
      return responseData.content.map((c) => c.text || "").join("\n");
    }
    return responseData.content || "";
  } else if (prov === "ollama") {
    if (responseData.response) {
      return responseData.response;
    }
    if (responseData.choices?.[0]?.message?.content) {
      return responseData.choices[0].message.content;
    }
  }

  return (
    responseData.response ||
    responseData.text ||
    responseData.choices?.[0]?.message?.content ||
    ""
  );
}

/**
 * Main translation function with local model fallback support.
 * @param {string} rawPrompt
 * @param {object} [config]
 * @returns {Promise<string>}
 */
export async function translateNaturalLanguageToCommand(rawPrompt, config = {}) {
  const prompt = cleanAIPrompt(rawPrompt);
  if (!prompt) {
    throw new Error("Prompt cannot be empty.");
  }

  const aiConfig = config.ai || config || {};
  const primaryProvider = (aiConfig.provider || "openai").toLowerCase();
  const fallbackProvider = (aiConfig.fallback_provider || "ollama").toLowerCase();

  // Try Primary Provider
  try {
    const req = buildAIRequest(primaryProvider, prompt, {
      ...aiConfig,
      apiKey: getAIApiKey(primaryProvider, config),
    });
    const res = await httpPost(req.endpoint, req.headers, req.body);
    const text = extractAIResponseText(primaryProvider, res);
    const command = parseCommandFromAIResponse(text);
    if (command) {
      return command;
    }
    throw new Error("AI provider returned empty command.");
  } catch (primaryErr) {
    console.warn(
      `CmdBar AI: Primary provider (${primaryProvider}) failed: ${primaryErr.message}. Attempting fallback (${fallbackProvider})...`
    );

    if (primaryProvider === fallbackProvider) {
      throw primaryErr;
    }

    // Try Fallback Provider (e.g. Ollama)
    try {
      const fallbackOptions = {
        ...aiConfig,
        model: aiConfig.fallback_model || (fallbackProvider === "ollama" ? "llama3" : aiConfig.model),
        apiKey: getAIApiKey(fallbackProvider, config),
      };
      const req = buildAIRequest(fallbackProvider, prompt, fallbackOptions);
      const res = await httpPost(req.endpoint, req.headers, req.body);
      const text = extractAIResponseText(fallbackProvider, res);
      const command = parseCommandFromAIResponse(text);
      if (command) {
        return command;
      }
      throw new Error("Fallback AI provider returned empty command.");
    } catch (fallbackErr) {
      throw new Error(
        `AI Command Translation failed. Primary (${primaryProvider}): ${primaryErr.message}; Fallback (${fallbackProvider}): ${fallbackErr.message}`
      );
    }
  }
}
