"""
App Android da Manutenção: aparelhos autorizados (login persistente por token),
registro de aberturas, visualizações de pedidos, fila de notificações entregues
ao serviço em segundo plano do app e metadados do APK para auto-atualização.

O token do aparelho é gerado uma única vez (no primeiro login dentro do app) e
guardado só no aparelho; aqui fica apenas o SHA-256. Com ele o app recria a
sessão sempre que ela expira — o usuário não precisa logar de novo.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import secrets
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable, Optional

from database import db
from manutencao_schema import ensure_manutencao_schema

logger = logging.getLogger(__name__)

ORIGENS_VISUALIZACAO = ("app", "web")
MAX_IDS_VISUALIZACAO = 200
NOTIF_RETENCAO_DIAS = 7
_ACESSO_THROTTLE_S = 60.0


class AparelhoInvalido(Exception):
    """Token ausente, desconhecido ou revogado."""


# ------------------------------------------------------------------ helpers


def _ponto_str(value: Any) -> str:
    return "".join(c for c in str(value or "") if c.isdigit())


def _iso(value: Any) -> Optional[str]:
    if isinstance(value, datetime):
        return value.isoformat(timespec="seconds")
    return str(value) if value else None


def hash_token(token: str) -> str:
    return hashlib.sha256(str(token or "").strip().encode("utf-8")).hexdigest()


def _nomes(pontos: Iterable[Any]) -> dict[str, str]:
    from services.manutencao_service import _nomes_por_ponto

    return _nomes_por_ponto(pontos)


def _clean(value: Any, limit: int) -> Optional[str]:
    text = " ".join(str(value or "").split())
    return text[:limit] or None


# ------------------------------------------------------- sinal p/ long-poll

_sinal_lock = threading.Lock()
_sinal_versao = 0


def _sinalizar() -> None:
    global _sinal_versao
    with _sinal_lock:
        _sinal_versao += 1


def versao_sinal() -> int:
    return _sinal_versao


# ---------------------------------------------------------------- aparelhos


def registrar_aparelho(
    ponto: str,
    *,
    aparelho_id: str,
    modelo: Optional[str] = None,
    versao_app: Optional[str] = None,
) -> dict[str, Any]:
    """Autoriza o aparelho para o ponto e devolve o token (mostrado uma única vez)."""
    ensure_manutencao_schema()
    p = _ponto_str(ponto)
    dev = _clean(aparelho_id, 64)
    if not p or p.strip("0") == "":
        raise ValueError("Sessão sem ponto identificado")
    if not dev:
        raise ValueError("Identificador do aparelho ausente")
    token = secrets.token_urlsafe(32)
    with db.cursor() as cursor:
        # Reinstalação/novo login no mesmo aparelho substitui o token anterior.
        cursor.execute(
            """
            UPDATE tab_manutencao_aparelho
            SET revogado_em = NOW(), revogado_por = %s
            WHERE aparelho_id = %s AND revogado_em IS NULL
            """,
            (p, dev),
        )
        cursor.execute(
            """
            INSERT INTO tab_manutencao_aparelho
                (ponto, token_hash, aparelho_id, modelo, versao_app, ultimo_acesso_em)
            VALUES (%s, %s, %s, %s, %s, NOW())
            """,
            (p, hash_token(token), dev, _clean(modelo, 120), _clean(versao_app, 20)),
        )
        novo_id = int(cursor.lastrowid)
        # O login na instalação já é a primeira abertura do app.
        cursor.execute(
            """
            INSERT INTO tab_manutencao_app_abertura (aparelho_id, ponto, versao_app)
            VALUES (%s, %s, %s)
            """,
            (novo_id, p, _clean(versao_app, 20)),
        )
        cursor.execute(
            "UPDATE tab_manutencao_aparelho SET ultima_abertura_em = NOW() WHERE id = %s",
            (novo_id,),
        )
    logger.info("Manutenção app: aparelho #%s autorizado para ponto %s (%s)", novo_id, p, modelo)
    return {"id": novo_id, "token": token, "ponto": p}


_ultimo_acesso: dict[int, float] = {}


def autenticar_token(token: Optional[str], *, tocar: bool = True) -> dict[str, Any]:
    """Devolve o aparelho ativo do token ou levanta AparelhoInvalido."""
    raw = str(token or "").strip()
    if len(raw) < 20:
        raise AparelhoInvalido("Token do aparelho ausente")
    ensure_manutencao_schema()
    rows = db.execute_query(
        """
        SELECT id, ponto, aparelho_id, modelo, versao_app, revogado_em
        FROM tab_manutencao_aparelho WHERE token_hash = %s
        """,
        (hash_token(raw),),
    ) or []
    if not rows or rows[0].get("revogado_em"):
        raise AparelhoInvalido("Aparelho não autorizado ou acesso revogado")
    aparelho = dict(rows[0])
    aparelho["ponto"] = _ponto_str(aparelho["ponto"])
    if tocar:
        agora = time.monotonic()
        if agora - _ultimo_acesso.get(aparelho["id"], 0.0) > _ACESSO_THROTTLE_S:
            _ultimo_acesso[aparelho["id"]] = agora
            try:
                db.execute_query(
                    "UPDATE tab_manutencao_aparelho SET ultimo_acesso_em = NOW() WHERE id = %s",
                    (aparelho["id"],),
                )
            except Exception as exc:  # pragma: no cover - cosmético
                logger.debug("Manutenção app: ultimo_acesso falhou: %s", exc)
    return aparelho


def registrar_abertura(aparelho: dict[str, Any], versao_app: Optional[str]) -> None:
    versao = _clean(versao_app, 20)
    with db.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO tab_manutencao_app_abertura (aparelho_id, ponto, versao_app)
            VALUES (%s, %s, %s)
            """,
            (aparelho["id"], aparelho["ponto"], versao),
        )
        cursor.execute(
            """
            UPDATE tab_manutencao_aparelho
            SET ultima_abertura_em = NOW(), ultimo_acesso_em = NOW(),
                versao_app = COALESCE(%s, versao_app)
            WHERE id = %s
            """,
            (versao, aparelho["id"]),
        )


