"""
Performance benchmarks for CmdBar Web Dashboard.
:visibility: public
"""

import time
import json
import threading
import urllib.request
import pytest
from companion.dashboard_server import merge_configs_structural, run_dashboard_server

TEST_PERF_PORT = 8090

@pytest.fixture(scope="module", autouse=True)
def start_perf_server():
    """
    Spawns background server for performance benchmarking.
    :visibility: public
    """
    server_thread = threading.Thread(
        target=run_dashboard_server,
        kwargs={"port": TEST_PERF_PORT},
        daemon=True
    )
    server_thread.start()
    time.sleep(0.3)
    yield

def test_api_latency_benchmark():
    """
    Benchmarks API endpoint response latency to ensure < 50ms average response time.
    :visibility: public
    """
    url = f"http://localhost:{TEST_PERF_PORT}/api/config"
    latencies = []

    for _ in range(20):
        start = time.perf_counter()
        with urllib.request.urlopen(url) as resp:
            assert resp.status == 200
            resp.read()
        elapsed_ms = (time.perf_counter() - start) * 1000.0
        latencies.append(elapsed_ms)

    avg_latency = sum(latencies) / len(latencies)
    assert avg_latency < 50.0, f"Average API latency too high: {avg_latency:.2f}ms"

def test_structural_merge_performance_benchmark():
    """
    Benchmarks structural config merge performance for large configurations (1000 items).
    :visibility: public
    """
    large_local = {
        "categories": [
            {
                "name": f"Cat_{i}",
                "commands": [{"name": f"Cmd_{j}", "command": f"echo {j}"} for j in range(10)]
            }
            for i in range(50)
        ]
    }

    large_remote = {
        "categories": [
            {
                "name": f"Cat_{i}",
                "commands": [{"name": f"Cmd_{j}", "command": f"echo {j}"} for j in range(5, 15)]
            }
            for i in range(25, 75)
        ]
    }

    start = time.perf_counter()
    merged = merge_configs_structural(large_local, large_remote)
    elapsed_ms = (time.perf_counter() - start) * 1000.0

    assert elapsed_ms < 100.0, f"Large config merge took too long: {elapsed_ms:.2f}ms"
    assert len(merged["categories"]) == 75
