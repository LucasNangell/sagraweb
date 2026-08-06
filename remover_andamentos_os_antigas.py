"""
Remove andamentos históricos no MySQL — OSs com ano < 2024.

Para cada OS com AnoProtocolo anterior ao ano de corte, exclui da tabAndamento
todos os registros em que UltimoStatus não é TRUE (1), preservando apenas o(s)
andamento(s) marcado(s) como último status.

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

DELETE_BATCH = 5000

QUERY_RESUMO = """
    SELECT
        COUNT(*) AS total_andamentos,
        SUM(CASE WHEN COALESCE(a.UltimoStatus, 0) = 1 THEN 1 ELSE 0 END) AS mantidos_ultimo_status,
        SUM(CASE WHEN COALESCE(a.UltimoStatus, 0) != 1 THEN 1 ELSE 0 END) AS andamentos_a_remover,
        COUNT(DISTINCT CASE
            WHEN COALESCE(a.UltimoStatus, 0) != 1
            THEN CONCAT(a.NroProtocoloLink, '/', a.AnoProtocoloLink)
        END) AS os_com_remocao
    FROM tabAndamento a
    INNER JOIN tabProtocolos p
        ON p.NroProtocolo = a.NroProtocoloLink
       AND p.AnoProtocolo = a.AnoProtocoloLink
    WHERE p.AnoProtocolo < %(ano_corte)s
"""

QUERY_OS_SEM_ULTIMO = """
    SELECT
        p.NroProtocolo AS nro,
        p.AnoProtocolo AS ano,
        COUNT(a.CodStatus) AS total_andamentos
    FROM tabProtocolos p
    INNER JOIN tabAndamento a
        ON a.NroProtocoloLink = p.NroProtocolo
       AND a.AnoProtocoloLink = p.AnoProtocolo
    WHERE p.AnoProtocolo < %(ano_corte)s
      AND NOT EXISTS (
          SELECT 1
          FROM tabAndamento ult
          WHERE ult.NroProtocoloLink = p.NroProtocolo
            AND ult.AnoProtocoloLink = p.AnoProtocolo
            AND ult.UltimoStatus = 1
      )
    GROUP BY p.NroProtocolo, p.AnoProtocolo
    ORDER BY p.AnoProtocolo, p.NroProtocolo
"""

QUERY_OS_MULTIPLOS_ULTIMO = """
    SELECT
        a.NroProtocoloLink AS nro,
        a.AnoProtocoloLink AS ano,
        COUNT(*) AS qtd_ultimo_status
    FROM tabAndamento a
    INNER JOIN tabProtocolos p
        ON p.NroProtocolo = a.NroProtocoloLink
       AND p.AnoProtocolo = a.AnoProtocoloLink
    WHERE p.AnoProtocolo < %(ano_corte)s
      AND a.UltimoStatus = 1
    GROUP BY a.NroProtocoloLink, a.AnoProtocoloLink
    HAVING COUNT(*) > 1
    ORDER BY a.AnoProtocoloLink, a.NroProtocoloLink
"""

QUERY_AMOSTRA = """
    SELECT
        a.CodStatus,
        a.NroProtocoloLink AS nro,
        a.AnoProtocoloLink AS ano,
        a.SituacaoLink,
        a.SetorLink,
        a.`Data`,
        a.UltimoStatus
    FROM tabAndamento a
    INNER JOIN tabProtocolos p
        ON p.NroProtocolo = a.NroProtocoloLink
       AND p.AnoProtocolo = a.AnoProtocoloLink
    WHERE p.AnoProtocolo < %(ano_corte)s
      AND COALESCE(a.UltimoStatus, 0) != 1
    ORDER BY a.AnoProtocoloLink, a.NroProtocoloLink, a.`Data`
    LIMIT %(limite)s
