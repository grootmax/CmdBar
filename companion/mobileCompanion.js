import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export function getMobileConfigDir() {
    const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    return path.join(configHome, 'cmdbar');
}

export function getMobileConfigPath() {
    return process.env.CMDBAR_MOBILE_CONFIG_PATH || path.join(getMobileConfigDir(), 'mobile_companion.json');
}

export function loadMobileConfig(customPath) {
    const targetPath = customPath || getMobileConfigPath();
    if (fs.existsSync(targetPath)) {
        try {
            const raw = fs.readFileSync(targetPath, 'utf8');
            const data = JSON.parse(raw);
            if (data && typeof data === 'object') {
                return data;
            }
        } catch (e) {}
    }
    return {
        devices: {},
        quick_actions: {},
        notifications: [],
        offline_queue: [],
        biometric_challenges: {},
        widget_config: {
            refresh_interval_sec: 300,
            theme: 'system',
            pinned_actions: []
        }
    };
}

export function saveMobileConfig(data, customPath) {
    const targetPath = customPath || getMobileConfigPath();
    const targetDir = path.dirname(targetPath);
    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }
    const tempPath = `${targetPath}.${Date.now()}.${Math.random().toString(36).substring(2, 8)}.tmp`;
    try {
        fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
        fs.renameSync(tempPath, targetPath);
        return true;
    } catch (e) {
        try {
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        } catch (err) {}
        return false;
    }
}

export class DeviceManager {
    constructor(service) {
        this.service = service;
    }

    registerDevice(deviceId, name, platform, pushToken = null, biometricPublicKey = null) {
        if (!deviceId || typeof deviceId !== 'string' || !deviceId.trim()) {
            throw new Error('Device ID cannot be empty.');
        }
        if (!name || typeof name !== 'string' || !name.trim()) {
            throw new Error('Device name cannot be empty.');
        }
        const platformClean = String(platform || '').trim().toLowerCase();
        if (platformClean !== 'ios' && platformClean !== 'android') {
            throw new Error("Platform must be 'ios' or 'android'.");
        }

        const data = this.service.loadData();
        data.devices = data.devices || {};

        const existing = data.devices[deviceId] || {};
        const deviceToken = existing.device_token || crypto.randomBytes(32).toString('hex');
        const now = Date.now() / 1000;

        const deviceInfo = {
            device_id: deviceId.trim(),
            name: name.trim(),
            platform: platformClean,
            push_token: pushToken || existing.push_token || null,
            device_token: deviceToken,
            biometric_public_key: biometricPublicKey || existing.biometric_public_key || null,
            biometric_enrolled: Boolean(biometricPublicKey || existing.biometric_public_key),
            status: 'active',
            registered_at: existing.registered_at || now,
            last_active_at: now
        };

        data.devices[deviceId] = deviceInfo;
        this.service.saveData(data);
        return deviceInfo;
    }

    unregisterDevice(deviceId) {
        const data = this.service.loadData();
        if (data.devices && data.devices[deviceId]) {
            delete data.devices[deviceId];
            this.service.saveData(data);
            return true;
        }
        return false;
    }

    getDevice(deviceId) {
        const data = this.service.loadData();
        return (data.devices && data.devices[deviceId]) || null;
    }

    listDevices() {
        const data = this.service.loadData();
        return Object.values(data.devices || {});
    }

    updatePushToken(deviceId, pushToken) {
        const data = this.service.loadData();
        if (data.devices && data.devices[deviceId]) {
            data.devices[deviceId].push_token = pushToken;
            data.devices[deviceId].last_active_at = Date.now() / 1000;
            this.service.saveData(data);
            return true;
        }
        return false;
    }

    authenticateDevice(deviceId, deviceToken) {
        const device = this.getDevice(deviceId);
        if (!device || device.status !== 'active') return false;
        if (crypto.timingSafeEqual(Buffer.from(device.device_token || ''), Buffer.from(deviceToken || ''))) {
            const data = this.service.loadData();
            if (data.devices && data.devices[deviceId]) {
                data.devices[deviceId].last_active_at = Date.now() / 1000;
                this.service.saveData(data);
            }
            return true;
        }
        return false;
    }
}

export class PushNotificationEngine {
    constructor(service) {
        this.service = service;
    }

