/**
 * CmdBar Mobile Companion JS Module
 * =================================
 * Provides JavaScript utilities for Mobile Companion synchronization,
 * including Quick Action formatters, Widget payload generation,
 * Biometric Challenge verification, and Offline Queue management.
 * 
 * @public
 */

export class MobileSync {
    /**
     * Formats commands into mobile Quick Actions (iOS ShortcutItems / Android Shortcuts).
     * @public
     * @param {Array} commands Array of command objects
     * @param {string} platform 'ios' | 'android'
     * @returns {Array} Array of formatted mobile quick actions
     */
    static formatQuickActions(commands = [], platform = 'ios') {
        if (!Array.isArray(commands)) return [];
        
        return commands.map((cmd, idx) => {
            const id = cmd.id || `action-${idx + 1}`;
            const title = cmd.name || cmd.title || 'Quick Action';
            const category = cmd.category || 'General';
            const command = cmd.command || cmd.template || '';
            const requiresBiometric = Boolean(cmd.requiresBiometric || cmd.requires_biometric);
            const icon = cmd.icon || 'terminal';

            if (platform.toLowerCase() === 'ios') {
                return {
                    type: id,
                    title: title,
                    subtitle: category,
                    iconType: icon,
                    command: command,
                    requiresBiometric: requiresBiometric
                };
            } else {
                return {
                    id: id,
                    shortLabel: title,
                    longLabel: `${category}: ${title}`,
                    iconRes: icon,
                    command: command,
                    requiresBiometric: requiresBiometric
                };
            }
        });
    }

    /**
     * Builds widget state payload for iOS WidgetKit or Android RemoteViews.
     * @public
     * @param {Array} commands Array of active commands
     * @param {string} platform 'ios' | 'android'
     * @param {string} family 'small' | 'medium' | 'large'
     * @param {number} queueCount Depth of pending offline queue
     * @returns {Object} Structured widget payload
     */
    static buildWidgetPayload(commands = [], platform = 'ios', family = 'medium', queueCount = 0) {
        const actions = this.formatQuickActions(commands, platform);
        const timestamp = Date.now();

        if (platform.toLowerCase() === 'ios') {
            return {
                date: timestamp,
                family: family,
                status: 'online',
                quickActions: actions.slice(0, 4),
                systemMetrics: {
                    queueDepth: queueCount,
                    totalQuickActions: actions.length
                },
                timeline: [
                    {
                        entryDate: timestamp,
                        title: 'CmdBar Desktop Companion',
                        status: 'online',
                        badgeCount: queueCount
                    }
                ]
            };
        } else {
            return {
                widgetType: 'remote_views',
                family: family,
                updatedAt: timestamp,
                shortcuts: actions.slice(0, 6),
                statusText: 'CmdBar (Online)',
                queueCount: queueCount,
                layout: {
                    columns: family === 'medium' ? 2 : 4,
                    showStatusHeader: true
                }
            };
        }
    }

    /**
     * Validates a biometric verification payload token against a challenge nonce.
     * @public
     * @param {Object} challenge Challenge object containing challengeId and nonce
     * @param {string} signature Received biometric signature
     * @returns {boolean} True if verification payload structure is valid
     */
    static validateBiometricPayload(challenge, signature) {
        if (!challenge || typeof challenge !== 'object') return false;
        if (!challenge.challengeId || !challenge.nonce) return false;
        if (!signature || typeof signature !== 'string' || signature.trim().length === 0) return false;
        if (challenge.expiresAt && Date.now() > challenge.expiresAt * 1000) return false;
        return true;
    }

    /**
     * Queues an offline action item.
     * @public
     * @param {Array} queue Existing queue array
     * @param {string} deviceId Device identifier
     * @param {string} commandName Command display name
     * @param {string} commandStr Command execution string
     * @param {Object} parameters Optional parameters
     * @returns {Array} Updated queue array
     */
    static enqueueOfflineAction(queue = [], deviceId, commandName, commandStr, parameters = {}) {
        if (!Array.isArray(queue)) queue = [];
        if (!commandName || !commandStr) return queue;

        const newItem = {
            queueId: `q-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
            deviceId: deviceId || 'mobile-device',
            commandName: String(commandName).trim(),
            commandStr: String(commandStr).trim(),
            parameters: parameters || {},
            status: 'queued',
            attempts: 0,
            maxRetries: 3,
            createdAt: Date.now()
        };

        return [...queue, newItem];
    }

    /**
     * Deduplicates and synchronizes offline queue batches.
     * @public
     * @param {Array} localQueue Local host queue
     * @param {Array} remoteBatch Mobile uploaded batch
     * @returns {Array} Synchronized queue
     */
    static syncOfflineQueue(localQueue = [], remoteBatch = []) {
        if (!Array.isArray(localQueue)) localQueue = [];
        if (!Array.isArray(remoteBatch)) return localQueue;

        const queueMap = new Map();
        localQueue.forEach(item => {
            if (item && item.queueId) queueMap.set(item.queueId, item);
        });

        remoteBatch.forEach(item => {
            if (item && item.queueId) {
                if (!queueMap.has(item.queueId)) {
                    queueMap.set(item.queueId, {
                        ...item,
                        status: item.status || 'queued',
                        attempts: item.attempts || 0
                    });
                }
            }
        });

        return Array.from(queueMap.values());
    }
}
