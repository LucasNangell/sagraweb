import logging
import os
import time
from typing import Dict, List, Tuple

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import BaseModel, validator

from database import db
from pcp_queue_service import ensure_pcp_table, persist_order, validate_os_in_setor
router = APIRouter()
logger = logging.getLogger(__name__)

def _pcp_queue_cache_ttl_sec() -> float:
    try:
        return max(0.0, float(os.getenv("SAGRA_PCP_QUEUE_CACHE_SEC", "8")))
    except (TypeError, ValueError):
        return 8.0


_PCP_QUEUE_CACHE: Dict[str, tuple[float, dict]] = {}


def _invalidate_pcp_queue_cache(setor: str | None = None) -> None:
    if setor:
        _PCP_QUEUE_CACHE.pop(setor.strip(), None)
    else:
        _PCP_QUEUE_CACHE.clear()


def invalidate_pcp_queue_cache(setor: str | None = None) -> None:
    """Invalida cache in-memory da fila PCP (usar após andamentos/alterações operacionais)."""
    _invalidate_pcp_queue_cache(setor)


VIRTUAL_SETORES = {
    "Gravação": {
        "base_setor": "SEFOC",
        "situacoes": ["Gravação", "Gravação Parcial"],
    }
}

def _resolve_setor(setor: str):
    cfg = VIRTUAL_SETORES.get(setor)
    if cfg:
        return cfg["base_setor"], cfg.get("situacoes", [])
    return setor, []

def _dedupe_queue_rows(rows):
    """Garante no máximo uma linha por (nr_os, ano), preservando ordem."""
    seen = set()
    unique = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        key = (row.get("nr_os"), row.get("ano"))
        if key in seen:
            continue
        seen.add(key)
        unique.append(row)
    return unique

class PCPItem(BaseModel):
    nr_os: int
    ano: int

class ReorderRequest(BaseModel):
    setor: str
    items: List[PCPItem]

    @validator("setor")
    def _strip_setor(cls, value: str) -> str:
        if not value or not value.strip():
            raise ValueError("setor obrigatorio")
        return value.strip()

def _broadcast_updates(setor: str):
    """Fire-and-forget broadcast for dashboards/PCP listeners."""
    try:
        from routers.realtime import schedule_broadcast

        schedule_broadcast({"type": "pcp_queue_update", "setor": setor})
        schedule_broadcast({"type": "system_update", "setor": setor})
    except Exception as exc:
        logger.error("Erro ao agendar broadcast PCP: %s", exc)

