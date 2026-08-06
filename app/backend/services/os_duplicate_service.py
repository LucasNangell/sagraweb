"""
Duplicação SQL de OS (tabProtocolos + tabDetalhesServico + andamento inicial).

Usado por POST /os/{ano}/{id}/duplicate e pela criação automática DEPOL.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, Optional

from database import db
from routers.andamento_helpers import format_andamento_obs, format_ponto
from routers.os_audit_service import log_andamento_added, log_os_duplicated


@dataclass(frozen=True)
class DuplicateOsResult:
    new_id: int
    new_year: int
    cod_status: str


def format_ponto_for_andamento(usuario: str) -> str:
    """format_ponto remove não-dígitos; se sobrar vazio (ex. só 'C'), usa o bruto."""
    raw = (usuario or "").strip()
    formatted = format_ponto(raw)
    if formatted:
        return formatted
    return raw[:32] if raw else ""


def _source_exists(cursor, source_nro: int, source_ano: int) -> bool:
    cursor.execute(
        """
        SELECT NroProtocolo FROM tabProtocolos
        WHERE NroProtocolo = %s AND AnoProtocolo = %s
        LIMIT 1
        """,
        (int(source_nro), int(source_ano)),
    )
    return cursor.fetchone() is not None


def duplicate_os_sql(
    *,
    source_nro: int,
    source_ano: int,
    usuario: str,
    setor_andamento: str = "SEFOC",
    obs_andamento: Optional[str] = None,
    modelos_arq: Optional[str] = None,
    entreg_data: Optional[date | str] = None,
    cursor: Any = None,
) -> DuplicateOsResult:
    """
    Duplica OS. Se `cursor` for passado, usa a transação externa;
    caso contrário abre `db.execute_transaction`.
    """
    source_nro = int(source_nro)
    source_ano = int(source_ano)
    setor = (setor_andamento or "SEFOC").strip() or "SEFOC"
    if obs_andamento is None:
        obs_text = format_andamento_obs(f"Duplicado da OS {source_nro}/{source_ano}")
    else:
        obs_text = format_andamento_obs(obs_andamento)
    ponto_formatado = format_ponto_for_andamento(usuario)

    entreg_val: Optional[str] = None
    if entreg_data is not None:
        if isinstance(entreg_data, date):
            entreg_val = entreg_data.isoformat()
        else:
            entreg_val = str(entreg_data).strip() or None

    def _run(cur) -> DuplicateOsResult:
        if not _source_exists(cur, source_nro, source_ano):
            raise LookupError(f"OS {source_nro}/{source_ano} não encontrada.")

        is_papelaria = source_nro >= 5000
        current_year = datetime.now().year

        if is_papelaria:
            cur.execute(
                """
                SELECT MAX(NroProtocolo) as max_id
                FROM tabProtocolos
                WHERE AnoProtocolo = %s AND NroProtocolo >= 5000
                """,
                (current_year,),
            )
        else:
            cur.execute(
                """
                SELECT MAX(NroProtocolo) as max_id
                FROM tabProtocolos
                WHERE AnoProtocolo = %s AND NroProtocolo < 5000
                """,
                (current_year,),
            )

        result = cur.fetchone()
        max_id = result["max_id"] if result and result.get("max_id") else None
        if max_id:
            new_id = int(max_id) + 1
        else:
            new_id = 5000 if is_papelaria else 1

        cols_protocolo = """
            CodigoRequisic, CategoriaLink, NomeUsuario, Titular, OrgInteressado, SiglaOrgao,
            GabSalaUsuario, Andar, Localizacao, RamalUsuario, CodUsuarioLink,
            DataEntrada, ProcessoSolicit, CSnro, CotaRepro, CotaCartao,
            EntregPrazoLink, EntregData, ContatoTrab
        """
        cur.execute(
            f"""
            INSERT INTO tabProtocolos (NroProtocolo, AnoProtocolo, {cols_protocolo})
            SELECT %s, %s, {cols_protocolo}
            FROM tabProtocolos
            WHERE NroProtocolo = %s AND AnoProtocolo = %s
            """,
            (new_id, current_year, source_nro, source_ano),
        )
        if cur.rowcount == 0:
            raise LookupError(f"OS {source_nro}/{source_ano} não encontrada.")

        cols_detalhes = """
            TiragemSolicitada, Tiragem, CotaTotal, Titulo, TipoPublicacaoLink, FormatoLink,
            MaquinaLink, Pags, FrenteVerso, ModelosArq, FormatoLink, PapelLink, PapelDescricao,
            Cores, CoresDescricao, DescAcabamento, Observ, MaterialFornecido,
            Fotolito, ModeloDobra, ProvaImpressa, InsumosFornecidos,
            ElemGrafBrasao, ElemGrafTimbre, ElemGrafArteGab, ElemGrafAssinatura,
            CalcPgs1, CalcQtdCores1, CalcCor1,
            CalcPgs2, CalcQtdCores2, CalcCor2,
            CalcPgs3, CalcQtdCores3, CalcCor3
        """
        cur.execute(
            f"""
            INSERT INTO tabDetalhesServico (NroProtocoloLinkDet, AnoProtocoloLinkDet, {cols_detalhes})
            SELECT %s, %s, {cols_detalhes}
            FROM tabDetalhesServico
            WHERE NroProtocoloLinkDet = %s AND AnoProtocoloLinkDet = %s
            """,
            (new_id, current_year, source_nro, source_ano),
        )

        if entreg_val is not None:
            cur.execute(
                """
                UPDATE tabProtocolos
                SET EntregData = %s
                WHERE NroProtocolo = %s AND AnoProtocolo = %s
                """,
                (entreg_val, new_id, current_year),
            )

        if modelos_arq is not None:
            cur.execute(
                """
                UPDATE tabDetalhesServico
                SET ModelosArq = %s
                WHERE NroProtocoloLinkDet = %s AND AnoProtocoloLinkDet = %s
                """,
                (str(modelos_arq), new_id, current_year),
            )

        new_cod_status = f"{new_id:05d}{current_year}-01"
        cur.execute(
            """
            INSERT INTO tabAndamento
            (CodStatus, NroProtocoloLink, AnoProtocoloLink, SituacaoLink, SetorLink, Data, UltimoStatus, Observaçao, Ponto)
            VALUES (%s, %s, %s, 'Entrada Inicial', %s, NOW(), 1, %s, %s)
            """,
            (new_cod_status, new_id, current_year, setor, obs_text, ponto_formatado),
        )

        log_os_duplicated(
            cur,
            source_nro=source_nro,
            source_ano=source_ano,
            new_nro=new_id,
            new_ano=current_year,
            ponto=usuario,
        )
        log_andamento_added(
            cur,
            nro=new_id,
            ano=current_year,
            cod_status=new_cod_status,
            situacao="Entrada Inicial",
            setor=setor,
            obs=obs_text,
            ponto=ponto_formatado,
        )

        return DuplicateOsResult(
            new_id=new_id, new_year=current_year, cod_status=new_cod_status
        )

    if cursor is not None:
        return _run(cursor)

    result = db.execute_transaction([_run])
    return result[0]


def duplicate_os(
    *,
    source_nro: int,
    source_ano: int,
    usuario: str,
    setor_andamento: str = "SEFOC",
    obs_andamento: Optional[str] = None,
    modelos_arq: Optional[str] = None,
    entreg_data: Optional[date | str] = None,
) -> DuplicateOsResult:
    """Duplica OS em transação própria (sem hooks HTTP/MDB)."""
    return duplicate_os_sql(
        source_nro=source_nro,
        source_ano=source_ano,
        usuario=usuario,
        setor_andamento=setor_andamento,
        obs_andamento=obs_andamento,
        modelos_arq=modelos_arq,
        entreg_data=entreg_data,
    )
