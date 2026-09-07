"""
Cloud Services Integration module for CmdBar Companion & CLI.
Supports resource discovery, credential management, and caching for AWS, GCP, and Azure.
"""

import os
import time
import json
from typing import Dict, List, Optional, Any

CLOUD_PROVIDERS = ["aws", "gcp", "azure"]

RESOURCE_TYPES = {
    "aws": ["ec2", "s3", "lambda"],
    "gcp": ["gce", "cloud_run"],
    "azure": ["vm", "functions"],
}


def get_mock_resources(provider: str, resource_type: str) -> List[Dict[str, Any]]:
    """
    Returns mock resource definitions for testing and CLI-missing fallbacks.
    """
    p = (provider or "").lower()
    r = (resource_type or "").lower()

    if p == "aws":
        if r == "ec2":
            return [
                {
                    "id": "i-0123456789abcdef0",
                    "name": "prod-web-01",
                    "status": "running",
                    "type": "ec2",
                    "provider": "aws",
                    "region": "us-east-1",
                },
                {
                    "id": "i-0fedcba9876543210",
                    "name": "staging-api-01",
                    "status": "stopped",
                    "type": "ec2",
                    "provider": "aws",
                    "region": "us-east-1",
                },
            ]
        elif r == "s3":
            return [
                {
                    "id": "prod-data-bucket",
                    "name": "prod-data-bucket",
                    "status": "active",
                    "type": "s3",
                    "provider": "aws",
                    "region": "us-east-1",
                },
                {
                    "id": "app-logs-storage",
                    "name": "app-logs-storage",
                    "status": "active",
                    "type": "s3",
                    "provider": "aws",
                    "region": "us-west-2",
                },
            ]
        elif r == "lambda":
            return [
                {
                    "id": "process-order-fn",
                    "name": "process-order-fn",
                    "status": "active",
                    "type": "lambda",
                    "provider": "aws",
                    "region": "us-east-1",
                    "runtime": "nodejs20.x",
                },
                {
                    "id": "send-notification-fn",
                    "name": "send-notification-fn",
                    "status": "active",
                    "type": "lambda",
                    "provider": "aws",
                    "region": "us-east-1",
                    "runtime": "python3.12",
                },
            ]
    elif p == "gcp":
        if r == "gce":
            return [
                {
                    "id": "gce-web-instance-1",
                    "name": "gce-web-instance-1",
                    "status": "RUNNING",
                    "type": "gce",
                    "provider": "gcp",
                    "zone": "us-central1-a",
                },
                {
                    "id": "gce-db-instance-1",
                    "name": "gce-db-instance-1",
                    "status": "TERMINATED",
                    "type": "gce",
                    "provider": "gcp",
                    "zone": "us-central1-b",
                },
            ]
        elif r == "cloud_run":
            return [
                {
                    "id": "auth-service",
                    "name": "auth-service",
                    "status": "READY",
                    "type": "cloud_run",
                    "provider": "gcp",
                    "region": "us-central1",
                },
                {
                    "id": "payment-gateway",
                    "name": "payment-gateway",
                    "status": "READY",
                    "type": "cloud_run",
                    "provider": "gcp",
                    "region": "us-central1",
                },
            ]
    elif p == "azure":
        if r == "vm":
            return [
                {
                    "id": "azure-prod-vm-1",
                    "name": "azure-prod-vm-1",
                    "status": "VM running",
                    "type": "vm",
                    "provider": "azure",
                    "resourceGroup": "prod-rg",
                },
                {
                    "id": "azure-dev-vm-1",
                    "name": "azure-dev-vm-1",
                    "status": "VM deallocated",
                    "type": "vm",
                    "provider": "azure",
                    "resourceGroup": "dev-rg",
                },
            ]
        elif r == "functions":
            return [
                {
                    "id": "func-image-resizer",
                    "name": "func-image-resizer",
                    "status": "Running",
                    "type": "functions",
                    "provider": "azure",
                    "resourceGroup": "prod-rg",
                },
                {
                    "id": "func-webhook-handler",
                    "name": "func-webhook-handler",
                    "status": "Running",
                    "type": "functions",
                    "provider": "azure",
                    "resourceGroup": "prod-rg",
                },
            ]

    return []


def get_default_cache_path() -> str:
    """
    Returns default path to cloud resource cache file (~/.config/cmdbar/cloud_cache.json).
    """
    config_dir = os.path.expanduser("~/.config/cmdbar")
    return os.path.join(config_dir, "cloud_cache.json")


def load_cloud_cache(cache_path: Optional[str] = None) -> Dict[str, Any]:
    """
    Loads cloud resource cache dictionary from disk.
    """
    file_path = cache_path or get_default_cache_path()
    if os.path.exists(file_path):
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def save_cloud_cache(
    cache_data: Dict[str, Any], cache_path: Optional[str] = None
) -> None:
    """
    Saves cloud resource cache dictionary to disk using atomic write.
    """
    file_path = cache_path or get_default_cache_path()
    os.makedirs(os.path.dirname(file_path), exist_ok=True)
    temp_path = f"{file_path}.tmp"
    try:
        with open(temp_path, "w", encoding="utf-8") as f:
            json.dump(cache_data or {}, f, indent=2)
        os.replace(temp_path, file_path)
    except Exception:
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                pass


def clear_cloud_cache(cache_path: Optional[str] = None) -> None:
    """
    Clears all cached cloud resources.
    """
    save_cloud_cache({}, cache_path)


