import os
import sys

try:
    from app.atomic_write import atomic_write, atomic_write_json
except ImportError:
    sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
    from app.atomic_write import atomic_write, atomic_write_json

__all__ = ["atomic_write", "atomic_write_json"]