def revogar_aparelho(aparelho_id: int, por_ponto: str) -> None:
    ensure_manutencao_schema()
    with db.cursor() as cursor:
        cursor.execute(
            """
            UPDATE tab_manutencao_aparelho
            SET revogado_em = NOW(), revogado_por = %s
            WHERE id = %s AND revogado_em IS NULL
            """,
            (_ponto_str(por_ponto), int(aparelho_id)),
        )
        if cursor.rowcount == 0:
            from services.manutencao_service import ManutencaoNotFound

            raise ManutencaoNotFound("Aparelho não encontrado ou já desconectado")


def revogar_por_token(token: str) -> None:
    db.execute_query(
        """
        UPDATE tab_manutencao_aparelho
        SET revogado_em = NOW(), revogado_por = ponto
        WHERE token_hash = %s AND revogado_em IS NULL
        """,
        (hash_token(token),),
    )


def listar_aparelhos(incluir_revogados: bool = False) -> list[dict[str, Any]]:
    ensure_manutencao_schema()
    where = "" if incluir_revogados else "WHERE a.revogado_em IS NULL"
    rows = db.execute_query(
        f"""
        SELECT a.id, a.ponto, a.modelo, a.versao_app, a.criado_em, a.ultimo_acesso_em,
               a.ultima_abertura_em, a.revogado_em,
               (SELECT COUNT(*) FROM tab_manutencao_app_abertura b
                 WHERE b.aparelho_id = a.id
                   AND b.aberto_em >= NOW() - INTERVAL 7 DAY) AS aberturas_7d
        FROM tab_manutencao_aparelho a
        {where}
        ORDER BY COALESCE(a.ultima_abertura_em, a.criado_em) DESC
        LIMIT 300
        """
    ) or []
    nomes = _nomes(r.get("ponto") for r in rows)
    out = []
    for r in rows:
        ponto = _ponto_str(r.get("ponto"))
        out.append(
            {
                "id": int(r["id"]),
                "ponto": ponto,
                "nome": nomes.get(ponto) or None,
                "modelo": r.get("modelo"),
                "versao_app": r.get("versao_app"),
                "criado_em": _iso(r.get("criado_em")),
                "ultimo_acesso_em": _iso(r.get("ultimo_acesso_em")),
                "ultima_abertura_em": _iso(r.get("ultima_abertura_em")),
                "revogado_em": _iso(r.get("revogado_em")),
                "aberturas_7d": int(r.get("aberturas_7d") or 0),
            }
        )
    return out


