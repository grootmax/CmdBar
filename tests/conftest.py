import sys
from unittest.mock import MagicMock

# Mock gi and its components before any imports happen
gi_mock = MagicMock()
sys.modules["gi"] = gi_mock

gi_repository_mock = MagicMock()
sys.modules["gi.repository"] = gi_repository_mock


class MockApplication:
    def __init__(self, *args, **kwargs):
        pass

    def run(self, *args):
        return 0


class MockApplicationWindow:
    def __init__(self, *args, **kwargs):
        pass


class MockGtkWindow:
    def __init__(self, *args, **kwargs):
        pass
    def set_default_size(self, *args, **kwargs):
        pass
    def set_child(self, *args, **kwargs):
        pass
    def connect(self, *args, **kwargs):
        pass


Gtk_mock = MagicMock()
Gtk_mock.Window = MockGtkWindow
Adw_mock = MagicMock()
Gio_mock = MagicMock()
GLib_mock = MagicMock()

Adw_mock.Application = MockApplication
Adw_mock.ApplicationWindow = MockApplicationWindow
Gio_mock.ApplicationFlags.FLAGS_NONE = 0

# Set up standard properties to avoid GObject errors or missing attributes
gi_repository_mock.Gtk = Gtk_mock
gi_repository_mock.Adw = Adw_mock
gi_repository_mock.Gio = Gio_mock
gi_repository_mock.GLib = GLib_mock

sys.modules["gi.repository.Gtk"] = Gtk_mock
sys.modules["gi.repository.Adw"] = Adw_mock
sys.modules["gi.repository.Gio"] = Gio_mock
sys.modules["gi.repository.GLib"] = GLib_mock
