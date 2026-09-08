# CI/CD Integration Pipeline Developer Specifications

This document outlines the architecture, internal API contracts, and provider normalisation strategies for the CmdBar CI/CD Integration Pipeline module.

## Architecture & Module Structure

The CI/CD pipeline feature consists of two main modules:
- `extension/cicdPipeline.js`: ES module providing status querying, deployment dispatching, rollback handling, shell command generation, and secret masking for GNOME Shell.
- `companion/cicd_pipeline.py`: Python companion module providing matching functionality for CLI tools and management interfaces.

## Standardized Status Object Schema

```typescript
interface PipelineStatus {
  provider: 'github' | 'gitlab' | 'jenkins';
  id: string;
  status: 'success' | 'failed' | 'running' | 'queued' | 'cancelled' | 'unknown';
  outcome: string;
  branch: string;
  commit: string;
  author: string;
  url: string;
  duration: string;
  timestamp: string;
  stages: Array<{ name: string; status: string }>;
  error?: string;
}
```

## Security & Secrets Management

- **Automatic Redaction**: `maskSecrets(text, secretsArray)` replaces all detected token formats (`ghp_*`, `glpat-*`, `Bearer *`, `Basic *`) and custom secret strings with `[REDACTED]`.
- **Environment Integration**: Resolves secrets dynamically from `GITHUB_TOKEN`, `GITLAB_TOKEN`, `JENKINS_API_TOKEN`, `JENKINS_USER`, `JENKINS_URL`.

## API Functions

Refer to the generated [API Reference](api.html) for full function signatures and docstrings.
