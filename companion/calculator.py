"""
Quick Calculator and Eval Mode module for CmdBar Companion.
Evaluates mathematical expressions, unit conversions, and currency conversions safely offline.
"""

import math
import re

# Offline Currency Exchange Rates relative to base currency USD
CURRENCY_RATES = {
    "USD": 1.0,
    "EUR": 0.92,
    "GBP": 0.79,
    "JPY": 155.0,
    "CAD": 1.36,
    "AUD": 1.52,
    "CHF": 0.90,
    "CNY": 7.23,
    "INR": 83.5,
    "BRL": 5.15,
    "RUB": 90.0,
    "KRW": 1370.0,
    "SGD": 1.35,
    "NZD": 1.65,
    "HKD": 7.82,
    "MXN": 16.8,
    "SEK": 10.7,
    "NOK": 10.6,
    "TRY": 32.2,
    "AED": 3.67,
    "SAR": 3.75,
}

# Unit Conversion Definitions relative to standard base units
UNIT_DEFINITIONS = {
    # Length (base: meters 'm')
    "m": {"category": "length", "factor": 1.0, "name": "meters"},
    "meter": {"category": "length", "factor": 1.0, "name": "meters"},
    "meters": {"category": "length", "factor": 1.0, "name": "meters"},
    "km": {"category": "length", "factor": 1000.0, "name": "kilometers"},
    "kilometer": {"category": "length", "factor": 1000.0, "name": "kilometers"},
    "kilometers": {"category": "length", "factor": 1000.0, "name": "kilometers"},
    "cm": {"category": "length", "factor": 0.01, "name": "centimeters"},
    "centimeter": {"category": "length", "factor": 0.01, "name": "centimeters"},
    "centimeters": {"category": "length", "factor": 0.01, "name": "centimeters"},
    "mm": {"category": "length", "factor": 0.001, "name": "millimeters"},
    "millimeter": {"category": "length", "factor": 0.001, "name": "millimeters"},
    "millimeters": {"category": "length", "factor": 0.001, "name": "millimeters"},
    "mi": {"category": "length", "factor": 1609.344, "name": "miles"},
    "mile": {"category": "length", "factor": 1609.344, "name": "miles"},
    "miles": {"category": "length", "factor": 1609.344, "name": "miles"},
    "ft": {"category": "length", "factor": 0.3048, "name": "feet"},
    "foot": {"category": "length", "factor": 0.3048, "name": "feet"},
    "feet": {"category": "length", "factor": 0.3048, "name": "feet"},
    "in": {"category": "length", "factor": 0.0254, "name": "inches"},
    "inch": {"category": "length", "factor": 0.0254, "name": "inches"},
    "inches": {"category": "length", "factor": 0.0254, "name": "inches"},
    "yd": {"category": "length", "factor": 0.9144, "name": "yards"},
    "yard": {"category": "length", "factor": 0.9144, "name": "yards"},
    "yards": {"category": "length", "factor": 0.9144, "name": "yards"},

    # Mass (base: kilograms 'kg')
    "kg": {"category": "mass", "factor": 1.0, "name": "kilograms"},
    "kilogram": {"category": "mass", "factor": 1.0, "name": "kilograms"},
    "kilograms": {"category": "mass", "factor": 1.0, "name": "kilograms"},
    "g": {"category": "mass", "factor": 0.001, "name": "grams"},
    "gram": {"category": "mass", "factor": 0.001, "name": "grams"},
    "grams": {"category": "mass", "factor": 0.001, "name": "grams"},
    "mg": {"category": "mass", "factor": 0.000001, "name": "milligrams"},
    "milligram": {"category": "mass", "factor": 0.000001, "name": "milligrams"},
    "milligrams": {"category": "mass", "factor": 0.000001, "name": "milligrams"},
    "lb": {"category": "mass", "factor": 0.45359237, "name": "pounds"},
    "lbs": {"category": "mass", "factor": 0.45359237, "name": "pounds"},
    "pound": {"category": "mass", "factor": 0.45359237, "name": "pounds"},
    "pounds": {"category": "mass", "factor": 0.45359237, "name": "pounds"},
    "oz": {"category": "mass", "factor": 0.028349523125, "name": "ounces"},
    "ounce": {"category": "mass", "factor": 0.028349523125, "name": "ounces"},
    "ounces": {"category": "mass", "factor": 0.028349523125, "name": "ounces"},

    # Temperature
    "c": {"category": "temperature", "name": "Celsius"},
    "celsius": {"category": "temperature", "name": "Celsius"},
    "f": {"category": "temperature", "name": "Fahrenheit"},
    "fahrenheit": {"category": "temperature", "name": "Fahrenheit"},
    "k": {"category": "temperature", "name": "Kelvin"},
    "kelvin": {"category": "temperature", "name": "Kelvin"},

    # Data / Storage (base: bits)
    "b": {"category": "data", "factor": 1.0, "name": "bits"},
    "bit": {"category": "data", "factor": 1.0, "name": "bits"},
    "bits": {"category": "data", "factor": 1.0, "name": "bits"},
    "B": {"category": "data", "factor": 8.0, "name": "bytes"},
    "byte": {"category": "data", "factor": 8.0, "name": "bytes"},
    "bytes": {"category": "data", "factor": 8.0, "name": "bytes"},
    "kb": {"category": "data", "factor": 8 * 1024, "name": "KB"},
    "kilobyte": {"category": "data", "factor": 8 * 1024, "name": "KB"},
    "kilobytes": {"category": "data", "factor": 8 * 1024, "name": "KB"},
    "mb": {"category": "data", "factor": 8 * 1024 * 1024, "name": "MB"},
    "megabyte": {"category": "data", "factor": 8 * 1024 * 1024, "name": "MB"},
    "megabytes": {"category": "data", "factor": 8 * 1024 * 1024, "name": "MB"},
    "gb": {"category": "data", "factor": 8 * 1024 * 1024 * 1024, "name": "GB"},
    "gigabyte": {"category": "data", "factor": 8 * 1024 * 1024 * 1024, "name": "GB"},
    "gigabytes": {"category": "data", "factor": 8 * 1024 * 1024 * 1024, "name": "GB"},
    "tb": {"category": "data", "factor": 8 * 1024 * 1024 * 1024 * 1024, "name": "TB"},
    "terabyte": {"category": "data", "factor": 8 * 1024 * 1024 * 1024 * 1024, "name": "TB"},
    "terabytes": {"category": "data", "factor": 8 * 1024 * 1024 * 1024 * 1024, "name": "TB"},

    # Time (base: seconds)
    "ms": {"category": "time", "factor": 0.001, "name": "milliseconds"},
    "s": {"category": "time", "factor": 1.0, "name": "seconds"},
    "sec": {"category": "time", "factor": 1.0, "name": "seconds"},
    "second": {"category": "time", "factor": 1.0, "name": "seconds"},
    "seconds": {"category": "time", "factor": 1.0, "name": "seconds"},
    "min": {"category": "time", "factor": 60.0, "name": "minutes"},
    "minute": {"category": "time", "factor": 60.0, "name": "minutes"},
    "minutes": {"category": "time", "factor": 60.0, "name": "minutes"},
    "h": {"category": "time", "factor": 3600.0, "name": "hours"},
    "hr": {"category": "time", "factor": 3600.0, "name": "hours"},
    "hour": {"category": "time", "factor": 3600.0, "name": "hours"},
    "hours": {"category": "time", "factor": 3600.0, "name": "hours"},
    "d": {"category": "time", "factor": 86400.0, "name": "days"},
    "day": {"category": "time", "factor": 86400.0, "name": "days"},
    "days": {"category": "time", "factor": 86400.0, "name": "days"},

    # Speed (base: m/s)
    "m/s": {"category": "speed", "factor": 1.0, "name": "m/s"},
    "km/h": {"category": "speed", "factor": 1 / 3.6, "name": "km/h"},
    "kph": {"category": "speed", "factor": 1 / 3.6, "name": "km/h"},
    "mph": {"category": "speed", "factor": 0.44704, "name": "mph"},
}


