"""
Event-Based Triggers Engine (Re-exported for app module compatibility).
"""

from companion.event_triggers import (
    get_nested_value,
    evaluate_condition,
    evaluate_conditions,
    substitute_context,
    compute_hmac_sha256,
    FileWatcher,
    GitHookManager,
    WebhookListener,
    SystemEventManager,
    EventTriggerEngine,
)

__all__ = [
    "get_nested_value",
    "evaluate_condition",
    "evaluate_conditions",
    "substitute_context",
    "compute_hmac_sha256",
    "FileWatcher",
    "GitHookManager",
    "WebhookListener",
    "SystemEventManager",
    "EventTriggerEngine",
]
