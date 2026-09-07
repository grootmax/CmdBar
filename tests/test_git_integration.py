import unittest
import os
import tempfile
import shutil
from app.config_schema import DEFAULT_CONFIG, resolve_command_preview

class TestGitIntegration(unittest.TestCase):
    def test_default_config_includes_git_category(self):
        categories = DEFAULT_CONFIG.get("categories", [])
        git_cat = next((c for c in categories if c.get("name") == "Git"), None)
        self.assertIsNotNone(git_cat, "Git category should be present in DEFAULT_CONFIG")
        
        commands = git_cat.get("commands", [])
        self.assertTrue(len(commands) >= 4, "Git category should contain at least 4 commands")
        cmd_names = [cmd.get("name") for cmd in commands]
        self.assertIn("Git Status", cmd_names)
        self.assertIn("Git Pull", cmd_names)
        self.assertIn("Git Push", cmd_names)
        self.assertIn("Git Commit", cmd_names)

    def test_resolve_command_preview_with_git_placeholders(self):
        cmd_template = "git push origin {git-branch}"
        param_values = {"git-branch": "main"}
        resolved, errors = resolve_command_preview(cmd_template, "shell-quoted", param_values, {})
        self.assertIn("main", resolved)
        self.assertEqual(len(errors), 0)

if __name__ == "__main__":
    unittest.main()
