"""
Companion Workspace Manager re-export wrapper.
Provides access to WorkspaceManager and enterprise workspace components.
:visibility: public
"""

from app.workspace_manager import (
    WorkspaceManager,
    WORKSPACE_ROLES,
    PLAN_TIERS,
    PLAN_LIMITS
)

__all__ = [
    "WorkspaceManager",
    "WORKSPACE_ROLES",
    "PLAN_TIERS",
    "PLAN_LIMITS"
]