@router.get("/pcp/queue")
def get_pcp_queue(
    response: Response,
    setor: str = Query(..., description="Setor da fila PCP"),
    painel: bool = Query(
        False,
        description="Painel TV: omite previsões ML (resposta mais rápida)",
    ),
):
    ensure_pcp_table()
    setor_key = setor.strip()
    ttl = _pcp_queue_cache_ttl_sec()
    if ttl > 0:
        cached = _PCP_QUEUE_CACHE.get(setor_key)
        if cached and (time.time() - cached[0]) < ttl:
            response.headers["X-Sagra-Cache"] = "hit"
            response.headers["Cache-Control"] = f"private, max-age={int(ttl)}"
            return cached[1]

    base_setor, situacoes = _resolve_setor(setor_key)

    situacao_filter = ""
    situacao_params = []
    if situacoes:
        placeholders = ", ".join(["%s"] * len(situacoes))
        situacao_filter = f" AND a.SituacaoLink IN ({placeholders})"
        situacao_params = situacoes

    query = f"""
    SELECT 
        p.NroProtocolo AS nr_os,
        p.AnoProtocolo AS ano,
        d.Titulo AS titulo,
        d.TipoPublicacaoLink AS produto,
        d.FormatoLink AS formato,
        d.Tiragem AS tiragem,
        d.Pags AS pags,
        a.SituacaoLink AS situacao,
        %s AS setor,
        p.EntregData AS data_entrega,
        p.EntregPeriodo AS entreg_periodo,
        p.EntregPrazoLink AS prioridade,
        p.NomeUsuario AS nome_usuario,
        a.Data AS last_update,
        a.`Observaçao` AS observacao,
        pcp.ordem AS pcp_ordem,
        pcp.ultima_atualizacao AS pcp_ultima_atualizacao
    FROM tabProtocolos AS p
    LEFT JOIN tabDetalhesServico AS d 
        ON (p.NroProtocolo = d.NroProtocoloLinkDet AND p.AnoProtocolo = d.AnoProtocoloLinkDet)
    LEFT JOIN tabAndamento AS a
        ON a.CodStatus = (
            SELECT a2.CodStatus
            FROM tabAndamento AS a2
            WHERE a2.NroProtocoloLink = p.NroProtocolo
              AND a2.AnoProtocoloLink = p.AnoProtocolo
              AND a2.UltimoStatus = 1
            ORDER BY a2.`Data` DESC, a2.CodStatus DESC
            LIMIT 1
        )
    LEFT JOIN tab_pcp_fila AS pcp
                ON (pcp.setor = %s AND pcp.nro_os = p.NroProtocolo AND pcp.ano = p.AnoProtocolo)
    WHERE a.CodStatus IS NOT NULL
            AND a.SetorLink = %s
      AND a.SituacaoLink NOT IN ('Entregue', 'Cancelada', 'Cancelado')
      {situacao_filter}
    ORDER BY 
        CASE WHEN pcp.ordem IS NULL THEN 1 ELSE 0 END,
        pcp.ordem ASC,
        CASE 
            WHEN p.EntregPrazoLink LIKE '%%Prometido p/%%' THEN 0
            WHEN p.EntregPrazoLink LIKE '%%Solicitado p/%%' THEN 1
            ELSE 2
        END ASC,
        p.EntregData ASC,
        p.AnoProtocolo DESC,
        p.NroProtocolo DESC
    """
    try:
        params = [setor, setor, base_setor] + situacao_params
        main_rows = db.execute_query(query, params)
        from services.os_sub_os_queries import (
            dedupe_queue_rows_with_sub_os,
            fetch_sub_os_queue_rows,
        )

        sub_rows = fetch_sub_os_queue_rows(
            base_setor=base_setor,
            display_setor=setor_key,
            situacoes=situacoes or None,
        )
        items = dedupe_queue_rows_with_sub_os(list(main_rows or []) + sub_rows)
        if not painel:
            try:
                from services.pcp_prediction_service import enrich_queue_items

                items = enrich_queue_items(
                    items,
                    base_setor=base_setor,
                    allowed_situacoes=situacoes or None,
                )
            except Exception as exc:
                logger.warning("Previsões PCP indisponíveis para %s: %s", setor_key, exc)

        payload = {
            "setor": setor_key,
            "items": items,
        }
        if ttl > 0:
            _PCP_QUEUE_CACHE[setor_key] = (time.time(), payload)
            response.headers["X-Sagra-Cache"] = "miss"
            response.headers["Cache-Control"] = f"private, max-age={int(ttl)}"
        return payload
    except Exception as exc:
        logger.error("Erro ao buscar fila PCP: %s", exc)
        raise HTTPException(status_code=500, detail="Erro ao buscar fila do setor")

@router.post("/pcp/queue/reorder")
async def reorder_pcp_queue(payload: ReorderRequest):
    ensure_pcp_table()
    setor = payload.setor.strip()
    base_setor, situacoes = _resolve_setor(setor)

    if payload.items is None:
        raise HTTPException(status_code=400, detail="Lista de itens ausente")

    if len(payload.items) == 0:
        try:
            persist_order(setor, [])
            _invalidate_pcp_queue_cache(setor)
            _broadcast_updates(setor)
            return {"status": "ok", "count": 0}
        except Exception as exc:
            logger.error("Erro ao limpar fila PCP: %s", exc)
            raise HTTPException(status_code=500, detail="Erro ao limpar fila")

    seen = set()
    pairs: List[Tuple[int, int]] = []
    for item in payload.items:
        key = (item.nr_os, item.ano)
        if key in seen:
            raise HTTPException(status_code=400, detail=f"OS duplicada na fila: {item.nr_os}/{item.ano}")
        seen.add(key)
        pairs.append(key)

    valid_pairs = validate_os_in_setor(setor, pairs, allowed_situacoes=situacoes, base_setor=base_setor)
    missing = [f"{nr}/{ano}" for nr, ano in pairs if (nr, ano) not in valid_pairs]
    if missing:
        raise HTTPException(status_code=400, detail=f"OS fora do setor ou finalizada: {', '.join(missing)}")

    try:
        persist_order(setor, pairs)
    except Exception as exc:
        logger.error("Erro salvando fila PCP: %s", exc)
        raise HTTPException(status_code=500, detail="Erro ao salvar ordenação")

    _invalidate_pcp_queue_cache(setor)
    _broadcast_updates(setor)
    return {"status": "ok", "count": len(pairs)}
