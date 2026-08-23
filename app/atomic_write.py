import os
import json
import stat


def atomic_write(target_path, content, mode="w", encoding="utf-8"):
    """
    Writes content to target_path atomically using a temporary file in the same directory.
    Guarantees cleanup of the temporary file if an error occurs.
    Preserves destination file permission modes if target_path exists.
    """
    target_path = os.path.abspath(target_path)
    target_dir = os.path.dirname(target_path)
    if target_dir:
        os.makedirs(target_dir, exist_ok=True)

    temp_path = target_path + ".tmp"

    file_mode = None
    if os.path.exists(target_path):
        try:
            file_mode = stat.S_IMODE(os.stat(target_path).st_mode)
        except OSError:
            pass

    try:
        if isinstance(content, (bytes, bytearray)):
            with open(temp_path, "wb") as f:
                f.write(content)
        else:
            with open(temp_path, mode, encoding=encoding) as f:
                f.write(content)

        if file_mode is not None:
            try:
                os.chmod(temp_path, file_mode)
            except OSError:
                pass

        os.replace(temp_path, target_path)
    except Exception as err:
        try:
            if os.path.exists(temp_path):
                os.remove(temp_path)
        except OSError:
            pass
        raise err


def atomic_write_json(target_path, data, indent=2):
    """
    Helper to atomically write JSON data to target_path.
    """
    content = json.dumps(data, indent=indent) + "\n"
    atomic_write(target_path, content)
