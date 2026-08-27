"""
Serviço central de auditoria de OS — registra criação, alterações de campos,
andamentos, vínculos e duplicações com o ponto do responsável.
"""
from __future__ import annotations

import json
import logging
from contextvars import ContextVar
from datetime import datetime
from typing import Any, Iterable, Mapping, Optional

from .andamento_helpers import format_ponto

logger = logging.getLogger(__name__)

_AUDIT_TABLE_READY = False
_AUDIT_CLIENT_IP_COLUMN_READY = False
_audit_client_ip: ContextVar[Optional[str]] = ContextVar("audit_client_ip", default=None)


def bind_audit_client_ip(ip: Optional[str]) -> None:
    _audit_client_ip.set((ip or "").strip() or None)


def reset_audit_client_ip() -> None:
    _audit_client_ip.set(None)


def get_audit_client_ip() -> Optional[str]:
    return _audit_client_ip.get()

CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS tab_os_audit_log (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    nro_protocolo INT NOT NULL,
    ano_protocolo INT NOT NULL,
    evento_em DATETIME NOT NULL,
    acao VARCHAR(40) NOT NULL,
    entidade VARCHAR(40) NOT NULL,
    campo VARCHAR(80) NULL,
    valor_anterior TEXT NULL,
    valor_novo TEXT NULL,
    ponto VARCHAR(20) NULL,
    client_ip VARCHAR(45) NULL,
    ref_cod VARCHAR(64) NULL,
    origem VARCHAR(40) NOT NULL DEFAULT 'API',
    descricao TEXT NULL,
    INDEX idx_os_audit_os (ano_protocolo, nro_protocolo, evento_em),
    INDEX idx_os_audit_ref (ref_cod)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""

INSERT_SQL = """
INSERT INTO tab_os_audit_log (
    nro_protocolo, ano_protocolo, evento_em, acao, entidade,
    campo, valor_anterior, valor_novo, ponto, client_ip, ref_cod, origem, descricao
) VALUES (
    %(nro_protocolo)s, %(ano_protocolo)s, %(evento_em)s, %(acao)s, %(entidade)s,
    %(campo)s, %(valor_anterior)s, %(valor_novo)s, %(ponto)s, %(client_ip)s,
    %(ref_cod)s, %(origem)s, %(descricao)s
)
"""

FIELD_LABELS: dict[str, str] = {
    "CodigoRequisic": "Código requisição",
    "CategoriaLink": "Categoria",
    "NomeUsuario": "Solicitante",
    "Titular": "Titular",
    "OrgInteressado": "Órgão interessado",
    "SiglaOrgao": "Sigla",
    "GabSalaUsuario": "Gabinete/Sala",
    "Andar": "Andar",
    "Localizacao": "Localização",
    "RamalUsuario": "Ramal",
    "DataEntrada": "Data entrada",
    "ProcessoSolicit": "Processo",
    "CSnro": "CS",
    "EntregPrazoLink": "Prazo entrega",
    "EntregData": "Data entrega",
    "EntregPeriodo": "Turno",
    "ResponsavelGrafLink": "Responsável na gráfica",
    "EntregaFormaLink": "Forma de entrega",
    "ContatoTrab": "Contato",
    "Titulo": "Título",
    "TipoPublicacaoLink": "Produto",
    "FormatoLink": "Formato",
    "MaquinaLink": "Máquina",
    "Tiragem": "Tiragem",
    "Pags": "Páginas",
    "FrenteVerso": "Frente e verso",
    "ModelosArq": "Modelos arquivo",
    "PapelLink": "Papel",
    "PapelDescricao": "Descrição papel",
    "Cores": "Cores",
    "CoresDescricao": "Descrição cores",
    "DescAcabamento": "Acabamento",
    "Observ": "Observações",
    "TiragemSolicitada": "Tiragem solicitada",
    "CotaTotal": "Tiragem final",
    "MaterialFornecido": "Material fornecido",
    "Fotolito": "Fotolito",
    "ModeloDobra": "Modelo dobra",
    "ProvaImpressa": "Prova impressa",
    "InsumosFornecidos": "Insumos fornecidos",
    "ElemGrafBrasao": "Brasão",
    "ElemGrafTimbre": "Timbre",
    "ElemGrafArteGab": "Arte gabinete",
    "ElemGrafAssinatura": "Assinatura",
    "SituacaoLink": "Situação",
    "SetorLink": "Setor",
    "Observaçao": "Observação",
    "Ponto": "Ponto",
}

PROTOCOLO_FIELDS = (
    "CodigoRequisic",
    "CategoriaLink",
    "NomeUsuario",
    "Titular",
    "OrgInteressado",
    "SiglaOrgao",
    "GabSalaUsuario",
    "Andar",
    "Localizacao",
    "RamalUsuario",
    "DataEntrada",
    "ProcessoSolicit",
    "CSnro",
    "EntregPrazoLink",
    "EntregData",
    "EntregPeriodo",
    "ResponsavelGrafLink",
    "EntregaFormaLink",
    "ContatoTrab",
)

DETALHES_FIELDS = (
    "Titulo",
    "TipoPublicacaoLink",
    "FormatoLink",
    "MaquinaLink",
    "Tiragem",
    "Pags",
    "FrenteVerso",
    "ModelosArq",
    "PapelLink",
    "PapelDescricao",
    "Cores",
    "CoresDescricao",
    "DescAcabamento",
    "Observ",
    "TiragemSolicitada",
    "CotaTotal",
    "MaterialFornecido",
    "Fotolito",
    "ModeloDobra",
    "ProvaImpressa",
    "InsumosFornecidos",
    "ElemGrafBrasao",
    "ElemGrafTimbre",
    "ElemGrafArteGab",
    "ElemGrafAssinatura",
)

SAVE_PROTO_MAP = {
    "CodigoRequisicao": "CodigoRequisic",
    "CategoriaLink": "CategoriaLink",
    "NomeUsuario": "NomeUsuario",
    "Titular": "Titular",
    "OrgInteressado": "OrgInteressado",
    "SiglaOrgao": "SiglaOrgao",
    "GabSalaUsuario": "GabSalaUsuario",
    "Andar": "Andar",
    "Localizacao": "Localizacao",
    "RamalUsuario": "RamalUsuario",
    "DataEntrada": "DataEntrada",
    "ProcessoSolicit": "ProcessoSolicit",
    "CSnro": "CSnro",
    "EntregPrazoLink": "EntregPrazoLink",
    "EntregData": "EntregData",
    "EntregPeriodo": "EntregPeriodo",
    "ResponsavelGrafLink": "ResponsavelGrafLink",
    "EntregaFormaLink": "EntregaFormaLink",
    "ContatoTrab": "ContatoTrab",
    "DebitarCGRAF": "DebitarCGRAF",
}

SAVE_DET_MAP = {
    "Titulo": "Titulo",
    "TipoPublicacaoLink": "TipoPublicacaoLink",
    "FormatoLink": "FormatoLink",
    "MaquinaLink": "MaquinaLink",
    "Tiragem": "Tiragem",
    "Pags": "Pags",
    "FrenteVerso": "FrenteVerso",
    "ModelosArq": "ModelosArq",
    "PapelLink": "PapelLink",
    "PapelDescricao": "PapelDescricao",
    "Cores": "Cores",
    "CoresDescricao": "CoresDescricao",
    "DescAcabamento": "DescAcabamento",
    "Observ": "Observ",
    "TiragemSolicitada": "TiragemSolicitada",
    "TiragemFinal": "CotaTotal",
    "MaterialFornecido": "MaterialFornecido",
    "Fotolito": "Fotolito",
    "ModeloDobra": "ModeloDobra",
    "ProvaImpressa": "ProvaImpressa",
    "InsumosFornecidos": "InsumosFornecidos",
    "ElemGrafBrasao": "ElemGrafBrasao",
    "ElemGrafTimbre": "ElemGrafTimbre",
    "ElemGrafArteGab": "ElemGrafArteGab",
    "ElemGrafAssinatura": "ElemGrafAssinatura",
}


def _ensure_client_ip_column(cursor) -> None:
    global _AUDIT_CLIENT_IP_COLUMN_READY
    if _AUDIT_CLIENT_IP_COLUMN_READY:
        return
    cursor.execute(
        """
        SELECT COUNT(*) AS total
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'tab_os_audit_log'
          AND COLUMN_NAME = 'client_ip'
        """
    )
    row = cursor.fetchone() or {}
    if not row.get("total"):
        cursor.execute(
            "ALTER TABLE tab_os_audit_log ADD COLUMN client_ip VARCHAR(45) NULL AFTER ponto"
        )
    _AUDIT_CLIENT_IP_COLUMN_READY = True


def ensure_audit_table(cursor) -> None:
    global _AUDIT_TABLE_READY
    if not _AUDIT_TABLE_READY:
        cursor.execute(CREATE_TABLE_SQL)
        _AUDIT_TABLE_READY = True
    _ensure_client_ip_column(cursor)


def normalize_ponto(ponto: Optional[str]) -> Optional[str]:
    if not ponto:
        return None
    digits = "".join(filter(str.isdigit, str(ponto)))
    if not digits:
        return str(ponto).strip() or None
    return format_ponto(digits)


def normalize_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "Sim" if value else "Não"
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M:%S")
    text = str(value).strip()
    if text.endswith(".0") and text[:-2].isdigit():
        return text[:-2]
    return text


def field_label(field: str) -> str:
    return FIELD_LABELS.get(field, field)


def _entry(
    *,
    nro: int,
    ano: int,
    acao: str,
    entidade: str,
    ponto: Optional[str] = None,
    campo: Optional[str] = None,
    valor_anterior: Optional[str] = None,
    valor_novo: Optional[str] = None,
    ref_cod: Optional[str] = None,
    origem: str = "API",
    descricao: Optional[str] = None,
    evento_em: Optional[datetime] = None,
    client_ip: Optional[str] = None,
) -> dict[str, Any]:
    resolved_ip = (client_ip or get_audit_client_ip() or "").strip() or None
    return {
        "nro_protocolo": nro,
        "ano_protocolo": ano,
        "evento_em": evento_em or datetime.now(),
        "acao": acao,
        "entidade": entidade,
        "campo": campo,
        "valor_anterior": valor_anterior,
        "valor_novo": valor_novo,
        "ponto": normalize_ponto(ponto),
        "client_ip": resolved_ip,
        "ref_cod": ref_cod,
        "origem": origem,
        "descricao": descricao,
    }


def insert_entries(cursor, entries: Iterable[dict[str, Any]]) -> None:
    rows = list(entries)
    if not rows:
        return
    cursor.executemany(INSERT_SQL, rows)


def diff_entity_fields(
    *,
    nro: int,
    ano: int,
    entidade: str,
    acao_create: str,
    acao_update: str,
    old_row: Optional[Mapping[str, Any]],
    new_values: Mapping[str, Any],
    ponto: Optional[str],
    origem: str = "API",
) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    if old_row is None:
        for field, new_val in new_values.items():
            new_norm = normalize_value(new_val)
            if not new_norm:
                continue
            entries.append(
                _entry(
                    nro=nro,
                    ano=ano,
                    acao=acao_create,
                    entidade=entidade,
                    ponto=ponto,
                    campo=field_label(field),
                    valor_novo=new_norm,
                    origem=origem,
                    descricao=f"{field_label(field)} definido",
                )
            )
        return entries

    for field, new_val in new_values.items():
        old_norm = normalize_value(old_row.get(field))
        new_norm = normalize_value(new_val)
        if old_norm == new_norm:
            continue
        entries.append(
            _entry(
                nro=nro,
                ano=ano,
                acao=acao_update,
                entidade=entidade,
                ponto=ponto,
                campo=field_label(field),
                valor_anterior=old_norm or None,
                valor_novo=new_norm or None,
                origem=origem,
                descricao=f"{field_label(field)} alterado",
            )
        )
    return entries


def build_save_payload_maps(data: Any) -> tuple[dict[str, Any], dict[str, Any]]:
    proto: dict[str, Any] = {}
    det: dict[str, Any] = {}
    payload = data.model_dump() if hasattr(data, "model_dump") else dict(data)

    for req_field, db_field in SAVE_PROTO_MAP.items():
        if req_field in payload:
            proto[db_field] = payload.get(req_field)

    for req_field, db_field in SAVE_DET_MAP.items():
        if req_field in payload:
            det[db_field] = payload.get(req_field)

    return proto, det


def fetch_protocolo_row(cursor, nro: int, ano: int) -> Optional[dict[str, Any]]:
    cursor.execute(
        "SELECT * FROM tabProtocolos WHERE NroProtocolo = %s AND AnoProtocolo = %s",
        (nro, ano),
    )
    return cursor.fetchone()


def fetch_detalhes_row(cursor, nro: int, ano: int) -> Optional[dict[str, Any]]:
    cursor.execute(
        "SELECT * FROM tabDetalhesServico WHERE NroProtocoloLinkDet = %s AND AnoProtocoloLinkDet = %s",
        (nro, ano),
    )
    return cursor.fetchone()


def log_os_save(
    cursor,
    *,
    is_update: bool,
    nro: int,
    ano: int,
    ponto: Optional[str],
    data: Any,
    old_proto: Optional[Mapping[str, Any]] = None,
    old_det: Optional[Mapping[str, Any]] = None,
    origem: str = "API",
) -> None:
    ensure_audit_table(cursor)
    proto_values, det_values = build_save_payload_maps(data)
    entries: list[dict[str, Any]] = []

    if is_update:
        old_proto = old_proto or fetch_protocolo_row(cursor, nro, ano) or {}
        old_det = old_det if old_det is not None else (fetch_detalhes_row(cursor, nro, ano) or {})
        entries.extend(
            diff_entity_fields(
                nro=nro,
                ano=ano,
                entidade="protocolo",
                acao_create="CREATE",
                acao_update="UPDATE",
                old_row=old_proto,
                new_values=proto_values,
                ponto=ponto,
                origem=origem,
            )
        )
        entries.extend(
            diff_entity_fields(
                nro=nro,
                ano=ano,
                entidade="detalhes",
                acao_create="CREATE",
                acao_update="UPDATE",
                old_row=old_det if old_det else None,
                new_values=det_values,
                ponto=ponto,
                origem=origem,
            )
        )
    else:
        entries.append(
            _entry(
                nro=nro,
                ano=ano,
                acao="CREATE",
                entidade="os",
                ponto=ponto,
                origem=origem,
                descricao=f"OS {nro}/{ano} criada",
            )
        )
        entries.extend(
            diff_entity_fields(
                nro=nro,
                ano=ano,
                entidade="protocolo",
                acao_create="CREATE",
                acao_update="UPDATE",
                old_row=None,
                new_values=proto_values,
                ponto=ponto,
                origem=origem,
            )
        )
        entries.extend(
            diff_entity_fields(
                nro=nro,
                ano=ano,
                entidade="detalhes",
                acao_create="CREATE",
                acao_update="UPDATE",
                old_row=None,
                new_values=det_values,
                ponto=ponto,
                origem=origem,
            )
        )

    insert_entries(cursor, entries)


def log_andamento_added(
    cursor,
    *,
    nro: int,
    ano: int,
    cod_status: str,
    situacao: str,
    setor: str,
    obs: Optional[str],
    ponto: Optional[str],
    origem: str = "API",
    evento_em: Optional[datetime] = None,
) -> None:
    ensure_audit_table(cursor)
    descricao = f"Andamento: {situacao} — Setor {setor}"
    if obs:
        descricao += f" — {normalize_value(obs)[:240]}"
    insert_entries(
        cursor,
        [
            _entry(
                nro=nro,
                ano=ano,
                acao="ANDAMENTO_ADD",
                entidade="andamento",
                ponto=ponto,
                ref_cod=cod_status,
                origem=origem,
                descricao=descricao,
                evento_em=evento_em,
                valor_novo=json.dumps(
                    {
                        "situacao": situacao,
                        "setor": setor,
                        "observacao": obs,
                    },
                    ensure_ascii=False,
                ),
            )
        ],
    )


def log_andamento_updated(
    cursor,
    *,
    nro: int,
    ano: int,
    cod_status: str,
    old_row: Mapping[str, Any],
    situacao: str,
    setor: str,
    obs: Optional[str],
    ponto: Optional[str],
    origem: str = "API",
) -> None:
    ensure_audit_table(cursor)
    entries: list[dict[str, Any]] = []
    changes = {
        "SituacaoLink": situacao,
        "SetorLink": setor,
        "Observaçao": obs,
        "Ponto": normalize_ponto(ponto),
    }
    for field, new_val in changes.items():
        old_norm = normalize_value(old_row.get(field))
        new_norm = normalize_value(new_val)
        if old_norm == new_norm:
            continue
        entries.append(
            _entry(
                nro=nro,
                ano=ano,
                acao="ANDAMENTO_UPDATE",
                entidade="andamento",
                ponto=ponto,
                ref_cod=cod_status,
                campo=field_label(field),
                valor_anterior=old_norm or None,
                valor_novo=new_norm or None,
                origem=origem,
                descricao=f"Andamento {cod_status}: {field_label(field)} alterado",
            )
        )
    insert_entries(cursor, entries)


def log_andamento_deleted(
    cursor,
    *,
    nro: int,
    ano: int,
    cod_status: str,
    old_row: Mapping[str, Any],
    ponto: Optional[str] = None,
    origem: str = "API",
) -> None:
    ensure_audit_table(cursor)
    situacao = normalize_value(old_row.get("SituacaoLink"))
    setor = normalize_value(old_row.get("SetorLink"))
    insert_entries(
        cursor,
        [
            _entry(
                nro=nro,
                ano=ano,
                acao="ANDAMENTO_DELETE",
                entidade="andamento",
                ponto=ponto or normalize_value(old_row.get("Ponto")),
                ref_cod=cod_status,
                origem=origem,
                descricao=f"Andamento excluído: {situacao} — Setor {setor}",
                valor_anterior=json.dumps(
                    {
                        "situacao": situacao,
                        "setor": setor,
                        "observacao": normalize_value(old_row.get("Observaçao")),
                    },
                    ensure_ascii=False,
                ),
            )
        ],
    )


def log_vinculo_added(
    cursor,
    *,
    nro: int,
    ano: int,
    vinculo_nro: int,
    vinculo_ano: int,
    ponto: Optional[str] = None,
    origem: str = "API",
) -> None:
    ensure_audit_table(cursor)
    insert_entries(
        cursor,
        [
            _entry(
                nro=nro,
                ano=ano,
                acao="VINCULO_ADD",
                entidade="vinculo",
                ponto=ponto,
                origem=origem,
                descricao=f"Vínculo criado com OS {vinculo_nro}/{vinculo_ano}",
                valor_novo=f"{vinculo_nro}/{vinculo_ano}",
            )
        ],
    )


def log_vinculo_deleted(
    cursor,
    *,
    nro: int,
    ano: int,
    vinculo_nro: int,
    vinculo_ano: int,
    ponto: Optional[str] = None,
    origem: str = "API",
) -> None:
    ensure_audit_table(cursor)
    insert_entries(
        cursor,
        [
            _entry(
                nro=nro,
                ano=ano,
                acao="VINCULO_DELETE",
                entidade="vinculo",
                ponto=ponto,
                origem=origem,
                descricao=f"Vínculo removido com OS {vinculo_nro}/{vinculo_ano}",
                valor_anterior=f"{vinculo_nro}/{vinculo_ano}",
            )
        ],
    )


def log_os_duplicated(
    cursor,
    *,
    source_nro: int,
    source_ano: int,
    new_nro: int,
    new_ano: int,
    ponto: Optional[str],
    origem: str = "API",
) -> None:
    ensure_audit_table(cursor)
    insert_entries(
        cursor,
        [
            _entry(
                nro=source_nro,
                ano=source_ano,
                acao="DUPLICATE",
                entidade="os",
                ponto=ponto,
                origem=origem,
                descricao=f"OS duplicada — nova OS {new_nro}/{new_ano}",
                valor_novo=f"{new_nro}/{new_ano}",
            ),
            _entry(
                nro=new_nro,
                ano=new_ano,
                acao="CREATE",
                entidade="os",
                ponto=ponto,
                origem=origem,
                descricao=f"OS criada por duplicação da OS {source_nro}/{source_ano}",
                valor_anterior=f"{source_nro}/{source_ano}",
            ),
        ],
    )


LINK_TYPE_DESCRIPTIONS: dict[str, str] = {
    "problemas_tecnicos": "Link de problemas técnicos gerado",
    "prova": "Link de prova gerado",
    "prova_web": "Link de Prova WEB gerado",
    "portal_cliente": "Link de portal do cliente gerado",
    "generico": "Link gerado",
}


def infer_link_type(url: str) -> str:
    lower = url.lower()
    if "client_proof" in lower or "/prova/" in lower or "/portal/prova/" in lower:
        return "prova"
    if "client_pt" in lower:
        return "problemas_tecnicos"
    if "/portal/" in lower:
        return "portal_cliente"
    return "generico"


def log_link_generated(
    cursor,
    *,
    nro: int,
    ano: int,
    url: str,
    link_type: Optional[str] = None,
    ponto: Optional[str] = None,
    origem: str = "ANALISE",
) -> None:
    ensure_audit_table(cursor)
    resolved_type = link_type or infer_link_type(url)
    prefix = LINK_TYPE_DESCRIPTIONS.get(resolved_type, LINK_TYPE_DESCRIPTIONS["generico"])
    insert_entries(
        cursor,
        [
            _entry(
                nro=nro,
                ano=ano,
                acao="LINK_GENERATED",
                entidade="link",
                ponto=ponto,
                origem=origem,
                descricao=f"{prefix}: {url}",
                valor_novo=url,
            )
        ],
    )


def log_link_generated_db(db, **kwargs) -> None:
    """Grava log de link fora de transação existente."""

    def transaction_logic(cursor):
        log_link_generated(cursor, **kwargs)

    db.execute_transaction([transaction_logic])


def backfill_legacy_audit(cursor, nro: int, ano: int) -> None:
    ensure_audit_table(cursor)
    cursor.execute(
        "SELECT COUNT(*) AS total FROM tab_os_audit_log WHERE nro_protocolo = %s AND ano_protocolo = %s",
        (nro, ano),
    )
    if (cursor.fetchone() or {}).get("total"):
        return

    entries: list[dict[str, Any]] = []

    cursor.execute(
        """
        SELECT CodStatus, SituacaoLink, SetorLink, Data, Ponto, Observaçao
        FROM tabAndamento
        WHERE NroProtocoloLink = %s AND AnoProtocoloLink = %s
        ORDER BY CodStatus
        """,
        (nro, ano),
    )
    andamentos = cursor.fetchall() or []

    if andamentos:
        first = andamentos[0]
        evento = first.get("Data") or datetime.now()
        entries.append(
            _entry(
                nro=nro,
                ano=ano,
                acao="CREATE",
                entidade="os",
                ponto=normalize_value(first.get("Ponto")) or None,
                origem="BACKFILL",
                descricao=f"OS {nro}/{ano} criada (registro legado)",
                evento_em=evento,
            )
        )

    for row in andamentos:
        cod = row.get("CodStatus")
        situacao = normalize_value(row.get("SituacaoLink"))
        setor = normalize_value(row.get("SetorLink"))
        obs = normalize_value(row.get("Observaçao"))
        descricao = f"Andamento: {situacao} — Setor {setor}"
        if obs:
            descricao += f" — {obs[:240]}"
        entries.append(
            _entry(
                nro=nro,
                ano=ano,
                acao="ANDAMENTO_ADD",
                entidade="andamento",
                ponto=normalize_value(row.get("Ponto")) or None,
                ref_cod=f"backfill:{cod}",
                origem="BACKFILL",
                descricao=descricao,
                evento_em=row.get("Data") or datetime.now(),
                valor_novo=json.dumps(
                    {"situacao": situacao, "setor": setor, "observacao": obs},
                    ensure_ascii=False,
                ),
            )
        )

    insert_entries(cursor, entries)


def fetch_audit_log(cursor, nro: int, ano: int) -> list[dict[str, Any]]:
    ensure_audit_table(cursor)
    backfill_legacy_audit(cursor, nro, ano)
    cursor.execute(
        """
        SELECT id, evento_em, acao, entidade, campo, valor_anterior, valor_novo,
               ponto, client_ip, origem, descricao
        FROM tab_os_audit_log
        WHERE nro_protocolo = %s AND ano_protocolo = %s
        ORDER BY evento_em ASC, id ASC
        """,
        (nro, ano),
    )
    return cursor.fetchall() or []
