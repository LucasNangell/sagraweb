"""
Abertura pública de chamado de manutenção via QR Code da máquina.

Rotas sem sessão e sem verificação de IP (liberadas em security/api_auth.py
via prefixo /api/manutencao/publico/). Para reduzir abuso:
- só aceita máquinas ativas, identificadas pelo código;
- limite de requisições por IP (janela deslizante em memória);
- o solicitante se identifica pelo ponto; nome desconhecido é cadastrado em
  tabUsuarios sem sobrescrever cadastros existentes.
"""
from __future__ import annotations

import logging
import re
import threading
import time
from collections import defaultdict, deque
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from database import db
from services import manutencao_service as svc

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/manutencao/publico", tags=["manutencao-publico"])

_PONTO_RE = re.compile(r"^\d{1,10}$")


class _RateLimiter:
    def __init__(self) -> None:
        self._hits: dict[tuple[str, str], deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, bucket: str, key: str, limit: int, window_s: float) -> None:
        now = time.monotonic()
        with self._lock:
            q = self._hits[(bucket, key)]
            while q and now - q[0] > window_s:
                q.popleft()
            if len(q) >= limit:
                raise HTTPException(
                    status_code=429,
                    detail="Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.",
                )
            q.append(now)

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


rate_limiter = _RateLimiter()


def _client_ip(request: Request) -> str:
    try:
        from security.api_auth import resolve_client_ip

        return resolve_client_ip(request) or "?"
    except Exception:
        return request.client.host if request.client else "?"


def _maquina_publica(codigo: str) -> dict:
    try:
        maq = svc.get_maquina_por_codigo(codigo)
    except svc.ManutencaoNotFound as exc:
        raise HTTPException(status_code=404, detail="Máquina não encontrada") from exc
    if not maq["ativo"]:
        raise HTTPException(status_code=404, detail="Máquina inativa para chamados")
    return maq


def buscar_nome_ponto(ponto: str) -> Optional[str]:
    rows = db.execute_query("SELECT Nome FROM tabUsuarios WHERE Ponto = %s", (int(ponto),)) or []
    if rows and str(rows[0].get("Nome") or "").strip():
        return str(rows[0]["Nome"]).strip()
    return None


def cadastrar_nome_se_ausente(ponto: str, nome: str) -> None:
    """Cria o usuário (Ponto, Nome) apenas se ainda não existir nome cadastrado."""
    db.execute_query(
        """
        INSERT INTO tabUsuarios (Ponto, Nome) VALUES (%s, %s)
        ON DUPLICATE KEY UPDATE Nome = IF(Nome IS NULL OR TRIM(Nome) = '', VALUES(Nome), Nome)
        """,
        (int(ponto), nome),
    )


def _validar_ponto(ponto: str) -> str:
    p = str(ponto or "").strip()
    if not _PONTO_RE.match(p) or int(p) <= 0:
        raise HTTPException(status_code=400, detail="Informe um número de ponto válido")
    return p


@router.get("/maquinas/{codigo}")
def get_maquina_publica(codigo: str, request: Request):
    rate_limiter.check("maquina", _client_ip(request), limit=60, window_s=60)
    maq = _maquina_publica(codigo)
    abertos = svc.list_pedidos(status=list(svc.STATUS_ABERTOS), maquina_id=maq["id"])
    return {
        "codigo": maq["codigo"],
        "nome": maq["nome"],
        "setor": maq.get("setor"),
        "parada": maq["parada"],
        "pedidos_abertos": [
            {
                "id": p["id"],
                "titulo": p["titulo"],
                "status": p["status"],
                "prioridade": p["prioridade"],
                "solicitado_em": p["solicitado_em"],
            }
            for p in abertos
        ],
    }


@router.get("/ponto/{ponto}")
def get_nome_por_ponto(ponto: str, request: Request):
    rate_limiter.check("ponto", _client_ip(request), limit=20, window_s=60)
    p = _validar_ponto(ponto)
    return {"ponto": p, "nome": buscar_nome_ponto(p)}


class ChamadoPublico(BaseModel):
    codigo: str = Field(min_length=1, max_length=32)
    titulo: str = Field(min_length=1, max_length=200)
    descricao: Optional[str] = Field(default=None, max_length=5000)
    prioridade: str = "normal"
    maquina_parada: bool = False
    ponto: str = Field(min_length=1, max_length=10)
    nome: Optional[str] = Field(default=None, max_length=120)


@router.post("/chamados")
def post_chamado_publico(body: ChamadoPublico, request: Request):
    ip = _client_ip(request)
    rate_limiter.check("chamado", ip, limit=6, window_s=600)
    maq = _maquina_publica(body.codigo)
    ponto = _validar_ponto(body.ponto)

    nome = buscar_nome_ponto(ponto)
    if not nome:
        informado = " ".join(str(body.nome or "").split())
        if len(informado) < 3:
            raise HTTPException(
                status_code=400,
                detail="Ponto não cadastrado: informe também o seu nome completo",
            )
        cadastrar_nome_se_ausente(ponto, informado[:120])
        nome = informado[:120]
        logger.info("Manutenção pública: ponto %s cadastrado via QR (ip=%s)", ponto, ip)

    try:
        pedido = svc.criar_pedido(
            {
                "maquina_id": maq["id"],
                "titulo": body.titulo,
                "descricao": body.descricao,
                "prioridade": body.prioridade,
                "maquina_parada": body.maquina_parada,
            },
            ponto,
            origem="QR Code",
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    logger.info(
        "Manutenção pública: chamado #%s aberto por ponto %s na máquina %s (ip=%s)",
        pedido["id"],
        ponto,
        maq["codigo"],
        ip,
    )
    return {
        "id": pedido["id"],
        "posicao_fila": pedido.get("posicao_fila"),
        "maquina_nome": pedido.get("maquina_nome"),
        "solicitante_nome": nome,
    }