"""

QUERY_DELETE_LOTE = """
    DELETE FROM tabAndamento
    WHERE CodStatus IN (
        SELECT CodStatus FROM (
            SELECT a.CodStatus
            FROM tabAndamento a
            INNER JOIN tabProtocolos p
                ON p.NroProtocolo = a.NroProtocoloLink
               AND p.AnoProtocolo = a.AnoProtocoloLink
            WHERE p.AnoProtocolo < %(ano_corte)s
              AND COALESCE(a.UltimoStatus, 0) != 1
            LIMIT %(batch)s
        ) AS _delete_batch
    )
"""


def setup_logging() -> None:
    log_path = os.path.join(ROOT_DIR, "remover_andamentos_os_antigas.log")
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


def _fetchall_dict(cursor: Any, query: str, params: dict) -> list[dict]:
    cursor.execute(query, params)
    rows = cursor.fetchall()
    if not rows:
        return []
    if isinstance(rows[0], dict):
        return list(rows)
    cols = [d[0] for d in cursor.description]
    return [dict(zip(cols, row)) for row in rows]


def coletar_diagnostico(conn: mysql.connector.MySQLConnection, ano_corte: int) -> dict:
    cursor = conn.cursor(dictionary=True)
    params = {"ano_corte": ano_corte}
    try:
        cursor.execute(QUERY_RESUMO, params)
        resumo = cursor.fetchone() or {}

        cursor.execute(
            """
            SELECT COUNT(*) AS total_os
            FROM tabProtocolos
            WHERE AnoProtocolo < %(ano_corte)s
            """,
            params,
        )
        total_os = (cursor.fetchone() or {}).get("total_os", 0)

        sem_ultimo = _fetchall_dict(cursor, QUERY_OS_SEM_ULTIMO, params)
        multiplos_ultimo = _fetchall_dict(cursor, QUERY_OS_MULTIPLOS_ULTIMO, params)
        amostra = _fetchall_dict(
            cursor,
            QUERY_AMOSTRA,
            {"ano_corte": ano_corte, "limite": 10},
        )

        return {
            "total_os": int(total_os),
            "total_andamentos_os_antigas": int(resumo.get("total_andamentos") or 0),
            "andamentos_a_remover": int(resumo.get("andamentos_a_remover") or 0),
            "andamentos_mantidos": int(resumo.get("mantidos_ultimo_status") or 0),
            "os_com_remocao": int(resumo.get("os_com_remocao") or 0),
            "os_sem_ultimo_status": sem_ultimo,
            "os_multiplos_ultimo_status": multiplos_ultimo,
            "amostra": amostra,
        }
    finally:
        cursor.close()


def log_diagnostico(diag: dict, ano_corte: int) -> None:
    logging.info("OSs com ano < %s: %s", ano_corte, diag["total_os"])
    logging.info(
        "Andamentos nessas OSs: %s (remover: %s, manter UltimoStatus=1: %s)",
        diag["total_andamentos_os_antigas"],
        diag["andamentos_a_remover"],
        diag["andamentos_mantidos"],
    )
    logging.info("OSs com ao menos um andamento a remover: %s", diag["os_com_remocao"])

    sem_ultimo = diag["os_sem_ultimo_status"]
    if sem_ultimo:
        logging.warning(
            "ATENÇÃO: %s OS(s) ficarão SEM nenhum andamento (não há UltimoStatus=1).",
            len(sem_ultimo),
        )
        for row in sem_ultimo[:10]:
            logging.warning(
                "  %s/%s — %s andamento(s) serão todos removidos",
                row["nro"],
                row["ano"],
                row["total_andamentos"],
            )
        if len(sem_ultimo) > 10:
            logging.warning("  ... e mais %s OS(s)", len(sem_ultimo) - 10)

    multiplos = diag["os_multiplos_ultimo_status"]
    if multiplos:
        logging.info(
            "OSs com mais de um UltimoStatus=1 (todos serão mantidos): %s",
            len(multiplos),
        )
        for row in multiplos[:5]:
            logging.info(
                "  %s/%s — %s registro(s) com UltimoStatus=1",
                row["nro"],
                row["ano"],
                row["qtd_ultimo_status"],
            )

    if diag["amostra"]:
        logging.info("Amostra de andamentos a remover (até 10):")
        for row in diag["amostra"]:
            logging.info(
                "  %s — %s/%s — %s / %s — UltimoStatus=%s",
                row["CodStatus"],
                row["nro"],
                row["ano"],
                row.get("SituacaoLink") or "-",
                row.get("SetorLink") or "-",
                row.get("UltimoStatus"),
            )


def remover_em_lotes(
    conn: mysql.connector.MySQLConnection,
    *,
    ano_corte: int,
    batch_size: int,
) -> int:
    cursor = conn.cursor()
    removidos = 0

    try:
        while True:
            cursor.execute(
                QUERY_DELETE_LOTE,
                {"ano_corte": ano_corte, "batch": batch_size},
            )
            afetados = cursor.rowcount
            if afetados <= 0:
                break
            removidos += afetados
            conn.commit()
            if removidos <= batch_size or removidos % (batch_size * 10) == 0:
                logging.info("Removidos até agora: %s", removidos)
    except MySQLError:
        conn.rollback()
        raise
    finally:
        cursor.close()

    return removidos


def executar(
    *,
    ano_corte: int,
    dry_run: bool,
    assume_yes: bool,
    batch_size: int,
) -> int:
    conn = connect_mysql()
    try:
        diag = coletar_diagnostico(conn, ano_corte)
        log_diagnostico(diag, ano_corte)

        if diag["andamentos_a_remover"] == 0:
            logging.info("Nenhum andamento para remover.")
            return 0

        if dry_run:
            logging.info("Modo dry-run: nenhuma exclusão gravada.")
            return 0

        if not assume_yes:
            print()
            print(
                f"Serão removidos {diag['andamentos_a_remover']} andamento(s) "
                f"de OSs com ano < {ano_corte}."
            )
            print(
                f"Permanecerão {diag['andamentos_mantidos']} registro(s) "
                "com UltimoStatus=TRUE."
            )
            if diag["os_sem_ultimo_status"]:
                print(
                    f"AVISO: {len(diag['os_sem_ultimo_status'])} OS(s) ficarão "
                    "sem nenhum andamento."
                )
            print("Os MDBs NÃO serão alterados.")
            resposta = input("Confirmar exclusão? (digite SIM): ").strip()
            if resposta != "SIM":
                logging.info("Operação cancelada pelo usuário.")
                return 1

        removidos = remover_em_lotes(conn, ano_corte=ano_corte, batch_size=batch_size)
        logging.info("Concluído: %s andamento(s) removido(s).", removidos)
        return 0
    finally:
        conn.close()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Remove andamentos históricos de OSs antigas no MySQL, "
            "mantendo apenas UltimoStatus=TRUE."
        )
    )
    parser.add_argument(
        "--ano-corte",
        type=int,
        default=2024,
        help="Ano limite (padrão: 2024). Processa OSs com AnoProtocolo menor que este valor.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Exibe diagnóstico sem excluir registros.",
    )
    parser.add_argument(
        "-y",
        "--yes",
        action="store_true",
        help="Executa sem pedir confirmação interativa.",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=DELETE_BATCH,
        help=f"Tamanho do lote de DELETE (padrão: {DELETE_BATCH}).",
    )
    return parser.parse_args()


def main() -> int:
    setup_logging()
    args = parse_args()
    if args.batch_size < 1:
        logging.error("--batch-size deve ser >= 1.")
        return 1

    logging.info("Início da limpeza — %s", datetime.now().isoformat(timespec="seconds"))
    return executar(
        ano_corte=args.ano_corte,
        dry_run=args.dry_run,
        assume_yes=args.yes,
        batch_size=args.batch_size,
    )


if __name__ == "__main__":
    raise SystemExit(main())
