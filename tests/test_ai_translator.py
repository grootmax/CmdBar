import os
import json
import pytest
from unittest.mock import patch, MagicMock

from companion.ai_translator import (
    parse_command_from_ai_response,
    clean_ai_prompt,
    is_ai_command,
    get_ai_api_key,
    build_ai_request,
    extract_ai_response_text,
    translate_natural_language_to_command,
)


def test_is_ai_command():
    assert is_ai_command("/ai deploy latest build") is True
    assert is_ai_command("/AI create git branch") is True
    assert is_ai_command("  /ai scale container") is True
    assert is_ai_command("git status") is False
    assert is_ai_command(None) is False


def test_clean_ai_prompt():
    assert clean_ai_prompt("/ai deploy build to staging") == "deploy build to staging"
    assert clean_ai_prompt("/AI list running processes") == "list running processes"
    assert clean_ai_prompt("  /ai  make test ") == "make test"
    assert clean_ai_prompt("git checkout main") == "git checkout main"


def test_parse_command_from_ai_response():
    # 1. Code block with bash
    res1 = "Here is the command:\n```bash\ncd /project && make build && scp build.tar.gz staging:/var/www/\n```"
    assert (
        parse_command_from_ai_response(res1)
        == "cd /project && make build && scp build.tar.gz staging:/var/www/"
    )

    # 2. Plain code block
    res2 = "```\ngit checkout -b feature/ai\n```"
    assert parse_command_from_ai_response(res2) == "git checkout -b feature/ai"

    # 3. Inline backticks
    res3 = "You can run `docker ps -a` to inspect."
    assert parse_command_from_ai_response(res3) == "docker ps -a"

    # 4. Plain text
    res4 = "Here is your command:\nps aux | grep python"
    assert parse_command_from_ai_response(res4) == "ps aux | grep python"


def test_get_ai_api_key():
    config = {"ai": {"provider": "openai", "api_key": "sk-config-key"}}
    assert get_ai_api_key("openai", config) == "sk-config-key"

    with patch.dict(os.environ, {"OPENAI_API_KEY": "sk-env-key"}):
        assert get_ai_api_key("openai", {}) == "sk-env-key"


def test_build_ai_request():
    # OpenAI
    url, headers, body_bytes, prov = build_ai_request(
        "openai", "/ai build project", {"api_key": "key1"}
    )
    assert "api.openai.com" in url
    assert headers["Authorization"] == "Bearer key1"
    body = json.loads(body_bytes.decode("utf-8"))
    assert body["model"] == "gpt-4o"

    # Anthropic
    url, headers, body_bytes, prov = build_ai_request(
        "anthropic", "/ai test project", {"api_key": "key2"}
    )
    assert "api.anthropic.com" in url
    assert headers["x-api-key"] == "key2"
    body = json.loads(body_bytes.decode("utf-8"))
    assert body["model"] == "claude-3-5-sonnet-20241022"

    # Ollama
    url, headers, body_bytes, prov = build_ai_request("ollama", "/ai status", {})
    assert "localhost:11434" in url
    body = json.loads(body_bytes.decode("utf-8"))
    assert body["model"] == "llama3"


def test_extract_ai_response_text():
    # OpenAI
    res_openai = {"choices": [{"message": {"content": "```bash\nmake test\n```"}}]}
    assert extract_ai_response_text("openai", res_openai) == "```bash\nmake test\n```"

    # Anthropic
    res_claude = {"content": [{"text": "```bash\ngit status\n```"}]}
    assert (
        extract_ai_response_text("anthropic", res_claude) == "```bash\ngit status\n```"
    )

    # Ollama
    res_ollama = {"response": "```bash\ndocker ps\n```"}
    assert extract_ai_response_text("ollama", res_ollama) == "```bash\ndocker ps\n```"


@patch("companion.ai_translator.http_post_json")
def test_translate_natural_language_to_command_fallback(mock_http_post):
    # Primary (OpenAI) fails, Fallback (Ollama) succeeds
    def mock_post(url, headers, data, timeout=15):
        if "openai.com" in url:
            raise RuntimeError("API key invalid")
        if "localhost:11434" in url:
            return {
                "response": "```bash\ncd /project && make build && scp build.tar.gz staging:/var/www/\n```"
            }
        raise RuntimeError("Unknown endpoint")

    mock_http_post.side_effect = mock_post

    config = {
        "ai": {
            "provider": "openai",
            "fallback_provider": "ollama",
            "fallback_model": "llama3",
        }
    }

    cmd = translate_natural_language_to_command(
        "/ai deploy latest build to staging", config
    )
    assert cmd == "cd /project && make build && scp build.tar.gz staging:/var/www/"
    assert mock_http_post.call_count == 2
