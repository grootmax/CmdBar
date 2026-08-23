"""
Template Manager module for companion app.
Re-exports template management utilities.
"""

from app.template_manager import (
    get_templates_dir,
    validate_template,
    load_template_file,
    load_all_templates,
    import_templates_to_config,
    export_command_as_template,
    export_templates_to_file,
)

__all__ = [
    "get_templates_dir",
    "validate_template",
    "load_template_file",
    "load_all_templates",
    "import_templates_to_config",
    "export_command_as_template",
    "export_templates_to_file",
]
