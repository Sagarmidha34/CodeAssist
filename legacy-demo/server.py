"""CodeAssist: small, offline-first demonstration server.

This is a teaching prototype, not a production sandbox. Generated code is run
in a temporary directory with a timeout and a conservative AST allowlist.
"""
from __future__ import annotations

import ast
import json
import os
import subprocess
import sys
import tempfile
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

ROOT = Path(__file__).parent
MAX_BODY = 40_000
MAX_REPAIRS = 1

TASKS: dict[str, dict[str, Any]] = {
    "average": {
        "title": "Average of marks", "description": "Read five numeric marks and print their average.",
        "input": "10\n20\n30\n40\n50\n", "expected": "30.0",
        "code": 'marks = [float(input()) for _ in range(5)]\nprint(sum(marks) / len(marks))\n',
        "requirements": ["Read exactly five numbers", "Compute their arithmetic mean", "Print one numeric result"],
    },
    "factorial": {
        "title": "Factorial", "description": "Read a non-negative integer and print its factorial.",
        "input": "5\n", "expected": "120",
        "code": 'n = int(input())\nresult = 1\nfor value in range(2, n + 1):\n    result *= value\nprint(result)\n',
        "requirements": ["Read a non-negative integer", "Multiply integers from 1 through n", "Print 1 for input 0"],
    },
    "prime": {
        "title": "Prime check", "description": "Read an integer and print Prime or Not prime.",
        "input": "17\n", "expected": "Prime",
        "code": 'n = int(input())\nis_prime = n >= 2\nfor divisor in range(2, n):\n    if n % divisor == 0:\n        is_prime = False\n        break\nprint("Prime" if is_prime else "Not prime")\n',
        "requirements": ["Integers below 2 are not prime", "Check divisibility", "Print Prime or Not prime"],
    },
    "palindrome": {
        "title": "Palindrome check", "description": "Read a word and print Palindrome or Not palindrome.",
        "input": "level\n", "expected": "Palindrome",
        "code": 'word = input().strip()\nprint("Palindrome" if word == word[::-1] else "Not palindrome")\n',
        "requirements": ["Read a word", "Compare it with its reverse", "Print Palindrome or Not palindrome"],
    },
    "sum": {
        "title": "Sum of two numbers", "description": "Read two integers and print their sum.",
        "input": "12\n8\n", "expected": "20",
        "code": 'first = int(input())\nsecond = int(input())\nprint(first + second)\n',
        "requirements": ["Read two integers", "Add them", "Print the sum"],
    },
}

class UnsafeCode(ValueError):
    pass

ALLOWED_NODES = (
    ast.Module, ast.Expr, ast.Assign, ast.AugAssign, ast.If, ast.For, ast.Break,
    ast.Continue, ast.Pass, ast.Name, ast.Load, ast.Store, ast.Constant,
    ast.List, ast.Tuple, ast.Dict, ast.Set, ast.Subscript, ast.Slice,
    ast.BinOp, ast.UnaryOp, ast.BoolOp, ast.Compare, ast.IfExp, ast.Call,
    ast.keyword, ast.Add, ast.Sub, ast.Mult, ast.Div, ast.FloorDiv, ast.Mod,
    ast.Pow, ast.USub, ast.UAdd, ast.Not, ast.And, ast.Or, ast.Eq, ast.NotEq,
    ast.Lt, ast.LtE, ast.Gt, ast.GtE, ast.In, ast.NotIn, ast.Is, ast.IsNot,
    ast.ListComp, ast.comprehension, ast.Load, ast.Store,
)
SAFE_CALLS = {"print", "input", "int", "float", "str", "bool", "len", "sum", "min", "max", "range", "abs", "round", "enumerate"}

def validate_code(source: str) -> None:
    if len(source) > 12_000:
        raise UnsafeCode("Code is too long (12,000 character limit).")
    try:
        tree = ast.parse(source)
    except SyntaxError as exc:
        raise UnsafeCode(f"Syntax error on line {exc.lineno}: {exc.msg}") from exc
    for node in ast.walk(tree):
        if not isinstance(node, ALLOWED_NODES):
            raise UnsafeCode(f"Blocked Python construct: {type(node).__name__}.")
        if isinstance(node, ast.Call) and (not isinstance(node.func, ast.Name) or node.func.id not in SAFE_CALLS):
            raise UnsafeCode("Only basic input, output, numeric, and collection functions are allowed.")
        if isinstance(node, ast.Name) and (node.id.startswith("__") or node.id in {"open", "eval", "exec", "compile", "globals", "locals", "getattr", "setattr", "delattr", "__import__"}):
            raise UnsafeCode(f"Blocked name: {node.id}.")

