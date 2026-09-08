# CI/CD Integration Pipeline

CmdBar features native support for monitoring, triggering, and rolling back automated deployments across popular Continuous Integration and Continuous Deployment (CI/CD) platforms directly from your GNOME top bar.

## Supported Providers

- **GitHub Actions**: Inspect workflow runs, trigger dispatch events, and initiate rollbacks.
- **GitLab CI/CD**: Monitor pipeline execution, trigger new pipeline jobs, and rerun releases.
- **Jenkins CI**: Query job build statuses, launch parameterised builds, and trigger rollback jobs.

## Core Capabilities

### 1. View Pipeline Status
View real-time status summaries of your latest builds and deployments, including branch, commit SHA, author, build duration, and individual stage execution results.

### 2. Trigger Deployments
Initiate production or staging deployments for any target branch, ref, or environment with custom parameter overrides directly from CmdBar.

### 3. Rollback Commands
Quickly execute rollback operations to restore a previous stable build version or release tag in case of incident or failed deployment.

### 4. Secrets Integration & Masking
All API tokens (`GITHUB_TOKEN`, `GITLAB_TOKEN`, `JENKINS_API_TOKEN`) and HTTP Authorization headers are automatically masked and redacted in logs, status previews, and error notifications to prevent credential leakage.

## Quick Setup

Configure environment variables or set credentials in your `config.json`:

```json
{
  "cicd": {
    "provider": "github",
    "token": "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "repo": "owner/repository",
    "branch": "main"
  }
}
```
