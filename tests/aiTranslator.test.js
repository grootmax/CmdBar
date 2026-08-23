import { jest } from "@jest/globals";
import {
  parseCommandFromAIResponse,
  cleanAIPrompt,
  isAICommand,
  getAIApiKey,
  buildAIRequest,
  extractAIResponseText,
  translateNaturalLanguageToCommand,
} from "../extension/aiTranslator.js";

describe("AI Command Translator (JS)", () => {
  test("isAICommand identifies /ai prefix correctly", () => {
    expect(isAICommand("/ai deploy latest build")).toBe(true);
    expect(isAICommand("/AI create git branch")).toBe(true);
    expect(isAICommand("  /ai  scale docker container")).toBe(true);
    expect(isAICommand("git checkout main")).toBe(false);
    expect(isAICommand(null)).toBe(false);
  });

  test("cleanAIPrompt strips trigger prefix", () => {
    expect(cleanAIPrompt("/ai deploy build to staging")).toBe(
      "deploy build to staging",
    );
    expect(cleanAIPrompt("/AI list running processes")).toBe(
      "list running processes",
    );
    expect(cleanAIPrompt("  /ai  make test ")).toBe("make test");
    expect(cleanAIPrompt("git status")).toBe("git status");
  });

  test("parseCommandFromAIResponse extracts commands from various LLM response formats", () => {
    // 1. Triple backticks bash code block
    const res1 =
      "Here is the command:\n```bash\ncd /project && make build && scp build.tar.gz staging:/var/www/\n```";
    expect(parseCommandFromAIResponse(res1)).toBe(
      "cd /project && make build && scp build.tar.gz staging:/var/www/",
    );

    // 2. Generic code block
    const res2 = "```\ngit checkout -b feature/ai-shell\n```";
    expect(parseCommandFromAIResponse(res2)).toBe(
      "git checkout -b feature/ai-shell",
    );

    // 3. Inline backticks
    const res3 = "You can run `docker ps -a` to view containers.";
    expect(parseCommandFromAIResponse(res3)).toBe("docker ps -a");

    // 4. Plain text filtered
    const res4 = "Here is your command:\nps aux | grep node";
    expect(parseCommandFromAIResponse(res4)).toBe("ps aux | grep node");
  });

  test("getAIApiKey retrieves keys from config and env", () => {
    const config = {
      ai: {
        provider: "openai",
        api_key: "sk-test-12345",
      },
    };
    expect(getAIApiKey("openai", config)).toBe("sk-test-12345");

    process.env.ANTHROPIC_API_KEY = "sk-ant-test-67890";
    expect(getAIApiKey("anthropic", {})).toBe("sk-ant-test-67890");
    delete process.env.ANTHROPIC_API_KEY;
  });

  test("buildAIRequest formats requests for OpenAI, Anthropic, and Ollama", () => {
    // OpenAI
    const openAiReq = buildAIRequest("openai", "/ai deploy service", {
      model: "gpt-4o",
      apiKey: "test-key",
      temperature: 0.1,
    });
    expect(openAiReq.endpoint).toBe(
      "https://api.openai.com/v1/chat/completions",
    );
    expect(openAiReq.headers["Authorization"]).toBe("Bearer test-key");
    expect(openAiReq.body.model).toBe("gpt-4o");

    // Anthropic / Claude
    const claudeReq = buildAIRequest("anthropic", "/ai check logs", {
      model: "claude-3-5-sonnet-20241022",
      apiKey: "ant-key",
    });
    expect(claudeReq.endpoint).toBe("https://api.anthropic.com/v1/messages");
    expect(claudeReq.headers["x-api-key"]).toBe("ant-key");
    expect(claudeReq.body.model).toBe("claude-3-5-sonnet-20241022");

    // Ollama (Local)
    const ollamaReq = buildAIRequest("ollama", "/ai list pods", {
      model: "llama3",
    });
    expect(ollamaReq.endpoint).toBe("http://localhost:11434/api/generate");
    expect(ollamaReq.body.model).toBe("llama3");
    expect(ollamaReq.body.stream).toBe(false);
  });

  test("extractAIResponseText parses response payloads", () => {
    // OpenAI
    const openAiJson = {
      choices: [{ message: { content: "```bash\nmake build\n```" } }],
    };
    expect(extractAIResponseText("openai", openAiJson)).toBe(
      "```bash\nmake build\n```",
    );

    // Anthropic
    const anthropicJson = {
      content: [{ text: "```bash\nsystemctl status nginx\n```" }],
    };
    expect(extractAIResponseText("anthropic", anthropicJson)).toBe(
      "```bash\nsystemctl status nginx\n```",
    );

    // Ollama
    const ollamaJson = {
      response: "```bash\nkubectl get pods\n```",
    };
    expect(extractAIResponseText("ollama", ollamaJson)).toBe(
      "```bash\nkubectl get pods\n```",
    );
  });

  test("translateNaturalLanguageToCommand handles successful translation and local fallback", async () => {
    const originalFetch = global.fetch;

    try {
      // Mock primary failure, fallback success
      let calls = 0;
      global.fetch = jest.fn().mockImplementation((url) => {
        calls++;
        if (url.includes("openai.com")) {
          return Promise.resolve({
            ok: false,
            status: 500,
            statusText: "Internal Server Error",
            text: () => Promise.resolve("API key expired"),
          });
        }
        if (url.includes("localhost:11434")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                response:
                  "```bash\ncd /project && make build && scp build.tar.gz staging:/var/www/\n```",
              }),
          });
        }
        return Promise.reject(new Error("Unknown URL"));
      });

      const config = {
        ai: {
          provider: "openai",
          fallback_provider: "ollama",
          fallback_model: "llama3",
        },
      };

      const command = await translateNaturalLanguageToCommand(
        "/ai deploy the latest build to staging",
        config,
      );

      expect(command).toBe(
        "cd /project && make build && scp build.tar.gz staging:/var/www/",
      );
      expect(calls).toBe(2);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
