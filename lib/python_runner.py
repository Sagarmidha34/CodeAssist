"""Restricted Python runner for CodeAssist's small-task agent workflow.

The syntax allowlist and process resource limits make the teaching runner
safer, but this is not a hardened multi-tenant sandbox. Deploy only behind the
authenticated, quota-limited application and keep the process private.
"""
import ast
import contextlib
import io
import json
import resource
import sys

MAX_SOURCE = 12_000
MAX_INPUT = 2_000
MAX_OUTPUT = 4_000
SAFE_BUILTINS = {
    "print": print, "input": input, "int": int, "float": float,
    "str": str, "bool": bool, "len": len, "sum": sum, "min": min,
    "max": max, "range": range, "abs": abs, "round": round,
    "sorted": sorted, "reversed": reversed,
    "enumerate": enumerate, "zip": zip, "map": map, "list": list, "tuple": tuple,
    "set": set, "all": all, "any": any,
    "Exception": Exception, "ArithmeticError": ArithmeticError,
    "ValueError": ValueError, "TypeError": TypeError,
    "IndexError": IndexError, "KeyError": KeyError,
    "ZeroDivisionError": ZeroDivisionError, "RuntimeError": RuntimeError,
}
ALLOWED = (
    ast.Module, ast.Expr, ast.Assign, ast.AugAssign, ast.If, ast.For, ast.Try,
    ast.ExceptHandler, ast.Raise, ast.Attribute,
    ast.Break, ast.Continue, ast.Pass, ast.FunctionDef, ast.Return,
    ast.arguments, ast.arg, ast.Name, ast.Load, ast.Store, ast.Constant,
    ast.List, ast.Tuple, ast.Dict, ast.Set, ast.Subscript, ast.Slice,
    ast.BinOp, ast.UnaryOp, ast.BoolOp, ast.Compare, ast.IfExp, ast.Call,
    ast.keyword, ast.Add, ast.Sub, ast.Mult, ast.Div, ast.FloorDiv,
    ast.Mod, ast.Pow, ast.USub, ast.UAdd, ast.Not, ast.And, ast.Or,
    ast.Eq, ast.NotEq, ast.Lt, ast.LtE, ast.Gt, ast.GtE, ast.In,
    ast.NotIn, ast.Is, ast.IsNot, ast.ListComp, ast.comprehension,
)
SAFE_METHODS = {
    "append", "copy", "count", "extend", "index", "insert", "join",
    "lower", "lstrip", "pop", "remove", "replace", "reverse", "rstrip",
    "sort", "split", "splitlines", "startswith", "strip", "upper",
}

def apply_limits():
    def limit_soft(resource_id, target):
        _soft, hard = resource.getrlimit(resource_id)
        effective = target if hard == resource.RLIM_INFINITY else min(target, hard)
        try:
            resource.setrlimit(resource_id, (effective, hard))
        except (ValueError, OSError):
            # Some macOS limits report a sentinel hard cap that cannot be
            # written back; the other process controls still apply.
            pass

    limit_soft(resource.RLIMIT_CPU, 2)
    limit_soft(resource.RLIMIT_FSIZE, 1_000_000)
    limit_soft(resource.RLIMIT_NOFILE, 16)
    if hasattr(resource, "RLIMIT_AS"):
        limit_soft(resource.RLIMIT_AS, 512 * 1024 * 1024)

class LimitedOutput(io.StringIO):
    def write(self, value):
        if self.tell() + len(value) > MAX_OUTPUT:
            raise RuntimeError("Output exceeded the 4,000 character limit.")
        return super().write(value)

def run(source, input_text):
    if not isinstance(source, str) or len(source) > MAX_SOURCE:
        return {"ok": False, "stdout": "", "error": "Code exceeds the 12,000 character limit."}
    if not isinstance(input_text, str) or len(input_text) > MAX_INPUT:
        return {"ok": False, "stdout": "", "error": "Test input exceeds the 2,000 character limit."}
    try:
        tree = ast.parse(source)
        functions = {n.name for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)}
        for node in ast.walk(tree):
            if not isinstance(node, ALLOWED):
                raise ValueError(f"Blocked Python construct: {type(node).__name__}.")
            if isinstance(node, ast.Call):
                is_safe_name = isinstance(node.func, ast.Name) and (node.func.id in SAFE_BUILTINS or node.func.id in functions)
                is_safe_method = isinstance(node.func, ast.Attribute) and node.func.attr in SAFE_METHODS
                if not is_safe_name and not is_safe_method:
                    raise ValueError("Only basic built-ins and functions defined in this file may be called.")
            if isinstance(node, ast.Attribute) and node.attr not in SAFE_METHODS:
                raise ValueError("Only approved string and list methods may be accessed.")
            if isinstance(node, ast.Name) and node.id.startswith("__"):
                raise ValueError("Names beginning with double underscores are blocked.")
        safe_globals = {"__builtins__": SAFE_BUILTINS}
        captured = LimitedOutput()
        old_stdin = sys.stdin
        sys.stdin = io.StringIO(input_text)
        try:
            with contextlib.redirect_stdout(captured):
                exec(compile(tree, "<codeassist>", "exec"), safe_globals, safe_globals)
        finally:
            sys.stdin = old_stdin
        return {"ok": True, "stdout": captured.getvalue().strip(), "error": ""}
    except Exception as exc:
        return {"ok": False, "stdout": "", "error": f"{type(exc).__name__}: {exc}"[:400]}

def main():
    try:
        apply_limits()
        payload = json.loads(sys.stdin.read(100_000))
        result = run(payload.get("code", ""), payload.get("input", ""))
    except BaseException as exc:
        result = {"ok": False, "stdout": "", "error": f"Runner error: {type(exc).__name__}: {exc}"[:400]}
    sys.__stdout__.write(json.dumps(result))

if __name__ == "__main__":
    main()
