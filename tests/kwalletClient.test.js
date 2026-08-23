import { KWalletClient } from '../extension/kwalletClient.js';

describe('KWallet Client Unit Tests', () => {
    let kwallet;

    beforeEach(() => {
        kwallet = new KWalletClient({ useFallback: true });
    });

    test('should open and close wallet session', async () => {
        const opened = await kwallet.openWallet();
        expect(opened).toBe(true);
        expect(kwallet._isOpen).toBe(true);

        const closed = await kwallet.closeWallet();
        expect(closed).toBe(true);
        expect(kwallet._isOpen).toBe(false);
    });

    test('should write and read secrets', async () => {
        await kwallet.openWallet();
        const written = await kwallet.writeSecret('OPENAI_API_KEY', 'sk-test-key-12345');
        expect(written).toBe(true);

        const exists = await kwallet.hasSecret('OPENAI_API_KEY');
        expect(exists).toBe(true);

        const secret = await kwallet.readSecret('OPENAI_API_KEY');
        expect(secret).toBe('sk-test-key-12345');
    });

    test('should delete secrets', async () => {
        await kwallet.openWallet();
        await kwallet.writeSecret('TEMP_TOKEN', 'token-abc');

        expect(await kwallet.hasSecret('TEMP_TOKEN')).toBe(true);
        const deleted = await kwallet.deleteSecret('TEMP_TOKEN');
        expect(deleted).toBe(true);
        expect(await kwallet.hasSecret('TEMP_TOKEN')).toBe(false);
        expect(await kwallet.readSecret('TEMP_TOKEN')).toBeNull();
    });

    test('should reject empty or invalid key names', async () => {
        await kwallet.openWallet();
        expect(await kwallet.writeSecret('', 'val')).toBe(false);
        expect(await kwallet.writeSecret('   ', 'val')).toBe(false);
        expect(await kwallet.readSecret('')).toBeNull();
    });
});
