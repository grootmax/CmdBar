#!/usr/bin/env python3
import unittest
import os
from companion.cicd_pipeline import (
    normalize_config,
    mask_secrets,
    parse_pipeline_status,
    format_pipeline_status_output,
    get_trigger_command,
    get_rollback_command,
)


class TestCICDPipelineCompanion(unittest.TestCase):

    def setUp(self):
        self.sample_github_run = {
            "workflow_runs": [
                {
                    "id": 12345,
                    "status": "completed",
                    "conclusion": "success",
                    "head_branch": "main",
                    "head_sha": "abc123456789",
                    "actor": {"login": "testuser"},
                    "html_url": "https://github.com/owner/repo/actions/runs/12345",
                }
            ]
        }

    def test_normalize_config(self):
        cfg = normalize_config("github", {"repo": "owner/repo", "token": "ghp_secret_123"})
        self.assertEqual(cfg["provider"], "github")
        self.assertEqual(cfg["repo"], "owner/repo")
        self.assertEqual(cfg["token"], "ghp_secret_123")
        self.assertEqual(cfg["base_url"], "https://api.github.com")

    def test_mask_secrets(self):
        raw = "Using token ghp_1234567890abcdefghijklmnopqrstuvwxyz and Bearer my_bearer_token"
        masked = mask_secrets(raw)
        self.assertNotIn("ghp_1234567890abcdefghijklmnopqrstuvwxyz", masked)
        self.assertIn("[REDACTED]", masked)

    def test_parse_pipeline_status(self):
        parsed = parse_pipeline_status("github", self.sample_github_run)
        self.assertEqual(parsed["provider"], "github")
        self.assertEqual(parsed["id"], "12345")
        self.assertEqual(parsed["status"], "success")
        self.assertEqual(parsed["branch"], "main")
        self.assertEqual(parsed["commit"], "abc1234")

    def test_format_pipeline_status_output(self):
        status_obj = {
            "provider": "github",
            "id": "12345",
            "status": "success",
            "branch": "main",
            "commit": "abc1234",
            "author": "testuser",
            "duration": "45s",
            "url": "https://github.com/owner/repo/runs/12345",
        }
        fmt = format_pipeline_status_output(status_obj)
        self.assertIn("[GITHUB] Pipeline #12345: ✅ SUCCESS", fmt)
        self.assertIn("Branch: main (abc1234)", fmt)

    def test_get_trigger_command_masks_token(self):
        cmd = get_trigger_command(
            "github",
            {"repo": "org/repo", "token": "ghp_my_secret_token_val_123", "job": "deploy.yml"},
        )
        self.assertIn("curl", cmd)
        self.assertNotIn("ghp_my_secret_token_val_123", cmd)
        self.assertIn("[REDACTED]", cmd)

    def test_get_rollback_command(self):
        cmd = get_rollback_command(
            "jenkins",
            {"job": "deploy-job", "user": "admin", "token": "secret_tok", "targetVersion": "v1.2.0"},
        )
        self.assertIn("TARGET_VERSION", cmd)
        self.assertIn("v1.2.0", cmd)
        self.assertNotIn("secret_tok", cmd)


if __name__ == "__main__":
    unittest.main()
