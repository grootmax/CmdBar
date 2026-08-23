"""
KDE Plasma Support package for CmdBar Companion.
Provides KWallet credential storage, KWin global shortcuts & active window context,
StatusNotifierItem system tray integration, and KDE Plasma theme adaptation.
"""

from .kwallet import KWalletManager
from .kwin import KWinManager
from .system_tray import SystemTrayManager
from .theme import PlasmaThemeAdapter
from .service import CmdBarKdeService

__all__ = [
    "KWalletManager",
    "KWinManager",
    "SystemTrayManager",
    "PlasmaThemeAdapter",
    "CmdBarKdeService",
]
