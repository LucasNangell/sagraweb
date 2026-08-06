"""Pendências de e-mail — OS/SP em Encam. de Docum. no setor SEFOC."""
from __future__ import annotations

from typing import Any, List

from database import db
from services.os_componentes_service import MANUAL_ANDAMENTO_SQL

PENDENCIA_SITUACAO = "Encam. de Docum."
# Colunas textuais do UNION vêm de tabAndamento (legado) e tab_os_sub_os_andamento.
_UNION_COLLATE = "utf8mb4_unicode_ci"


def _union_text(expr: str) -> str:
    return f"CONVERT({expr} USING utf8mb4) COLLATE {_UNION_COLLATE}"


def fetch_email_pendencias(setor: str = "SEFOC") -> List[dict[str, Any]]:
    """
    Lista OS e SP aguardando envio de e-mail.

    Inclui:
    - Andamento principal (tabAndamento.UltimoStatus=1) com situação/setor informados;
    - Sub OS com ultimo_status=1 em tab_os_sub_os_andamento (SPs com componentes).
    """
    setor_filter = (setor or "SEFOC").strip() or "SEFOC"
    manual_exists = MANUAL_ANDAMENTO_SQL.replace("sa.", "sa_m.")

    query = f"""
        SELECT os, ano, produto, observacao, situacao, setor, data
        FROM (
            SELECT
                p.NroProtocolo AS os,
                p.AnoProtocolo AS ano,
                {_union_text("d.TipoPublicacaoLink")} AS produto,
                {_union_text("a.`Observaçao`")} AS observacao,
                {_union_text("a.SituacaoLink")} AS situacao,
                {_union_text("a.SetorLink")} AS setor,
                a.`Data` AS data
            FROM tabProtocolos p
            INNER JOIN tabAndamento a
                ON p.NroProtocolo = a.NroProtocoloLink
               AND p.AnoProtocolo = a.AnoProtocoloLink
            LEFT JOIN tabDetalhesServico d
                ON p.NroProtocolo = d.NroProtocoloLinkDet
               AND p.AnoProtocolo = d.AnoProtocoloLinkDet
            WHERE a.SituacaoLink = %s
              AND a.UltimoStatus = 1
              AND a.SetorLink = %s

            UNION

            SELECT
                p.NroProtocolo AS os,
                p.AnoProtocolo AS ano,
                {_union_text("d.TipoPublicacaoLink")} AS produto,
                {_union_text("sa.observacao")} AS observacao,
                {_union_text("sa.situacao")} AS situacao,
                {_union_text("sa.setor")} AS setor,
                sa.data AS data
            FROM tab_os_sub_os s
            INNER JOIN tab_os_sub_os_andamento sa
                ON sa.sub_os_id = s.id AND sa.ultimo_status = 1
            INNER JOIN tabProtocolos p
                ON p.NroProtocolo = s.nro_protocolo
               AND p.AnoProtocolo = s.ano_protocolo
            LEFT JOIN tabDetalhesServico d
                ON p.NroProtocolo = d.NroProtocoloLinkDet
               AND p.AnoProtocolo = d.AnoProtocoloLinkDet
            WHERE s.ativo = 1
              AND s.congelada = 0
              AND sa.situacao = %s
              AND sa.setor = %s
              AND EXISTS (
                  SELECT 1 FROM tab_os_sub_os_andamento sa_m
                  WHERE sa_m.sub_os_id = s.id AND {manual_exists}
              )
        ) AS pendencias
        ORDER BY `data` DESC
    """
    params = (
        PENDENCIA_SITUACAO,
        setor_filter,
        PENDENCIA_SITUACAO,
        setor_filter,
    )
    return db.execute_query(query, params) or []


def count_email_pendencias(setor: str = "SEFOC") -> int:
    setor_filter = (setor or "SEFOC").strip() or "SEFOC"
    manual_exists = MANUAL_ANDAMENTO_SQL.replace("sa.", "sa_m.")
    query = f"""
        SELECT COUNT(*) AS count FROM (
            SELECT p.NroProtocolo, p.AnoProtocolo
            FROM tabProtocolos p
            INNER JOIN tabAndamento a
                ON p.NroProtocolo = a.NroProtocoloLink
               AND p.AnoProtocolo = a.AnoProtocoloLink
            WHERE a.SituacaoLink = %s
              AND a.UltimoStatus = 1
              AND a.SetorLink = %s

            UNION

            SELECT p.NroProtocolo, p.AnoProtocolo
            FROM tab_os_sub_os s
            INNER JOIN tab_os_sub_os_andamento sa
                ON sa.sub_os_id = s.id AND sa.ultimo_status = 1
            INNER JOIN tabProtocolos p
                ON p.NroProtocolo = s.nro_protocolo
               AND p.AnoProtocolo = s.ano_protocolo
            WHERE s.ativo = 1
              AND s.congelada = 0
              AND sa.situacao = %s
              AND sa.setor = %s
              AND EXISTS (
                  SELECT 1 FROM tab_os_sub_os_andamento sa_m
                  WHERE sa_m.sub_os_id = s.id AND {manual_exists}
              )
        ) AS pendencias
    """
    params = (
        PENDENCIA_SITUACAO,
        setor_filter,
        PENDENCIA_SITUACAO,
        setor_filter,
    )
    res = db.execute_query(query, params)
    if not res:
        return 0
    return int(res[0].get("count") or 0)


def merge_pendencias_lists(
    db_items: List[dict[str, Any]],
    apogee_items: List[dict[str, Any]],
) -> List[dict[str, Any]]:
    """Retorna pendências do banco (source=db) seguidas das Apogee (source=apogee)."""
    merged: List[dict[str, Any]] = []
    for row in db_items:
        item = dict(row)
        item.setdefault("source", "db")
        merged.append(item)
    for row in apogee_items:
        item = dict(row)
        item["source"] = "apogee"
        merged.append(item)
    return merged


def count_all_email_pendencias(
    setor: str = "SEFOC",
    apogee_count: int = 0,
) -> int:
    return count_email_pendencias(setor) + max(0, int(apogee_count or 0))
