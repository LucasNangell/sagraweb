"""
API do módulo Manutenção (máquinas da Gráfica).

Permissões independentes:
- sb_manutencao_gerencia: solicita, prioriza/reordena a fila, cancela e mantém
  o cadastro de máquinas e manutenções recorrentes.
- sb_manutencao_operador: recebe a fila, inicia, registra diagnóstico/passos,
  pausa, devolve e conclui.
Leitura (máquinas, pedidos, resumo) liberada para qualquer uma das duas.
"""
from __future__ import annotations

import logging
from typing import Any, Callable, Optional

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from services import manutencao_app_service as app_svc
from services import manutencao_horario_service as horario_svc
from services import manutencao_service as svc

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/manutencao", tags=["manutencao"])

PERM_GERENCIA = "sb_manutencao_gerencia"
PERM_OPERADOR = "sb_manutencao_operador"


def _perms(request: Request) -> dict:
    return getattr(request.state, "sagra_permissions", None) or {}


def _require_view(request: Request) -> None:
    p = _perms(request)
    if not (p.get(PERM_GERENCIA) or p.get(PERM_OPERADOR)):
        raise HTTPException(status_code=403, detail="Sem permissão para Manutenção")


def _require_gerencia(request: Request) -> None:
    if not _perms(request).get(PERM_GERENCIA):
        raise HTTPException(status_code=403, detail="Requer permissão Manutenção — Gerência")


def _require_operador(request: Request) -> None:
    if not _perms(request).get(PERM_OPERADOR):
        raise HTTPException(status_code=403, detail="Requer permissão Manutenção — Operador")


def _require_any_action(request: Request) -> None:
    _require_view(request)


def _ponto(request: Request) -> str:
    from security.session_auth import SessionData, require_session

    session = getattr(request.state, "sagra_session", None)
    if isinstance(session, SessionData):
        return str(session.ponto)
    try:
        return str(require_session(request).ponto)
    except Exception:
        return "0"


def _run(fn: Callable[[], Any]) -> Any:
    try:
        return fn()
    except svc.ManutencaoNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except svc.ManutencaoConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# ------------------------------------------------------------------ payloads


class MaquinaCreate(BaseModel):
    nome: str
    codigo: Optional[str] = None
    setor: Optional[str] = None
    fabricante: Optional[str] = None
    modelo: Optional[str] = None
    numero_serie: Optional[str] = None
    observacoes: Optional[str] = None
    ativo: bool = True
    ordem: Optional[int] = None


class MaquinaUpdate(BaseModel):
    nome: Optional[str] = None
    codigo: Optional[str] = None
    setor: Optional[str] = None
    fabricante: Optional[str] = None
    modelo: Optional[str] = None
    numero_serie: Optional[str] = None
    observacoes: Optional[str] = None
    ativo: Optional[bool] = None
    ordem: Optional[int] = None


class RecorrenteCreate(BaseModel):
    titulo: str
    descricao: Optional[str] = None
    maquina_id: Optional[int] = None
    periodicidade_dias: Optional[int] = None
    prioridade_padrao: str = "normal"
    ativo: bool = True


class RecorrenteUpdate(BaseModel):
    titulo: Optional[str] = None
    descricao: Optional[str] = None
    maquina_id: Optional[int] = None
    clear_maquina: bool = False
    periodicidade_dias: Optional[int] = None
    clear_periodicidade: bool = False
    prioridade_padrao: Optional[str] = None
    ativo: Optional[bool] = None


class PedidoCreate(BaseModel):
    maquina_id: int
    titulo: Optional[str] = None
    descricao: Optional[str] = None
    prioridade: Optional[str] = None
    recorrente_id: Optional[int] = None
    maquina_parada: bool = False


class PedidoUpdate(BaseModel):
    titulo: Optional[str] = None
    descricao: Optional[str] = None
    prioridade: Optional[str] = None
    maquina_parada: Optional[bool] = None


class FilaOrdem(BaseModel):
    ids: list[int] = Field(default_factory=list, max_length=2000)


class MotivoPayload(BaseModel):
    motivo: Optional[str] = None


