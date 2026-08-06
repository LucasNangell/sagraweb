"""Smoke test de rotas críticas — sem servidor externo (TestClient)."""
from __future__ import annotations

import os
import sys
from pathlib import Path

# Python adiciona scripts/ ao sys.path — remover e usar cwd=backend como `python -c`.
_backend = Path(__file__).resolve().parents[1]
_script_dir = str(Path(__file__).resolve().parent)
if _script_dir in sys.path:
    sys.path.remove(_script_dir)
os.chdir(_backend)
if "" not in sys.path:
    sys.path.insert(0, "")
import bootstrap_paths  # noqa: E402, F401

os.environ.setdefault("ENV", "development")
os.environ.setdefault(
    "SAGRA_SESSION_SECRET",
    "test-session-secret-32-chars-minimum!!",
)

from fastapi.testclient import TestClient  # noqa: E402

from routers.api import app  # noqa: E402


def main() -> int:
    client = TestClient(app, raise_server_exceptions=False)
    failed = 0

    def check(name: str, ok: bool, detail: str) -> None:
        nonlocal failed
        status = "PASS" if ok else "FAIL"
        print(f"{status} | {name} | {detail}")
        if not ok:
            failed += 1

    r = client.get("/health")
    check(
        "GET /health",
        r.status_code in (200, 503),
        f"status={r.status_code} body={r.text[:100]}",
    )

    r = client.get("/api/config/public")
    check("GET /api/config/public", r.status_code == 200, f"status={r.status_code}")

    r = client.get("/api/os/search")
    check(
        "GET /api/os/search sem sessão",
        r.status_code in (403, 200),
        f"status={r.status_code} (200=painel anônimo dev/LAN; 403=produção autenticada)",
    )

    r = client.post("/api/realtime/notify", json={"type": "system_update"})
    check(
        "POST /api/realtime/notify sem auth",
        r.status_code == 403,
        f"status={r.status_code}",
    )

    r = client.get("/api/files/serve", params={"path": "../../etc/passwd"})
    check(
        "GET /api/files/serve traversal",
        r.status_code in (403, 400, 404, 422),
        f"status={r.status_code}",
    )

    r = client.get("/health")
    hdrs = {k.lower(): v for k, v in r.headers.items()}
    check(
        "Header X-Content-Type-Options",
        "x-content-type-options" in hdrs,
        hdrs.get("x-content-type-options", "missing"),
    )

    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "ping"})
        pong = ws.receive_json()
        check("WebSocket /ws ping/pong", pong.get("type") == "pong", str(pong))

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
