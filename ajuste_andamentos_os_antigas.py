"""
Ajuste em massa de andamentos no MySQL — OSs com ano < 2024.

Insere um andamento Cancelado (SEFOC / Ajuste de sistema / UltimoStatus=TRUE) para:

1. OSs cujo andamento operacional atual não é Entregue/Cancelado/Cancelada.
2. OSs sem nenhum registro em tabAndamento (ex.: após limpeza de histórico).

Alteração exclusiva no MySQL — não replica no MDB.
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
from datetime import datetime
from typing import Any

import mysql.connector
from mysql.connector import Error as MySQLError

ROOT_DIR = os.path.abspath(os.path.dirname(__file__))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)
BACKEND_DIR = os.path.join(ROOT_DIR, "app", "backend")
if os.path.isdir(BACKEND_DIR) and BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from config_manager import config_manager  # noqa: E402

SITUACOES_FINALIZADAS = frozenset({"Entregue", "Cancelado", "Cancelada"})
SITUACAO_NOVA = "Cancelado"
SETOR_NOVO = "SEFOC"
OBS_NOVA = "Ajuste de sistema"
COMMIT_BATCH = 100

MIRROR_EXCLUDE = """
    NOT EXISTS (
        SELECT 1
        FROM tab_os_sub_os_andamento m
        WHERE m.cod_status_espelho IS NOT NULL
          AND m.cod_status_espelho != ''
          AND m.cod_status_espelho COLLATE utf8mb4_general_ci
              = a.CodStatus COLLATE utf8mb4_general_ci
    )
"""

NOT_EXISTS_AJUSTE_DUPLICADO = """
    NOT EXISTS (
        SELECT 1
        FROM tabAndamento aj
        WHERE aj.NroProtocoloLink = p.NroProtocolo
          AND aj.AnoProtocoloLink = p.AnoProtocolo
          AND aj.UltimoStatus = 1
          AND aj.SituacaoLink = %(situacao_nova)s
          AND aj.SetorLink = %(setor_novo)s
          AND aj.`Observaçao` = %(obs_nova)s
    )
"""

QUERY_OS_ELEGIVEIS = f"""
    SELECT
        p.NroProtocolo AS nro,
        p.AnoProtocolo AS ano,
        cur.SituacaoLink AS situacao_atual,
        cur.CodStatus AS cod_status_atual
    FROM tabProtocolos p
    LEFT JOIN tabAndamento cur ON cur.CodStatus = (
        SELECT a.CodStatus
        FROM tabAndamento a
        WHERE a.NroProtocoloLink = p.NroProtocolo
          AND a.AnoProtocoloLink = p.AnoProtocolo
          AND {MIRROR_EXCLUDE}
        ORDER BY
            a.UltimoStatus DESC,
            a.`Data` DESC,
            a.CodStatus DESC
        LIMIT 1
    )
    WHERE p.AnoProtocolo < %(ano_corte)s
      AND cur.SituacaoLink IS NOT NULL
      AND cur.SituacaoLink NOT IN ('Entregue', 'Cancelado', 'Cancelada')
      AND {NOT_EXISTS_AJUSTE_DUPLICADO.strip()}
    ORDER BY p.AnoProtocolo, p.NroProtocolo
"""

QUERY_OS_SEM_ANDAMENTO = f"""
    SELECT
        p.NroProtocolo AS nro,
        p.AnoProtocolo AS ano,
        NULL AS situacao_atual,
        NULL AS cod_status_atual
    FROM tabProtocolos p
    WHERE p.AnoProtocolo < %(ano_corte)s
      AND NOT EXISTS (
          SELECT 1
          FROM tabAndamento a
          WHERE a.NroProtocoloLink = p.NroProtocolo
            AND a.AnoProtocoloLink = p.AnoProtocolo
      )
      AND {NOT_EXISTS_AJUSTE_DUPLICADO.strip()}
    ORDER BY p.AnoProtocolo, p.NroProtocolo
