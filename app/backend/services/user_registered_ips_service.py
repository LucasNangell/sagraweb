"""
Consulta e manutenção de IPs cadastrados por usuário.
"""
from __future__ import annotations

import re
from typing import Any

from database import db
from fastapi import HTTPException
from security.password_auth import verify_password

_IP_RE = re.compile(
    r"^(?:\d{1,3}\.){3}\d{1,3}$|^[0-9a-fA-F:]+$"
)


def normalize_ip(value: str) -> str:
    return (value or "").strip()


def is_valid_ip(value: str) -> bool:
    ip = normalize_ip(value)
    if not ip or len(ip) > 45:
        return False
    if not _IP_RE.match(ip):
        return False
    if "." in ip:
        parts = ip.split(".")
        return len(parts) == 4 and all(part.isdigit() and 0 <= int(part) <= 255 for part in parts)
    return True


def get_user_registered_ips(ponto: int) -> list[str]:
    rows = db.execute_query(
        """
        SELECT ip FROM user_registered_ips
        WHERE Ponto = %s
        ORDER BY ip ASC
        """,
        (ponto,),
    )
    return [str(row["ip"]).strip() for row in rows if row.get("ip")]


def list_user_ips_detail(ponto: int) -> list[dict[str, Any]]:
    rows = db.execute_query(
        """
        SELECT id, ip, descricao
        FROM user_registered_ips
        WHERE Ponto = %s
        ORDER BY ip ASC
        """,
        (ponto,),
    )
    return [
        {
            "id": int(row["id"]),
            "ip": str(row["ip"]).strip(),
            "descricao": (row.get("descricao") or "").strip() or None,
        }
        for row in rows
    ]


def user_ip_is_registered(ponto: int, client_ip: str) -> bool:
    ip = normalize_ip(client_ip)
    if not ip:
        return False
    rows = db.execute_query(
        """
        SELECT 1 FROM user_registered_ips
        WHERE Ponto = %s AND ip = %s
        LIMIT 1
        """,
        (ponto, ip),
    )
    return bool(rows)


def local_login_requires_password(ponto: int, client_ip: str) -> bool:
    """Exige senha na intranet quando há IPs cadastrados e o IP atual não está na lista."""
    registered = get_user_registered_ips(ponto)
    if not registered:
        return False
    return not user_ip_is_registered(ponto, client_ip)


def verify_local_password_gate(ponto: int, password: str | None) -> None:
    rows = db.execute_query(
        """
        SELECT PasswordHash, AuthAtivo
        FROM tabUsuarios
        WHERE Ponto = %s
        """,
        (ponto,),
    )
    if not rows or not rows[0].get("PasswordHash"):
        raise HTTPException(
            status_code=403,
            detail=(
                "Acesso deste IP requer senha. Ative sua conta de internet "
                "ou contate o administrador."
            ),
        )
    if not rows[0].get("AuthAtivo", 1):
        raise HTTPException(status_code=403, detail="Conta desativada.")
    if not password:
        raise HTTPException(
            status_code=401,
            detail="Senha obrigatória para acesso deste IP.",
        )
    if not verify_password(password, str(rows[0]["PasswordHash"])):
        raise HTTPException(status_code=401, detail="Senha inválida.")


def set_user_ips(ponto: int, ips: list[str]) -> list[str]:
    cleaned: list[str] = []
    seen: set[str] = set()
    for raw in ips:
        ip = normalize_ip(raw)
        if not ip:
            continue
        if not is_valid_ip(ip):
            raise ValueError(f"IP inválido: {raw}")
        if ip in seen:
            continue
        seen.add(ip)
        cleaned.append(ip)

    db.execute_query("DELETE FROM user_registered_ips WHERE Ponto = %s", (ponto,))
    for ip in cleaned:
        db.execute_query(
            """
            INSERT INTO user_registered_ips (Ponto, ip)
            VALUES (%s, %s)
            """,
            (ponto, ip),
        )
    return cleaned


def attach_ips_to_users(users: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not users:
        return users
    pontos = [int(u["Ponto"]) for u in users if u.get("Ponto") is not None]
    if not pontos:
        return users

    placeholders = ", ".join(["%s"] * len(pontos))
    rows = db.execute_query(
        f"""
        SELECT Ponto, ip
        FROM user_registered_ips
        WHERE Ponto IN ({placeholders})
        ORDER BY Ponto ASC, ip ASC
        """,
        tuple(pontos),
    )
    by_ponto: dict[int, list[str]] = {}
    for row in rows:
        ponto = int(row["Ponto"])
        by_ponto.setdefault(ponto, []).append(str(row["ip"]).strip())

    enriched: list[dict[str, Any]] = []
    for user in users:
        item = dict(user)
        ponto = int(user["Ponto"])
        item["IpsCadastrados"] = by_ponto.get(ponto, [])
        enriched.append(item)
    return enriched
