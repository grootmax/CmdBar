import {
  normalizeProvider,
  resolveSecrets,
  redactSecrets,
  triggerPipeline,
  getPipelineStatus,
  rollbackPipeline,
  isCICDCommand,
  parseCICDCommand,
  CICDPipelineManager,
} from '../extension/cicdPipeline.js';

describe('CI/CD Integration Pipeline Unit & Integration Tests', () => {

  describe('Provider Normalization & Secret Resolution', () => {
    test('normalizeProvider should normalize provider strings correctly', () => {
      expect(normalizeProvider('GitHub-Actions')).toBe('github');
      expect(normalizeProvider('GitLab-CI')).toBe('gitlab');
      expect(normalizeProvider('Jenkins-CI')).toBe('jenkins');
      expect(normalizeProvider('custom')).toBe('custom');
      expect(normalizeProvider(null)).toBe('unknown');
    });

    test('resolveSecrets should resolve GitHub secrets from config and env', () => {
      const config = { cicd: { github: { token: 'cfg-gh-token', baseUrl: 'https://gh.custom.com' } } };
      const env = { GITHUB_TOKEN: 'env-gh-token' };

      const resolvedFromCfg = resolveSecrets('github', config, env);
      expect(resolvedFromCfg.token).toBe('cfg-gh-token');
      expect(resolvedFromCfg.baseUrl).toBe('https://gh.custom.com');

      const resolvedFromEnv = resolveSecrets('github', {}, env);
      expect(resolvedFromEnv.token).toBe('env-gh-token');
      expect(resolvedFromEnv.baseUrl).toBe('https://api.github.com');
    });

    test('resolveSecrets should resolve GitLab secrets from config and env', () => {
      const config = { secrets: { gitlab_token: 'cfg-gl-token' } };
      const env = { GITLAB_TOKEN: 'env-gl-token', GITLAB_API_URL: 'https://gitlab.example.com' };

      const resolvedFromCfg = resolveSecrets('gitlab', config, env);
      expect(resolvedFromCfg.token).toBe('cfg-gl-token');

      const resolvedFromEnv = resolveSecrets('gitlab', {}, env);
      expect(resolvedFromEnv.token).toBe('env-gl-token');
      expect(resolvedFromEnv.baseUrl).toBe('https://gitlab.example.com');
    });

    test('resolveSecrets should resolve Jenkins credentials from config and env', () => {
      const config = { cicd: { jenkins: { user: 'admin', token: 'cfg-jk-token', baseUrl: 'http://jenkins.local:8080' } } };
      const env = { JENKINS_USER: 'env-user', JENKINS_TOKEN: 'env-jk-token' };

      const resolvedFromCfg = resolveSecrets('jenkins', config, env);
      expect(resolvedFromCfg.user).toBe('admin');
      expect(resolvedFromCfg.token).toBe('cfg-jk-token');
      expect(resolvedFromCfg.baseUrl).toBe('http://jenkins.local:8080');

      const resolvedFromEnv = resolveSecrets('jenkins', {}, env);
      expect(resolvedFromEnv.user).toBe('env-user');
      expect(resolvedFromEnv.token).toBe('env-jk-token');
      expect(resolvedFromEnv.baseUrl).toBe('http://localhost:8080');
    });
  });

  describe('Secret Redaction & Sanitization', () => {
    test('redactSecrets should redact token values and authorization headers from strings', () => {
      const rawText = 'Authorization: Bearer secret-token-123 and PRIVATE-TOKEN: gl-secret-token and token=mysecret';
      const redacted = redactSecrets(rawText, ['secret-token-123', 'gl-secret-token']);

      expect(redacted).not.toContain('secret-token-123');
      expect(redacted).not.toContain('gl-secret-token');
      expect(redacted).toContain('[REDACTED]');
    });

    test('redactSecrets should recursively redact sensitive keys in objects', () => {
      const data = {
        name: 'GitHub Action',
        token: 'ghp_secret123456789',
        nested: {
          api_key: 'key-999',
          publicInfo: 'visible',
        },
      };

      const redacted = redactSecrets(data);
      expect(redacted.token).toBe('[REDACTED]');
      expect(redacted.nested.api_key).toBe('[REDACTED]');
      expect(redacted.nested.publicInfo).toBe('visible');
    });
  });

  describe('GitHub Actions Pipeline Operations', () => {
    test('triggerPipeline should dispatch GitHub Actions workflow successfully', async () => {
      const mockTransport = async (url, opts) => {
        expect(url).toContain('/repos/myorg/myrepo/actions/workflows/deploy.yml/dispatches');
        expect(opts.method).toBe('POST');
        expect(opts.headers.Authorization).toBe('Bearer gh-test-token');
        return {
          status: 204,
          statusText: 'No Content',
          text: async () => '',
        };
      };

      const config = { cicd: { github: { token: 'gh-test-token' } } };
      const res = await triggerPipeline('github', { repo: 'myorg/myrepo', workflowId: 'deploy.yml', ref: 'main' }, config, mockTransport);

      expect(res.provider).toBe('github');
      expect(res.status).toBe('queued');
      expect(res.ref).toBe('main');
      expect(res.target).toBe('myorg/myrepo');
    });

    test('getPipelineStatus should return standardized GitHub run status', async () => {
      const mockTransport = async (url) => {
        expect(url).toContain('/repos/myorg/myrepo/actions/runs/1001');
        return {
          status: 200,
          json: async () => ({
            id: 1001,
            status: 'completed',
            conclusion: 'success',
            head_branch: 'main',
            head_sha: 'abc1234',
            html_url: 'https://github.com/myorg/myrepo/actions/runs/1001',
            created_at: '2026-08-23T10:00:00Z',
            updated_at: '2026-08-23T10:02:00Z',
            jobs: [{ name: 'build', status: 'completed', conclusion: 'success' }],
          }),
        };
      };

      const res = await getPipelineStatus('github', { repo: 'myorg/myrepo', runId: '1001' }, {}, mockTransport);

      expect(res.id).toBe('1001');
      expect(res.status).toBe('success');
      expect(res.commit).toBe('abc1234');
      expect(res.duration).toBe(120);
      expect(res.steps[0].name).toBe('build');
    });

    test('rollbackPipeline should initiate GitHub Actions re-run rollback', async () => {
      const mockTransport = async (url, opts) => {
        expect(url).toContain('/repos/myorg/myrepo/actions/runs/1001/rerun');
        expect(opts.method).toBe('POST');
        return {
          status: 201,
          json: async () => ({ id: 1001 }),
        };
      };

      const res = await rollbackPipeline('github', { repo: 'myorg/myrepo', targetRunId: '1001' }, {}, mockTransport);

      expect(res.success).toBe(true);
      expect(res.rollbackRunId).toBe('1001');
      expect(res.provider).toBe('github');
    });
  });

  describe('GitLab CI Pipeline Operations', () => {
    test('triggerPipeline should trigger GitLab CI pipeline successfully', async () => {
      const mockTransport = async (url, opts) => {
        expect(url).toContain('/api/v4/projects/123/pipeline');
        expect(opts.headers['PRIVATE-TOKEN']).toBe('gl-test-token');
        return {
          status: 201,
          json: async () => ({
            id: 501,
            status: 'pending',
            ref: 'main',
            web_url: 'https://gitlab.com/proj/pipelines/501',
            created_at: new Date().toISOString(),
          }),
        };
      };

      const config = { cicd: { gitlab: { token: 'gl-test-token' } } };
      const res = await triggerPipeline('gitlab', { projectId: '123', ref: 'main' }, config, mockTransport);

      expect(res.provider).toBe('gitlab');
      expect(res.id).toBe('501');
      expect(res.status).toBe('queued');
    });

    test('getPipelineStatus should return standardized GitLab status', async () => {
      const mockTransport = async (url) => {
        expect(url).toContain('/api/v4/projects/123/pipelines/501');
        return {
          status: 200,
          json: async () => ({
            id: 501,
            status: 'running',
            ref: 'main',
            sha: 'def5678',
            web_url: 'https://gitlab.com/proj/pipelines/501',
            duration: 45,
          }),
        };
      };

      const res = await getPipelineStatus('gitlab', { projectId: '123', pipelineId: '501' }, {}, mockTransport);

      expect(res.id).toBe('501');
      expect(res.status).toBe('running');
      expect(res.duration).toBe(45);
    });

    test('rollbackPipeline should retry prior GitLab pipeline', async () => {
      const mockTransport = async (url, opts) => {
        expect(url).toContain('/api/v4/projects/123/pipelines/500/retry');
        return {
          status: 200,
          json: async () => ({ id: 502, status: 'pending' }),
        };
      };

      const res = await rollbackPipeline('gitlab', { projectId: '123', pipelineId: '500' }, {}, mockTransport);

      expect(res.success).toBe(true);
      expect(res.rollbackRunId).toBe('502');
      expect(res.provider).toBe('gitlab');
    });
  });

  describe('Jenkins Job Operations', () => {
    test('triggerPipeline should trigger Jenkins build with parameters', async () => {
      const mockTransport = async (url, opts) => {
        expect(url).toContain('/job/deploy-app/buildWithParameters?ENV=staging');
        expect(opts.headers.Authorization).toContain('Basic ');
        return {
          status: 201,
          text: async () => '',
        };
      };

      const config = { cicd: { jenkins: { user: 'jenkins-user', token: 'jk-token-123' } } };
      const res = await triggerPipeline('jenkins', { jobName: 'deploy-app', parameters: { ENV: 'staging' } }, config, mockTransport);

      expect(res.provider).toBe('jenkins');
      expect(res.status).toBe('queued');
      expect(res.target).toBe('deploy-app');
    });

    test('getPipelineStatus should return standardized Jenkins status', async () => {
      const mockTransport = async (url) => {
        expect(url).toContain('/job/deploy-app/42/api/json');
        return {
          status: 200,
          json: async () => ({
            number: 42,
            building: false,
            result: 'SUCCESS',
            url: 'http://localhost:8080/job/deploy-app/42',
            duration: 15000,
            actions: [{ causes: [{ shortDescription: 'Triggered by user' }] }],
          }),
        };
      };

      const res = await getPipelineStatus('jenkins', { jobName: 'deploy-app', buildNumber: '42' }, {}, mockTransport);

      expect(res.id).toBe('42');
      expect(res.status).toBe('success');
      expect(res.duration).toBe(15);
      expect(res.steps[0].status).toBe('Triggered by user');
    });

    test('rollbackPipeline should trigger Jenkins rollback parameter build', async () => {
      const mockTransport = async (url) => {
        expect(url).toContain('/job/deploy-app/buildWithParameters?ACTION=rollback&ROLLBACK_TARGET=41');
        return {
          status: 201,
          text: async () => '',
        };
      };

      const res = await rollbackPipeline('jenkins', { jobName: 'deploy-app', targetBuild: '41' }, {}, mockTransport);

      expect(res.success).toBe(true);
      expect(res.provider).toBe('jenkins');
    });
  });

  describe('Command Parsing & CICDPipelineManager Integration', () => {
    test('isCICDCommand should correctly identify slash commands', () => {
      expect(isCICDCommand('/cicd trigger github owner/repo')).toBe(true);
      expect(isCICDCommand(' /CICD status gitlab 123')).toBe(true);
      expect(isCICDCommand('make build')).toBe(false);
      expect(isCICDCommand(null)).toBe(false);
    });

    test('parseCICDCommand should parse trigger, status, and rollback commands', () => {
      const triggerCmd = parseCICDCommand('/cicd trigger github owner/repo main');
      expect(triggerCmd.action).toBe('trigger');
      expect(triggerCmd.provider).toBe('github');
      expect(triggerCmd.options.repo).toBe('owner/repo');
      expect(triggerCmd.options.ref).toBe('main');

      const statusCmd = parseCICDCommand('/cicd status gitlab 456 1001');
      expect(statusCmd.action).toBe('status');
      expect(statusCmd.provider).toBe('gitlab');
      expect(statusCmd.options.projectId).toBe('456');
      expect(statusCmd.options.pipelineId).toBe('1001');

      const rollbackCmd = parseCICDCommand('/cicd rollback jenkins my-job 12');
      expect(rollbackCmd.action).toBe('rollback');
      expect(rollbackCmd.provider).toBe('jenkins');
      expect(rollbackCmd.options.jobName).toBe('my-job');
      expect(rollbackCmd.options.targetRunId).toBe('12');
    });

    test('CICDPipelineManager should execute parsed commands end-to-end', async () => {
      const mockTransport = async (url) => {
        if (url.includes('/repos/owner/repo/actions/runs/99')) {
          return {
            status: 200,
            json: async () => ({
              id: 99,
              status: 'completed',
              conclusion: 'success',
              head_branch: 'main',
              html_url: 'https://github.com/owner/repo/actions/runs/99',
            }),
          };
        }
        return { status: 404, text: async () => 'Not found' };
      };

      const manager = new CICDPipelineManager({}, mockTransport);
      const res = await manager.executeCommand('/cicd status github owner/repo 99');

      expect(res.id).toBe('99');
      expect(res.status).toBe('success');
      expect(res.provider).toBe('github');
    });
  });

  describe('Integration & Performance Benchmarks', () => {
    test('End-to-End Workflow: Trigger -> Status -> Rollback with Secret Sanitization', async () => {
      let stepCount = 0;
      const mockTransport = async (url) => {
        stepCount++;
        if (url.includes('/pipelines/888/retry')) {
          return {
            status: 200,
            json: async () => ({ id: 889, status: 'pending' }),
          };
        }
        if (url.includes('/pipelines/888')) {
          return {
            status: 200,
            json: async () => ({ id: 888, status: 'success', ref: 'main', duration: 30 }),
          };
        }
        if (url.endsWith('/pipeline')) {
          return {
            status: 201,
            json: async () => ({ id: 888, status: 'created', ref: 'main', web_url: 'https://gitlab.com/proj/pipelines/888' }),
          };
        }
        return { status: 200, json: async () => ({}) };
      };

      const config = { cicd: { gitlab: { token: 'glpat-super-secret-12345' } } };
      const manager = new CICDPipelineManager(config, mockTransport);

      const triggerRes = await manager.trigger('gitlab', { projectId: '123' });
      expect(triggerRes.id).toBe('888');

      const statusRes = await manager.getStatus('gitlab', { projectId: '123', pipelineId: triggerRes.id });
      expect(statusRes.status).toBe('success');

      const rollbackRes = await manager.rollback('gitlab', { projectId: '123', pipelineId: triggerRes.id });
      expect(rollbackRes.success).toBe(true);
      expect(rollbackRes.rollbackRunId).toBe('889');

      // Verify no secrets leaked in response objects
      const sanitizedObj = manager.redactSecrets({ triggerRes, statusRes, rollbackRes });
      const strified = JSON.stringify(sanitizedObj);
      expect(strified).not.toContain('glpat-super-secret-12345');
    });

    test('Performance Benchmark: Local processing and parsing should complete in <50ms', () => {
      const start = performance.now();

      for (let i = 0; i < 200; i++) {
        parseCICDCommand('/cicd trigger github owner/repo branch=main inputs={"env":"prod"}');
        normalizeProvider('GitHub-Actions-CI');
        resolveSecrets('github', { cicd: { github: { token: 'token-123' } } });
        redactSecrets('Bearer token-123 token=secretpassword', ['token-123']);
      }

      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(50);
    });
  });
});
