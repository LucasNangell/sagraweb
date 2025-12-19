"""
Sincroniza tabProtocolos e tabDetalhesServico dos MDBs (OS_Atual e Papelaria)
para o MySQL, limitando-se às OSs do ano de 2025. Mantém o MySQL alinhado com
os dados de origem: insere/atualiza registros existentes nos MDBs e remove do
MySQL aqueles do ano de 2025 que não existem em nenhum MDB.
"""

import json
import logging
from typing import Dict, Tuple, List

import mysql.connector
import pyodbc


YEAR_TARGET = 2025


class Config:
    def __init__(self, cfg: Dict):
        self.mysql_host = cfg.get("db_host", "localhost")
        self.mysql_port = cfg.get("db_port", 3306)
        self.mysql_user = cfg.get("db_user", "root")
        self.mysql_password = cfg.get("db_password", "")
        self.mysql_database = cfg.get("db_name", "sagrafulldb")
        self.mdb_os_atual_path = cfg.get("mdb_os_atual_path")
        self.mdb_papelaria_path = cfg.get("mdb_papelaria_path")

    @classmethod
    def load(cls, filepath: str = "config.json"):
        with open(filepath, "r", encoding="utf-8") as f:
            return cls(json.load(f))


def get_mysql_conn(cfg: Config):
    return mysql.connector.connect(
        host=cfg.mysql_host,
        port=cfg.mysql_port,
        user=cfg.mysql_user,
        password=cfg.mysql_password,
        database=cfg.mysql_database,
        charset="utf8mb4",
        autocommit=False,
    )


def get_mdb_conn(path: str):
    driver = "{Microsoft Access Driver (*.mdb, *.accdb)}"
    conn_str = f"DRIVER={driver};DBQ={path};"
    return pyodbc.connect(conn_str, autocommit=False)


def fetch_protocolos_mdb(conn: pyodbc.Connection) -> Dict[Tuple[int, int], Dict]:
    cur = conn.cursor()
    cur.execute(
        """
        SELECT NroProtocolo, AnoProtocolo, NomeUsuario, EntregData, EntregPrazoLink
        FROM tabProtocolos
        WHERE AnoProtocolo = ?
        """,
        (YEAR_TARGET,),
    )
    cols = [c[0] for c in cur.description]
    data = { (row[0], row[1]): dict(zip(cols, row)) for row in cur.fetchall() }
    cur.close()
    return data


def fetch_detalhes_mdb(conn: pyodbc.Connection) -> Dict[Tuple[int, int], Dict]:
    cur = conn.cursor()
    cur.execute(
        """
        SELECT NroProtocoloLinkDet, AnoProtocoloLinkDet, Titulo, TipoPublicacaoLink, Tiragem
        FROM tabDetalhesServico
        WHERE AnoProtocoloLinkDet = ?
        """,
        (YEAR_TARGET,),
    )
    cols = [c[0] for c in cur.description]
    data = { (row[0], row[1]): dict(zip(cols, row)) for row in cur.fetchall() }
    cur.close()
    return data


def merge_sources(primary: Dict, secondary: Dict) -> Dict:
    """Merge two dicts keyed by (nro, ano); primary has priority."""
    merged = dict(secondary)
    merged.update(primary)
    return merged


def upsert_protocolos_mysql(conn, rows: Dict[Tuple[int, int], Dict]):
    cur = conn.cursor()
    sql = (
        """
        INSERT INTO tabProtocolos (NroProtocolo, AnoProtocolo, NomeUsuario, EntregData, EntregPrazoLink)
        VALUES (%s, %s, %s, %s, %s)
        ON DUPLICATE KEY UPDATE
            NomeUsuario = VALUES(NomeUsuario),
            EntregData = VALUES(EntregData),
            EntregPrazoLink = VALUES(EntregPrazoLink)
        """
    )
    data = [
        (
            r["NroProtocolo"],
            r["AnoProtocolo"],
            r.get("NomeUsuario"),
            r.get("EntregData"),
            r.get("EntregPrazoLink"),
        )
        for r in rows.values()
    ]
    if data:
        cur.executemany(sql, data)
    conn.commit()
    cur.close()


