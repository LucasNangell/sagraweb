"""Baixa o cadastro da API da Câmara e grava em tabDeputadosCamara.

Uso, a partir de app/backend:
    python scripts/sincronizar_deputados_camara.py
"""
from __future__ import annotations

import json
import logging
import sys
from pathlib import Path

import pymysql
import pymysql.cursors

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from database import db  # noqa: E402
from services.deputados_camara_service import (  # noqa: E402
    baixar_deputados_camara,
    gravar_deputados_camara,
    listar_deputados_paginado,
)

logger = logging.getLogger("sincronizar_deputados_camara")


def _gravar(executar, detalhes: list[dict], ids: set[int] | None) -> int:
    return gravar_deputados_camara(detalhes, executar=executar, ids_em_exercicio=ids)


def _prod_executar():
    config_path = BACKEND.parents[1] / "config" / "config.json"
    bruto = json.loads(config_path.read_text(encoding="utf-8"))
    banco = bruto.get("db") or bruto
    senha = str(banco.get("db_password") or "")
    usuario = str(banco.get("db_user") or "usr_sagraweb")
    nome = str(banco.get("db_name") or "sagrafulldb")
    porta = int(banco.get("db_port") or 3306)
    if not senha:
        raise RuntimeError("config.json não tem senha para o MySQL de produção")
    conn = pymysql.connect(
        host="10.1.1.73",
        port=porta,
        user=usuario,
        password=senha,
        database=nome,
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=True,
        connect_timeout=10,
        read_timeout=120,
        write_timeout=120,
    )

    def executar(sql: str, params=None):
        with conn.cursor() as cursor:
            cursor.execute(sql, params)
            return cursor.fetchall()

    return conn, executar


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    lista = listar_deputados_paginado(itens=100)
    if not lista:
        raise SystemExit("A API da Câmara não devolveu deputados.")
    logger.info("Deputados listados: %s", len(lista))
    detalhes = baixar_deputados_camara(lista)
    ids = {int(item["id"]) for item in lista} if len(detalhes) == len(lista) else None
    local = _gravar(db.execute_query, detalhes, ids)
    print(f"GRAVADOS_LOCAL {local} HOST {db.host} DETALHES {len(detalhes)}", flush=True)

    if str(db.host).strip() == "10.1.1.73":
        print("PRODUCAO ja e o banco local", flush=True)
        return

    try:
        conn, executar = _prod_executar()
    except RuntimeError as exc:
        print(f"AVISO_PRODUCAO {exc}", flush=True)
        return
    try:
        prod = _gravar(executar, detalhes, ids)
    finally:
        conn.close()
    print(f"GRAVADOS_PRODUCAO {prod} HOST 10.1.1.73", flush=True)


if __name__ == "__main__":
    main()
