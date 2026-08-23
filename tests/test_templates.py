import os
import json
import tempfile
import pytest

from app.template_manager import (
    get_templates_dir,
    validate_template,
    load_template_file,
    load_all_templates,
    import_templates_to_config,
    export_command_as_template,
    export_templates_to_file,
)


def test_get_templates_dir():
    tmpl_dir = get_templates_dir()
    assert os.path.exists(tmpl_dir)
    assert os.path.isdir(tmpl_dir)


def test_validate_template_valid():
    raw = {
        "name": "Git Checkout",
        "description": "Switch branch",
        "command": "git checkout <branch>",
        "category": "Git",
        "icon": "vcs-branch-symbolic",
        "parameters": {
            "branch": {"placeholder": "main"}
        }
    }
    validated = validate_template(raw)
    assert validated["name"] == "Git Checkout"
    assert validated["description"] == "Switch branch"
    assert validated["command"] == "git checkout <branch>"
    assert validated["category"] == "Git"
    assert validated["icon"] == "vcs-branch-symbolic"


def test_validate_template_invalid():
    with pytest.raises(ValueError):
        validate_template("not a dict")

    with pytest.raises(ValueError):
        validate_template({"description": "no name or command"})

    with pytest.raises(ValueError):
        validate_template({"name": "Test"})


def test_load_all_built_in_templates():
    templates = load_all_templates()
    assert len(templates) >= 20

    categories = set(t["category"] for t in templates)
    # Check that required categories are covered
    cat_str = " ".join(categories).lower()
    assert "git" in cat_str
    assert "docker" in cat_str
    assert "kubernetes" in cat_str or "kube" in cat_str
    assert "aws" in cat_str
    assert "npm" in cat_str or "pnpm" in cat_str
    assert "system" in cat_str


def test_import_templates_to_config():
    config = {
        "categories": [
            {
                "name": "Existing Cat",
                "commands": []
            }
        ]
    }

    tmpl = {
        "name": "Docker Run",
        "description": "Run docker container",
        "command": "docker run -d <img_id>",
        "category": "Docker Operations",
        "icon": "utilities-terminal-symbolic"
    }

    updated, added = import_templates_to_config(config, tmpl)
    assert added == 1
    assert len(updated["categories"]) == 2
    
    docker_cat = next(c for c in updated["categories"] if c["name"] == "Docker Operations")
    assert len(docker_cat["commands"]) == 1
    assert docker_cat["commands"][0]["name"] == "Docker Run"

    # Duplicate import should not add command again
    updated2, added2 = import_templates_to_config(updated, tmpl)
    assert added2 == 0


def test_export_and_load_community_template():
    with tempfile.TemporaryDirectory() as tmpdir:
        out_file = os.path.join(tmpdir, "community_template.json")

        cmd = {
            "name": "Custom Deploy",
            "command": "./deploy.sh --env <env>",
            "mode": "shell-quoted",
            "parameters": {
                "env": {"placeholder": "production"}
            }
        }

        tmpl = export_command_as_template(cmd, category_name="DevOps", author="Developer1")
        assert tmpl["name"] == "Custom Deploy"
        assert tmpl["category"] == "DevOps"
        assert tmpl["author"] == "Developer1"

        export_templates_to_file([tmpl], out_file, author="Developer1")
        assert os.path.exists(out_file)

        loaded = load_template_file(out_file)
        assert len(loaded) == 1
        assert loaded[0]["name"] == "Custom Deploy"
        assert loaded[0]["command"] == "./deploy.sh --env <env>"
