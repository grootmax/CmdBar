from companion.audit_logger import (
    get_audit_log_path,
    get_current_user,
    is_sensitive_command,
    rotate_log_if_needed,
    log_command,
    read_audit_logs,
    clear_audit_log,
    DEFAULT_SENSITIVE_KEYWORDS,
)

__all__ = [
    "get_audit_log_path",
    "get_current_user",
    "is_sensitive_command",
    "rotate_log_if_needed",
    "log_command",
    "read_audit_logs",
    "clear_audit_log",
    "DEFAULT_SENSITIVE_KEYWORDS",
]
