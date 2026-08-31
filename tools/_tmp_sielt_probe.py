"""Read-only: sample SIELT Em Execução andamentos."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "app" / "backend"))

import pymysql
from config_manager import config_manager


def main():
    cfg = config_manager.get_mysql_config()
    conn = pymysql.connect(
        host=cfg["host"],
        port=int(cfg.get("port", 3306)),
        user=cfg["user"],
        password=cfg["password"],
        database=cfg["database"],
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
        read_timeout=120,
        connect_timeout=15,
    )
    cur = conn.cursor()

    cur.execute(
        """
        SELECT SituacaoLink, COUNT(*) n
        FROM tabAndamento
        WHERE SetorLink = 'SIELT'
        GROUP BY SituacaoLink
        ORDER BY n DESC
        LIMIT 20
        """
    )
    print("=== SIELT by situacao ===")
    for r in cur.fetchall():
        print(r)

    cur.execute(
        """
        SELECT COUNT(*) n
        FROM tabAndamento
        WHERE SituacaoLink = 'Em Execução' AND SetorLink = 'SIELT'
        """
    )
    print("em execucao SIELT", cur.fetchone())

    cur.execute(
        """
        SELECT
          TRIM(SUBSTRING(`Observaçao`, LOCATE(CHAR(10), REPLACE(`Observaçao`, CHAR(13), CHAR(10))) + 1, 80)) AS body,
          COUNT(*) AS n
        FROM tabAndamento
        WHERE SituacaoLink = 'Em Execução' AND SetorLink = 'SIELT'
        GROUP BY body
        ORDER BY n DESC
        LIMIT 30
        """
    )
    print("=== obs bodies ===")
    for r in cur.fetchall():
        print(json.dumps(r, default=str, ensure_ascii=False))

    cur.execute(
        """
        SELECT LEFT(`Observaçao`, 120) AS obs, `Data`, NroProtocoloLink, AnoProtocoloLink
        FROM tabAndamento
        WHERE SituacaoLink = 'Em Execução' AND SetorLink = 'SIELT'
        ORDER BY `Data` DESC
        LIMIT 15
        """
    )
    print("=== recent samples ===")
    for r in cur.fetchall():
        print(json.dumps(r, default=str, ensure_ascii=False))

    cur.execute(
        """
        SELECT YEAR(`Data`) y, COUNT(*) n
        FROM tabAndamento
        WHERE SituacaoLink = 'Em Execução' AND SetorLink = 'SIELT'
        GROUP BY YEAR(`Data`)
        ORDER BY y
        """
    )
    print("=== by year ===")
    for r in cur.fetchall():
        print(r)

    cur.execute(
        """
        SELECT TRIM(d.MaquinaLink) maquina, COUNT(*) n
        FROM tabAndamento a
        LEFT JOIN tabDetalhesServico d
          ON d.NroProtocoloLinkDet = a.NroProtocoloLink
         AND d.AnoProtocoloLinkDet = a.AnoProtocoloLink
        WHERE a.SituacaoLink = 'Em Execução' AND a.SetorLink = 'SIELT'
        GROUP BY TRIM(d.MaquinaLink)
        ORDER BY n DESC
        LIMIT 20
        """
    )
    print("=== maquina ===")
    for r in cur.fetchall():
        print(r)

    conn.close()


if __name__ == "__main__":
    main()
