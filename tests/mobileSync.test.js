import { MobileSync } from '../companion/mobileSync.js';

describe('MobileSync Companion Module', () => {
    const mockCommands = [
        {
            id: 'act-1',
            name: 'Deploy Staging',
            category: 'Deploy',
            command: 'make deploy',
            requiresBiometric: true,
            icon: 'rocket'
        },
        {
            id: 'act-2',
            name: 'Run Tests',
            category: 'CI/CD',
            command: 'npm test',
            requiresBiometric: false,
            icon: 'test'
        }
    ];

    describe('Quick Action Formatting', () => {
        test('formatQuickActions for iOS platform', () => {
            const actions = MobileSync.formatQuickActions(mockCommands, 'ios');
            expect(actions).toHaveLength(2);
            expect(actions[0]).toEqual({
                type: 'act-1',
                title: 'Deploy Staging',
                subtitle: 'Deploy',
                iconType: 'rocket',
                command: 'make deploy',
                requiresBiometric: true
            });
        });

        test('formatQuickActions for Android platform', () => {
            const actions = MobileSync.formatQuickActions(mockCommands, 'android');
            expect(actions).toHaveLength(2);
            expect(actions[0]).toEqual({
                id: 'act-1',
                shortLabel: 'Deploy Staging',
                longLabel: 'Deploy: Deploy Staging',
                iconRes: 'rocket',
                command: 'make deploy',
                requiresBiometric: true
            });
        });

        test('formatQuickActions handles empty inputs gracefully', () => {
            expect(MobileSync.formatQuickActions(null)).toEqual([]);
            expect(MobileSync.formatQuickActions([])).toEqual([]);
        });
    });

    describe('Widget Payload Building', () => {
        test('buildWidgetPayload for iOS WidgetKit', () => {
            const payload = MobileSync.buildWidgetPayload(mockCommands, 'ios', 'medium', 3);
            expect(payload.status).toBe('online');
            expect(payload.family).toBe('medium');
            expect(payload.quickActions).toHaveLength(2);
            expect(payload.systemMetrics.queueDepth).toBe(3);
            expect(payload.timeline[0].badgeCount).toBe(3);
        });

        test('buildWidgetPayload for Android RemoteViews', () => {
            const payload = MobileSync.buildWidgetPayload(mockCommands, 'android', 'medium', 5);
            expect(payload.widgetType).toBe('remote_views');
            expect(payload.shortcuts).toHaveLength(2);
            expect(payload.queueCount).toBe(5);
            expect(payload.layout.columns).toBe(2);
        });
    });

    describe('Biometric Payload Validation', () => {
        test('validateBiometricPayload approves valid challenge and signature', () => {
            const challenge = {
                challengeId: 'ch-123',
                nonce: 'nonce-abc',
                expiresAt: Math.floor(Date.now() / 1000) + 300
            };
            const valid = MobileSync.validateBiometricPayload(challenge, 'valid_sig_token');
            expect(valid).toBe(true);
        });

        test('validateBiometricPayload rejects expired or missing challenge', () => {
            const expiredChallenge = {
                challengeId: 'ch-123',
                nonce: 'nonce-abc',
                expiresAt: Math.floor(Date.now() / 1000) - 100
            };
            expect(MobileSync.validateBiometricPayload(expiredChallenge, 'sig')).toBe(false);
            expect(MobileSync.validateBiometricPayload(null, 'sig')).toBe(false);
            expect(MobileSync.validateBiometricPayload({}, 'sig')).toBe(false);
            expect(MobileSync.validateBiometricPayload({ challengeId: 'c', nonce: 'n' }, '')).toBe(false);
        });
    });

    describe('Offline Queue Synchronization', () => {
        test('enqueueOfflineAction appends new item to queue', () => {
            const queue = MobileSync.enqueueOfflineAction([], 'dev-phone', 'Deploy', 'make deploy', { env: 'staging' });
            expect(queue).toHaveLength(1);
            expect(queue[0].commandName).toBe('Deploy');
            expect(queue[0].status).toBe('queued');
            expect(queue[0].parameters).toEqual({ env: 'staging' });
        });

        test('syncOfflineQueue deduplicates and merges remote batch', () => {
            const local = [
                { queueId: 'q1', commandName: 'Cmd 1', status: 'queued' }
            ];
            const remote = [
                { queueId: 'q1', commandName: 'Cmd 1 Dup', status: 'queued' },
                { queueId: 'q2', commandName: 'Cmd 2', status: 'queued' }
            ];

            const synced = MobileSync.syncOfflineQueue(local, remote);
            expect(synced).toHaveLength(2);
            expect(synced.map(i => i.queueId)).toEqual(['q1', 'q2']);
        });
    });
});
