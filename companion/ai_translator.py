"""
AI Shell Command Translator for CmdBar Companion & CLI.
Translates natural language prompts to executable shell commands.
Supports OpenAI, Anthropic (Claude), and Ollama (local model), with fallback.
"""

import os
import re
import json
import urllib.request
import urllib.error


def parse_command_from_ai_response(response_text: str) -> str:
    """
    Extracts executable command block from LLM response text.
    """
    if not response_text or not isinstance(response_text, str):
        return ""
    
    text = response_text.strip()

    # 1. Markdown code block ```bash ... ``` or ``` ... ```
    match_block = re.search(r"```(?:[a-zA-Z0-9_-]+)?\s*\n?([\s\S]*?)\n?```", text)
    if match_block and match_block.group(1).strip():
        return match_block.group(1).strip()

    # 2. Inline backticks `...`
    match_inline = re.search(r"`([^`\n]+)`", text)
    if match_inline and match_inline.group(1).strip():
        return match_inline.group(1).strip()

    # 3. Fallback: line-by-line filtering
    lines = [l.strip() for l in text.split("\n") if l.strip()]
    clean_lines = []
    for line in lines:
        lower = line.lower()
        if not (lower.startswith("here is") or lower.startswith("you can") or 
                lower.startswith("note:") or lower.startswith("explanation:") or
                lower.startswith("command:")):
            clean_lines.append(line)

    return " ".join(clean_lines).strip() or text


def clean_ai_prompt(prompt: str) -> str:
    """
    Strips '/ai ' prefix from user prompt.
    """
    if not prompt or not isinstance(prompt, str):
        return ""
    return re.sub(r"^\s*\/ai\s*", "", prompt, flags=re.IGNORECASE).strip()


def is_ai_command(text: str) -> bool:
    """
    Checks if command string starts with '/ai' trigger.
    """
    if not text or not isinstance(text, str):
        return False
    return text.strip().lower().startswith("/ai")


def get_ai_api_key(provider: str, config: dict = None) -> str:
    """
    Retrieves API key for provider from config or environment variables.
    """
    config = config or {}
    ai_cfg = config.get("ai", config) if isinstance(config, dict) else {}

    key = ai_cfg.get("api_key") or ai_cfg.get("apiKey")
    if key and isinstance(key, str) and key.strip():
        return key.strip()

    prov = (provider or ai_cfg.get("provider") or "openai").lower()
    if prov == "openai":
        return os.environ.get("OPENAI_API_KEY", "").strip()
    elif prov in ("anthropic", "claude"):
        return os.environ.get("ANTHROPIC_API_KEY", "").strip()
    elif prov == "ollama":
        return os.environ.get("OLLAMA_API_KEY", "").strip()

    return ""


def build_ai_request(provider: str, raw_prompt: str, options: dict = None) -> tuple:
    """
    Builds HTTP request tuple (url, headers, body_bytes, provider) for provider.
    """
    options = options or {}
    prov = (provider or "openai").lower()
    prompt = clean_ai_prompt(raw_prompt)
    system_prompt = options.get(
        "system_prompt",
        "You are an expert Linux shell command assistant. Translate the natural language prompt into a concise, correct executable shell command. Output ONLY the raw executable command inside a ```bash ... ``` code block. Do not include explanation or Markdown outside the code block."
    )
    temp = options.get("temperature", 0.2)
    api_key = get_ai_api_key(prov, options)

    if prov == "openai":
        endpoint = options.get("endpoint") or "https://api.openai.com/v1/chat/completions"
        model = options.get("model") or "gpt-4o"
        headers = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        body = {
            "model": model,
            "temperature": temp,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt}
            ]
        }
        return endpoint, headers, json.dumps(body).encode("utf-8"), "openai"

    elif prov in ("anthropic", "claude"):
        endpoint = options.get("endpoint") or "https://api.anthropic.com/v1/messages"
        model = options.get("model") or "claude-3-5-sonnet-20241022"
        headers = {
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01"
        }
        if api_key:
            headers["x-api-key"] = api_key
        body = {
            "model": model,
            "max_tokens": 1024,
            "temperature": temp,
            "messages": [
                {"role": "user", "content": f"{system_prompt}\n\nUser Prompt: {prompt}"}
            ]
        }
        return endpoint, headers, json.dumps(body).encode("utf-8"), "anthropic"

    elif prov == "ollama":
        endpoint = options.get("endpoint") or "http://localhost:11434/api/generate"
        model = options.get("model") or "llama3"
        headers = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        if "/chat/completions" in endpoint:
            body = {
                "model": model,
                "temperature": temp,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": prompt}
                ]
            }
        else:
            body = {
                "model": model,
                "prompt": f"{system_prompt}\n\nUser Prompt: {prompt}",
                "stream": False,
                "options": {"temperature": temp}
            }
        return endpoint, headers, json.dumps(body).encode("utf-8"), "ollama"

    else:
        raise ValueError(f"Unsupported AI provider: {provider}")


