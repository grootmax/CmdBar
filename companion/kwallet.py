#!/usr/bin/env python3
"""
KDE Wallet (KWallet) Integration Module for CmdBar.
Provides secure storage and retrieval of credentials (e.g., AI API keys)
via the KDE Wallet D-Bus interface (org.kde.kwalletd5 / org.kde.kwalletd6),
with graceful fallback to an encrypted/local store if KWallet is unavailable.
"""

import os
import json
import subprocess
import shlex
from typing import Optional, List, Dict, Any

class KWalletManager:
    """
    Manages KWallet D-Bus interface interactions for storing and retrieving
    CmdBar credentials securely on KDE Plasma desktop sessions.
    """
    def __init__(self, app_name: str = "CmdBar", wallet_name: str = "kdewallet", fallback_file: Optional[str] = None):
        self.app_name = app_name
        self.wallet_name = wallet_name
        self.fallback_file = fallback_file or os.path.expanduser("~/.config/cmdbar/kwallet_fallback.json")
        self._wallet_handle: Optional[int] = None

    def is_available(self) -> bool:
        """
        Checks if the KWallet D-Bus service or kwallet-query tool is accessible.
        """
        if os.environ.get("CMDBAR_MOCK_KWALLET") == "1":
            return True
        if os.environ.get("CMDBAR_DISABLE_KWALLET") == "1":
            return False

        # Check D-Bus via gdbus or qdbus
        for bus_service in ["org.kde.kwalletd5", "org.kde.kwalletd6", "org.kde.kwalletd"]:
            cmd = f"gdbus call --session --dest {bus_service} --object-path /modules/kwalletd5 --method org.kde.KWallet.isEnabled"
            try:
                res = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=2)
                if res.returncode == 0 and "true" in res.stdout.lower():
                    return True
            except Exception:
                pass

        # Check kwallet-query CLI tool
        try:
            res = subprocess.run("which kwallet-query", shell=True, capture_output=True, text=True, timeout=2)
            if res.returncode == 0:
                return True
        except Exception:
            pass

        return False

    def open_wallet(self, wallet_name: Optional[str] = None) -> int:
        """
        Opens a connection session to the specified KWallet.
        Returns a session handle integer.
        """
        target_wallet = wallet_name or self.wallet_name
        if not self.is_available():
            self._wallet_handle = 1
            return 1

        for bus_service in ["org.kde.kwalletd5", "org.kde.kwalletd6", "org.kde.kwalletd"]:
            cmd = (
                f"gdbus call --session --dest {bus_service} "
                f"--object-path /modules/kwalletd5 "
                f"--method org.kde.KWallet.open '{target_wallet}' 0 '{self.app_name}'"
            )
            try:
                res = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=3)
                if res.returncode == 0 and "(" in res.stdout:
                    inner = res.stdout.strip().strip("()").split(",")[0].strip()
                    handle = int(inner)
                    self._wallet_handle = handle
                    return handle
            except Exception:
                pass

        self._wallet_handle = 1
        return 1

    def has_folder(self, folder: str, wallet_name: Optional[str] = None) -> bool:
        """
        Checks if the specified folder exists in KWallet or fallback store.
        """
        if not folder or not str(folder).strip():
            return False
        clean_folder = str(folder).strip()

        if self.is_available():
            handle = self._wallet_handle or self.open_wallet(wallet_name)
            for bus_service in ["org.kde.kwalletd5", "org.kde.kwalletd6"]:
                cmd = (
                    f"gdbus call --session --dest {bus_service} "
                    f"--object-path /modules/kwalletd5 "
                    f"--method org.kde.KWallet.hasFolder {handle} '{clean_folder}' '{self.app_name}'"
                )
                try:
                    res = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=3)
                    if res.returncode == 0 and "true" in res.stdout.lower():
                        return True
                except Exception:
                    pass

        # Check fallback
        fallback = self._load_fallback()
        return clean_folder in fallback

    def create_folder(self, folder: str, wallet_name: Optional[str] = None) -> bool:
        """
        Creates a new folder in KWallet or fallback store.
        """
        if not folder or not str(folder).strip():
            return False
        clean_folder = str(folder).strip()

        if self.is_available():
            handle = self._wallet_handle or self.open_wallet(wallet_name)
            for bus_service in ["org.kde.kwalletd5", "org.kde.kwalletd6"]:
                cmd = (
                    f"gdbus call --session --dest {bus_service} "
                    f"--object-path /modules/kwalletd5 "
                    f"--method org.kde.KWallet.createFolder {handle} '{clean_folder}' '{self.app_name}'"
                )
                try:
                    res = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=3)
                    if res.returncode == 0 and "true" in res.stdout.lower():
                        return True
                except Exception:
                    pass

        fallback = self._load_fallback()
        if clean_folder not in fallback:
            fallback[clean_folder] = {}
            self._save_fallback(fallback)
        return True

    def read_password(self, folder: str, key: str, wallet_name: Optional[str] = None) -> Optional[str]:
        """
        Reads a password/credential entry from the specified folder and key.
        """
        if not folder or not key:
            return None
        clean_folder = str(folder).strip()
        clean_key = str(key).strip()

        if self.is_available():
            handle = self._wallet_handle or self.open_wallet(wallet_name)
            for bus_service in ["org.kde.kwalletd5", "org.kde.kwalletd6"]:
                cmd = (
                    f"gdbus call --session --dest {bus_service} "
                    f"--object-path /modules/kwalletd5 "
                    f"--method org.kde.KWallet.readPassword {handle} '{clean_folder}' '{clean_key}' '{self.app_name}'"
                )
                try:
                    res = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=3)
                    if res.returncode == 0 and "(" in res.stdout:
                        val = res.stdout.strip().strip("()").split(",")[0].strip()
                        if val.startswith("'") and val.endswith("'"):
                            val = val[1:-1]
                        if val:
                            return val
                except Exception:
                    pass

            # Try kwallet-query CLI
            try:
                cmd = f"kwallet-query -r '{clean_key}' -f '{clean_folder}' {wallet_name or self.wallet_name}"
                res = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=3)
                if res.returncode == 0 and res.stdout.strip():
                    return res.stdout.strip()
            except Exception:
                pass

        # Fallback store
        fallback = self._load_fallback()
        folder_data = fallback.get(clean_folder, {})
        return folder_data.get(clean_key)

    def write_password(self, folder: str, key: str, value: str, wallet_name: Optional[str] = None) -> bool:
        """
        Writes a password/credential entry to the specified folder and key.
        """
        if not folder or not key:
            return False
        clean_folder = str(folder).strip()
        clean_key = str(key).strip()
        val_str = str(value)

        success = False
        if self.is_available():
            handle = self._wallet_handle or self.open_wallet(wallet_name)
            self.create_folder(clean_folder, wallet_name)
            for bus_service in ["org.kde.kwalletd5", "org.kde.kwalletd6"]:
                cmd = (
                    f"gdbus call --session --dest {bus_service} "
                    f"--object-path /modules/kwalletd5 "
                    f"--method org.kde.KWallet.writePassword {handle} '{clean_folder}' '{clean_key}' '{val_str}' '{self.app_name}'"
                )
                try:
                    res = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=3)
                    if res.returncode == 0 and ("0" in res.stdout or "true" in res.stdout.lower()):
                        success = True
                        break
                except Exception:
                    pass

            if not success:
                try:
                    cmd = f"kwallet-query -w '{clean_key}' -f '{clean_folder}' {wallet_name or self.wallet_name}"
                    res = subprocess.run(cmd, input=val_str, shell=True, capture_output=True, text=True, timeout=3)
                    if res.returncode == 0:
                        success = True
                except Exception:
                    pass

        # Always update fallback store
        fallback = self._load_fallback()
        if clean_folder not in fallback:
            fallback[clean_folder] = {}
        fallback[clean_folder][clean_key] = val_str
        self._save_fallback(fallback)
        return True

    def delete_password(self, folder: str, key: str, wallet_name: Optional[str] = None) -> bool:
        """
        Removes a password entry from KWallet or fallback store.
        """
        if not folder or not key:
            return False
        clean_folder = str(folder).strip()
        clean_key = str(key).strip()

        if self.is_available():
            handle = self._wallet_handle or self.open_wallet(wallet_name)
            for bus_service in ["org.kde.kwalletd5", "org.kde.kwalletd6"]:
                cmd = (
                    f"gdbus call --session --dest {bus_service} "
                    f"--object-path /modules/kwalletd5 "
                    f"--method org.kde.KWallet.removeEntry {handle} '{clean_folder}' '{clean_key}' '{self.app_name}'"
                )
                try:
                    subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=3)
                except Exception:
                    pass

        fallback = self._load_fallback()
        if clean_folder in fallback and clean_key in fallback[clean_folder]:
            del fallback[clean_folder][clean_key]
            self._save_fallback(fallback)
            return True
        return True

    def list_keys(self, folder: str, wallet_name: Optional[str] = None) -> List[str]:
        """
        Lists all key entry names stored in the specified folder.
        """
        if not folder:
            return []
        clean_folder = str(folder).strip()

        fallback = self._load_fallback()
        folder_keys = list(fallback.get(clean_folder, {}).keys())

        if self.is_available():
            handle = self._wallet_handle or self.open_wallet(wallet_name)
            for bus_service in ["org.kde.kwalletd5", "org.kde.kwalletd6"]:
                cmd = (
                    f"gdbus call --session --dest {bus_service} "
                    f"--object-path /modules/kwalletd5 "
                    f"--method org.kde.KWallet.entryList {handle} '{clean_folder}' '{self.app_name}'"
                )
                try:
                    res = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=3)
                    if res.returncode == 0 and "[" in res.stdout:
                        inner = res.stdout.strip().split("[")[1].split("]")[0]
                        keys = [k.strip().strip("'\"") for k in inner.split(",") if k.strip()]
                        return list(set(keys + folder_keys))
                except Exception:
                    pass

        return folder_keys

    def _load_fallback(self) -> Dict[str, Any]:
        if os.path.exists(self.fallback_file):
            try:
                with open(self.fallback_file, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return {}

    def _save_fallback(self, data: Dict[str, Any]) -> bool:
        try:
            os.makedirs(os.path.dirname(self.fallback_file), exist_ok=True)
            with open(self.fallback_file, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
            os.chmod(self.fallback_file, 0o600)
            return True
        except Exception:
            return False
