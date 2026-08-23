"""
Pytest unit test suite for CmdBar Cloud Services Integration module (companion/cloud_providers.py).
"""

import os
import tempfile
import time
import pytest

from companion.cloud_providers import (
    CLOUD_PROVIDERS,
    RESOURCE_TYPES,
    get_mock_resources,
    get_auth_status,
    discover_resources,
    get_cached_resources,
    set_cached_resources,
    load_cloud_cache,
    save_cloud_cache,
    clear_cloud_cache,
    get_cloud_parameter_options,
)


@pytest.fixture
def temp_cache_file():
    with tempfile.TemporaryDirectory() as tmp_dir:
        yield os.path.join(tmp_dir, "cloud_cache.json")


def test_cloud_providers_constants():
    assert "aws" in CLOUD_PROVIDERS
    assert "gcp" in CLOUD_PROVIDERS
    assert "azure" in CLOUD_PROVIDERS

    assert "ec2" in RESOURCE_TYPES["aws"]
    assert "s3" in RESOURCE_TYPES["aws"]
    assert "lambda" in RESOURCE_TYPES["aws"]

    assert "gce" in RESOURCE_TYPES["gcp"]
    assert "cloud_run" in RESOURCE_TYPES["gcp"]

    assert "vm" in RESOURCE_TYPES["azure"]
    assert "functions" in RESOURCE_TYPES["azure"]


def test_mock_resources_aws():
    ec2 = get_mock_resources("aws", "ec2")
    assert len(ec2) > 0
    assert ec2[0]["type"] == "ec2"
    assert ec2[0]["id"].startswith("i-")

    s3 = get_mock_resources("aws", "s3")
    assert len(s3) > 0
    assert s3[0]["type"] == "s3"

    lambdas = get_mock_resources("aws", "lambda")
    assert len(lambdas) > 0
    assert lambdas[0]["type"] == "lambda"


def test_mock_resources_gcp():
    gce = get_mock_resources("gcp", "gce")
    assert len(gce) > 0
    assert gce[0]["type"] == "gce"

    cloud_run = get_mock_resources("gcp", "cloud_run")
    assert len(cloud_run) > 0
    assert cloud_run[0]["type"] == "cloud_run"


def test_mock_resources_azure():
    vms = get_mock_resources("azure", "vm")
    assert len(vms) > 0
    assert vms[0]["type"] == "vm"

    funcs = get_mock_resources("azure", "functions")
    assert len(funcs) > 0
    assert funcs[0]["type"] == "functions"


def test_auth_status_evaluation():
    aws_auth = get_auth_status(
        "aws", env={"AWS_ACCESS_KEY_ID": "k", "AWS_SECRET_ACCESS_KEY": "s"}
    )
    assert aws_auth["authenticated"] is True

    gcp_auth = get_auth_status(
        "gcp", env={"GOOGLE_APPLICATION_CREDENTIALS": "/path/creds.json"}
    )
    assert gcp_auth["authenticated"] is True

    azure_auth = get_auth_status("azure", env={"AZURE_SUBSCRIPTION_ID": "sub-id"})
    assert azure_auth["authenticated"] is True


def test_caching_layer(temp_cache_file):
    sample = [{"id": "i-test", "name": "test-vm", "status": "running"}]
    set_cached_resources("aws", "ec2", sample, cache_path=temp_cache_file)

    cached = get_cached_resources("aws", "ec2", ttl=300, cache_path=temp_cache_file)
    assert cached == sample

    # Test TTL expiration
    expired_cache = {
        "aws:ec2": {
            "timestamp": time.time() - 1000,
            "resources": [{"id": "i-old"}],
        }
    }
    save_cloud_cache(expired_cache, cache_path=temp_cache_file)
    assert (
        get_cached_resources("aws", "ec2", ttl=300, cache_path=temp_cache_file) is None
    )


def test_clear_cache(temp_cache_file):
    set_cached_resources("aws", "s3", [{"id": "bucket-1"}], cache_path=temp_cache_file)
    clear_cloud_cache(cache_path=temp_cache_file)
    assert (
        get_cached_resources("aws", "s3", ttl=300, cache_path=temp_cache_file) is None
    )


def test_discover_resources(temp_cache_file):
    res = discover_resources("aws", "ec2", mock=True, cache_path=temp_cache_file)
    assert len(res) > 0
    assert res[0]["id"].startswith("i-")

    # Cached
    cached = get_cached_resources("aws", "ec2", ttl=300, cache_path=temp_cache_file)
    assert cached == res


def test_discover_resources_invalid_provider():
    with pytest.raises(ValueError):
        discover_resources("invalid_provider", "ec2")


def test_discover_resources_invalid_type():
    with pytest.raises(ValueError):
        discover_resources("aws", "invalid_type")


def test_get_cloud_parameter_options(temp_cache_file):
    options = get_cloud_parameter_options("aws", "ec2", cache_path=temp_cache_file)
    assert len(options) > 0
    assert "label" in options[0]
    assert "value" in options[0]
    assert options[0]["value"].startswith("i-")
