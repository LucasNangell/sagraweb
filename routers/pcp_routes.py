import logging
from typing import List, Tuple
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, validator

from database import db
from pcp_queue_service import ensure_pcp_table, persist_order, validate_os_in_setor
from routers.realtime import manager

router = APIRouter()
logger = logging.getLogger(__name__)

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
        # Notify PCP-aware screens
        import asyncio
        asyncio.create_task(manager.broadcast({"type": "pcp_queue_update", "setor": setor}))
        # Keep legacy dashboards in sync
        asyncio.create_task(manager.broadcast({"type": "system_update", "setor": setor}))
    except Exception as exc:
        logger.error("Erro ao agendar broadcast PCP: %s", exc)

@router.get("/pcp/queue")
def get_pcp_queue(setor: str = Query(..., description="Setor da fila PCP")):
    ensure_pcp_table()
    base_setor, situacoes = _resolve_setor(setor)

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
        a.SituacaoLink AS situacao,
        %s AS setor,
        p.EntregData AS data_entrega,
        p.EntregPrazoLink AS prioridade,
        a.Data AS last_update,
        a.`Observaçao` AS observacao,
        pcp.ordem AS pcp_ordem,
        pcp.ultima_atualizacao AS pcp_ultima_atualizacao
    FROM tabProtocolos AS p
    LEFT JOIN tabDetalhesServico AS d 
        ON (p.NroProtocolo = d.NroProtocoloLinkDet AND p.AnoProtocolo = d.AnoProtocoloLinkDet)
    LEFT JOIN tabAndamento AS a 
        ON (p.NroProtocolo = a.NroProtocoloLink AND p.AnoProtocolo = a.AnoProtocoloLink)
    LEFT JOIN tab_pcp_fila AS pcp
                ON (pcp.setor = %s AND pcp.nro_os = p.NroProtocolo AND pcp.ano = p.AnoProtocolo)
    WHERE a.UltimoStatus = 1
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
        rows = db.execute_query(query, params)
        return {"setor": setor, "items": rows}
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

    _broadcast_updates(setor)
    return {"status": "ok", "count": len(pairs)}
