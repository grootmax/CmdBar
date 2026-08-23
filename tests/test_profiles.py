import pytest
from app.config_schema import (
    get_profiles,
    get_active_profile_name,
    get_profile_env,
    is_command_visible_in_profile,
    merge_environment,
)

def test_get_profiles_list_and_dict():
    cfg_list = {
        "profiles": [
            {"name": "Production", "env": {"ENV_TYPE": "prod"}},
            {"name": "Development", "env": {"ENV_TYPE": "dev"}},
        ]
    }
    profiles = get_profiles(cfg_list)
    assert len(profiles) == 2
    assert profiles[0]["name"] == "Production"
    assert profiles[0]["env"]["ENV_TYPE"] == "prod"

    cfg_dict = {
        "profiles": {
            "Staging": {"env": {"ENV_TYPE": "staging"}},
        }
    }
    profiles_dict = get_profiles(cfg_dict)
    assert len(profiles_dict) == 1
    assert profiles_dict[0]["name"] == "Staging"
    assert profiles_dict[0]["env"]["ENV_TYPE"] == "staging"

def test_get_active_profile_name():
    cfg = {
        "active_profile": "Staging",
        "profiles": [
            {"name": "Production"},
            {"name": "Staging"},
        ]
    }
    assert get_active_profile_name(cfg) == "Staging"

    cfg_no_active = {
        "profiles": [{"name": "Development"}]
    }
    assert get_active_profile_name(cfg_no_active) == "Development"

def test_get_profile_env_and_merge():
    cfg = {
        "active_profile": "Production",
        "profiles": [
            {"name": "Production", "env": {"HOST": "prod.example.com", "PORT": "443"}},
            {"name": "Development", "env": {"HOST": "localhost", "PORT": "8000"}},
        ]
    }
    prod_env = get_profile_env(cfg)
    assert prod_env["HOST"] == "prod.example.com"

    dev_env = get_profile_env(cfg, "Development")
    assert dev_env["HOST"] == "localhost"

    base_env = {"PATH": "/usr/bin", "PORT": "3000"}
    merged = merge_environment(base_env, cfg, "Production")
    assert merged["PATH"] == "/usr/bin"
    assert merged["HOST"] == "prod.example.com"
    assert merged["PORT"] == "443"

def test_is_command_visible_in_profile():
    cmd_dev = {"name": "Dev Task", "profiles": ["Development"]}
    cmd_prod = {"name": "Prod Task", "profile": "Production"}
    cmd_any = {"name": "General Task"}

    assert is_command_visible_in_profile(cmd_dev, "Development") is True
    assert is_command_visible_in_profile(cmd_dev, "Production") is False

    assert is_command_visible_in_profile(cmd_prod, "Production") is True
    assert is_command_visible_in_profile(cmd_prod, "Development") is False

    assert is_command_visible_in_profile(cmd_any, "Production") is True
    assert is_command_visible_in_profile(cmd_any, "Development") is True