class ProgressoPayload(BaseModel):
    diagnostico: Optional[str] = None
    passos: Optional[list[str]] = Field(default=None, max_length=svc.MAX_PASSOS)


class ConclusaoPayload(BaseModel):
    conclusao: str
    diagnostico: Optional[str] = None
    passos: Optional[list[str]] = Field(default=None, max_length=svc.MAX_PASSOS)


class ComentarioPayload(BaseModel):
    texto: str


# -------------------------------------------------------------------- leitura


@router.get("/resumo")
def get_resumo(request: Request):
    _require_view(request)
    return _run(svc.resumo)


@router.get("/maquinas")
def get_maquinas(request: Request, include_inactive: bool = Query(False)):
    _require_view(request)
    return {"items": _run(lambda: svc.list_maquinas(include_inactive=include_inactive))}


@router.get("/maquinas/codigo/{codigo}")
def get_maquina_por_codigo(codigo: str, request: Request):
    """Resolução por código (base do futuro QR Code da máquina)."""
    _require_view(request)
    return _run(lambda: svc.get_maquina_por_codigo(codigo))


@router.get("/maquinas/{maquina_id}")
def get_maquina(maquina_id: int, request: Request):
    _require_view(request)
    return _run(lambda: svc.get_maquina(maquina_id))


@router.get("/recorrentes")
def get_recorrentes(request: Request, include_inactive: bool = Query(False)):
    _require_view(request)
    return {"items": _run(lambda: svc.list_recorrentes(include_inactive=include_inactive))}


@router.get("/pedidos")
def get_pedidos(
    request: Request,
    status: Optional[str] = Query(None, description="CSV: fila,em_execucao,pausado,concluido,cancelado"),
    maquina_id: Optional[int] = Query(None),
    finalizados_dias: int = Query(30, ge=1, le=3650),
    limit_finalizados: int = Query(100, ge=1, le=1000),
    incluir_similares: bool = Query(False, description="Conta soluções semelhantes dos abertos"),
):
    _require_view(request)
    status_list = [s.strip() for s in status.split(",")] if status else None
    items = _run(
        lambda: svc.list_pedidos(
            status=status_list,
            maquina_id=maquina_id,
            finalizados_dias=finalizados_dias,
            limit_finalizados=limit_finalizados,
            incluir_similares=incluir_similares,
        )
    )
    return {"items": app_svc.anexar_visualizacoes(items)}


@router.get("/historico/busca")
def get_historico_busca(
    request: Request,
    q: str = Query("", max_length=200),
    maquina_id: Optional[int] = Query(None),
    limit: int = Query(40, ge=1, le=200),
):
    """Busca soluções em manutenções concluídas (diagnóstico, passos, conclusão)."""
    _require_view(request)
    return {"items": _run(lambda: svc.buscar_historico(q, maquina_id=maquina_id, limit=limit))}


@router.get("/pedidos/{pedido_id}/similares")
def get_pedido_similares(pedido_id: int, request: Request):
    """Manutenções concluídas semelhantes a este pedido (para consultar o passo a passo)."""
    _require_view(request)
    return {"items": _run(lambda: svc.similares_do_pedido(pedido_id))}


@router.get("/pedidos/{pedido_id}")
def get_pedido(pedido_id: int, request: Request):
    _require_view(request)
    pedido = _run(lambda: svc.get_pedido(pedido_id, include_eventos=True))
    app_svc.anexar_visualizacoes([pedido])
    return pedido


# ------------------------------------------------------------------ gerência


@router.post("/maquinas")
def post_maquina(body: MaquinaCreate, request: Request):
    _require_gerencia(request)
    return _run(lambda: svc.create_maquina(body.model_dump(), _ponto(request)))


# Edições também aceitam POST: o proxy do endereço público (internet/app Android)
# bloqueia PUT/PATCH/DELETE. PATCH/PUT ficam por compatibilidade.
@router.post("/maquinas/{maquina_id}")
@router.patch("/maquinas/{maquina_id}")
def patch_maquina(maquina_id: int, body: MaquinaUpdate, request: Request):
    _require_gerencia(request)
    return _run(
        lambda: svc.update_maquina(maquina_id, body.model_dump(exclude_unset=True), _ponto(request))
    )


