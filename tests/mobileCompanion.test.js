import fs from 'fs';
import path from 'path';
import os from 'os';
import { MobileCompanionService } from '../companion/mobileCompanion.js';

describe('Mobile Companion JS Module', () => {
    let tmpDir;
    let configPath;
    let service;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmdbar-mobile-test-'));
        configPath = path.join(tmpDir, 'mobile_test.json');
        process.env.CMDBAR_MOBILE_CONFIG_PATH = configPath;
        service = new MobileCompanionService(configPath);
    });

    afterEach(() => {
        try {
            if (fs.existsSync(tmpDir)) {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            }
        } catch (e) {}
        delete process.env.CMDBAR_MOBILE_CONFIG_PATH;
    });

    test('Device registration, authentication and unregistration', () => {
        const iosDev = service.deviceManager.registerDevice('ios_1', 'iPhone 15', 'ios', 'apns_token_abc');
        expect(iosDev.device_id).toBe('ios_1');
        expect(iosDev.platform).toBe('ios');

        const androidDev = service.deviceManager.registerDevice('android_1', 'Galaxy S24', 'android', 'fcm_token_xyz');
        expect(androidDev.platform).toBe('android');

        const list = service.deviceManager.listDevices();
        expect(list.length).toBe(2);

        const authenticated = service.deviceManager.authenticateDevice('ios_1', iosDev.device_token);
        expect(authenticated).toBe(true);

        const unregistered = service.deviceManager.unregisterDevice('android_1');
        expect(unregistered).toBe(true);
        expect(service.deviceManager.listDevices().length).toBe(1);
    });

    test('Push notification dispatching and history', () => {
        service.deviceManager.registerDevice('dev_1', 'iPhone', 'ios', 'token_123');
        service.deviceManager.registerDevice('dev_2', 'Pixel', 'android', 'token_456');

        const notif = service.pushEngine.sendNotification('dev_1', 'Task Complete', 'Build succeeded');
        expect(notif.status).toBe('delivered');
        expect(notif.platform).toBe('ios');

        const broadcast = service.pushEngine.broadcastNotification('Alert', 'Maintenance');
        expect(broadcast.length).toBe(2);

        const history = service.pushEngine.getNotificationHistory('dev_1');
        expect(history.length).toBeGreaterThanOrEqual(2);
    });

    test('Quick action registration and execution', async () => {
        service.deviceManager.registerDevice('dev_1', 'iPhone', 'ios');

        const action = service.quickActionManager.registerQuickAction(
            'qa_echo',
            'Echo Test',
            'echo {msg}',
            'terminal',
            'General',
            false,
            { msg: { regex: '^[a-zA-Z0-9_\\-\\s]+$' } }
        );
        expect(action.action_id).toBe('qa_echo');

        const res = await service.quickActionManager.executeQuickAction('dev_1', 'qa_echo', { msg: 'Hello JS Companion' });
        expect(res.status).toBe('success');
        expect(res.stdout).toContain('Hello JS Companion');
    });

    test('Biometric authentication challenge and verification', async () => {
        service.deviceManager.registerDevice('dev_bio', 'Secure iPhone', 'ios', 'apns_token', 'pub_key_123');

        service.quickActionManager.registerQuickAction(
            'qa_sensitive',
            'Sensitive Cmd',
            'echo sensitive',
            'lock',
            'Security',
            true
        );

        // Attempt without biometric token -> fails
        const noBioRes = await service.quickActionManager.executeQuickAction('dev_bio', 'qa_sensitive');
        expect(noBioRes.status).toBe('biometric_required');

        // Challenge/token creation
        const challenge = service.biometricHandler.generateChallenge('dev_bio');
        const token = service.biometricHandler.createBiometricToken('dev_bio', challenge.challenge);

        // Execute with valid biometric token
        const successRes = await service.quickActionManager.executeQuickAction('dev_bio', 'qa_sensitive', {}, token);
        expect(successRes.status).toBe('success');
        expect(successRes.stdout).toContain('sensitive');
    });

    test('Widget provider data formatting and refresh', () => {
        service.deviceManager.registerDevice('dev_1', 'Phone', 'ios', 'token');
        service.quickActionManager.registerQuickAction('qa_1', 'Action 1', 'echo 1');

        const widgetData = service.widgetProvider.getWidgetData('all', 'dev_1', 'medium');
        expect(widgetData.quick_actions.length).toBe(1);
        expect(widgetData.system_status.status).toBe('online');

        const refreshed = service.widgetProvider.refreshWidgetData('quick_actions');
        expect(refreshed.widget_type).toBe('quick_actions');
    });

    test('Offline queue enqueueing and processing', async () => {
        service.deviceManager.registerDevice('dev_offline', 'Offline Phone', 'ios');
        service.quickActionManager.registerQuickAction('qa_offline', 'Offline Cmd', 'echo offline_ok');

        const queued1 = service.offlineQueue.enqueueRequest('dev_offline', 'qa_offline');
        const queued2 = service.offlineQueue.enqueueRequest('dev_offline', 'qa_offline');

        expect(service.offlineQueue.getQueuedRequests('dev_offline', 'queued').length).toBe(2);

        const results = await service.offlineQueue.processAllQueuedRequests();
        expect(results.length).toBe(2);
        expect(results[0].status).toBe('success');

        const cleared = service.offlineQueue.clearCompletedRequests();
        expect(cleared).toBe(2);
    });
});
