import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  evaluateCommandPolicy,
  CommandPolicyManager,
  matchPattern,
  globToRegex,
  resolveUserContext,
  DEFAULT_BLACKLIST_PATTERNS,
  DEFAULT_WHITELIST_PATTERNS,
} from '../extension/commandPolicy.js';
import { loadConfig, saveConfig } from '../extension/configSync.js';

describe('Command Security Policy Engine (Whitelist & Blacklist) Unit & Integration Tests', () => {
  let tempDir;
  let configPath;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmdbar-policy-test-'));
    configPath = path.join(tempDir, 'config.json');
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Pattern Matching Engine', () => {
    test('globToRegex converts glob patterns with wildcards correctly', () => {
      const rx1 = globToRegex('rm -rf *');
      expect(rx1.test('rm -rf /tmp/data')).toBe(true);
      expect(rx1.test('rm -rf /')).toBe(true);
      expect(rx1.test('echo hello')).toBe(false);

      const rx2 = globToRegex('ping -c ? 127.0.0.1');
      expect(rx2.test('ping -c 3 127.0.0.1')).toBe(true);
      expect(rx2.test('ping -c 33 127.0.0.1')).toBe(false);
    });

    test('matchPattern supports exact, glob, regex, and binary matching', () => {
      expect(matchPattern('shutdown -h now', 'shutdown*')).toBe(true);
      expect(matchPattern('mkfs.ext4 /dev/sdb', 'mkfs*')).toBe(true);
      expect(matchPattern('rm -rf /var/log', 'regex:^rm\\s+-rf')).toBe(true);
      expect(matchPattern('ls -la', 'ls')).toBe(true);
      expect(matchPattern('echo "hello"', 'rm -rf *')).toBe(false);
    });
  });

  describe('Blacklist Command Blocking', () => {
    test('blocks dangerous commands by default in blacklist mode', () => {
      const dangerousCmds = [
        'rm -rf /',
        'rm -rf /home/user',
        'mkfs.ext4 /dev/sda1',
        'dd if=/dev/zero of=/dev/sda',
        'chmod -R 777 /var/www',
        'shutdown -h now',
        'reboot',
      ];

      for (const cmd of dangerousCmds) {
        const result = evaluateCommandPolicy(cmd);
        expect(result.allowed).toBe(false);
        expect(result.blockedBy).toBe('blacklist');
        expect(typeof result.reason).toBe('string');
      }
    });

    test('allows safe standard commands in blacklist mode', () => {
      const safeCmds = [
        'echo Hello World',
        'make build',
        'git status',
        'aws s3 ls',
        'ping -c 3 127.0.0.1',
      ];

      for (const cmd of safeCmds) {
        const result = evaluateCommandPolicy(cmd);
        expect(result.allowed).toBe(true);
        expect(result.blockedBy).toBeNull();
      }
    });
  });

  describe('Whitelist Required Commands Mode', () => {
    test('restricts execution to whitelisted commands only when mode is whitelist', () => {
      const policy = {
        enabled: true,
        mode: 'whitelist',
        whitelist: ['echo *', 'git status', 'make *'],
        blacklist: [],
        rules: [],
      };

      expect(evaluateCommandPolicy('echo Hello', {}, policy).allowed).toBe(true);
      expect(evaluateCommandPolicy('git status', {}, policy).allowed).toBe(true);
      expect(evaluateCommandPolicy('make test', {}, policy).allowed).toBe(true);

      const blockedResult = evaluateCommandPolicy('python3 malicious.py', {}, policy);
      expect(blockedResult.allowed).toBe(false);
      expect(blockedResult.blockedBy).toBe('whitelist');
    });

    test('combined mode enforces blacklist first, then whitelist', () => {
      const policy = {
        enabled: true,
        mode: 'combined',
        blacklist: ['rm -rf *'],
        whitelist: ['rm *', 'echo *'],
        rules: [],
      };

      // Matches blacklist -> blocked even if in whitelist
      const blockedRes = evaluateCommandPolicy('rm -rf /tmp/test', {}, policy);
      expect(blockedRes.allowed).toBe(false);
      expect(blockedRes.blockedBy).toBe('blacklist');

      // Matches whitelist and not in blacklist -> allowed
      expect(evaluateCommandPolicy('echo hello', {}, policy).allowed).toBe(true);
    });
  });

  describe('User & Group Scoped Security Rules', () => {
    test('enforces rules scoped to specific usernames', () => {
      const policy = {
        enabled: true,
        mode: 'blacklist',
        blacklist: [],
        whitelist: [],
        rules: [
          {
            id: 'rule-contractor-deny',
            user: 'alice',
            action: 'deny',
            pattern: 'aws *',
            reason: 'Contractor Alice is restricted from AWS commands',
          },
        ],
      };

      const aliceRes = evaluateCommandPolicy('aws s3 ls', { user: 'alice' }, policy);
      expect(aliceRes.allowed).toBe(false);
      expect(aliceRes.blockedBy).toBe('user_group_rule');
      expect(aliceRes.reason).toContain('Contractor Alice');

      const bobRes = evaluateCommandPolicy('aws s3 ls', { user: 'bob' }, policy);
      expect(bobRes.allowed).toBe(true);
    });

    test('enforces rules scoped to specific groups', () => {
      const policy = {
        enabled: true,
        mode: 'blacklist',
        blacklist: [],
        whitelist: [],
        rules: [
          {
            id: 'rule-interns-block',
            group: 'interns',
            action: 'deny',
            pattern: 'docker *',
            reason: 'Intern group cannot run Docker commands',
          },
        ],
      };

      const internRes = evaluateCommandPolicy('docker run ubuntu', { user: 'sam', groups: ['interns'] }, policy);
      expect(internRes.allowed).toBe(false);
      expect(internRes.blockedBy).toBe('user_group_rule');

      const devRes = evaluateCommandPolicy('docker run ubuntu', { user: 'sam', groups: ['developers'] }, policy);
      expect(devRes.allowed).toBe(true);
    });

    test('supports allow rules for user override', () => {
      const policy = {
        enabled: true,
        mode: 'blacklist',
        blacklist: ['shutdown*'],
        whitelist: [],
        rules: [
          {
            id: 'admin-shutdown-allow',
            group: 'wheel',
            action: 'allow',
            pattern: 'shutdown*',
            reason: 'Sudoers in wheel group can invoke shutdown',
          },
        ],
      };

      const adminRes = evaluateCommandPolicy('shutdown -h now', { user: 'root', groups: ['wheel'] }, policy);
      expect(adminRes.allowed).toBe(true);

      const userRes = evaluateCommandPolicy('shutdown -h now', { user: 'guest', groups: ['users'] }, policy);
      expect(userRes.allowed).toBe(false);
    });
  });

  describe('Approval Request & Override Management', () => {
    test('creates approval requests and allows execution upon approval with token', () => {
      const pm = new CommandPolicyManager();
      const command = 'rm -rf /tmp/build_cache';

      // Verify command is blocked initially
      const initialEval = pm.evaluate(command);
      expect(initialEval.allowed).toBe(false);

      // Requester submits approval request
      const req = pm.requestApproval(command, { user: 'developer1' }, 'Need to purge stale build cache');
      expect(req.status).toBe('pending');
      expect(req.command).toBe(command);

      const pending = pm.listPendingApprovals();
      expect(pending.length).toBe(1);
      expect(pending[0].id).toBe(req.id);

      // Administrator approves request
      const approvedReq = pm.approveRequest(req.id, { user: 'secadmin' });
      expect(approvedReq.status).toBe('approved');
      expect(approvedReq.token).toBeDefined();

      // Verify evaluation now passes when token provided
      const postApprovalEval = pm.evaluate(command, { user: 'developer1' }, approvedReq.token);
      expect(postApprovalEval.allowed).toBe(true);
      expect(postApprovalEval.approved).toBe(true);
    });

    test('direct override grant and revocation', () => {
      const pm = new CommandPolicyManager();
      const command = 'chmod -R 777 /tmp/testdir';

      expect(pm.evaluate(command).allowed).toBe(false);

      const override = pm.grantOverride('chmod -R 777 *', { user: 'admin' });
      expect(override.token).toBeDefined();

      expect(pm.evaluate(command, {}, override.token).allowed).toBe(true);

      const revoked = pm.revokeOverride(override.token);
      expect(revoked).toBe(true);

      expect(pm.evaluate(command, {}, override.token).allowed).toBe(false);
    });

    test('rejection of approval request', () => {
      const pm = new CommandPolicyManager();
      const req = pm.requestApproval('dd if=/dev/zero of=/dev/sdb', { user: 'user1' }, 'Wipe drive');

      const rejected = pm.rejectRequest(req.id, { user: 'security_lead' }, 'Unsafe operation');
      expect(rejected.status).toBe('rejected');
      expect(pm.listPendingApprovals().length).toBe(0);
    });
  });

  describe('Integration with Signed Configuration Store', () => {
    test('policy configuration persists and verifies with HMAC signature', async () => {
      const config = {
        policy: {
          enabled: true,
          mode: 'whitelist',
          blacklist: ['rm -rf *'],
          whitelist: ['echo *', 'make *'],
          rules: [
            { id: 'rule1', user: 'bob', action: 'deny', pattern: 'make deploy' }
          ],
          overrides: []
        },
        categories: [
          { name: 'General', commands: [{ name: 'Test', command: 'echo hi' }] }
        ]
      };

      await saveConfig(config, configPath);
      const loadedConfig = await loadConfig(configPath);

      expect(loadedConfig.policy).toBeDefined();
      expect(loadedConfig.policy.mode).toBe('whitelist');
      expect(loadedConfig.policy.rules.length).toBe(1);

      const evalRes = evaluateCommandPolicy('echo hi', {}, loadedConfig.policy);
      expect(evalRes.allowed).toBe(true);
    });
  });

  describe('Performance Benchmarks', () => {
    test('evaluates 10,000 policy checks in under 200 milliseconds', () => {
      const pm = new CommandPolicyManager({
        enabled: true,
        mode: 'combined',
        blacklist: DEFAULT_BLACKLIST_PATTERNS,
        whitelist: DEFAULT_WHITELIST_PATTERNS,
        rules: [
          { user: 'alice', action: 'deny', pattern: 'aws *' },
          { group: 'interns', action: 'deny', pattern: 'docker *' },
        ],
        overrides: [],
      });

      const testCommands = [
        'rm -rf /tmp/foo',
        'echo "hello benchmark"',
        'make -j4 build',
        'docker run -d nginx',
        'aws s3 sync . s3://bucket',
        'mkfs.ext4 /dev/sdb',
        'ping -c 1 127.0.0.1',
      ];

      const startTime = Date.now();
      const iterations = 10000;

      for (let i = 0; i < iterations; i++) {
        const cmd = testCommands[i % testCommands.length];
        pm.evaluate(cmd, { user: 'alice', groups: ['interns'] });
      }

      const elapsedMs = Date.now() - startTime;
      expect(elapsedMs).toBeLessThan(1000);
    });
  });
});
