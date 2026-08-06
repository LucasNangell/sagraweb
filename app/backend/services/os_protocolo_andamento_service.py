"""Atualiza tabProtocolos quando andamento é Entregue ou Cancelado/Cancelada."""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel

from mdb_helpers import to_mdb_date
from routers.andamento_helpers import format_ponto

_CANCELED = frozenset({"Cancelado", "Cancelada"})
_DELIVERED = frozenset({"Entregue"})


class ProtocoloEntregaInput(BaseModel):
    data: Optional[str] = None
    armazenado_em: Optional[str] = None
    recado_com: Optional[str] = None
    entregue_para: Optional[str] = None
    nr_ponto: Optional[str] = None
    data_entrega: Optional[str] = None
    entregue_por: Optional[str] = None
    setor: Optional[str] = None


def is_protocolo_andamento_situacao(situacao: str) -> bool:
    situ = (situacao or "").strip()
    return situ in _CANCELED or situ in _DELIVERED


def requires_protocolo_entrega_payload(situacao: str) -> bool:
    return (situacao or "").strip() in _DELIVERED


def _parse_date_for_mysql(value: Optional[str]):
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    return to_mdb_date(text)


def _format_ponto_field(raw: Optional[str]) -> str:
    if not raw:
        return ""
    clean = "".join(filter(str.isdigit, str(raw)))
    if clean:
        return format_ponto(clean)
    return str(raw).strip()


def apply_protocolo_on_andamento(
    cursor,
    nro: int,
    ano: int,
    situacao: str,
    *,
    obs: str = "",
    ponto: str = "",
    setor: str = "",
    entrega: Optional[ProtocoloEntregaInput] = None,
) -> bool:
    """
    Grava campos de entrega/cancelamento em tabProtocolos.
    Retorna True se houve UPDATE aplicável à situação.
    """
    situ = (situacao or "").strip()

    if situ in _CANCELED:
        cursor.execute(
            """
            UPDATE tabProtocolos SET
                CancelamentoMotivo = %s,
                CancelamentoPonto = %s,
                CancelamentoSetor = %s
            WHERE NroProtocolo = %s AND AnoProtocolo = %s
            """,
            (
                (obs or "").strip(),
                (ponto or "").strip(),
                (setor or "").strip(),
                nro,
                ano,
            ),
        )
        return True

    if situ in _DELIVERED:
        if entrega is None:
            raise ValueError(
                "Dados de entrega (protocolo_entrega) são obrigatórios para andamento Entregue."
            )
        cursor.execute(
            """
            UPDATE tabProtocolos SET
                DataConclusao = %s,
                ArmazenadoEm = %s,
                ContatoRecebim = %s,
                RetiradaNome = %s,
                RetiradaPonto = %s,
                RecebimData = %s,
                PontoEntrega = %s,
                SetorEntrega = %s
            WHERE NroProtocolo = %s AND AnoProtocolo = %s
            """,
            (
                _parse_date_for_mysql(entrega.data),
                (entrega.armazenado_em or "").strip(),
                (entrega.recado_com or "").strip(),
                (entrega.entregue_para or "").strip(),
                _format_ponto_field(entrega.nr_ponto),
                _parse_date_for_mysql(entrega.data_entrega),
                _format_ponto_field(entrega.entregue_por),
                (entrega.setor or setor or "").strip(),
                nro,
                ano,
            ),
        )
        return True

    return False
