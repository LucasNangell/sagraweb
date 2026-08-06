"""Lista OS para CotasGraf; situação e lançamento usam ReqEntregue em tabProtocolos."""

from __future__ import annotations

import logging
from typing import Any, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from database import db
from services.cliente_cota_service import is_deputado_categoria, resolver_semestre_ativo_id
from services.cotas_graf_service import (
    build_cotas_graf_query,
    build_cotas_graf_solicitantes_cotas_query,
    build_solicitante_consumo_historico_query,
)
from services.deputados_camara_service import (
    is_deputado_em_exercicio_por_nome,
    obter_nomes_deputados_em_exercicio,
)

router = APIRouter()
logger = logging.getLogger(__name__)


def _as_bool(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return int(value) == 1
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "sim", "s")
    return bool(value)


class CotasGrafItem(BaseModel):
    nr_os: int
    ano: int
    produto: Optional[str] = None
    solicitante: Optional[str] = None
    titulo: Optional[str] = None
    cotas_graf_atualizado: bool = False


class CotasGrafListResponse(BaseModel):
    items: List[CotasGrafItem]
    total: int
    limit: int
    offset: int
    page: int


class CotasGrafLancarResponse(BaseModel):
    nr_os: int
    ano: int
    cotas_graf_atualizado: bool = True


class CotasGrafSolicitanteCotasItem(BaseModel):
    solicitante: Optional[str] = None
    categoria: Optional[str] = None
    cod_usuario: Optional[str] = None
    nome_usuario: Optional[str] = None
    consumo_os: int = 0
    limite_os: Optional[int] = None
    saldo_os: Optional[int] = None
    consumo_sp: int = 0
    limite_sp: Optional[int] = None
    saldo_sp: Optional[int] = None
    semestre_ano: Optional[int] = None
    semestre_numero: Optional[int] = None


class CotasGrafSolicitantesCotasResponse(BaseModel):
    items: List[CotasGrafSolicitanteCotasItem]
    total: int
    semestre_ano: Optional[int] = None
    semestre_numero: Optional[int] = None


class CotasGrafConsumoHistoricoItem(BaseModel):
    nr_os: int
    ano: int
    tipo: str
    produto: Optional[str] = None
    titulo: Optional[str] = None
    cota_consumida: int = 0
    data_entrada: Optional[str] = None
    origem: Optional[str] = None
    referencia_externa: Optional[str] = None


class CotasGrafConsumoHistoricoResponse(BaseModel):
    items: List[CotasGrafConsumoHistoricoItem]
    total: int


def _saldo_cota(limite: Any, consumo: Any) -> Optional[int]:
    if limite is None:
        return None
    return max(0, int(limite) - int(consumo or 0))


def _map_solicitante_cotas_row(row: dict[str, Any]) -> CotasGrafSolicitanteCotasItem:
    consumo_os = int(row.get("consumo_os") or 0)
    consumo_sp = int(row.get("consumo_sp") or 0)
    limite_os = row.get("limite_os")
    limite_sp = row.get("limite_sp")
    limite_os_int = int(limite_os) if limite_os is not None else None
    limite_sp_int = int(limite_sp) if limite_sp is not None else None
    return CotasGrafSolicitanteCotasItem(
        solicitante=row.get("solicitante"),
        categoria=row.get("categoria"),
        cod_usuario=row.get("cod_usuario"),
        nome_usuario=row.get("nome_usuario"),
        consumo_os=consumo_os,
        limite_os=limite_os_int,
        saldo_os=_saldo_cota(limite_os_int, consumo_os),
        consumo_sp=consumo_sp,
        limite_sp=limite_sp_int,
        saldo_sp=_saldo_cota(limite_sp_int, consumo_sp),
        semestre_ano=int(row["semestre_ano"]) if row.get("semestre_ano") is not None else None,
        semestre_numero=int(row["semestre_numero"])
        if row.get("semestre_numero") is not None
        else None,
    )


def _filtrar_solicitantes_deputados_em_exercicio(
    items: List[CotasGrafSolicitanteCotasItem],
) -> List[CotasGrafSolicitanteCotasItem]:
    """Mantém não-deputados; deputados só se constarem na API da Câmara (em exercício)."""
    try:
        nomes_em_exercicio = obter_nomes_deputados_em_exercicio()
    except Exception as exc:
        logger.warning(
            "Não foi possível obter deputados em exercício da API da Câmara: %s",
            exc,
        )
        return items

    if not nomes_em_exercicio:
        logger.warning(
            "Lista de deputados em exercício vazia; exibindo todos os solicitantes deputados"
        )
        return items

    filtrados: List[CotasGrafSolicitanteCotasItem] = []
    for item in items:
        if is_deputado_categoria(item.categoria):
            nome = (item.solicitante or item.nome_usuario or "").strip()
            if not is_deputado_em_exercicio_por_nome(
                nome,
                nomes_em_exercicio=nomes_em_exercicio,
            ):
                continue
        filtrados.append(item)
    return filtrados