    sendNotification(deviceId, title, body, payload = {}, category = null) {
        const device = this.service.deviceManager.getDevice(deviceId);
        if (!device) {
            throw new Error(`Device '${deviceId}' not found.`);
        }

        const pushToken = device.push_token;
        const platform = device.platform || 'ios';
        const now = Date.now() / 1000;
        const notifId = `notif_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

        let formattedPayload;
        if (platform === 'ios') {
            formattedPayload = {
                aps: {
                    alert: { title, body },
                    sound: 'default',
                    category: category || 'QUICK_ACTION_RESULT'
                },
                data: payload || {}
            };
        } else {
            formattedPayload = {
                notification: { title, body },
                data: payload || {},
                android: {
                    priority: 'high',
                    notification: { channel_id: category || 'cmdbar_channel' }
                }
            };
        }

        const status = pushToken ? 'delivered' : 'queued';
        const record = {
            notification_id: notifId,
            device_id: deviceId,
            platform,
            title,
            body,
            payload: payload || {},
            category,
            formatted_payload: formattedPayload,
            status,
            timestamp: now
        };

        const data = this.service.loadData();
        data.notifications = data.notifications || [];
        data.notifications.push(record);
        if (data.notifications.length > 200) {
            data.notifications = data.notifications.slice(-200);
        }
        this.service.saveData(data);
        return record;
    }

    broadcastNotification(title, body, payload = {}, category = null) {
        const devices = this.service.deviceManager.listDevices();
        const results = [];
        for (const dev of devices) {
            if (dev.status === 'active') {
                results.push(this.sendNotification(dev.device_id, title, body, payload, category));
            }
        }
        return results;
    }

    getNotificationHistory(deviceId = null, limit = 50) {
        const data = this.service.loadData();
        let notifs = data.notifications || [];
        if (deviceId) {
            notifs = notifs.filter(n => n.device_id === deviceId);
        }
        return notifs.slice(-limit);
    }
}

export class QuickActionManager {
    constructor(service) {
        this.service = service;
    }

    registerQuickAction(actionId, title, commandTemplate, icon = 'default', category = 'General', requireBiometric = false, paramsSchema = {}) {
        if (!actionId || typeof actionId !== 'string' || !actionId.trim()) {
            throw new Error('Action ID cannot be empty.');
        }
        if (!title || typeof title !== 'string' || !title.trim()) {
            throw new Error('Title cannot be empty.');
        }
        if (!commandTemplate || typeof commandTemplate !== 'string' || !commandTemplate.trim()) {
            throw new Error('Command template cannot be empty.');
        }

        const data = this.service.loadData();
        data.quick_actions = data.quick_actions || {};

        const actionInfo = {
            action_id: actionId.trim(),
            title: title.trim(),
            command_template: commandTemplate.trim(),
            icon: icon || 'default',
            category: category || 'General',
            require_biometric: Boolean(requireBiometric),
            params_schema: paramsSchema || {},
            created_at: Date.now() / 1000
        };

        data.quick_actions[actionId.trim()] = actionInfo;
        this.service.saveData(data);
        return actionInfo;
    }

    removeQuickAction(actionId) {
        const data = this.service.loadData();
        if (data.quick_actions && data.quick_actions[actionId]) {
            delete data.quick_actions[actionId];
            this.service.saveData(data);
            return true;
        }
        return false;
    }

    getQuickActions() {
        const data = this.service.loadData();
        return Object.values(data.quick_actions || {});
    }

    getQuickAction(actionId) {
        const data = this.service.loadData();
        return (data.quick_actions && data.quick_actions[actionId]) || null;
    }

    async executeQuickAction(deviceId, actionId, params = {}, biometricToken = null) {
        const action = this.getQuickAction(actionId);
        if (!action) {
            return { status: 'error', message: `Quick action '${actionId}' not found.` };
        }

        if (action.require_biometric) {
            if (!biometricToken || !this.service.biometricHandler.verifyBiometric(deviceId, biometricToken)) {
                return {
                    status: 'biometric_required',
                    message: `Quick action '${actionId}' requires valid biometric authentication.`
                };
            }
        }

        const template = action.command_template;
        const schema = action.params_schema || {};

        for (const [paramName, cfg] of Object.entries(schema)) {
            const pattern = cfg.regex;
            const val = params[paramName] || '';
            if (pattern) {
                const reg = new RegExp(pattern);
                if (!reg.test(val)) {
                    return {
                        status: 'error',
                        message: `Parameter '${paramName}' failed regex validation: ${pattern}`
                    };
                }
            }
        }

        let finalCmd = template;
        for (const [k, v] of Object.entries(params)) {
            finalCmd = finalCmd.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
        }

        let exitCode = 0;
        let stdout = '';
        let stderr = '';

        try {
            const res = await execAsync(finalCmd);
            stdout = res.stdout;
            stderr = res.stderr;
        } catch (err) {
            exitCode = err.code || 1;
            stdout = err.stdout || '';
            stderr = err.stderr || err.message;
        }

        const result = {
            status: exitCode === 0 ? 'success' : 'error',
            action_id: actionId,
            device_id: deviceId,
            final_command: finalCmd,
            exit_code: exitCode,
            stdout,
            stderr,
            executed_at: Date.now() / 1000
        };

        try {
            this.service.pushEngine.sendNotification(
                deviceId,
                `Quick Action: ${action.title}`,
                `Executed with status code ${exitCode}`,
                { action_id: actionId, exit_code: exitCode }
            );
        } catch (e) {}

        return result;
    }
}

export class WidgetProvider {
    constructor(service) {
        this.service = service;
    }

    getWidgetData(widgetType = 'all', deviceId = null, size = 'medium') {
        const data = this.service.loadData();
        const actions = Object.values(data.quick_actions || {});
        const actionLimit = size === 'small' ? 2 : size === 'medium' ? 4 : 8;

        const actionsData = actions.slice(0, actionLimit).map(a => ({
            action_id: a.action_id,
            title: a.title,
            icon: a.icon,
            require_biometric: a.require_biometric,
            category: a.category
        }));

        const systemStatus = {
            status: 'online',
            active_devices: Object.values(data.devices || {}).filter(d => d.status === 'active').length,
            pending_offline_queue: (data.offline_queue || []).filter(q => q.status === 'queued').length,
            timestamp: Date.now() / 1000
        };

        const recentNotifications = (data.notifications || []).slice(-5);
        const recentHistory = recentNotifications.map(n => ({
            title: n.title,
            status: n.status,
            timestamp: n.timestamp
        }));

        if (widgetType === 'quick_actions') {
            return { widget_type: 'quick_actions', size, items: actionsData };
        } else if (widgetType === 'system_status') {
            return { widget_type: 'system_status', size, info: systemStatus };
        } else if (widgetType === 'recent_history') {
            return { widget_type: 'recent_history', size, history: recentHistory };
        } else {
            return {
                widget_type: 'all',
                size,
                quick_actions: actionsData,
                system_status: systemStatus,
                recent_history: recentHistory,
                updated_at: Date.now() / 1000
            };
        }
    }

    refreshWidgetData(widgetType = 'all') {
        const widgetPayload = this.getWidgetData(widgetType);
        this.service.pushEngine.broadcastNotification(
            'Widget Update',
            'Mobile widget state refreshed.',
            { widget_data: widgetPayload },
            'WIDGET_REFRESH'
        );
        return widgetPayload;
    }
}

export class BiometricAuthHandler {
    constructor(service) {
        this.service = service;
    }

    enrollBiometric(deviceId, publicKeyOrSecret) {
        if (!publicKeyOrSecret) return false;
        const data = this.service.loadData();
        if (data.devices && data.devices[deviceId]) {
            data.devices[deviceId].biometric_public_key = publicKeyOrSecret;
            data.devices[deviceId].biometric_enrolled = true;
            this.service.saveData(data);
            return true;
        }
        return false;
    }

    generateChallenge(deviceId, timeoutSeconds = 300) {
        const device = this.service.deviceManager.getDevice(deviceId);
        if (!device) throw new Error(`Device '${deviceId}' not found.`);

        const nonce = crypto.randomBytes(16).toString('hex');
        const expiresAt = Date.now() / 1000 + timeoutSeconds;

        const data = this.service.loadData();
        data.biometric_challenges = data.biometric_challenges || {};
        data.biometric_challenges[deviceId] = { nonce, expires_at: expiresAt };
        this.service.saveData(data);

        return { device_id: deviceId, challenge: nonce, expires_at: expiresAt };
    }

    createBiometricToken(deviceId, challengeNonce) {
        const device = this.service.deviceManager.getDevice(deviceId);
        if (!device) throw new Error('Device not found');
        const key = device.biometric_public_key || device.device_token;
        return crypto.createHmac('sha256', key).update(challengeNonce).digest('hex');
    }

    verifyBiometric(deviceId, biometricToken) {
        const data = this.service.loadData();
        const challengeInfo = data.biometric_challenges && data.biometric_challenges[deviceId];

        if (!challengeInfo) {
            const device = this.service.deviceManager.getDevice(deviceId);
            if (!device || !device.biometric_enrolled) return false;
            const key = device.biometric_public_key || device.device_token;
            const expectedFallback = crypto.createHash('sha256').update(`biometric_${key}`).digest('hex');
            return biometricToken === expectedFallback;
        }

        if (Date.now() / 1000 > challengeInfo.expires_at) {
            delete data.biometric_challenges[deviceId];
            this.service.saveData(data);
            return false;
        }

        const nonce = challengeInfo.nonce;
        const device = this.service.deviceManager.getDevice(deviceId);
        if (!device) return false;
        const key = device.biometric_public_key || device.device_token;
        const expected = crypto.createHmac('sha256', key).update(nonce).digest('hex');

        if (biometricToken === expected) {
            delete data.biometric_challenges[deviceId];
            this.service.saveData(data);
            return true;
        }
        return false;
    }
}

export class OfflineQueueManager {
    constructor(service) {
        this.service = service;
    }

    enqueueRequest(deviceId, actionId, params = {}, nonce = null) {
        const now = Date.now() / 1000;
        const queueId = `queue_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

        const requestItem = {
            queue_id: queueId,
            device_id: deviceId,
            action_id: actionId,
            params: params || {},
            nonce: nonce || crypto.randomBytes(8).toString('hex'),
            status: 'queued',
            retry_count: 0,
            created_at: now,
            processed_at: null,
            result: null
        };

        const data = this.service.loadData();
        data.offline_queue = data.offline_queue || [];
        data.offline_queue.push(requestItem);
        this.service.saveData(data);
        return requestItem;
    }