def is_calculator_query(text: str) -> bool:
    """
    Checks if text input starts with '>' trigger prefix.
    """
    if not text or not isinstance(text, str):
        return False
    return text.strip().startswith(">")


def clean_calculator_query(text: str) -> str:
    """
    Strips '>' trigger prefix from query string.
    """
    if not text or not isinstance(text, str):
        return ""
    return re.sub(r"^\s*>\s*", "", text).strip()


def normalize_currency(code: str) -> str:
    """
    Normalizes currency symbol or string to standard uppercase code.
    """
    if not code:
        return ""
    s = code.strip().upper()
    symbols = {"$": "USD", "€": "EUR", "£": "GBP", "¥": "JPY", "₹": "INR"}
    if s in symbols:
        return symbols[s]
    if s in CURRENCY_RATES:
        return s
    return ""


def format_number(val: float) -> str:
    """
    Formats float into clean string without precision artifacts.
    """
    if math.isnan(val):
        return "NaN"
    if math.isinf(val):
        return "Infinity" if val > 0 else "-Infinity"
    rounded = round(val, 10)
    if rounded == int(rounded):
        return str(int(rounded))
    return str(rounded)


def convert_temperature(val: float, from_unit: str, to_unit: str) -> float:
    """
    Converts temperature value between Celsius, Fahrenheit, and Kelvin.
    """
    f = from_unit.lower()
    t = to_unit.lower()

    if f in ("c", "celsius"):
        celsius = val
    elif f in ("f", "fahrenheit"):
        celsius = (val - 32) * (5 / 9)
    elif f in ("k", "kelvin"):
        celsius = val - 273.15
    else:
        raise ValueError(f"Unknown temperature unit {from_unit}")

    if t in ("c", "celsius"):
        return celsius
    elif t in ("f", "fahrenheit"):
        return celsius * (9 / 5) + 32
    elif t in ("k", "kelvin"):
        return celsius + 273.15
    else:
        raise ValueError(f"Unknown temperature unit {to_unit}")


