import { KWinIntegration } from '../extension/kwinIntegration.js';

describe('KWin Integration Unit Tests', () => {
    let kwin;

    beforeEach(() => {
        kwin = new KWinIntegration({ defaultShortcut: 'Meta+Space' });
    });

    test('should register and trigger global shortcuts', async () => {
        const triggered = [];
        const registered = await kwin.registerShortcut('Meta+Space', (sc) => {
            triggered.push(sc);
        });

        expect(registered).toBe(true);
        expect(kwin._activeShortcut).toBe('Meta+Space');

        kwin.triggerShortcut();
        expect(triggered).toEqual(['Meta+Space']);
    });

    test('should get and set active window context', async () => {
        const initial = await kwin.getActiveWindowContext();
        expect(initial).toHaveProperty('windowClass');
        expect(initial).toHaveProperty('windowTitle');

        const updated = kwin.setActiveWindowContext({
            windowClass: 'konsole',
            windowTitle: 'zsh - ~/CmdBar',
            pid: 9999,
            desktop: 3
        });

        expect(updated.windowClass).toBe('konsole');
        expect(updated.desktop).toBe(3);
    });

    test('should calculate popup position correctly', () => {
        const panel = { x: 0, y: 0, width: 1920, height: 36 };
        const popup = { width: 400, height: 500 };

        const pos = kwin.calculatePopupPosition(panel, popup);
        expect(pos.y).toBe(40);
        expect(pos.x).toBeGreaterThan(0);
        expect(pos.x + popup.width).toBeLessThanOrEqual(1920);
    });

    test('should unregister shortcut handlers', () => {
        let count = 0;
        kwin.registerShortcut('Alt+Space', () => count++);
        kwin.unregister();
        kwin.triggerShortcut();
        expect(count).toBe(0);
    });
});
