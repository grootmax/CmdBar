import pytest
from app.team_sharing import (
    ROLES,
    ROLE_LEVELS,
    PERMISSIONS,
    has_permission,
    check_permission,
    sha256_hex,
    encode_command_share_url,
    decode_command_share_url,
    import_from_share_url,
    add_team_repository,
    remove_team_repository,
    list_team_repositories,
    sync_team_repository,
    create_config_revision,
    get_revision_history,
    diff_config_revisions,
    rollback_to_revision,
    create_proposal,
    review_proposal,
    merge_proposal,
    list_proposals,
    get_proposal_by_id,
    log_activity,
    get_activity_feed,
    clear_activity_feed,
)


def test_rbac_permissions():
    assert has_permission("viewer", "VIEW") is True
    assert has_permission("viewer", "EXECUTE") is True
    assert has_permission("viewer", "CREATE_COMMAND") is False
    assert has_permission("viewer", "MANAGE_REPOS") is False

    assert has_permission("editor", "CREATE_COMMAND") is True
    assert has_permission("editor", "PROPOSE_CHANGE") is True
    assert has_permission("editor", "APPROVE_PROPOSAL") is False

    assert has_permission("approver", "APPROVE_PROPOSAL") is True
    assert has_permission("approver", "REJECT_PROPOSAL") is True

    assert has_permission("admin", "MANAGE_REPOS") is True
    assert has_permission("admin", "ROLLBACK_VERSION") is True

    with pytest.raises(PermissionError):
        check_permission("viewer", "MANAGE_REPOS")


def test_url_sharing_encode_decode():
    cmd_data = {
        "name": "Database Migration",
        "command": "python manage.py migrate",
    }

    url = encode_command_share_url(cmd_data, {"secretKey": "mypass"})
    assert "cmdbar://share?data=" in url
    assert "&sig=" in url

    decoded = decode_command_share_url(url, {"secretKey": "mypass"})
    assert decoded["valid"] is True
    assert decoded["type"] == "command"
    assert decoded["data"]["name"] == "Database Migration"


def test_expired_share_url():
    cmd_data = {"name": "Test", "command": "echo test"}
    url = encode_command_share_url(cmd_data, {"expiresInSeconds": -10})

    decoded = decode_command_share_url(url)
    assert decoded["valid"] is False
    assert "expired" in decoded["error"]


def test_import_from_share_url():
    cmd_data = {"name": "Build Assets", "command": "npm run build"}
    url = encode_command_share_url(cmd_data)

    res = import_from_share_url(url, target_category="Builds", user_role="viewer")
    assert res["importedCount"] == 1
    assert len(res["config"]["categories"]) == 1
    assert res["config"]["categories"][0]["name"] == "Builds"


def test_team_repository_lifecycle():
    config = {"categories": [], "teamRepositories": []}

    repo_info = {
        "id": "infra-team",
        "name": "Infrastructure Team",
        "url": "https://github.com/myorg/infra-commands.git",
    }

    config = add_team_repository(repo_info, config, user_role="admin")
    assert len(list_team_repositories(config)) == 1

    sync_res = sync_team_repository("infra-team", config, user_role="viewer")
    assert sync_res["syncedCount"] > 0
    assert len(sync_res["config"]["categories"]) == 1

    config = remove_team_repository("infra-team", sync_res["config"], user_role="admin")
    assert len(list_team_repositories(config)) == 0


def test_config_version_control():
    base_config = {
        "categories": [{"name": "CI", "commands": [{"name": "Test", "command": "pytest"}]}]
    }

    config = create_config_revision(base_config, author="alice", message="Rev 1")
    history = get_revision_history(config)
    assert len(history) == 1
    assert history[0]["revision"] == 1

    # Modify
    config["categories"][0]["commands"].append({"name": "Lint", "command": "flake8"})
    config = create_config_revision(config, author="bob", message="Rev 2")
    assert len(get_revision_history(config)) == 2

    # Rollback
    rolled = rollback_to_revision(config, 1, user_role="admin")
    assert len(rolled["categories"][0]["commands"]) == 1


def test_proposal_approval_workflow():
    config = {"categories": [], "teamRepositories": [{"id": "ops", "name": "Ops"}]}

    cmd = {"name": "Flips Switch", "command": "echo switch"}

    # Create
    prop_res = create_proposal(config, "ops", cmd, author="charlie", description="New switch", user_role="editor")
    config = prop_res["config"]
    prop_id = prop_res["proposal"]["id"]
    assert prop_res["proposal"]["status"] == "pending"

    # Review approve
    rev_res = review_proposal(config, prop_id, "approved", reviewer="diana", comment="LGTM", reviewer_role="approver")
    config = rev_res["config"]
    assert rev_res["proposal"]["status"] == "approved"

    # Merge
    merged_config = merge_proposal(config, prop_id, user_role="approver")
    assert len(merged_config["categories"]) == 1
    assert merged_config["categories"][0]["commands"][0]["name"] == "Flips Switch"


def test_activity_feed():
    config = {"activityFeed": []}

    log_activity(config, actor="Alice", actor_role="admin", action="TEST_ACT", target="Target1", repo_id="r1")
    log_activity(config, actor="Bob", actor_role="viewer", action="TEST_ACT2", target="Target2", repo_id="r2")

    feed = get_activity_feed(config)
    assert feed["total"] == 2

    filtered = get_activity_feed(config, {"repoId": "r1"})
    assert filtered["total"] == 1

    cleared = clear_activity_feed(config, user_role="admin")
    assert get_activity_feed(cleared)["total"] == 0