@router.get("/cotas-graf/list", response_model=CotasGrafListResponse)
def list_cotas_graf(
    nr_os: Optional[int] = Query(None),
    ano: Optional[int] = Query(None),
    ano_mode: str = Query("specific"),
    produto: Optional[str] = Query(None),
    produtos: Optional[List[str]] = Query(None),
    titulo: Optional[str] = Query(None),
    solicitante: Optional[str] = Query(None),
    solicitantes: Optional[List[str]] = Query(None),
    situacao_cotas: Optional[List[str]] = Query(None),
    include_finished: bool = Query(False),
    include_os: bool = Query(True),
    include_sp: bool = Query(True),
    page: int = Query(1, ge=1),
    limit: int = Query(200, ge=1, le=1000),
) -> CotasGrafListResponse:
    offset = (page - 1) * limit
    try:
        list_sql, count_sql, params = build_cotas_graf_query(
            nr_os=nr_os,
            ano=ano,
            ano_mode=ano_mode,
            produto=produto,
            produtos=produtos,
            titulo=titulo,
            solicitante=solicitante,
            solicitantes=solicitantes,
            situacao_cotas=situacao_cotas,
            include_finished=include_finished,
            include_os=include_os,
            include_sp=include_sp,
            limit=limit,
            offset=offset,
        )
        count_rows = db.execute_query(count_sql, params)
        total = int((count_rows[0] or {}).get("total") or 0)
        rows = db.execute_query(list_sql, params)
        items = [
            CotasGrafItem(
                nr_os=int(row["nr_os"]),
                ano=int(row["ano"]),
                produto=row.get("produto"),
                solicitante=row.get("solicitante"),
                titulo=row.get("titulo"),
                cotas_graf_atualizado=_as_bool(row.get("req_entregue")),
            )
            for row in rows or []
        ]
        return CotasGrafListResponse(
            items=items,
            total=total,
            limit=limit,
            offset=offset,
            page=page,
        )
    except Exception as exc:
        logger.error("Erro ao listar Cotas Graf: %s", exc)
        raise HTTPException(status_code=500, detail="Erro ao carregar lista Cotas Graf.") from exc


@router.get(
    "/cotas-graf/solicitantes-cotas",
    response_model=CotasGrafSolicitantesCotasResponse,
)
def list_cotas_graf_solicitantes_cotas(
    nr_os: Optional[int] = Query(None),
    ano: Optional[int] = Query(None),
    ano_mode: str = Query("specific"),
    produto: Optional[str] = Query(None),
    produtos: Optional[List[str]] = Query(None),
    titulo: Optional[str] = Query(None),
    solicitante: Optional[str] = Query(None),
    solicitantes: Optional[List[str]] = Query(None),
    situacao_cotas: Optional[List[str]] = Query(None),
    include_finished: bool = Query(False),
    include_os: bool = Query(True),
    include_sp: bool = Query(True),
    limit: int = Query(500, ge=1, le=1000),
) -> CotasGrafSolicitantesCotasResponse:
    try:
        semestre_id = resolver_semestre_ativo_id()
        fetch_limit = min(max(limit, 500), 1000)
        list_sql, count_sql, params = build_cotas_graf_solicitantes_cotas_query(
            semestre_id=semestre_id,
            nr_os=nr_os,
            ano=ano,
            ano_mode=ano_mode,
            produto=produto,
            produtos=produtos,
            titulo=titulo,
            solicitante=solicitante,
            solicitantes=solicitantes,
            situacao_cotas=situacao_cotas,
            include_finished=include_finished,
            include_os=include_os,
            include_sp=include_sp,
            limit=fetch_limit,
        )
        rows = db.execute_query(list_sql, params)
        items = _filtrar_solicitantes_deputados_em_exercicio(
            [_map_solicitante_cotas_row(row) for row in rows or []]
        )
        total = len(items)
        items = items[:limit]
        semestre_ano = items[0].semestre_ano if items else None
        semestre_numero = items[0].semestre_numero if items else None
        if semestre_ano is None:
            semestre_rows = db.execute_query(
                "SELECT Ano, NumeroSemestre FROM tabCotaSemestre WHERE ID = %s LIMIT 1",
                (semestre_id,),
            )
            if semestre_rows:
                semestre_ano = int(semestre_rows[0]["Ano"])
                semestre_numero = int(semestre_rows[0]["NumeroSemestre"])
        return CotasGrafSolicitantesCotasResponse(
            items=items,
            total=total,
            semestre_ano=semestre_ano,
            semestre_numero=semestre_numero,
        )
    except Exception as exc:
        logger.error("Erro ao listar cotas dos solicitantes: %s", exc)
        raise HTTPException(
            status_code=500,
            detail="Erro ao carregar cotas dos solicitantes.",
        ) from exc