def listar_aberturas(limit: int = 100) -> list[dict[str, Any]]:
    ensure_manutencao_schema()
    rows = db.execute_query(
        """
        SELECT b.id, b.ponto, b.versao_app, b.aberto_em, a.modelo
        FROM tab_manutencao_app_abertura b
        LEFT JOIN tab_manutencao_aparelho a ON a.id = b.aparelho_id
        ORDER BY b.id DESC
        LIMIT %s
        """,
        (max(1, min(int(limit), 500)),),
    ) or []
    nomes = _nomes(r.get("ponto") for r in rows)
    return [
        {
            "id": int(r["id"]),
            "ponto": _ponto_str(r.get("ponto")),
            "nome": nomes.get(_ponto_str(r.get("ponto"))) or None,
            "modelo": r.get("modelo"),
            "versao_app": r.get("versao_app"),
            "aberto_em": _iso(r.get("aberto_em")),
        }
        for r in rows
    ]


# ------------------------------------------------------------ visualizações


def registrar_visualizacoes(ponto: str, pedido_ids: Iterable[Any], origem: str) -> int:
    """Marca que o usuário viu os pedidos (primeira vez preservada)."""
    p = _ponto_str(ponto)
    if not p or p.strip("0") == "":
        return 0
    org = origem if origem in ORIGENS_VISUALIZACAO else "web"
    ids: list[int] = []
    for raw in pedido_ids or []:
        try:
            val = int(raw)
        except (TypeError, ValueError):
            continue
        if val > 0 and val not in ids:
            ids.append(val)
        if len(ids) >= MAX_IDS_VISUALIZACAO:
            break
    if not ids:
        return 0
    ensure_manutencao_schema()
    placeholders = ", ".join(["%s"] * len(ids))
    existentes = db.execute_query(
        f"SELECT id FROM tab_manutencao_pedido WHERE id IN ({placeholders})",
        tuple(ids),
    ) or []
    validos = [int(r["id"]) for r in existentes]
    if not validos:
        return 0
    with db.cursor() as cursor:
        cursor.executemany(
            """
            INSERT INTO tab_manutencao_visualizacao (pedido_id, ponto, origem)
            VALUES (%s, %s, %s)
            ON DUPLICATE KEY UPDATE
                ultima_em = NOW(),
                vezes = vezes + 1,
                origem = IF(origem = 'app' OR VALUES(origem) = 'app', 'app', origem)
            """,
            [(pid, p, org) for pid in validos],
        )
    return len(validos)


def visualizacoes_por_pedido(pedido_ids: Iterable[Any]) -> dict[int, list[dict[str, Any]]]:
    ids = sorted({int(x) for x in pedido_ids if x})
    if not ids:
        return {}
    ensure_manutencao_schema()
    placeholders = ", ".join(["%s"] * len(ids))
    rows = db.execute_query(
        f"""
        SELECT pedido_id, ponto, primeira_em, ultima_em, origem, vezes
        FROM tab_manutencao_visualizacao
        WHERE pedido_id IN ({placeholders})
        ORDER BY primeira_em ASC
        """,
        tuple(ids),
    ) or []
    nomes = _nomes(r.get("ponto") for r in rows)
    out: dict[int, list[dict[str, Any]]] = {}
    for r in rows:
        ponto = _ponto_str(r.get("ponto"))
        out.setdefault(int(r["pedido_id"]), []).append(
            {
                "ponto": ponto,
                "nome": nomes.get(ponto) or None,
                "primeira_em": _iso(r.get("primeira_em")),
                "ultima_em": _iso(r.get("ultima_em")),
                "origem": r.get("origem") or "web",
                "vezes": int(r.get("vezes") or 1),
            }
        )
    return out