"""


def setup_logging() -> None:
    log_path = os.path.join(ROOT_DIR, "ajuste_andamentos_os_antigas.log")
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(levelname)s - %(message)s",
        handlers=[
            logging.FileHandler(log_path, encoding="utf-8"),
            logging.StreamHandler(sys.stdout),
        ],
        force=True,
    )


def connect_mysql() -> mysql.connector.MySQLConnection:
    cfg = config_manager.get_mysql_config()
    conn = mysql.connector.connect(
        host=cfg["host"],
        port=cfg["port"],
        user=cfg["user"],
        password=cfg["password"],
        database=cfg["database"],
        autocommit=False,
    )
    logging.info("Conectado ao MySQL: %s@%s/%s", cfg["user"], cfg["host"], cfg["database"])
    return conn


def proximo_cod_status(cursor: Any, nro: int, ano: int) -> str:
    base_prefix = f"{int(nro):05d}{int(ano)}-"
    cursor.execute(
        "SELECT MAX(CodStatus) AS max_cod FROM tabAndamento WHERE CodStatus LIKE %s",
        (f"{base_prefix}%",),
    )
    row = cursor.fetchone()
    max_cod = row[0] if row and not isinstance(row, dict) else (row or {}).get("max_cod")
    next_seq = 1
    if max_cod:
        try:
            next_seq = int(str(max_cod).split("-")[-1]) + 1
        except ValueError:
            next_seq = 1
    return f"{base_prefix}{next_seq:02d}"


def inserir_andamento_cancelado(cursor: Any, nro: int, ano: int) -> str:
    cursor.execute(
        """
        UPDATE tabAndamento
        SET UltimoStatus = 0
        WHERE NroProtocoloLink = %s AND AnoProtocoloLink = %s
        """,
        (nro, ano),
    )

    novo_cod = proximo_cod_status(cursor, nro, ano)
    cursor.execute(
        """
        INSERT INTO tabAndamento
            (CodStatus, NroProtocoloLink, AnoProtocoloLink, SituacaoLink, SetorLink,
             `Data`, UltimoStatus, `Observaçao`, Ponto)
        VALUES (%s, %s, %s, %s, %s, NOW(), 1, %s, '')
        """,
        (novo_cod, nro, ano, SITUACAO_NOVA, SETOR_NOVO, OBS_NOVA),
    )
    return novo_cod


def _query_params(ano_corte: int) -> dict[str, Any]:
    return {
        "ano_corte": ano_corte,
        "situacao_nova": SITUACAO_NOVA,
        "setor_novo": SETOR_NOVO,
        "obs_nova": OBS_NOVA,
    }


def buscar_os_elegiveis(conn: mysql.connector.MySQLConnection, ano_corte: int) -> list[dict]:
    cursor = conn.cursor(dictionary=True)
    params = _query_params(ano_corte)
    try:
        cursor.execute(QUERY_OS_ELEGIVEIS, params)
        com_andamento = list(cursor.fetchall())

        cursor.execute(QUERY_OS_SEM_ANDAMENTO, params)
        sem_andamento = list(cursor.fetchall())

        merged: dict[tuple[int, int], dict] = {}
        for row in com_andamento:
            merged[(int(row["nro"]), int(row["ano"]))] = row
        for row in sem_andamento:
            key = (int(row["nro"]), int(row["ano"]))
            if key not in merged:
                merged[key] = row

        return sorted(merged.values(), key=lambda r: (int(r["ano"]), int(r["nro"])))
    finally:
        cursor.close()


def executar(
    *,
    ano_corte: int,
    dry_run: bool,
    limit: int | None,
    assume_yes: bool,
) -> int:
    conn = connect_mysql()
    elegiveis = buscar_os_elegiveis(conn, ano_corte)
    if limit is not None:
        elegiveis = elegiveis[:limit]

    total = len(elegiveis)
    qtd_sem_andamento = sum(1 for row in elegiveis if row.get("cod_status_atual") is None)
    logging.info(
        "OSs elegíveis (ano < %s): %s (%s sem nenhum andamento)",
        ano_corte,
        total,
        qtd_sem_andamento,
    )

    if total == 0:
        logging.info("Nenhuma OS para ajustar.")
        conn.close()
        return 0

    amostra = elegiveis[:10]
    logging.info("Amostra (até 10):")
    for row in amostra:
        logging.info(
            "  %s/%s — situação atual: %s (CodStatus=%s)",
            row["nro"],
            row["ano"],
            row.get("situacao_atual") or "(sem andamento)",
            row.get("cod_status_atual") or "-",
        )

    if dry_run:
        logging.info("Modo dry-run: nenhuma alteração gravada.")
        conn.close()
        return 0

    if not assume_yes:
        print()
        print(
            f"Serão inseridos {total} andamentos 'Cancelado' (SEFOC / Ajuste de sistema) no MySQL "
            f"({qtd_sem_andamento} OS(s) sem nenhum andamento registrado)."
        )
        print("Os MDBs NÃO serão alterados.")
        resposta = input("Confirmar execução? (digite SIM): ").strip()
        if resposta != "SIM":
            logging.info("Operação cancelada pelo usuário.")
            conn.close()
            return 1

    cursor = conn.cursor()
    processadas = 0
    erros = 0

    try:
        for row in elegiveis:
            nro = int(row["nro"])
            ano = int(row["ano"])
            try:
                novo_cod = inserir_andamento_cancelado(cursor, nro, ano)
                processadas += 1
                if processadas <= 20 or processadas % 500 == 0:
                    logging.info(
                        "OK %s/%s — %s → %s",
                        nro,
                        ano,
                        row.get("situacao_atual") or "(sem andamento)",
                        novo_cod,
                    )
                if processadas % COMMIT_BATCH == 0:
                    conn.commit()
            except MySQLError as exc:
                erros += 1
                conn.rollback()
                logging.error("Erro em %s/%s: %s", nro, ano, exc)

        conn.commit()
    finally:
        cursor.close()
        conn.close()

    logging.info("Concluído: %s inseridas, %s erros.", processadas, erros)
    return 1 if erros else 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Insere andamento Cancelado (SEFOC) em OSs antigas abertas ou sem andamento — somente MySQL."
        )
    )
    parser.add_argument(
        "--ano-corte",
        type=int,
        default=2024,
        help="Ano limite (padrão: 2024). Ajusta OSs com AnoProtocolo menor que este valor.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Lista OSs elegíveis sem gravar alterações.",
    )
    parser.add_argument(
        "-y",
        "--yes",
        action="store_true",
        help="Executa sem pedir confirmação interativa.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Limita quantidade de OSs processadas (útil para teste).",
    )
    return parser.parse_args()


def main() -> int:
    setup_logging()
    args = parse_args()
    logging.info("Início do ajuste — %s", datetime.now().isoformat(timespec="seconds"))
    return executar(
        ano_corte=args.ano_corte,
        dry_run=args.dry_run,
        limit=args.limit,
        assume_yes=args.yes,
    )


if __name__ == "__main__":
    raise SystemExit(main())