def upsert_detalhes_mysql(conn, rows: Dict[Tuple[int, int], Dict]):
    cur = conn.cursor()
    sql = (
        """
        INSERT INTO tabDetalhesServico (NroProtocoloLinkDet, AnoProtocoloLinkDet, Titulo, TipoPublicacaoLink, Tiragem)
        VALUES (%s, %s, %s, %s, %s)
        ON DUPLICATE KEY UPDATE
            Titulo = VALUES(Titulo),
            TipoPublicacaoLink = VALUES(TipoPublicacaoLink),
            Tiragem = VALUES(Tiragem)
        """
    )
    data = [
        (
            r["NroProtocoloLinkDet"],
            r["AnoProtocoloLinkDet"],
            r.get("Titulo"),
            r.get("TipoPublicacaoLink"),
            r.get("Tiragem"),
        )
        for r in rows.values()
    ]
    if data:
        cur.executemany(sql, data)
    conn.commit()
    cur.close()


def delete_absent_protocolos(conn, keep_keys: set):
    cur = conn.cursor()
    if keep_keys:
        placeholders = ", ".join(["(%s,%s)"] * len(keep_keys))
        flat = [item for key in keep_keys for item in key]
        cur.execute(
            f"""
            DELETE FROM tabProtocolos
            WHERE AnoProtocolo = %s AND (NroProtocolo, AnoProtocolo) NOT IN ({placeholders})
            """,
            (YEAR_TARGET, *flat),
        )
    else:
        cur.execute("DELETE FROM tabProtocolos WHERE AnoProtocolo = %s", (YEAR_TARGET,))
    conn.commit()
    cur.close()


def delete_absent_detalhes(conn, keep_keys: set):
    cur = conn.cursor()
    if keep_keys:
        placeholders = ", ".join(["(%s,%s)"] * len(keep_keys))
        flat = [item for key in keep_keys for item in key]
        cur.execute(
            f"""
            DELETE FROM tabDetalhesServico
            WHERE AnoProtocoloLinkDet = %s AND (NroProtocoloLinkDet, AnoProtocoloLinkDet) NOT IN ({placeholders})
            """,
            (YEAR_TARGET, *flat),
        )
    else:
        cur.execute("DELETE FROM tabDetalhesServico WHERE AnoProtocoloLinkDet = %s", (YEAR_TARGET,))
    conn.commit()
    cur.close()


def sync():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
    cfg = Config.load()

    mysql_conn = None
    mdb_os = None
    mdb_pap = None
    try:
        mysql_conn = get_mysql_conn(cfg)
        mdb_os = get_mdb_conn(cfg.mdb_os_atual_path)
        mdb_pap = get_mdb_conn(cfg.mdb_papelaria_path)

        prot_os = fetch_protocolos_mdb(mdb_os)
        prot_pap = fetch_protocolos_mdb(mdb_pap)
        det_os = fetch_detalhes_mdb(mdb_os)
        det_pap = fetch_detalhes_mdb(mdb_pap)

        protocolos = merge_sources(prot_os, prot_pap)
        detalhes = merge_sources(det_os, det_pap)

        logging.info("Protocolos 2025 encontrados: %d", len(protocolos))
        logging.info("Detalhes 2025 encontrados: %d", len(detalhes))

        upsert_protocolos_mysql(mysql_conn, protocolos)
        upsert_detalhes_mysql(mysql_conn, detalhes)

        delete_absent_protocolos(mysql_conn, set(protocolos.keys()))
        delete_absent_detalhes(mysql_conn, set(detalhes.keys()))

        logging.info("Sincronizacao concluida")
    finally:
        for c in [mysql_conn, mdb_os, mdb_pap]:
            try:
                if c:
                    c.close()
            except Exception:
                pass


if __name__ == "__main__":
    sync()