def _safe_factorial(n):
    n_int = int(n)
    if n_int < 0:
        raise ValueError("Factorial of negative number")
    return float(math.factorial(n_int))


def _evaluate_math_expression_py(expr: str) -> float:
    """
    Safe AST evaluator for Python math expressions.
    """
    import ast

    allowed_names = {
        "pi": math.pi,
        "e": math.e,
        "tau": getattr(math, "tau", 2 * math.pi),
        "phi": 1.618033988749895,
        "sin": math.sin,
        "cos": math.cos,
        "tan": math.tan,
        "asin": math.asin,
        "acos": math.acos,
        "atan": math.atan,
        "sqrt": math.sqrt,
        "cbrt": lambda x: math.pow(x, 1 / 3) if x >= 0 else -math.pow(-x, 1 / 3),
        "abs": abs,
        "log": math.log,
        "ln": math.log,
        "log10": math.log10,
        "log2": math.log2,
        "exp": math.exp,
        "floor": math.floor,
        "ceil": math.ceil,
        "round": round,
        "pow": math.pow,
        "min": min,
        "max": max,
        "fact": _safe_factorial,
        "factorial": _safe_factorial,
    }

    clean_expr = expr.replace("^", "**")
    clean_expr = re.sub(r"(\d+|[a-zA-Z_]\w*|\([^)]+\))!", r"fact(\1)", clean_expr)

    node = ast.parse(clean_expr, mode="eval")

    def _eval(node):
        if isinstance(node, ast.Expression):
            return _eval(node.body)
        elif isinstance(node, ast.Constant):
            if isinstance(node.value, (int, float)):
                return float(node.value)
            raise ValueError(f"Invalid constant {node.value}")
        elif isinstance(node, ast.UnaryOp):
            val = _eval(node.operand)
            if isinstance(node.op, ast.UAdd):
                return +val
            elif isinstance(node.op, ast.USub):
                return -val
            raise ValueError(f"Unsupported unary operator {node.op}")
        elif isinstance(node, ast.BinOp):
            left = _eval(node.left)
            right = _eval(node.right)
            if isinstance(node.op, ast.Add):
                return left + right
            elif isinstance(node.op, ast.Sub):
                return left - right
            elif isinstance(node.op, ast.Mult):
                return left * right
            elif isinstance(node.op, ast.Div):
                if right == 0:
                    raise ZeroDivisionError("Division by zero")
                return left / right
            elif isinstance(node.op, ast.Mod):
                if right == 0:
                    raise ZeroDivisionError("Division by zero")
                return left % right
            elif isinstance(node.op, ast.Pow):
                return math.pow(left, right)
            raise ValueError(f"Unsupported binary operator {node.op}")
        elif isinstance(node, ast.Name):
            name = node.id.lower()
            if name in allowed_names:
                val = allowed_names[name]
                if isinstance(val, (int, float)):
                    return float(val)
            raise ValueError(f"Unknown variable '{node.id}'")
        elif isinstance(node, ast.Call):
            if not isinstance(node.func, ast.Name):
                raise ValueError("Only direct function calls are allowed")
            func_name = node.func.id.lower()
            if func_name not in allowed_names:
                raise ValueError(f"Unknown function '{node.func.id}'")
            func = allowed_names[func_name]
            args = [_eval(arg) for arg in node.args]
            return float(func(*args))
        else:
            raise ValueError(f"Unsupported expression node {type(node)}")

    return _eval(node)