def execute_case(source: str, stdin: str) -> dict[str, Any]:
    validate_code(source)
    with tempfile.TemporaryDirectory(prefix="codeassist-") as tmp:
        path = Path(tmp) / "solution.py"
        path.write_text(source, encoding="utf-8")
        env = {"PATH": os.environ.get("PATH", ""), "PYTHONIOENCODING": "utf-8"}
        try:
            proc = subprocess.run(
                [sys.executable, "-I", "-S", str(path)], input=stdin, text=True,
                capture_output=True, timeout=3, cwd=tmp, env=env,
                preexec_fn=_limits if os.name == "posix" else None,
            )
        except subprocess.TimeoutExpired:
            return {"passed": False, "stdout": "", "stderr": "Execution timed out after 3 seconds."}
        out = proc.stdout.strip()
        if len(out) > 4_000:
            return {"passed": False, "stdout": out[:4_000], "stderr": "Output exceeded 4,000 characters."}
        return {"passed": proc.returncode == 0, "stdout": out, "stderr": proc.stderr[-2_000:], "returncode": proc.returncode}

def _limits() -> None:
    try:
        import resource
        resource.setrlimit(resource.RLIMIT_CPU, (2, 2))
        resource.setrlimit(resource.RLIMIT_FSIZE, (1_000_000, 1_000_000))
        resource.setrlimit(resource.RLIMIT_NOFILE, (16, 16))
    except Exception:
        pass

def handle_task(task_id: str, source: str) -> dict[str, Any]:
    task = TASKS.get(task_id)
    if not task:
        raise ValueError("Choose one of the five supported demo tasks.")
    events = [
        {"agent": "Requirement Agent", "status": "complete", "detail": "Structured the task into inputs, processing, and expected output."},
        {"agent": "Coding Agent", "status": "complete", "detail": "Prepared the offline Python solution for this supported task."},
        {"agent": "Testing Agent", "status": "running", "detail": "Executing the sample test in a constrained subprocess."},
    ]
    first = execute_case(source, task["input"])
    first["expected"] = task["expected"]
    first["passed"] = first["passed"] and first["stdout"] == task["expected"]
    attempts = [{"attempt": 1, **first}]
    final_code = source
    if not first["passed"]:
        events[-1].update(status="failed", detail="The sample test found a failure.")
        events.append({"agent": "Review Agent", "status": "complete", "detail": "Reviewed the failure and prepared one bounded repair using the offline reference solution."})
        if MAX_REPAIRS:
            final_code = task["code"]
            repaired = execute_case(final_code, task["input"])
            repaired["expected"] = task["expected"]
            repaired["passed"] = repaired["passed"] and repaired["stdout"] == task["expected"]
            attempts.append({"attempt": 2, **repaired, "repair": True})
            events.append({"agent": "Coding Agent", "status": "complete" if repaired["passed"] else "failed", "detail": "Applied the single allowed repair attempt."})
    else:
        events[-1].update(status="complete", detail="Sample output matched the expected result.")
        events.append({"agent": "Review Agent", "status": "complete", "detail": "Code passed the sample check; review is limited to the demo criteria."})
    return {"id": str(uuid.uuid4()), "task": task_id, "mode": "offline-demo", "requirements": task["requirements"],
            "events": events, "attempts": attempts, "code": final_code, "passed": attempts[-1]["passed"],
            "repairLimit": MAX_REPAIRS, "notice": "Offline demo uses fixed sample-task logic; it is not connected to an LLM API."}

class Handler(BaseHTTPRequestHandler):
    server_version = "CodeAssistDemo/1.0"
    def log_message(self, fmt: str, *args: Any) -> None:
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))
    def _send(self, status: int, payload: Any, content_type: str = "application/json; charset=utf-8") -> None:
        data = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
        self.send_response(status); self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data))); self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers(); self.wfile.write(data)
    def do_GET(self) -> None:
        if self.path == "/api/health":
            return self._send(200, {"status": "ok", "mode": "offline-demo", "llmConfigured": False})
        if self.path == "/api/tasks":
            return self._send(200, [{"id": k, "title": v["title"], "description": v["description"], "code": v["code"], "input": v["input"], "expected": v["expected"], "requirements": v["requirements"]} for k, v in TASKS.items()])
        if self.path in ("/", "/index.html"):
            return self._send(200, (ROOT / "index.html").read_bytes(), "text/html; charset=utf-8")
        if self.path == "/style.css":
            return self._send(200, (ROOT / "style.css").read_bytes(), "text/css; charset=utf-8")
        if self.path == "/app.js":
            return self._send(200, (ROOT / "app.js").read_bytes(), "text/javascript; charset=utf-8")
        self._send(404, {"error": "Not found"})
    def do_POST(self) -> None:
        if self.path != "/api/run":
            return self._send(404, {"error": "Not found"})
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size <= 0 or size > MAX_BODY:
                return self._send(413, {"error": "Request must be under 40 KB."})
            data = json.loads(self.rfile.read(size))
            result = handle_task(str(data.get("task", "")), str(data.get("code", "")))
            self._send(200, result)
        except UnsafeCode as exc:
            self._send(400, {"error": str(exc)})
        except ValueError as exc:
            self._send(400, {"error": str(exc)})
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._send(400, {"error": "Invalid JSON request."})
        except Exception as exc:
            self._send(500, {"error": f"Unexpected server error: {exc}"})

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    print(f"CodeAssist offline demo: http://127.0.0.1:{port}")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