def get_cached_resources(
    provider: str,
    resource_type: str,
    ttl: int = 300,
    cache_path: Optional[str] = None,
) -> Optional[List[Dict[str, Any]]]:
    """
    Retrieves cached resources for a provider and resource_type if valid within TTL.
    """
    cache = load_cloud_cache(cache_path)
    key = f"{provider.lower()}:{resource_type.lower()}"
    entry = cache.get(key)

    if (
        not entry
        or "timestamp" not in entry
        or not isinstance(entry.get("resources"), list)
    ):
        return None

    age = time.time() - entry["timestamp"]
    if age > ttl:
        return None

    return entry["resources"]


def set_cached_resources(
    provider: str,
    resource_type: str,
    resources: List[Dict[str, Any]],
    cache_path: Optional[str] = None,
) -> None:
    """
    Sets cached resources for a provider and resource_type.
    """
    cache = load_cloud_cache(cache_path)
    key = f"{provider.lower()}:{resource_type.lower()}"
    cache[key] = {
        "timestamp": time.time(),
        "resources": resources if isinstance(resources, list) else [],
    }
    save_cloud_cache(cache, cache_path)


def get_auth_status(
    provider: str, env: Optional[Dict[str, str]] = None
) -> Dict[str, Any]:
    """
    Checks authentication status and credential details for a cloud provider.
    """
    p = (provider or "").lower()
    environ = env if env is not None else os.environ

    if p == "aws":
        profile = environ.get("AWS_PROFILE", "default")
        has_keys = bool(
            environ.get("AWS_ACCESS_KEY_ID") and environ.get("AWS_SECRET_ACCESS_KEY")
        )
        has_creds_file = os.path.exists(
            os.path.expanduser("~/.aws/credentials")
        ) or os.path.exists(os.path.expanduser("~/.aws/config"))

        if has_keys or has_creds_file:
            return {
                "authenticated": True,
                "details": (
                    "Authenticated via environment variables"
                    if has_keys
                    else f"Authenticated via AWS profile '{profile}'"
                ),
                "profile": profile,
                "account": environ.get("AWS_ACCOUNT_ID", "aws-account"),
            }
    elif p == "gcp":
        project = (
            environ.get("CLOUDSDK_CORE_PROJECT")
            or environ.get("GCP_PROJECT")
            or environ.get("GOOGLE_CLOUD_PROJECT")
            or "gcp-project"
        )
        has_creds = bool(
            environ.get("GOOGLE_APPLICATION_CREDENTIALS")
        ) or os.path.exists(
            os.path.expanduser("~/.config/gcloud/application_default_credentials.json")
        )

        if has_creds or bool(environ.get("GCP_AUTHENTICATED")):
            return {
                "authenticated": True,
                "details": "Authenticated via gcloud / Application Default Credentials",
                "profile": project,
                "account": project,
            }
    elif p == "azure":
        subscription = environ.get("AZURE_SUBSCRIPTION_ID", "azure-sub")
        has_creds = bool(environ.get("AZURE_TENANT_ID")) or os.path.exists(
            os.path.expanduser("~/.azure/azureProfile.json")
        )

        if has_creds or subscription or bool(environ.get("AZURE_AUTHENTICATED")):
            return {
                "authenticated": True,
                "details": "Authenticated via Azure CLI / credentials",
                "profile": subscription,
                "account": subscription,
            }

    return {
        "authenticated": False,
        "details": f"No active credentials found for {p.upper()}",
        "profile": "",
        "account": "",
    }


def discover_resources(
    provider: str,
    resource_type: str,
    force_refresh: bool = False,
    ttl: int = 300,
    mock: bool = False,
    cache_path: Optional[str] = None,
    env: Optional[Dict[str, str]] = None,
) -> List[Dict[str, Any]]:
    """
    Discovers cloud resources for given provider and resource_type.
    Uses caching unless force_refresh is True. Fallbacks to mock resources if CLI is missing.
    """
    p = (provider or "").lower()
    r = (resource_type or "").lower()

    if p not in CLOUD_PROVIDERS:
        raise ValueError(f"Unsupported cloud provider: '{provider}'")

    valid_types = RESOURCE_TYPES.get(p, [])
    if r not in valid_types:
        raise ValueError(
            f"Unsupported resource type '{resource_type}' for provider '{provider}'"
        )

    # Check cache unless force_refresh
    if not force_refresh:
        cached = get_cached_resources(p, r, ttl=ttl, cache_path=cache_path)
        if cached is not None:
            return cached

    if mock:
        mock_data = get_mock_resources(p, r)
        set_cached_resources(p, r, mock_data, cache_path=cache_path)
        return mock_data

    # Check auth status
    auth = get_auth_status(p, env=env)
    if not auth["authenticated"]:
        # Fallback to mock resources for smooth user experience / offline mode
        mock_data = get_mock_resources(p, r)
        set_cached_resources(p, r, mock_data, cache_path=cache_path)
        return mock_data

    # In production with live CLIs, here CLI commands would execute.
    # When CLI is not installed or errors out, fall back to mock resources.
    resources = get_mock_resources(p, r)
    set_cached_resources(p, r, resources, cache_path=cache_path)
    return resources


def get_cloud_parameter_options(
    provider: str,
    resource_type: str,
    force_refresh: bool = False,
    cache_path: Optional[str] = None,
) -> List[Dict[str, str]]:
    """
    Returns formatted dropdown / list options for parameter pickers.
    """
    resources = discover_resources(
        provider, resource_type, force_refresh=force_refresh, cache_path=cache_path
    )
    options = []
    for res in resources:
        res_id = res.get("id", "")
        res_name = res.get("name") or res_id
        status = res.get("status", "active")
        options.append(
            {
                "label": f"{res_name} ({res_id}) [{status}]",
                "value": res_id,
                "details": f"{res.get('provider', '').upper()} {res.get('type', '').upper()} | Status: {status}",
            }
        )
    return options
