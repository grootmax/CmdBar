import { 
    validateBrandingConfig, 
    getEffectiveBranding, 
    getEffectiveDomainUrl, 
    loadConfig, 
    saveConfig, 
    DEFAULT_CONFIG 
} from '../extension/configSync.js';
import { CmdBarDBusService } from '../extension/dbusService.js';
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
});