def evaluate_calculator_query(raw_query: str) -> dict:
    """
    Evaluates math expressions, unit conversions, or currency conversions.
    """
    if not raw_query or not isinstance(raw_query, str):
        return {"success": False, "error": "Empty query"}

    query = clean_calculator_query(raw_query)
    if not query:
        return {"success": False, "error": "Empty query"}

    match_two = re.match(r"^(.*?)\s+(?:to|in)\s+([a-zA-Z\/$%€£¥₹]+)$", query, flags=re.IGNORECASE)
    amount_expr_str = ""
    from_str = ""
    to_str = ""

    if match_two:
        raw_amount_from = match_two.group(1).strip()
        to_str = match_two.group(2).strip()

        symbol_match = re.match(r"^([$%€£¥₹])\s*(.*)$", raw_amount_from)
        if symbol_match:
            from_str = symbol_match.group(1)
            amount_expr_str = symbol_match.group(2)
        else:
            last_space = raw_amount_from.rfind(" ")
            if last_space != -1:
                amount_expr_str = raw_amount_from[:last_space].strip()
                from_str = raw_amount_from[last_space + 1 :].strip()
            else:
                amount_expr_str = raw_amount_from

    if amount_expr_str and to_str:
        try:
            amount = _evaluate_math_expression_py(amount_expr_str)
        except Exception:
            try:
                amount = float(amount_expr_str)
            except Exception:
                amount = None

        if amount is not None and not math.isnan(amount):
            from_curr = normalize_currency(from_str)
            to_curr = normalize_currency(to_str)

            if from_curr in CURRENCY_RATES and to_curr in CURRENCY_RATES:
                usd_val = amount / CURRENCY_RATES[from_curr]
                converted = round(usd_val * CURRENCY_RATES[to_curr], 10)
                formatted_val = format_number(converted)
                res_str = f"{formatted_val} {to_curr}"
                return {
                    "success": True,
                    "type": "currency",
                    "expression": query,
                    "result": res_str,
                    "numeric_value": converted,
                    "formatted": f"= {res_str}",
                }

            from_def = UNIT_DEFINITIONS.get(from_str.lower())
            to_def = UNIT_DEFINITIONS.get(to_str.lower())

            if from_def and to_def:
                if from_def["category"] != to_def["category"]:
                    return {
                        "success": False,
                        "error": f"Cannot convert between {from_def['category']} and {to_def['category']}",
                    }

                if from_def["category"] == "temperature":
                    converted = round(convert_temperature(amount, from_str, to_str), 10)
                else:
                    base_val = amount * from_def["factor"]
                    converted = round(base_val / to_def["factor"], 10)

                formatted_val = format_number(converted)
                res_str = f"{formatted_val} {to_def.get('name', to_str)}"
                return {
                    "success": True,
                    "type": "unit",
                    "expression": query,
                    "result": res_str,
                    "numeric_value": converted,
                    "formatted": f"= {res_str}",
                }

    try:
        val = _evaluate_math_expression_py(query)
        rounded_val = round(val, 10)
        formatted_val = format_number(rounded_val)
        return {
            "success": True,
            "type": "math",
            "expression": query,
            "result": formatted_val,
            "numeric_value": rounded_val,
            "formatted": f"= {formatted_val}",
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
        }


calculate = evaluate_calculator_query
