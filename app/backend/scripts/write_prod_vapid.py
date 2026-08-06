"""Grava config/vapid.json (DEV + shared PROD). Uso interno — deploy."""
from __future__ import annotations

import base64
import json
import sys
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from py_vapid import Vapid02


def generate_vapid_pair() -> tuple[str, str]:
    vapid = Vapid02()
    vapid.generate_keys()
    private_pem = vapid.private_pem().decode("utf-8")
    raw_public = vapid.public_key.public_bytes(
        encoding=serialization.Encoding.X962,
        format=serialization.PublicFormat.UncompressedPoint,
    )
    public_b64url = base64.urlsafe_b64encode(raw_public).decode("ascii").rstrip("=")
    return public_b64url, private_pem


def main() -> int:
    pub, priv = generate_vapid_pair()
    payload = json.dumps({"public_key": pub, "private_key": priv}, ensure_ascii=False, indent=2)
    root = Path(__file__).resolve().parents[3]
    targets = [
        root / "config" / "vapid.json",
        Path(r"\\cgrafsysvm\Sistemas CGraf\Sagra Web\shared\config\vapid.json"),
        Path(r"\\cgrafsysvm\Sistemas CGraf\Sagra Web\config\vapid.json"),
        Path(r"\\cgrafsysvm\Sistemas CGraf\Sagra Web\releases\20260617_003924\config\vapid.json"),
        Path(r"\\cgrafsysvm\Sistemas CGraf\Sagra Web\current\config\vapid.json"),
    ]
    ok = 0
    for path in targets:
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(payload, encoding="utf-8")
            print(f"OK {path}")
            ok += 1
        except Exception as exc:
            print(f"FAIL {path}: {exc}", file=sys.stderr)
    print(f"public_key={pub}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