def extract_ai_response_text(provider: str, response_data: dict) -> str:
    """
    Parses provider response dict to extract text output.
    """
    if not isinstance(response_data, dict):
        return ""
    prov = (provider or "").lower()

    if prov == "openai":
        choices = response_data.get("choices", [])
        if choices and isinstance(choices, list):
            return choices[0].get("message", {}).get("content", "")
    elif prov in ("anthropic", "claude"):
        content = response_data.get("content")
        if isinstance(content, list):
            return "\n".join(c.get("text", "") for c in content if isinstance(c, dict))
        elif isinstance(content, str):
            return content
    elif prov == "ollama":
        if "response" in response_data:
            return response_data["response"]
        choices = response_data.get("choices", [])
        if choices and isinstance(choices, list):
            return choices[0].get("message", {}).get("content", "")

    return (
        response_data.get("response") or
        response_data.get("text") or
        ""
    )


def http_post_json(url: str, headers: dict, data_bytes: bytes, timeout: int = 15) -> dict:
    """
    Executes HTTP POST using urllib.request.
    """
    req = urllib.request.Request(url, data=data_bytes, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            resp_body = resp.read().decode("utf-8")
            return json.loads(resp_body)
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8") if e.fp else ""
        raise RuntimeError(f"HTTP {e.code}: {e.reason} - {err_body}")
    except Exception as e:
        raise RuntimeError(f"HTTP Request failed: {str(e)}")


def translate_natural_language_to_command(raw_prompt: str, config: dict = None) -> str:
    """
    Translates natural language prompt to executable shell command.
    Includes automatic local model fallback if primary provider fails.
    """
    prompt = clean_ai_prompt(raw_prompt)
    if not prompt:
        raise ValueError("Prompt cannot be empty.")

    config = config or {}
    ai_cfg = config.get("ai", config) if isinstance(config, dict) else {}
    primary_provider = (ai_cfg.get("provider") or "openai").lower()
    fallback_provider = (ai_cfg.get("fallback_provider") or "ollama").lower()

    # Try Primary Provider
    try:
        url, headers, body, prov = build_ai_request(primary_provider, prompt, ai_cfg)
        res = http_post_json(url, headers, body)
        text = extract_ai_response_text(prov, res)
        cmd = parse_command_from_ai_response(text)
        if cmd:
            return cmd
        raise RuntimeError("AI provider returned empty command.")
    except Exception as primary_err:
        if primary_provider == fallback_provider:
            raise primary_err

        # Try Fallback Provider (e.g. Ollama)
        try:
            fallback_opts = dict(ai_cfg)
            fallback_opts["model"] = ai_cfg.get("fallback_model") or ("llama3" if fallback_provider == "ollama" else ai_cfg.get("model"))
            url, headers, body, prov = build_ai_request(fallback_provider, prompt, fallback_opts)
            res = http_post_json(url, headers, body)
            text = extract_ai_response_text(prov, res)
            cmd = parse_command_from_ai_response(text)
            if cmd:
                return cmd
            raise RuntimeError("Fallback AI provider returned empty command.")
        except Exception as fallback_err:
            raise RuntimeError(
                f"AI Command Translation failed. Primary ({primary_provider}): {str(primary_err)}; Fallback ({fallback_provider}): {str(fallback_err)}"
            )