@router.get(
    "/cotas-graf/solicitantes-cotas/historico",
    response_model=CotasGrafConsumoHistoricoResponse,
)
def list_solicitante_consumo_historico(
    cod_usuario: str = Query(..., min_length=1),
    categoria: str = Query(""),
    nome_usuario: str = Query(..., min_length=1),
    limit: int = Query(500, ge=1, le=1000),
) -> CotasGrafConsumoHistoricoResponse:
    try:
        semestre_id = resolver_semestre_ativo_id()
        sql, params = build_solicitante_consumo_historico_query(
            semestre_id=semestre_id,
            cod_usuario=cod_usuario.strip(),
            categoria=categoria.strip(),
            nome_usuario=nome_usuario.strip(),
            limit=limit,
        )
        rows = db.execute_query(sql, params) or []
        items: List[CotasGrafConsumoHistoricoItem] = []
        for row in rows:
            data_entrada = row.get("data_entrada")
            if data_entrada is not None and hasattr(data_entrada, "isoformat"):
                data_entrada = data_entrada.isoformat()
            elif data_entrada is not None:
                data_entrada = str(data_entrada)
            items.append(
                CotasGrafConsumoHistoricoItem(
                    nr_os=int(row["nr_os"]),
                    ano=int(row["ano"]),
                    tipo=str(row.get("tipo") or "os"),
                    produto=row.get("produto"),
                    titulo=row.get("titulo"),
                    cota_consumida=int(row.get("cota_consumida") or 0),
                    data_entrada=data_entrada,
                    origem=row.get("origem"),
                    referencia_externa=row.get("referencia_externa") or None,
                )
            )
        return CotasGrafConsumoHistoricoResponse(items=items, total=len(items))
    except Exception as exc:
        logger.error("Erro ao listar histórico de consumo: %s", exc)
        raise HTTPException(
            status_code=500,
            detail="Erro ao carregar histórico de consumo.",
        ) from exc


@router.post(
    "/cotas-graf/{ano}/{nr_os}/lancar",
    response_model=CotasGrafLancarResponse,
)
def lancar_cotas_graf(ano: int, nr_os: int) -> CotasGrafLancarResponse:
    if nr_os < 1:
        raise HTTPException(status_code=400, detail="Número de OS inválido.")
    if ano < 2000 or ano > 2100:
        raise HTTPException(status_code=400, detail="Ano inválido.")

    try:
        rows = db.execute_query(
            """
            SELECT COALESCE(ReqEntregue, 0) AS req_entregue
            FROM tabProtocolos
            WHERE NroProtocolo = %s AND AnoProtocolo = %s
            """,
            (nr_os, ano),
        )
        if not rows:
            raise HTTPException(status_code=404, detail="OS não encontrada.")
        row = rows[0]
        if _as_bool(row.get("req_entregue")):
            return CotasGrafLancarResponse(nr_os=nr_os, ano=ano, cotas_graf_atualizado=True)

        db.execute_query(
            """
            UPDATE tabProtocolos
            SET ReqEntregue = 1
            WHERE NroProtocolo = %s AND AnoProtocolo = %s
            """,
            (nr_os, ano),
        )

        from routers.os_routes import _dispatch_mdb_sync

        def _sync_req_entregue_mdb() -> None:
            from routers.mdb_writer import sync_protocolo_req_entregue_to_mdb

            sync_protocolo_req_entregue_to_mdb(nr_os, ano)

        _dispatch_mdb_sync("cotas_graf_lancar", _sync_req_entregue_mdb)
        return CotasGrafLancarResponse(nr_os=nr_os, ano=ano, cotas_graf_atualizado=True)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Erro ao lançar Cotas Graf OS %s/%s: %s", nr_os, ano, exc)
        raise HTTPException(status_code=500, detail="Erro ao atualizar Cotas Graf.") from exc
