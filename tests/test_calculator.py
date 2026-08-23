"""
Pytest unit tests for CmdBar companion calculator module.
"""

import math
import pytest
from companion.calculator import (
    is_calculator_query,
    clean_calculator_query,
    evaluate_calculator_query,
    calculate,
    normalize_currency,
    format_number,
    convert_temperature,
)


def test_is_calculator_query():
    assert is_calculator_query("> 2+2") is True
    assert is_calculator_query(" > sin(pi/2)") is True
    assert is_calculator_query("2+2") is False
    assert is_calculator_query("") is False
    assert is_calculator_query(None) is False


def test_clean_calculator_query():
    assert clean_calculator_query("> 2+2") == "2+2"
    assert clean_calculator_query(" > sin(pi/2) ") == "sin(pi/2)"
    assert clean_calculator_query("2+2") == "2+2"


def test_format_number():
    assert format_number(42.0) == "42"
    assert format_number(0.1 + 0.2) == "0.3"
    assert format_number(3.14159) == "3.14159"


def test_math_expressions():
    res1 = calculate("> 2 + 2")
    assert res1["success"] is True
    assert res1["result"] == "4"

    res2 = calculate("> sin(pi/2)")
    assert res2["success"] is True
    assert float(res2["result"]) == pytest.approx(1.0)

    res3 = calculate("> 2 ^ 10")
    assert res3["success"] is True
    assert res3["result"] == "1024"

    res4 = calculate("> 5!")
    assert res4["success"] is True
    assert res4["result"] == "120"


def test_unit_conversions():
    res1 = calculate("> 10 km to miles")
    assert res1["success"] is True
    assert res1["type"] == "unit"
    assert res1["numeric_value"] == pytest.approx(6.21371, rel=1e-3)

    res2 = calculate("> 100 C to F")
    assert res2["success"] is True
    assert res2["numeric_value"] == 212.0

    res3 = calculate("> 1 GB in MB")
    assert res3["success"] is True
    assert res3["numeric_value"] == 1024.0


def test_currency_conversions():
    res1 = calculate("> 100 USD to EUR")
    assert res1["success"] is True
    assert res1["type"] == "currency"
    assert res1["numeric_value"] == 92.0
    assert res1["result"] == "92 EUR"


def test_error_handling():
    res1 = calculate("> 10 / 0")
    assert res1["success"] is False

    res2 = calculate("> 10 km to kg")
    assert res2["success"] is False

    res3 = calculate(">")
    assert res3["success"] is False
