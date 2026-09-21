import { SystemTrayManager } from '../extension/systemTray.js';

describe('System Tray Integration Unit Tests', () => {
    let tray;

    beforeEach(() => {
        tray = new SystemTrayManager();
    });

    test('should update tray status and badge count', () => {
        const res = tray.updateStatus('NeedsAttention', 5);
        expect(res.status).toBe('NeedsAttention');
        expect(res.badgeCount).toBe(5);

        const res2 = tray.updateStatus('Active', -1);
        expect(res2.badgeCount).toBe(0);
    });

    test('should set and update tooltip text', () => {
        const text = tray.setTooltip('CmdBar Active Palette');
        expect(text).toBe('CmdBar Active Palette');
        expect(tray.tooltip).toBe('CmdBar Active Palette');
    });

    test('should handle menu item clicks', () => {
        let clicked = false;
        tray.onMenuItem('exec', () => { clicked = true; });

        const ok = tray.triggerMenuItem('exec');
        expect(ok).toBe(true);
        expect(clicked).toBe(true);
    });

    test('should send desktop notification', async () => {
        const id = await tray.sendNotification('CmdBar Alert', 'Command executed successfully');
        expect(id).toBeGreaterThan(0);
        expect(tray._notifications.length).toBe(1);
    });

    test('should toggle visibility', () => {
        expect(tray.setVisible(false)).toBe(false);
        expect(tray.isVisible).toBe(false);
        expect(tray.setVisible(true)).toBe(true);
    });
});
