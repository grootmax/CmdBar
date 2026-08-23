import { jest } from "@jest/globals";
import {
  DEFAULT_BRANDING,
  validateBrandingConfig,
  getBrandingConfig,
  validateConfigSchema,
} from "../extension/configSync.js";
import {
  applyDomainAlias,
  buildAIRequest,
  httpPost,
} from "../extension/aiTranslator.js";

describe("Enterprise Custom Branding (White Label)", () => {
  test("DEFAULT_BRANDING structure and default values", () => {
    expect(DEFAULT_BRANDING.enabled).toBe(false);
    expect(DEFAULT_BRANDING.white_label).toBe(false);
    expect(DEFAULT_BRANDING.organization_name).toBe("CmdBar Enterprise");
    expect(DEFAULT_BRANDING.brand_color).toBe("#0055ff");
    expect(DEFAULT_BRANDING.accent_color).toBe("#00aaff");
  });

  test("validateBrandingConfig validation rules", () => {
    expect(validateBrandingConfig(null)).toBe(true);
    expect(validateBrandingConfig({})).toBe(true);
    expect(
      validateBrandingConfig({
        enabled: true,
        white_label: true,
        organization_name: "Acme Corp",
        brand_color: "#123456",
        domain_alias: "cmd.acme.corp",
        custom_ssl: { verify_ssl: false },
      }),
    ).toBe(true);

    expect(validateBrandingConfig("invalid")).toBe(false);
    expect(validateBrandingConfig({ enabled: "not-a-bool" })).toBe(false);
    expect(validateBrandingConfig({ organization_name: 12345 })).toBe(false);
    expect(validateBrandingConfig({ custom_ssl: "invalid" })).toBe(false);
    expect(
      validateBrandingConfig({ custom_ssl: { verify_ssl: "invalid" } }),
    ).toBe(false);
  });

  test("getBrandingConfig resolution with fallbacks", () => {
    const resDefault = getBrandingConfig({});
    expect(resDefault.enabled).toBe(false);
    expect(resDefault.organization_name).toBe("CmdBar Enterprise");

    const config = {
      branding: {
        enabled: true,
        organization_name: "Stark Industries",
        brand_color: "#cc0000",
        domain_alias: "commands.stark.com",
        custom_ssl: {
          cert_path: "/etc/ssl/stark.crt",
          verify_ssl: true,
        },
      },
    };
    const res = getBrandingConfig(config);
    expect(res.enabled).toBe(true);
    expect(res.white_label).toBe(true);
    expect(res.organization_name).toBe("Stark Industries");
    expect(res.brand_color).toBe("#cc0000");
    expect(res.domain_alias).toBe("commands.stark.com");
    expect(res.custom_ssl.cert_path).toBe("/etc/ssl/stark.crt");
    expect(res.custom_ssl.verify_ssl).toBe(true);
  });

  test("validateConfigSchema includes branding validation", () => {
    const validConfig = {
      branding: {
        enabled: true,
        organization_name: "Wayne Enterprises",
      },
      categories: [
        {
          name: "Security",
          commands: [{ name: "Scan", command: "nmap localhost" }],
        },
      ],
    };
    expect(validateConfigSchema(validConfig)).toBe(true);

    const invalidConfig = {
      branding: {
        enabled: "invalid-boolean",
      },
      categories: [],
    };
    expect(validateConfigSchema(invalidConfig)).toBe(false);
  });

  test("applyDomainAlias URL domain replacement", () => {
    const endpoint = "https://api.openai.com/v1/chat/completions";

    expect(applyDomainAlias(endpoint, "cmdbar.acme.internal")).toBe(
      "https://cmdbar.acme.internal/v1/chat/completions",
    );

    expect(
      applyDomainAlias(endpoint, "https://custom.endpoint.corp/ai"),
    ).toBe("https://custom.endpoint.corp/ai/v1/chat/completions");

    expect(applyDomainAlias(endpoint, "")).toBe(endpoint);
    expect(applyDomainAlias(endpoint, null)).toBe(endpoint);
  });

  test("buildAIRequest applies domain_alias from branding config", () => {
    const options = {
      branding: {
        enabled: true,
        domain_alias: "ai.acme.corp",
      },
    };
    const req = buildAIRequest("openai", "build project", options);
    expect(req.endpoint).toBe("https://ai.acme.corp/v1/chat/completions");
  });

  test("httpPost with sslOptions parameter", async () => {
    const sslOptions = {
      verify_ssl: false,
      ca_path: "/tmp/ca.crt",
    };
    // Tests that httpPost executes cleanly with sslOptions
    if (typeof fetch === "function") {
      const origFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });
      const res = await httpPost("https://localhost/api", {}, {}, sslOptions);
      expect(res.success).toBe(true);
      global.fetch = origFetch;
    }
  });

  test("Performance benchmark: getBrandingConfig execution time", () => {
    const config = {
      branding: {
        enabled: true,
        organization_name: "Umbrella Corp",
        brand_color: "#ff0000",
        domain_alias: "cmd.umbrella.corp",
      },
    };
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      getBrandingConfig(config);
    }
    const elapsed = performance.now() - start;
    // 1000 resolution cycles must complete well under 50ms
    expect(elapsed).toBeLessThan(50);
  });
});
