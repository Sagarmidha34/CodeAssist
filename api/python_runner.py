"""Private Vercel Python Function for the restricted CodeAssist runner."""
import hmac
import json
import os
from http.server import BaseHTTPRequestHandler
from pathlib import Path
import subprocess
import sys

# Importing this module makes the shared runner a reachable build dependency,
# while the child process keeps its resource limits isolated per test case.
from lib import python_runner as runner_module


class handler(BaseHTTPRequestHandler):
    def _respond(self, status, payload):
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(encoded)

    def do_POST(self):
        secret = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
        expected = f"Bearer {secret}" if secret else ""
        supplied = self.headers.get("Authorization", "")
        if not expected or not hmac.compare_digest(supplied, expected):
            self._respond(401, {"ok": False, "stdout": "", "error": "Unauthorized Python runner request."})
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            content_length = 0
        if content_length < 1 or content_length > 64_000:
            self._respond(413, {"ok": False, "stdout": "", "error": "Python runner request is empty or too large."})
            return

        try:
            payload = json.loads(self.rfile.read(content_length))
            if not isinstance(payload, dict):
                raise ValueError("Expected a JSON object.")
            runner_path = Path(runner_module.__file__).resolve()
            completed = subprocess.run(
                [sys.executable, "-I", "-S", str(runner_path)],
                input=json.dumps({"code": payload.get("code", ""), "input": payload.get("input", "")}),
                text=True,
                capture_output=True,
                cwd=Path(__file__).resolve().parent.parent,
                env={"PYTHONIOENCODING": "utf-8", "PATH": os.environ.get("PATH", "/usr/bin:/bin")},
                timeout=4,
                check=False,
            )
            if completed.returncode != 0 or len(completed.stdout) > 8_000:
                self._respond(200, {"ok": False, "stdout": "", "error": "Python runner stopped unexpectedly."})
                return
            result = json.loads(completed.stdout)
            if not isinstance(result, dict) or not isinstance(result.get("ok"), bool):
                raise ValueError("Runner returned an invalid result.")
            self._respond(200, result)
        except subprocess.TimeoutExpired:
            self._respond(200, {"ok": False, "stdout": "", "error": "Execution exceeded the 3.5 second limit."})
        except Exception as exc:
            self._respond(200, {"ok": False, "stdout": "", "error": f"Python runner error: {type(exc).__name__}: {exc}"[:400]})

    def log_message(self, _format, *_args):
        return
