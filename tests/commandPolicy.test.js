import {
  matchPattern,
  isUserInContext,
  createApprovalToken,
  validateApprovalToken,
  grantApprovalOverride,
  evaluateCommandPolicy
} from '../extension/commandProcessor.js';

describe('Command Whitelist & Blacklist Policy Engine Unit Tests', () => {
  describe('Pattern Matching (matchPattern)', () => {
    test('matches exact patterns', () => {
      expect(matchPattern('make build', 'make build', 'exact')).toBe(true);
      expect(matchPattern('make build', 'make clean', 'exact')).toBe(false);
    });

    test('matches substring patterns', () => {
      expect(matchPattern('sudo rm -rf /tmp/foo', 'rm -rf', 'substring')).toBe(true);
      expect(matchPattern('echo Hello World', 'rm -rf', 'substring')).toBe(false);
    });

    test('matches glob wildcard patterns', () => {
      expect(matchPattern('rm -rf /var/log/app.log', 'rm -rf *', 'glob')).toBe(true);
      expect(matchPattern('sudo apt-get update', 'sudo *', 'glob')).toBe(true);
      expect(matchPattern('git status', 'sudo *', 'glob')).toBe(false);
    });

    test('matches regular expression patterns', () => {
      expect(matchPattern('curl -X POST https://api.internal/deploy', '^curl.*deploy$', 'regex')).toBe(true);
      expect(matchPattern('curl https://example.com', '^curl.*deploy$', 'regex')).toBe(false);
    });

    test('matches binary executable patterns', () => {
      expect(matchPattern('/usr/bin/python3 script.py', 'python3', 'binary')).toBe(true);
      expect(matchPattern('docker run -d nginx', 'docker', 'binary')).toBe(true);
      expect(matchPattern('git push origin main', 'docker', 'binary')).toBe(false);
    });
  });

  describe('User & Group Filtering (isUserInContext)', () => {
    test('allows any user when user/group arrays are empty or wildcard', () => {
      const ctx = { username: 'alice', groups: ['developers'] };
      expect(isUserInContext(ctx, null, null)).toBe(true);
      expect(isUserInContext(ctx, ['*'], ['*'])).toBe(true);
    });

    test('filters rules by specific user name', () => {
      const ctxAlice = { username: 'alice', groups: ['dev'] };
      const ctxBob = { username: 'bob', groups: ['dev'] };

      expect(isUserInContext(ctxAlice, ['alice', 'charlie'], null)).toBe(true);
      expect(isUserInContext(ctxBob, ['alice', 'charlie'], null)).toBe(false);
    });

    test('filters rules by user group membership', () => {
      const ctxDev = { username: 'alice', groups: ['developers', 'staff'] };
      const ctxAdmin = { username: 'bob', groups: ['admins'] };

      expect(isUserInContext(ctxDev, null, ['developers'])).toBe(true);
      expect(isUserInContext(ctxAdmin, null, ['developers'])).toBe(false);
    });
  });

  describe('Approval Tokens & Override Management', () => {
    test('creates and validates signed approval token', () => {
      const command = 'rm -rf /tmp/cache';
      const token = createApprovalToken(command, 'sec-admin', 3600000);
      expect(typeof token).toBe('string');

      const validation = validateApprovalToken(token, command);
      expect(validation.valid).toBe(true);
      expect(validation.tokenData.approver).toBe('sec-admin');
      expect(validation.tokenData.command).toBe(command);
    });

    test('rejects expired or mismatched approval tokens', () => {
      const token = createApprovalToken('rm -rf /tmp/cache', 'admin', -1000);
      const valExpired = validateApprovalToken(token, 'rm -rf /tmp/cache');
      expect(valExpired.valid).toBe(false);
      expect(valExpired.error).toContain('expired');

      const validToken = createApprovalToken('rm -rf /tmp/cache', 'admin', 3600000);
      const valMismatch = validateApprovalToken(validToken, 'sudo reboot');
      expect(valMismatch.valid).toBe(false);
      expect(valMismatch.error).toContain('mismatch');
    });

    test('grants approval override entry in overrides object', () => {
      const overrides = {};
      const entry = grantApprovalOverride(overrides, 'sudo systemctl restart nginx', 'admin', 3600000);
      expect(entry).toBeDefined();
      expect(entry.approved_by).toBe('admin');
      expect(overrides['sudo systemctl restart nginx']).toBeDefined();
    });
  });

  describe('Policy Evaluation Engine (evaluateCommandPolicy)', () => {
    test('blocks dangerous commands matching blacklist rules', () => {
      const policy = {
        enabled: true,
        blacklist: [
          'rm -rf *',
          { pattern: '^sudo.*', type: 'regex', reason: 'Sudo commands require elevated approval.' }
        ]
      };

      const eval1 = evaluateCommandPolicy('rm -rf /var/data', null, policy);
      expect(eval1.allowed).toBe(false);
      expect(eval1.action).toBe('block');
      expect(eval1.requiresApproval).toBe(true);

      const eval2 = evaluateCommandPolicy('sudo reboot', null, policy);
      expect(eval2.allowed).toBe(false);
      expect(eval2.reason).toContain('Sudo commands require elevated approval');
    });

    test('enforces whitelist when whitelist rules are configured', () => {
      const policy = {
        enabled: true,
        whitelist: [
          'git status',
          'make build',
          { pattern: 'ping *', type: 'glob' }
        ]
      };

      const evalAllowed = evaluateCommandPolicy('git status', null, policy);
      expect(evalAllowed.allowed).toBe(true);

      const evalBlocked = evaluateCommandPolicy('curl http://malicious.site', null, policy);
      expect(evalBlocked.allowed).toBe(false);
      expect(evalBlocked.reason).toContain('not in the approved whitelist');
    });

    test('allows active override to bypass blacklist/whitelist blocks', () => {
      const policy = {
        enabled: true,
        blacklist: ['rm -rf *']
      };

      const overrides = {};
      grantApprovalOverride(overrides, 'rm -rf /tmp/scratch', 'security-team', 3600000);

      const evalRes = evaluateCommandPolicy('rm -rf /tmp/scratch', null, policy, overrides);
      expect(evalRes.allowed).toBe(true);
      expect(evalRes.overrideActive).toBe(true);
      expect(evalRes.reason).toContain('approved policy override');
    });

    test('applies user and group specific policy rules', () => {
      const policy = {
        enabled: true,
        blacklist: [
          { pattern: 'deploy *', type: 'glob', groups: ['interns'], reason: 'Interns cannot run deploy commands directly.' }
        ]
      };

      const internCtx = { username: 'bob', groups: ['interns'] };
      const seniorCtx = { username: 'alice', groups: ['senior-devs'] };

      const evalIntern = evaluateCommandPolicy('deploy staging', internCtx, policy);
      expect(evalIntern.allowed).toBe(false);
      expect(evalIntern.reason).toContain('Interns cannot run deploy');

      const evalSenior = evaluateCommandPolicy('deploy staging', seniorCtx, policy);
      expect(evalSenior.allowed).toBe(true);
    });
  });
});
