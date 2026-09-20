import os
import json
import pytest
from companion.kwallet import KWalletManager

@pytest.fixture
def temp_wallet_dir(tmp_path):
    fallback_file = tmp_path / "kwallet_fallback.json"
    return str(fallback_file)

def test_kwallet_availability():
    os.environ["CMDBAR_MOCK_KWALLET"] = "1"
    wallet = KWalletManager()
    assert wallet.is_available() is True

    os.environ["CMDBAR_DISABLE_KWALLET"] = "1"
    os.environ.pop("CMDBAR_MOCK_KWALLET", None)
    assert wallet.is_available() is False

def test_kwallet_fallback_operations(temp_wallet_dir):
    os.environ["CMDBAR_DISABLE_KWALLET"] = "1"
    wallet = KWalletManager(fallback_file=temp_wallet_dir)

    # Write credential
    success = wallet.write_password("CmdBar", "openai_key", "sk-test-key-12345")
    assert success is True

    # Read credential
    val = wallet.read_password("CmdBar", "openai_key")
    assert val == "sk-test-key-12345"

    # Has folder
    assert wallet.has_folder("CmdBar") is True
    assert wallet.has_folder("NonExistentFolder") is False

    # List keys
    keys = wallet.list_keys("CmdBar")
    assert "openai_key" in keys

    # Delete password
    del_res = wallet.delete_password("CmdBar", "openai_key")
    assert del_res is True
    assert wallet.read_password("CmdBar", "openai_key") is None

def test_kwallet_open_session():
    os.environ["CMDBAR_MOCK_KWALLET"] = "1"
    wallet = KWalletManager()
    handle = wallet.open_wallet("kdewallet")
    assert isinstance(handle, int)
    assert handle > 0