@router.post("/recorrentes")
def post_recorrente(body: RecorrenteCreate, request: Request):
    _require_gerencia(request)
    return _run(lambda: svc.create_recorrente(body.model_dump(), _ponto(request)))


@router.post("/recorrentes/{rec_id}")
@router.patch("/recorrentes/{rec_id}")
def patch_recorrente(rec_id: int, body: RecorrenteUpdate, request: Request):
    _require_gerencia(request)
    return _run(
        lambda: svc.update_recorrente(rec_id, body.model_dump(exclude_unset=True), _ponto(request))
    )


@router.post("/pedidos")
def post_pedido(body: PedidoCreate, request: Request):
    _require_gerencia(request)
    return _run(lambda: svc.criar_pedido(body.model_dump(), _ponto(request)))


@router.post("/pedidos/{pedido_id}")
@router.patch("/pedidos/{pedido_id}")
def patch_pedido(pedido_id: int, body: PedidoUpdate, request: Request):
    _require_gerencia(request)
    return _run(
        lambda: svc.atualizar_pedido_gerencia(
            pedido_id, body.model_dump(exclude_unset=True), _ponto(request)
        )
    )


@router.post("/fila/ordem")
@router.put("/fila/ordem")
def put_fila_ordem(body: FilaOrdem, request: Request):
    _require_gerencia(request)
    return {"items": _run(lambda: svc.reordenar_fila(body.ids, _ponto(request)))}


@router.post("/pedidos/{pedido_id}/cancelar")
def post_cancelar(pedido_id: int, body: MotivoPayload, request: Request):
    _require_gerencia(request)
    return _run(lambda: svc.cancelar_pedido(pedido_id, body.motivo, _ponto(request)))


# ------------------------------------------------------------------ operador


@router.post("/pedidos/{pedido_id}/iniciar")
def post_iniciar(pedido_id: int, request: Request):
    _require_operador(request)
    return _run(lambda: svc.iniciar_pedido(pedido_id, _ponto(request)))


@router.post("/pedidos/{pedido_id}/progresso")
@router.put("/pedidos/{pedido_id}/progresso")
def put_progresso(pedido_id: int, body: ProgressoPayload, request: Request):
    _require_operador(request)
    return _run(
        lambda: svc.registrar_progresso(
            pedido_id,
            diagnostico=body.diagnostico,
            passos=body.passos,
            ponto=_ponto(request),
        )
    )


@router.post("/pedidos/{pedido_id}/pausar")
def post_pausar(pedido_id: int, body: MotivoPayload, request: Request):
    _require_operador(request)
    return _run(lambda: svc.pausar_pedido(pedido_id, body.motivo, _ponto(request)))


@router.post("/pedidos/{pedido_id}/devolver")
def post_devolver(pedido_id: int, body: MotivoPayload, request: Request):
    _require_operador(request)
    return _run(lambda: svc.devolver_para_fila(pedido_id, body.motivo, _ponto(request)))


@router.post("/pedidos/{pedido_id}/concluir")
def post_concluir(pedido_id: int, body: ConclusaoPayload, request: Request):
    _require_operador(request)
    return _run(
        lambda: svc.concluir_pedido(
            pedido_id,
            conclusao=body.conclusao,
            diagnostico=body.diagnostico,
            passos=body.passos,
            ponto=_ponto(request),
        )
    )


# ------------------------------------------------------------------- ambos


@router.post("/pedidos/{pedido_id}/comentarios")
def post_comentario(pedido_id: int, body: ComentarioPayload, request: Request):
    _require_any_action(request)
    return _run(lambda: svc.comentar_pedido(pedido_id, body.texto, _ponto(request)))


@router.post("/push/teste")
def post_push_teste(request: Request):
    """Envia uma notificação push de teste da Manutenção aos aparelhos do usuário."""
    _require_view(request)
    ponto = _ponto(request)
    if not ponto or ponto.strip("0") == "":
        raise HTTPException(status_code=401, detail="Sessão sem ponto identificado")
    return _run(lambda: svc.enviar_push_teste(ponto))