def anexar_visualizacoes(pedidos: list[dict[str, Any]]) -> list[dict[str, Any]]:
    try:
        mapa = visualizacoes_por_pedido(p.get("id") for p in pedidos)
    except Exception as exc:  # pragma: no cover - indicador auxiliar
        logger.warning("Manutenção: visualizações indisponíveis: %s", exc)
        mapa = {}
    for p in pedidos:
        p["visualizacoes"] = mapa.get(int(p.get("id") or 0), [])
    return pedidos


# ------------------------------------------------------- notificações app


def enfileirar_notificacao(
    pontos: Iterable[str],
    *,
    titulo: str,
    mensagem: str,
    url: Optional[str],
    urgente: bool,
    pedido_id: Optional[int],
) -> int:
    alvos = [p for p in dict.fromkeys(_ponto_str(x) for x in pontos) if p]
    if not alvos:
        return 0
    ensure_manutencao_schema()
    with db.cursor() as cursor:
        cursor.executemany(
            """
            INSERT INTO tab_manutencao_app_notificacao
                (ponto, pedido_id, titulo, mensagem, url, urgente)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            [
                (p, pedido_id, titulo[:200], mensagem[:1000], (url or "")[:500] or None, 1 if urgente else 0)
                for p in alvos
            ],
        )
        if secrets.randbelow(50) == 0:
            cursor.execute(
                "DELETE FROM tab_manutencao_app_notificacao WHERE criado_em < NOW() - INTERVAL %s DAY",
                (NOTIF_RETENCAO_DIAS,),
            )
    _sinalizar()
    return len(alvos)


def ultimo_id_notificacao(ponto: str) -> int:
    rows = db.execute_query(
        "SELECT COALESCE(MAX(id), 0) AS ultimo FROM tab_manutencao_app_notificacao WHERE ponto = %s",
        (_ponto_str(ponto),),
    ) or []
    return int(rows[0].get("ultimo") or 0) if rows else 0


def notificacoes_desde(ponto: str, desde_id: int, limit: int = 20) -> list[dict[str, Any]]:
    rows = db.execute_query(
        """
        SELECT id, pedido_id, titulo, mensagem, url, urgente, criado_em
        FROM tab_manutencao_app_notificacao
        WHERE ponto = %s AND id > %s
          AND criado_em >= NOW() - INTERVAL 1 DAY
        ORDER BY id ASC
        LIMIT %s
        """,
        (_ponto_str(ponto), int(desde_id), int(limit)),
    ) or []
    return [
        {
            "id": int(r["id"]),
            "pedido_id": int(r["pedido_id"]) if r.get("pedido_id") else None,
            "titulo": r.get("titulo") or "Manutenção",
            "mensagem": r.get("mensagem") or "",
            "url": r.get("url"),
            "urgente": bool(r.get("urgente")),
            "criado_em": _iso(r.get("criado_em")),
        }
        for r in rows
    ]


# --------------------------------------------------------------- APK/versão


def app_dir() -> Path:
    custom = (os.getenv("MANUTENCAO_APP_DIR") or "").strip()
    if custom:
        return Path(custom)
    from config_manager import PROJECT_ROOT

    return Path(PROJECT_ROOT) / "storage" / "manutencao_app"


def info_versao() -> Optional[dict[str, Any]]:
    """Lê versao.json publicado junto do APK (None quando ainda não há APK)."""
    base = app_dir()
    meta_path = base / "versao.json"
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except Exception as exc:
        logger.warning("Manutenção app: versao.json inválido em %s: %s", meta_path, exc)
        return None
    arquivo = str(meta.get("arquivo") or "").strip()
    if not arquivo or "/" in arquivo or "\\" in arquivo or ".." in arquivo:
        return None
    apk = base / arquivo
    if not apk.is_file():
        return None
    return {
        "version_code": int(meta.get("version_code") or 0),
        "version_name": str(meta.get("version_name") or ""),
        "arquivo": arquivo,
        "sha256": str(meta.get("sha256") or ""),
        "tamanho": apk.stat().st_size,
        "publicado_em": meta.get("publicado_em"),
        "notas": meta.get("notas"),
        "_path": str(apk),
    }
