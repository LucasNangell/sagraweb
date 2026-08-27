"""
Conversão de valores Python/MySQL para formato Microsoft Access (MDB).

Access trata tipos de forma distinta do MySQL:
- Memo/Long Text: quebras de linha devem ser CRLF (\\r\\n)
- Yes/No: booleanos nativos (pyodbc converte bool)
- Date/Time: objetos date/datetime ou NULL (não string vazia)
- Numéricos: int/float ou NULL (evitar string vazia em colunas numéricas)
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any, Optional

_DATE_PATTERNS = (
    "%Y-%m-%d",
    "%Y-%m-%d %H:%M:%S",
    "%d/%m/%Y",
    "%d/%m/%Y %H:%M:%S",
)

MEMO_FIELDS = frozenset({
    "Andar",
    "ContatoTrab",
    "Titulo",
    "PapelDescricao",
    "CoresDescricao",
    "DescAcabamento",
    "Observ",
    "InsumosFornecidos",
    "Observaçao",
})

DATE_FIELDS = frozenset({
    "DataEntrada",
    "EntregData",
    "Data",
    "DataRecebimento",
    "DataConclusao",
    "RecebimData",
    "CancelamentoData",
})

BOOL_FIELDS = frozenset({
    "FrenteVerso",
    "MaterialFornecido",
    "Fotolito",
    "ModeloDobra",
    "ProvaImpressa",
    "ElemGrafBrasao",
    "ElemGrafTimbre",
    "ElemGrafArteGab",
    "ElemGrafAssinatura",
    "UltimoStatus",
    "ReqEntregue",
})

INT_FIELDS = frozenset({
    "Tiragem",
    "Pags",
    "ModelosArq",
    "TiragemSolicitada",
    "CotaTotal",
    "CalcPgs1",
    "CalcQtdCores1",
    "CalcPgs2",
    "CalcQtdCores2",
    "CalcPgs3",
    "CalcQtdCores3",
    "NroProtocolo",
    "AnoProtocolo",
    "NroProtocoloLink",
    "AnoProtocoloLink",
    "NroProtocoloLinkDet",
    "AnoProtocoloLinkDet",
    "CotaRepro",
    "CotaCartao",
})

CALC_DETALHES_FIELDS = (
    "CalcPgs1",
    "CalcQtdCores1",
    "CalcCor1",
    "CalcPgs2",
    "CalcQtdCores2",
    "CalcCor2",
    "CalcPgs3",
    "CalcQtdCores3",
    "CalcCor3",
)


def to_mdb_null(value: Any) -> Any:
    """Converte string vazia / whitespace-only em NULL para o Access."""
    if value is None:
        return None
    if isinstance(value, str) and value.strip() == "":
        return None
    return value


def to_mdb_memo(value: Any) -> Optional[str]:
    """Normaliza texto memo para CRLF (padrão Access/VBA)."""
    value = to_mdb_null(value)
    if value is None:
        return None
    text = str(value)
    return text.replace("\r\n", "\n").replace("\r", "\n").replace("\n", "\r\n")


def to_mdb_date(value: Any) -> Optional[date]:
    """Converte string/datetime/date para date ou NULL."""
    value = to_mdb_null(value)
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        raw = value.strip()
        for fmt in _DATE_PATTERNS:
            try:
                return datetime.strptime(raw, fmt).date()
            except ValueError:
                continue
        if "T" in raw:
            try:
                return datetime.fromisoformat(raw.replace("Z", "+00:00")).date()
            except ValueError:
                pass
    return None


def to_mdb_datetime(value: Any) -> Optional[datetime]:
    """Converte para datetime ou NULL (andamentos)."""
    value = to_mdb_null(value)
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime.combine(value, datetime.min.time())
    if isinstance(value, str):
        raw = value.strip()
        for fmt in _DATE_PATTERNS:
            try:
                return datetime.strptime(raw, fmt)
            except ValueError:
                continue
        if "T" in raw:
            try:
                return datetime.fromisoformat(raw.replace("Z", "+00:00"))
            except ValueError:
                pass
    return None


def to_mdb_bool(value: Any) -> Optional[bool]:
    """Converte para booleano Access (Yes/No)."""
    value = to_mdb_null(value)
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in ("1", "true", "sim", "yes", "-1"):
            return True
        if lowered in ("0", "false", "nao", "não", "no"):
            return False
    return bool(value)


def to_mdb_int(value: Any) -> Optional[int]:
    """Converte para inteiro ou NULL."""
    value = to_mdb_null(value)
    if value is None:
        return None
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        cleaned = value.strip().replace(".", "").replace(",", "")
        if cleaned.isdigit() or (cleaned.startswith("-") and cleaned[1:].isdigit()):
            return int(cleaned)
    return None


def to_mdb_field(name: str, value: Any) -> Any:
    """Aplica conversão adequada conforme o nome do campo."""
    if name in MEMO_FIELDS:
        return to_mdb_memo(value)
    if name in DATE_FIELDS:
        if name == "Data":
            return to_mdb_datetime(value)
        return to_mdb_date(value)
    if name in BOOL_FIELDS:
        return to_mdb_bool(value)
    if name in INT_FIELDS:
        converted = to_mdb_int(value)
        return converted if converted is not None else to_mdb_null(value)
    return to_mdb_null(value)


def prepare_os_protocol_params(row: dict) -> dict:
    """Prepara dict de tabProtocolos para gravação no MDB."""
    from os_calc_fields import cota_protocolo_column

    nro = int(row.get("NroProtocolo") or 0)
    cota_field = cota_protocolo_column(nro)
    fields = (
        "CodigoRequisic", "CategoriaLink", "NomeUsuario", "Titular", "OrgInteressado",
        "SiglaOrgao", "GabSalaUsuario", "Andar", "Localizacao", "RamalUsuario",
        "DataEntrada", "ProcessoSolicit", "CSnro", "EntregPrazoLink", "EntregData",
        "ContatoTrab", "ResponsavelGrafLink", "EntregaFormaLink", "EntregPeriodo", cota_field,
    )
    return {f: to_mdb_field(f, row.get(f)) for f in fields}


def prepare_os_detalhes_params(row: dict) -> dict:
    """Prepara dict de tabDetalhesServico para gravação no MDB."""
    fields = (
        "Titulo", "TipoPublicacaoLink", "FormatoLink", "MaquinaLink", "Tiragem", "Pags",
        "FrenteVerso", "ModelosArq", "PapelLink", "PapelDescricao", "Cores", "CoresDescricao",
        "DescAcabamento", "Observ", "TiragemSolicitada", "CotaTotal",
        "MaterialFornecido", "Fotolito", "ModeloDobra", "ProvaImpressa", "InsumosFornecidos",
        "ElemGrafBrasao", "ElemGrafTimbre", "ElemGrafArteGab", "ElemGrafAssinatura",
        *CALC_DETALHES_FIELDS,
    )
    return {f: to_mdb_field(f, row.get(f)) for f in fields}