# ------------------------------------------------------- horário de trabalho


class HorarioPayload(BaseModel):
    ativo: bool = False
    dias: list[int] = Field(default_factory=lambda: list(horario_svc.DIAS_PADRAO), max_length=7)
    inicio: str = Field(default=horario_svc.INICIO_PADRAO, pattern=r"^\d{2}:\d{2}$")
    fim: str = Field(default=horario_svc.FIM_PADRAO, pattern=r"^\d{2}:\d{2}$")
    urgentes_fora: bool = False


def _horario_resposta(cfg: dict) -> dict:
    return {**cfg, "avisando_agora": horario_svc.dentro_do_horario(cfg)}


def _ponto_obrigatorio(request: Request) -> str:
    ponto = _ponto(request)
    if not ponto or ponto.strip("0") == "":
        raise HTTPException(status_code=401, detail="Sessão sem ponto identificado")
    return ponto


@router.get("/horario")
def get_horario(request: Request):
    """Horário de trabalho do usuário logado (fora dele o celular não recebe avisos)."""
    _require_view(request)
    return _horario_resposta(horario_svc.obter_horario(_ponto_obrigatorio(request)))


@router.post("/horario")
def post_horario(body: HorarioPayload, request: Request):
    _require_view(request)
    ponto = _ponto_obrigatorio(request)
    try:
        cfg = horario_svc.salvar_horario(
            ponto,
            ativo=body.ativo,
            dias=body.dias,
            inicio=body.inicio,
            fim=body.fim,
            urgentes_fora=body.urgentes_fora,
        )
    except horario_svc.HorarioInvalido as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _horario_resposta(cfg)


# ------------------------------------------------- visualizações e app Android


class VisualizacaoPayload(BaseModel):
    ids: list[int] = Field(default_factory=list, max_length=app_svc.MAX_IDS_VISUALIZACAO)
    origem: str = Field(default="web", pattern="^(app|web)$")


@router.post("/visualizacoes")
def post_visualizacoes(body: VisualizacaoPayload, request: Request):
    """Registra que o usuário viu os pedidos listados na tela (app ou web)."""
    _require_view(request)
    return {"registrados": _run(lambda: app_svc.registrar_visualizacoes(_ponto(request), body.ids, body.origem))}


@router.get("/pedidos/{pedido_id}/visualizacoes")
def get_visualizacoes(pedido_id: int, request: Request):
    _require_view(request)
    return {"items": app_svc.visualizacoes_por_pedido([pedido_id]).get(pedido_id, [])}


class AparelhoPayload(BaseModel):
    aparelho_id: str = Field(min_length=8, max_length=64)
    modelo: Optional[str] = Field(default=None, max_length=120)
    versao_app: Optional[str] = Field(default=None, max_length=20)


@router.post("/aparelhos")
def post_aparelho(body: AparelhoPayload, request: Request):
    """Chamado pelo app Android logo após o login: autoriza o aparelho (login persistente)."""
    _require_view(request)
    ponto = _ponto(request)
    return _run(
        lambda: app_svc.registrar_aparelho(
            ponto,
            aparelho_id=body.aparelho_id,
            modelo=body.modelo,
            versao_app=body.versao_app,
        )
    )


@router.get("/aparelhos")
def get_aparelhos(request: Request, aberturas: int = Query(50, ge=0, le=500)):
    _require_gerencia(request)
    return {
        "items": app_svc.listar_aparelhos(),
        "aberturas": app_svc.listar_aberturas(aberturas) if aberturas else [],
        "versao": _versao_publica(),
    }


@router.post("/aparelhos/{aparelho_id}/revogar")
def post_revogar_aparelho(aparelho_id: int, request: Request):
    _require_gerencia(request)
    _run(lambda: app_svc.revogar_aparelho(aparelho_id, _ponto(request)))
    return {"ok": True}


def _versao_publica() -> Optional[dict]:
    info = app_svc.info_versao()
    if not info:
        return None
    return {k: v for k, v in info.items() if not k.startswith("_")}