    getQueuedRequests(deviceId = null, status = null) {
        const data = this.service.loadData();
        let queue = data.offline_queue || [];
        if (deviceId) {
            queue = queue.filter(item => item.device_id === deviceId);
        }
        if (status) {
            queue = queue.filter(item => item.status === status);
        }
        return queue;
    }

    async processQueuedRequest(queueId) {
        const data = this.service.loadData();
        const queue = data.offline_queue || [];

        const targetItem = queue.find(item => item.queue_id === queueId);
        if (!targetItem) {
            return { status: 'error', message: `Queued request '${queueId}' not found.` };
        }

        targetItem.status = 'processing';
        targetItem.retry_count = (targetItem.retry_count || 0) + 1;
        this.service.saveData(data);

        const res = await this.service.quickActionManager.executeQuickAction(
            targetItem.device_id,
            targetItem.action_id,
            targetItem.params
        );

        targetItem.status = res.status === 'success' ? 'completed' : 'failed';
        targetItem.processed_at = Date.now() / 1000;
        targetItem.result = res;

        this.service.saveData(data);
        return res;
    }

    async processAllQueuedRequests() {
        const pending = this.getQueuedRequests(null, 'queued');
        const results = [];
        for (const item of pending) {
            const res = await this.processQueuedRequest(item.queue_id);
            results.push(res);
        }
        return results;
    }

    clearCompletedRequests() {
        const data = this.service.loadData();
        const queue = data.offline_queue || [];
        const initLen = queue.length;
        data.offline_queue = queue.filter(item => item.status === 'queued');
        this.service.saveData(data);
        return initLen - data.offline_queue.length;
    }
}

export class MobileCompanionService {
    constructor(customPath) {
        this.customPath = customPath || getMobileConfigPath();
        this.deviceManager = new DeviceManager(this);
        this.pushEngine = new PushNotificationEngine(this);
        this.quickActionManager = new QuickActionManager(this);
        this.widgetProvider = new WidgetProvider(this);
        this.biometricHandler = new BiometricAuthHandler(this);
        this.offlineQueue = new OfflineQueueManager(this);
    }

    loadData() {
        return loadMobileConfig(this.customPath);
    }

    saveData(data) {
        return saveMobileConfig(data, this.customPath);
    }
}
