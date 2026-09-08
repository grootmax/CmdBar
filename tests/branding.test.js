import { jest } from "@jest/globals";
import { 
    validateBrandingConfig, 
    getEffectiveBranding, 
    getBrandingConfig,
    getEffectiveDomainUrl, 
    loadConfig, 
    saveConfig, 
    DEFAULT_CONFIG,
    DEFAULT_BRANDING,
    validateConfigSchema
} from '../extension/configSync.js';
import { CmdBarDBusService } from '../extension/dbusService.js';
import {
    applyDomainAlias,
    buildAIRequest,
    httpPost,
} from "../extension/aiTranslator.js";
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Enterprise Custom Branding & White Label Unit Tests', () => {
    let tempDir;
    let configPath;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmdbar-branding-test-'));
        configPath = path.join(tempDir, 'cmdbar', 'config.json');
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
    });

    afterEach(() => {
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test("DEFAULT_BRANDING structure and default values", () => {
        expect(DEFAULT_BRANDING.enabled).toBe(false);
        expect(DEFAULT_BRANDING.white_label).toBe(false);
        expect(DEFAULT_BRANDING.organization_name).toBe("CmdBar Enterprise");
        expect(DEFAULT_BRANDING.brand_color).toBe("#0055ff");
        expect(DEFAULT_BRANDING.accent_color).toBe("#00aaff");
    });

    describe('Branding Configuration Schema Validation', () => {
        test('should validate correct branding configurations', () => {
            const valid = {
                enabled: true,
                app_name: 'AcmeCmd',
                logo_path: '/opt/acme/logo.png',
                brand_colors: {
                    primary: '#1e3a8a',
                    accent: '#3b82f6',
                    background: '#0f172a',
                    text: '#ffffff'
                },
                domain_alias: 'cmd.acme.corp',
                custom_ssl: {
                    cert_path: '/etc/ssl/acme.crt',
                    key_path: '/etc/ssl/acme.key',
                    ca_path: '/etc/ssl/ca.crt',
                    verify_ssl: true
                },
                enterprise_identity: {
                    organization_name: 'Acme Corp',
                    support_url: 'https://support.acme.corp',
                    support_email: 'ops@acme.corp',
                    footer_text: 'Internal Acme Corporate Tooling'
                }
            };
            expect(validateBrandingConfig(valid)).toBe(true);
            expect(validateBrandingConfig(undefined)).toBe(true);
            expect(validateBrandingConfig(null)).toBe(true);
            expect(validateBrandingConfig({})).toBe(true);
        });

        test('should reject invalid color formats', () => {
            const badColor = {
                brand_colors: {
                    primary: 'not-a-color-!!!'
                }
            };
            expect(validateBrandingConfig(badColor)).toBe(false);
        });

        test('should reject invalid domain aliases', () => {
            const badDomain = {
                domain_alias: 'http://bad domain with spaces'
            };
            expect(validateBrandingConfig(badDomain)).toBe(false);
        });

        test('should reject invalid SSL structures', () => {
            const badSsl = {
                custom_ssl: {
                    verify_ssl: 'not-a-boolean'
                }
            };
            expect(validateBrandingConfig(badSsl)).toBe(false);
        });

        test('should reject invalid enterprise identity structures', () => {
            const badIdentity = {
                enterprise_identity: {
                    organization_name: 12345
                }
            };
            expect(validateBrandingConfig(badIdentity)).toBe(false);
        });
    });

    describe('Effective Branding Resolution', () => {
        test('should return default branding when none provided', () => {
            const effective = getEffectiveBranding({});
            expect(effective.enabled).toBe(false);
            expect(effective.app_name).toBe('CmdBar');
            expect(effective.brand_colors.primary).toBe('#3584e4');
        });

        test('should override defaults with custom white label branding', () => {
            const config = {
                branding: {
                    enabled: true,
                    app_name: 'AcmeCmd',
                    brand_colors: {
                        primary: '#1e3a8a'
                    },
                    domain_alias: 'cmd.acme.corp'
                }
            };
            const effective = getEffectiveBranding(config);
            expect(effective.enabled).toBe(true);
            expect(effective.app_name).toBe('AcmeCmd');
            expect(effective.brand_colors.primary).toBe('#1e3a8a');
            expect(effective.domain_alias).toBe('cmd.acme.corp');
        });

        test('getBrandingConfig resolution with fallbacks', () => {
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
    });

    describe('Domain Alias URL Resolution', () => {
        test('should append path to domain alias endpoint', () => {
            const branding = { domain_alias: 'cmd.acme.corp' };
            expect(getEffectiveDomainUrl(branding, '/api/v1/sync')).toBe('https://cmd.acme.corp/api/v1/sync');
            expect(getEffectiveDomainUrl(branding, 'api/v1/sync')).toBe('https://cmd.acme.corp/api/v1/sync');
        });

        test('should return relative path if domain alias is empty', () => {
            expect(getEffectiveDomainUrl({}, '/api/v1/sync')).toBe('/api/v1/sync');
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
    });

    describe('D-Bus Branding Management API', () => {
        test('should read and update branding via D-Bus interface methods', async () => {
            const dummyIndicator = {
                _getConfigPath: () => configPath,
                _reloadMenu: () => {}
            };
            const service = new CmdBarDBusService(dummyIndicator);

            // Initially default app name
            const initAppName = await service.GetEffectiveAppName();
            expect(initAppName).toBe('CmdBar');

            const brandingUpdate = {
                enabled: true,
                app_name: 'AcmeConsole',
                logo_path: 'acme-symbolic',
                brand_colors: {
                    primary: '#0055ff'
                },
                domain_alias: 'console.acme.corp'
            };

            const success = await service.SetBranding(JSON.stringify(brandingUpdate));
            expect(success).toBe(true);

            const updatedAppName = await service.GetEffectiveAppName();
            expect(updatedAppName).toBe('AcmeConsole');

            const jsonStr = await service.GetBranding();
            const retrieved = JSON.parse(jsonStr);
            expect(retrieved.enabled).toBe(true);
            expect(retrieved.app_name).toBe('AcmeConsole');
            expect(retrieved.domain_alias).toBe('console.acme.corp');
        });

        test('should reject malformed branding JSON in D-Bus SetBranding', async () => {
            const dummyIndicator = {
                _getConfigPath: () => configPath,
                _reloadMenu: () => {}
            };
            const service = new CmdBarDBusService(dummyIndicator);
            const success = await service.SetBranding('invalid json {{{');
            expect(success).toBe(false);
        });
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
        expect(elapsed).toBeLessThan(50);
    });
});

