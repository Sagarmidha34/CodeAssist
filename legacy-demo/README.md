# CodeAssist

**CodeAssist: A Multi-Agent AI Approach to Automated Code Generation and Testing** is an offline-first demonstration of a four-role code workflow. It uses Python's standard library only; no API key, package install, database, or external font download is needed.

## Run locally

Requires Python 3.10 or newer.

```bash
python3 server.py
```

Open <http://127.0.0.1:8000>. Stop the server with `Ctrl+C`. To change the local port, set `PORT` before starting the server.

## Current demo behavior

The interface offers five fixed examples: sum of two numbers, average of five marks, factorial, prime check, and palindrome check. Select a task, edit its sample code if desired, and run the workflow.

| Role | Current behavior |
|---|---|
| Requirement Agent | Presents a structured checklist for the selected sample task. |
| Coding Agent | Supplies local reference code for the selected task. |
| Testing Agent | Runs the submitted code against one fixed sample input and expected output. |
| Review Agent | Reports the result and, when the first attempt fails, permits one repair using the local reference solution. |

The repair limit is one. The final result shows the checks, agent activity, and final code. This is deterministic sample-task logic, **not an LLM implementation**. The current version has no real LLM API adapter, persistence layer, user-defined requirements, Pytest integration, or deployment setup. Those are future work; do not present them as implemented.

## Execution boundary

The server accepts a maximum 40 KB request, restricts Python syntax to a small AST allowlist, launches a separate isolated Python process, applies a three-second timeout, uses a temporary working directory, and applies basic POSIX CPU, file-size, and file-handle limits when available. Imports and file/network APIs are blocked by the allowlist.

This is a **teaching/demo control**, not a hardened security sandbox for untrusted public traffic. Run it only on your own machine; do not expose the server to the internet. A production system should execute code in a stronger OS/container boundary with resource and network isolation.

## API

- `GET /api/health` — local mode and API configuration status.
- `GET /api/tasks` — sample task catalog and reference code.
- `POST /api/run` — JSON body `{ "task": "average", "code": "..." }`.

The server binds to `127.0.0.1` by default. It serves the browser UI and API from the same origin.

## Architecture

```text
Browser (HTML/CSS/JavaScript)
          │ same-origin HTTP / JSON
          ▼
Python standard-library HTTP API (server.py)
          │
          ├── Requirement Agent — structured sample requirements
          ├── Coding Agent      — offline reference solution
          ├── Testing Agent     — AST gate → isolated subprocess → output check
          └── Review Agent      — result summary → at most one repair
```

### Optional LLM integration

An external LLM is **not connected in this build**. To add one later, introduce a provider adapter behind the Coding Agent (and optionally Requirement/Review Agents), keep the local demo as the default, load credentials only from environment variables, set request timeouts and response limits, and keep generated-code execution behind the local execution boundary. The agents are workflow roles; they do not require four separate models. API integration must be implemented and verified before claiming it in a viva.

## Naming note

The presentation and project title use **CodeAssist**. The synopsis has older **CodeCrew** references in its abstract. Use CodeAssist consistently in the demo and viva; update the synopsis separately if you are permitted to revise it.

## Viva-ready explanation

> CodeAssist is an offline local prototype that demonstrates a multi-agent workflow for small Python examples. The Requirement Agent structures the selected task, the Coding Agent provides a solution, the Testing Agent executes one sample case in a constrained subprocess, and the Review Agent reports the result. If the first run fails, the demo allows one repair using its local reference solution. The prototype does not currently call an external LLM API; adding a provider adapter is future work.

The key distinction is **generation plus a check**, rather than treating generated code as verified by default. The current demonstration uses five predefined tasks and one sample case per task, so it does not prove general correctness or show a benchmark against a single-agent system.
