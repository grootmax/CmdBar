import unittest
import time
from app.policy_manager import (
    evaluate_command_policy,
    CommandPolicyManager,
    match_pattern,
    glob_to_regex,
    resolve_user_context,
    DEFAULT_BLACKLIST_PATTERNS,
    DEFAULT_WHITELIST_PATTERNS,
)


class TestPolicyManager(unittest.TestCase):
    def test_pattern_matching(self):
        self.assertTrue(match_pattern("rm -rf /tmp/data", "rm -rf *"))
        self.assertTrue(match_pattern("mkfs.ext4 /dev/sdb", "mkfs*"))
        self.assertTrue(match_pattern("shutdown -h now", "shutdown*"))
        self.assertFalse(match_pattern("echo hello", "rm -rf *"))
        self.assertTrue(match_pattern("rm -rf /var/log", "regex:^rm\\s+-rf"))

    def test_blacklist_blocking(self):
        res = evaluate_command_policy("rm -rf /")
        self.assertFalse(res["allowed"])
        self.assertEqual(res["blocked_by"], "blacklist")

        res_safe = evaluate_command_policy("echo Hello World")
        self.assertTrue(res_safe["allowed"])
        self.assertIsNone(res_safe["blocked_by"])

    def test_whitelist_mode(self):
        policy = {
            "enabled": True,
            "mode": "whitelist",
            "whitelist": ["echo *", "git status"],
            "blacklist": [],
            "rules": [],
        }

        self.assertTrue(evaluate_command_policy("echo Hello", policy_config=policy)["allowed"])
        self.assertTrue(evaluate_command_policy("git status", policy_config=policy)["allowed"])

        blocked = evaluate_command_policy("python3 script.py", policy_config=policy)
        self.assertFalse(blocked["allowed"])
        self.assertEqual(blocked["blocked_by"], "whitelist")

    def test_user_and_group_scoped_rules(self):
        policy = {
            "enabled": True,
            "mode": "blacklist",
            "blacklist": [],
            "whitelist": [],
            "rules": [
                {
                    "id": "r1",
                    "user": "alice",
                    "action": "deny",
                    "pattern": "aws *",
                    "reason": "Alice restricted",
                },
                {
                    "id": "r2",
                    "group": "interns",
                    "action": "deny",
                    "pattern": "docker *",
                },
            ],
        }

        res_alice = evaluate_command_policy("aws s3 ls", custom_context={"user": "alice"}, policy_config=policy)
        self.assertFalse(res_alice["allowed"])
        self.assertEqual(res_alice["blocked_by"], "user_group_rule")

        res_bob = evaluate_command_policy("aws s3 ls", custom_context={"user": "bob"}, policy_config=policy)
        self.assertTrue(res_bob["allowed"])

        res_intern = evaluate_command_policy("docker ps", custom_context={"user": "sam", "groups": ["interns"]}, policy_config=policy)
        self.assertFalse(res_intern["allowed"])

    def test_approval_and_overrides(self):
        pm = CommandPolicyManager()
        cmd = "rm -rf /tmp/test"

        self.assertFalse(pm.evaluate(cmd)["allowed"])

        req = pm.request_approval(cmd, requester_context={"user": "user1"}, reason="Clean cache")
        self.assertEqual(req["status"], "pending")

        appr = pm.approve_request(req["id"], approver_context={"user": "admin"})
        self.assertEqual(appr["status"], "approved")
        self.assertIsNotNone(appr["token"])

        eval_approved = pm.evaluate(cmd, approval_token=appr["token"])
        self.assertTrue(eval_approved["allowed"])
        self.assertTrue(eval_approved["approved"])

        override = pm.grant_override("chmod -R 777 *", approver_context={"user": "admin"})
        self.assertTrue(pm.evaluate("chmod -R 777 /tmp/dir", approval_token=override["token"])["allowed"])

        pm.revoke_override(override["token"])
        self.assertFalse(pm.evaluate("chmod -R 777 /tmp/dir", approval_token=override["token"])["allowed"])


if __name__ == "__main__":
    unittest.main()
