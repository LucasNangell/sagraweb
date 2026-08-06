"""Gera par de chaves VAPID para Web Push (.env ou config/vapid_dev.json)."""
from __future__ import annotations

import base64
import sys


def generate_vapid_pair() -> tuple[str, str]:
    from cryptography.hazmat.primitives import serialization
    from py_vapid import Vapid02

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
    try:
        public, private = generate_vapid_pair()
    except ImportError:
        print("Instale: pip install pywebpush", file=sys.stderr)
        return 1

    print("Adicione ao config/.env (produção):")
    print(f"VAPID_PUBLIC_KEY={public}")
    print("VAPID_PRIVATE_KEY=\"\"\"")
    print(private, end="")
    print("\"\"\"")
    print("VAPID_SUBJECT=mailto:sagra-web@redecamara.camara.gov.br")
    print()
    print("Em ENV=development as chaves são geradas automaticamente em config/vapid_dev.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
