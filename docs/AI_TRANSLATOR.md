# AI Natural Language Command Translator

CmdBar includes built-in AI translation capabilities that allow users to translate natural language prompts into executable shell commands.

## Usage

Trigger AI mode by prefixing any input or command template with `/ai`:

```text
/ai deploy the latest build to staging
```

Example Flow:
1. User enters: `/ai deploy the latest build to staging`
2. CmdBar calls the configured AI Provider (OpenAI, Anthropic Claude, or local Ollama).
3. The response is parsed for executable code blocks (e.g. ```bash ... ```).
4. Generated Command Confirmation Dialog is presented:
   - Generated Command: `cd /project && make build && scp build.tar.gz staging:/var/www/`
5. Upon user confirmation, the command is executed.

## Supported AI Providers

1. **OpenAI** (default model: `gpt-4o`, endpoint: `https://api.openai.com/v1/chat/completions`)
2. **Anthropic / Claude** (default model: `claude-3-5-sonnet-20241022`, endpoint: `https://api.anthropic.com/v1/messages`)
3. **Ollama / Local Model** (default model: `llama3`, endpoint: `http://localhost:11434/api/generate`)

## Local Model Fallback

If the primary provider fails due to network issues, rate limits, or missing API keys, CmdBar automatically falls back to calling the local model (`ollama`).

## Configuration

In `~/.config/cmdbar/config.json`:

```json
{
  "ai": {
    "provider": "openai",
    "model": "gpt-4o",
    "temperature": 0.2,
    "api_key": "YOUR_SECURE_API_KEY",
    "require_confirmation": true,
    "fallback_provider": "ollama",
    "fallback_model": "llama3"
  }
}
```

## Secure API Key Storage

API keys can be supplied via configuration (`ai.api_key`), GNOME GSettings preferences (`ai-api-key`), or standard environment variables (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`). API keys are automatically redacted from preview logs and UI confirmations.
