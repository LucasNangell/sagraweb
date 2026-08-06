"""Auditoria de dados para previsão de prazo — somente SELECT. Uso único."""
from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path

import pymysql

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "app" / "backend"))

from config_manager import ConfigManager  # noqa: E402


def main() -> None:
    cfg = ConfigManager().get_mysql_config()
    conn = pymysql.connect(
        host=cfg["host"],
        port=cfg.get("port", 3306),
        user=cfg["user"],
        password=cfg["password"],
        database=cfg["database"],
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
        connect_timeout=15,
        read_timeout=180,
    )

    def q(sql: str, params=None):
        with conn.cursor() as cur:
            cur.execute(sql, params or ())
            return cur.fetchall()

    def q1(sql: str, params=None):
        rows = q(sql, params)
        return rows[0] if rows else {}

    results: dict = {}

    tables = [
        "tabProtocolos",
        "tabAndamento",
        "tabDetalhesServico",
        "tab_os_ultimo_andamento_operacional",
        "tab_os_componentes",
        "tab_os_sub_os",
        "tab_os_sub_os_andamento",
        "tab_pcp_fila",
        "tabProofTokens",
        "tabPapelariaJobs",
        "tabClienteGabinete",
        "tab_os_audit_log",
    ]
    counts = {}
    for t in tables:
        try:
            counts[t] = q1(f"SELECT COUNT(*) AS cnt FROM `{t}`")["cnt"]
        except Exception as exc:
            counts[t] = f"ERROR: {exc}"
    results["table_counts"] = counts

    results["os_totals"] = q1(
        """
        SELECT COUNT(*) AS total_os,
          SUM(CASE WHEN NroProtocolo < 5000 THEN 1 ELSE 0 END) AS os_normal_lt5000,
          SUM(CASE WHEN NroProtocolo >= 5000 THEN 1 ELSE 0 END) AS papelaria_gte5000
        FROM tabProtocolos
        """
    )

    results["os_by_year"] = q(
        """
        SELECT AnoProtocolo AS ano, COUNT(*) AS total,
          SUM(CASE WHEN NroProtocolo < 5000 THEN 1 ELSE 0 END) AS normal,
          SUM(CASE WHEN NroProtocolo >= 5000 THEN 1 ELSE 0 END) AS papelaria
        FROM tabProtocolos GROUP BY AnoProtocolo ORDER BY ano DESC LIMIT 15
        """
    )

    results["os_status_mat"] = q1(
        """
        SELECT COUNT(*) AS total_mat,
          SUM(CASE WHEN situacao IN ('Entregue') THEN 1 ELSE 0 END) AS entregue,
          SUM(CASE WHEN situacao IN ('Cancelada','Cancelado') THEN 1 ELSE 0 END) AS cancelada,
          SUM(CASE WHEN situacao IS NULL OR situacao NOT IN ('Entregue','Cancelada','Cancelado') THEN 1 ELSE 0 END) AS ativa
        FROM tab_os_ultimo_andamento_operacional
        """
    )

    results["andamentos_stats"] = q1(
        """
        SELECT COUNT(*) AS total_andamentos,
          COUNT(DISTINCT CONCAT(NroProtocoloLink,'/',AnoProtocoloLink)) AS os_com_andamento,
          ROUND(COUNT(*) / NULLIF(COUNT(DISTINCT CONCAT(NroProtocoloLink,'/',AnoProtocoloLink)),0), 2) AS media_andamentos_por_os
        FROM tabAndamento
        """
    )

    results["date_nulls"] = q1(
        """
        SELECT COUNT(*) AS total,
          SUM(DataEntrada IS NULL) AS sem_data_entrada,
          SUM(EntregData IS NULL) AS sem_entreg_data,
          SUM(DataConclusao IS NULL) AS sem_data_conclusao,
          SUM(RecebimData IS NULL) AS sem_recebim_data,
          SUM(EntregPrazoLink IS NULL OR TRIM(EntregPrazoLink) = '') AS sem_prioridade_texto
        FROM tabProtocolos
        """
    )

    results["entregue_sem_conclusao"] = q1(
        """
        SELECT COUNT(*) AS cnt FROM tab_os_ultimo_andamento_operacional ua
        INNER JOIN tabProtocolos p ON p.NroProtocolo = ua.nro_protocolo AND p.AnoProtocolo = ua.ano_protocolo
        WHERE ua.situacao = 'Entregue' AND p.DataConclusao IS NULL
        """
    )

    results["data_incoerente"] = q1(
        """
        SELECT
          SUM(CASE WHEN DataConclusao IS NOT NULL AND DataEntrada IS NOT NULL AND DataConclusao < DataEntrada THEN 1 ELSE 0 END) AS conclusao_antes_entrada,
          SUM(CASE WHEN EntregData IS NOT NULL AND DataEntrada IS NOT NULL AND EntregData < DataEntrada THEN 1 ELSE 0 END) AS prometida_antes_entrada,
          SUM(CASE WHEN DataConclusao IS NOT NULL AND EntregData IS NOT NULL AND DataConclusao > DATE_ADD(EntregData, INTERVAL 365 DAY) THEN 1 ELSE 0 END) AS conclusao_muito_apos_prometida
        FROM tabProtocolos
        """
    )

    results["datas_futuras"] = q1(
        """
        SELECT
          SUM(CASE WHEN DataEntrada > CURDATE() THEN 1 ELSE 0 END) AS entrada_futura,
          SUM(CASE WHEN EntregData > DATE_ADD(CURDATE(), INTERVAL 2 YEAR) THEN 1 ELSE 0 END) AS entreg_muito_futura,
          SUM(CASE WHEN DataConclusao > CURDATE() THEN 1 ELSE 0 END) AS conclusao_futura
        FROM tabProtocolos
        """
    )

    results["tempo_medio_conclusao"] = q1(
        """
        SELECT COUNT(*) AS os_entregues_com_datas,
          ROUND(AVG(DATEDIFF(p.DataConclusao, p.DataEntrada)), 1) AS media_dias,
          ROUND(AVG(DATEDIFF(p.DataConclusao, COALESCE(p.EntregData, p.DataEntrada))), 1) AS media_dias_vs_prometida_base
        FROM tabProtocolos p
        INNER JOIN tab_os_ultimo_andamento_operacional ua ON ua.nro_protocolo = p.NroProtocolo AND ua.ano_protocolo = p.AnoProtocolo
        WHERE ua.situacao = 'Entregue' AND p.DataEntrada IS NOT NULL AND p.DataConclusao IS NOT NULL
          AND p.DataConclusao >= p.DataEntrada
        """
    )

    results["tempo_por_produto"] = q(
        """
        SELECT d.TipoPublicacaoLink AS produto, COUNT(*) AS cnt,
          ROUND(AVG(DATEDIFF(p.DataConclusao, p.DataEntrada)), 1) AS media_dias
        FROM tabProtocolos p
        INNER JOIN tab_os_ultimo_andamento_operacional ua ON ua.nro_protocolo = p.NroProtocolo AND ua.ano_protocolo = p.AnoProtocolo
        INNER JOIN tabDetalhesServico d ON d.NroProtocoloLinkDet = p.NroProtocolo AND d.AnoProtocoloLinkDet = p.AnoProtocolo
        WHERE ua.situacao = 'Entregue' AND p.DataEntrada IS NOT NULL AND p.DataConclusao IS NOT NULL
          AND p.DataConclusao >= p.DataEntrada AND d.TipoPublicacaoLink IS NOT NULL AND TRIM(d.TipoPublicacaoLink) != ''
        GROUP BY d.TipoPublicacaoLink HAVING cnt >= 50 ORDER BY cnt DESC LIMIT 20
        """
    )

    results["tempo_por_prioridade"] = q(
        """
        SELECT
          CASE
            WHEN TRIM(COALESCE(p.EntregPrazoLink,'')) LIKE 'Prometido p/%%' THEN 'Prometido'
            WHEN TRIM(COALESCE(p.EntregPrazoLink,'')) LIKE 'Solicitado p/%%' THEN 'Solicitado'
            WHEN TRIM(COALESCE(p.EntregPrazoLink,'')) = '' THEN 'Vazio'
            ELSE 'Outros'
          END AS prioridade,
          COUNT(*) AS cnt,
          ROUND(AVG(DATEDIFF(p.DataConclusao, p.DataEntrada)), 1) AS media_dias,
          ROUND(AVG(CASE WHEN p.EntregData IS NOT NULL THEN DATEDIFF(p.DataConclusao, p.EntregData) END), 1) AS media_atraso_vs_prometida
        FROM tabProtocolos p
        INNER JOIN tab_os_ultimo_andamento_operacional ua ON ua.nro_protocolo = p.NroProtocolo AND ua.ano_protocolo = p.AnoProtocolo
        WHERE ua.situacao = 'Entregue' AND p.DataEntrada IS NOT NULL AND p.DataConclusao IS NOT NULL
        GROUP BY prioridade ORDER BY cnt DESC
        """
    )

    results["tempo_por_setor_inicial"] = q(
        """
        SELECT fa.setor_inicial, COUNT(*) AS cnt, ROUND(AVG(fa.dias), 1) AS media_dias FROM (
          SELECT p.NroProtocolo, p.AnoProtocolo, DATEDIFF(p.DataConclusao, p.DataEntrada) AS dias,
            (SELECT a2.SetorLink FROM tabAndamento a2
             WHERE a2.NroProtocoloLink = p.NroProtocolo AND a2.AnoProtocoloLink = p.AnoProtocolo
             ORDER BY a2.Data ASC, a2.CodStatus ASC LIMIT 1) AS setor_inicial
          FROM tabProtocolos p
          INNER JOIN tab_os_ultimo_andamento_operacional ua ON ua.nro_protocolo = p.NroProtocolo AND ua.ano_protocolo = p.AnoProtocolo
          WHERE ua.situacao = 'Entregue' AND p.DataEntrada IS NOT NULL AND p.DataConclusao IS NOT NULL
            AND p.DataConclusao >= p.DataEntrada
        ) fa
        WHERE fa.setor_inicial IS NOT NULL AND TRIM(fa.setor_inicial) != ''
        GROUP BY fa.setor_inicial HAVING cnt >= 30 ORDER BY cnt DESC LIMIT 15
        """
    )

    results["os_sem_andamento"] = q1(
        """
        SELECT COUNT(*) AS cnt FROM tabProtocolos p
        WHERE NOT EXISTS (
          SELECT 1 FROM tabAndamento a WHERE a.NroProtocoloLink = p.NroProtocolo AND a.AnoProtocoloLink = p.AnoProtocolo
        )
        """
    )

    results["multi_detalhes"] = q1(
        """
        SELECT COUNT(*) AS os_com_multiplos_detalhes FROM (
          SELECT NroProtocoloLinkDet, AnoProtocoloLinkDet, COUNT(*) AS c
          FROM tabDetalhesServico GROUP BY NroProtocoloLinkDet, AnoProtocoloLinkDet HAVING c > 1
        ) x
        """
    )

    results["detalhes_nulls"] = q1(
        """
        SELECT COUNT(*) AS total_detalhes,
          SUM(TipoPublicacaoLink IS NULL OR TRIM(TipoPublicacaoLink)='') AS sem_produto,
          SUM(Titulo IS NULL OR TRIM(Titulo)='') AS sem_titulo,
          SUM(Tiragem IS NULL OR Tiragem=0) AS sem_tiragem,
          SUM(Pags IS NULL OR Pags=0) AS sem_pags,
          SUM(FormatoLink IS NULL OR TRIM(FormatoLink)='') AS sem_formato,
          SUM(MaquinaLink IS NULL OR TRIM(MaquinaLink)='') AS sem_maquina
        FROM tabDetalhesServico
        """
    )

    results["treinamento"] = q1(
        """
        SELECT COUNT(*) AS entregues_total,
          SUM(CASE WHEN p.DataEntrada IS NOT NULL AND p.DataConclusao IS NOT NULL AND p.DataConclusao >= p.DataEntrada THEN 1 ELSE 0 END) AS com_datas_validas,
          SUM(CASE WHEN p.DataEntrada IS NOT NULL AND p.DataConclusao IS NOT NULL AND p.DataConclusao >= p.DataEntrada
            AND EXISTS (SELECT 1 FROM tabDetalhesServico d WHERE d.NroProtocoloLinkDet=p.NroProtocolo AND d.AnoProtocoloLinkDet=p.AnoProtocolo
              AND d.TipoPublicacaoLink IS NOT NULL AND TRIM(d.TipoPublicacaoLink)!='') THEN 1 ELSE 0 END) AS com_produto,
          SUM(CASE WHEN p.DataEntrada IS NOT NULL AND p.DataConclusao IS NOT NULL AND p.DataConclusao >= p.DataEntrada
            AND (SELECT COUNT(*) FROM tabAndamento a WHERE a.NroProtocoloLink=p.NroProtocolo AND a.AnoProtocoloLink=p.AnoProtocolo) >= 2 THEN 1 ELSE 0 END) AS com_2_andamentos
        FROM tabProtocolos p
        INNER JOIN tab_os_ultimo_andamento_operacional ua ON ua.nro_protocolo = p.NroProtocolo AND ua.ano_protocolo = p.AnoProtocolo
        WHERE ua.situacao = 'Entregue'
        """
    )

    results["ultimo_status_issues"] = q1(
        """
        SELECT
          SUM(CASE WHEN c > 1 THEN 1 ELSE 0 END) AS os_com_multiplos_ultimo_status,
          SUM(CASE WHEN c = 0 THEN 1 ELSE 0 END) AS os_sem_ultimo_status
        FROM (
          SELECT NroProtocoloLink, AnoProtocoloLink, SUM(UltimoStatus=1) AS c
          FROM tabAndamento GROUP BY NroProtocoloLink, AnoProtocoloLink
        ) t
        """
    )

    results["situacoes"] = q(
        """
        SELECT situacao, COUNT(*) AS cnt FROM tab_os_ultimo_andamento_operacional
        GROUP BY situacao ORDER BY cnt DESC LIMIT 25
        """
    )

    results["setores_ativos"] = q(
        """
        SELECT setor, COUNT(*) AS cnt FROM tab_os_ultimo_andamento_operacional
        WHERE situacao IS NULL OR situacao NOT IN ('Entregue','Cancelada','Cancelado')
        GROUP BY setor ORDER BY cnt DESC LIMIT 15
        """
    )

    results["proof_tokens"] = q1(
        """
        SELECT COUNT(*) AS total, SUM(DataResposta IS NOT NULL) AS com_resposta,
          SUM(Aprovado=1) AS aprovados, SUM(Aprovado=0 AND DataResposta IS NOT NULL) AS reprovados
        FROM tabProofTokens
        """
    )

    results["atraso_distrib"] = q1(
        """
        SELECT
          SUM(CASE WHEN p.EntregData IS NOT NULL AND p.DataConclusao <= p.EntregData THEN 1 ELSE 0 END) AS no_prazo,
          SUM(CASE WHEN p.EntregData IS NOT NULL AND p.DataConclusao > p.EntregData THEN 1 ELSE 0 END) AS atrasadas,
          SUM(CASE WHEN p.EntregData IS NULL THEN 1 ELSE 0 END) AS sem_data_prometida,
          ROUND(AVG(CASE WHEN p.EntregData IS NOT NULL THEN DATEDIFF(p.DataConclusao, p.EntregData) END), 1) AS media_dias_atraso
        FROM tabProtocolos p
        INNER JOIN tab_os_ultimo_andamento_operacional ua ON ua.nro_protocolo = p.NroProtocolo AND ua.ano_protocolo = p.AnoProtocolo
        WHERE ua.situacao = 'Entregue' AND p.DataConclusao IS NOT NULL
        """
    )

    results["tempo_normal_vs_papelaria"] = q1(
        """
        SELECT
          SUM(CASE WHEN p.NroProtocolo < 5000 THEN 1 ELSE 0 END) AS entregue_normal,
          ROUND(AVG(CASE WHEN p.NroProtocolo < 5000 THEN DATEDIFF(p.DataConclusao, p.DataEntrada) END), 1) AS media_normal,
          SUM(CASE WHEN p.NroProtocolo >= 5000 THEN 1 ELSE 0 END) AS entregue_papelaria,
          ROUND(AVG(CASE WHEN p.NroProtocolo >= 5000 THEN DATEDIFF(p.DataConclusao, p.DataEntrada) END), 1) AS media_papelaria
        FROM tabProtocolos p
        INNER JOIN tab_os_ultimo_andamento_operacional ua ON ua.nro_protocolo = p.NroProtocolo AND ua.ano_protocolo = p.AnoProtocolo
        WHERE ua.situacao = 'Entregue' AND p.DataEntrada IS NOT NULL AND p.DataConclusao IS NOT NULL
        """
    )

    results["mat_coverage"] = q1(
        """
        SELECT
          (SELECT COUNT(*) FROM tabProtocolos) AS protocolos,
          (SELECT COUNT(*) FROM tab_os_ultimo_andamento_operacional) AS materializada,
          (SELECT COUNT(*) FROM tabProtocolos p WHERE EXISTS (
            SELECT 1 FROM tabAndamento a WHERE a.NroProtocoloLink=p.NroProtocolo AND a.AnoProtocoloLink=p.AnoProtocolo
          )) AS protocolos_com_andamento
        """
    )

    results["retornos_setor"] = q1(
        """
        SELECT ROUND(AVG(retornos), 2) AS media_retornos_setor, MAX(retornos) AS max_retornos
        FROM (
          SELECT NroProtocoloLink, AnoProtocoloLink,
            COUNT(*) - COUNT(DISTINCT SetorLink) AS retornos
          FROM tabAndamento
          GROUP BY NroProtocoloLink, AnoProtocoloLink
        ) t
        """
    )

    conn.close()

    out = ROOT / "tools" / "audit_previsao_prazo_results.json"

    def default(o):
        if isinstance(o, datetime):
            return o.isoformat()
        return str(o)

    out.write_text(json.dumps(results, indent=2, default=default), encoding="utf-8")
    print(out)


if __name__ == "__main__":
    main()
