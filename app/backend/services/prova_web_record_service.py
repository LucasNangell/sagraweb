"""
Registro da Prova WEB (tabProvaWeb) — leitura e resolução de arquivos.

Compartilhado entre o visualizador interno (routers.prova_web_routes) e o portal
público do cliente (routers.proof_portal_routes), para que os dois resolvam os
PDFs da prova exatamente da mesma forma.
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime
from typing import Any, Optional

from database import db
from services.prova_web_render_service import (
    MODE_CAPA_MIOLO,
    MODE_ESPIRAL,
    MODE_FOLHA_DOBRADA,
    MODE_UNICO,
    pasta_render_for_versao,
    resolve_os_relative_pdf,
)

logger = logging.getLogger(__name__)

STATUS_RASCUNHO = "rascunho"
STATUS_PUBLICADO = "publicado"


def os_folder_path(ano: int, os_id: int) -> Optional[str]:
    from routers.os_routes import _get_os_folder_path

    return _get_os_folder_path(ano, os_id)


def require_os_folder(ano: int, os_id: int) -> str:
    folder = os_folder_path(ano, os_id)
    if not folder or not os.path.isdir(folder):
        raise FileNotFoundError("Pasta da OS não encontrada na rede.")
    return folder


def _parse_crop_json(raw: Any) -> Optional[dict[str, Any]]:
    if raw is None or raw == "":
        return None
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode("utf-8", errors="replace")
    if isinstance(raw, str):
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return None
        return data if isinstance(data, dict) else None
    return None


def _row_to_record(row: dict[str, Any]) -> dict[str, Any]:
    def _iso(value: Any) -> Optional[str]:
        if isinstance(value, datetime):
            return value.isoformat()
        return str(value) if value else None

    versao = int(row.get("Versao") or 1)
    pasta = (row.get("PastaRender") or "").strip() or pasta_render_for_versao(versao)
    status_raw = (row.get("Status") or STATUS_PUBLICADO).strip().lower()
    status = (
        STATUS_RASCUNHO
        if status_raw == STATUS_RASCUNHO
        else STATUS_PUBLICADO
    )
    return {
        "modo": (row.get("Modo") or MODE_UNICO).strip(),
        "arquivoUnico": (row.get("ArquivoUnico") or "").strip() or None,
        "arquivoCapa": (row.get("ArquivoCapa") or "").strip() or None,
        "arquivoMiolo": (row.get("ArquivoMiolo") or "").strip() or None,
        "cropJson": _parse_crop_json(row.get("CropJson")),
        "versao": versao,
        "pastaRender": pasta,
        "status": status,
        "isDraft": status == STATUS_RASCUNHO,
        "pontoRegistro": row.get("PontoRegistro"),
        "dataRegistro": _iso(row.get("DataRegistro")),
        "dataAtualizacao": _iso(row.get("DataAtualizacao")),
    }


def get_prova_web_record(ano: int, os_id: int) -> Optional[dict[str, Any]]:
    """Última versão da Prova WEB da OS (ORDER BY Versao DESC)."""
    rows = db.execute_query(
        """
        SELECT Modo, ArquivoUnico, ArquivoCapa, ArquivoMiolo, CropJson,
               Versao, PastaRender, Status, PontoRegistro, DataRegistro, DataAtualizacao
        FROM tabProvaWeb
        WHERE NroProtocolo = %(nro)s AND AnoProtocolo = %(ano)s
        ORDER BY Versao DESC
        LIMIT 1
        """,
        {"nro": os_id, "ano": ano},
    )
    if not rows:
        return None
    return _row_to_record(rows[0])


def get_prova_web_record_by_versao(
    ano: int, os_id: int, versao: int
) -> Optional[dict[str, Any]]:
    rows = db.execute_query(
        """
        SELECT Modo, ArquivoUnico, ArquivoCapa, ArquivoMiolo, CropJson,
               Versao, PastaRender, Status, PontoRegistro, DataRegistro, DataAtualizacao
        FROM tabProvaWeb
        WHERE NroProtocolo = %(nro)s AND AnoProtocolo = %(ano)s
          AND Versao = %(versao)s
        LIMIT 1
        """,
        {"nro": os_id, "ano": ano, "versao": int(versao)},
    )
    if not rows:
        return None
    return _row_to_record(rows[0])


def set_prova_web_status(ano: int, os_id: int, versao: int, status: str) -> None:
    if status not in (STATUS_RASCUNHO, STATUS_PUBLICADO):
        raise ValueError(f"Status inválido: {status}")
    db.execute_query(
        """
        UPDATE tabProvaWeb
        SET Status = %(status)s
        WHERE NroProtocolo = %(nro)s AND AnoProtocolo = %(ano)s
          AND Versao = %(versao)s
        """,
        {
            "status": status,
            "nro": os_id,
            "ano": ano,
            "versao": int(versao),
        },
    )


def delete_prova_web_version(ano: int, os_id: int, versao: int) -> bool:
    """Remove a linha da versão. Retorna True se apagou."""
    before = get_prova_web_record_by_versao(ano, os_id, versao)
    if not before:
        return False
    db.execute_query(
        """
        DELETE FROM tabProvaWeb
        WHERE NroProtocolo = %(nro)s AND AnoProtocolo = %(ano)s
          AND Versao = %(versao)s
        """,
        {"nro": os_id, "ano": ano, "versao": int(versao)},
    )
    return True


def count_prova_web_versions(ano: int, os_id: int) -> int:
    rows = db.execute_query(
        """
        SELECT COUNT(*) AS c FROM tabProvaWeb
        WHERE NroProtocolo = %(nro)s AND AnoProtocolo = %(ano)s
        """,
        {"nro": os_id, "ano": ano},
    )
    if not rows:
        return 0
    return int(rows[0].get("c") or 0)


def next_prova_web_versao(ano: int, os_id: int) -> int:
    rows = db.execute_query(
        """
        SELECT COALESCE(MAX(Versao), 0) AS m FROM tabProvaWeb
        WHERE NroProtocolo = %(nro)s AND AnoProtocolo = %(ano)s
        """,
        {"nro": os_id, "ano": ano},
    )
    max_v = int((rows[0].get("m") if rows else 0) or 0)
    return max_v + 1


def resolve_record_sources(
    ano: int, os_id: int, record: dict[str, Any]
) -> tuple[str, list[str]]:
    """
    Retorna (modo, caminhos físicos) do registro, validando contra a pasta da OS.

    Levanta FileNotFoundError (pasta/arquivo ausente) ou ValueError (caminho
    inválido); o caller mapeia para o status HTTP adequado.
    """
    folder = require_os_folder(ano, os_id)
    modo = record.get("modo") or MODE_UNICO
    if modo == MODE_CAPA_MIOLO:
        capa = resolve_os_relative_pdf(folder, record.get("arquivoCapa") or "")
        miolo = resolve_os_relative_pdf(folder, record.get("arquivoMiolo") or "")
        return MODE_CAPA_MIOLO, [capa, miolo]
    if modo == MODE_ESPIRAL:
        crop = record.get("cropJson") if isinstance(record.get("cropJson"), dict) else {}
        espiral = crop.get("espiral") if isinstance(crop, dict) else None
        kind = "unico"
        if isinstance(espiral, dict):
            kind = str(espiral.get("sourceKind") or "unico").strip().lower()
        if kind == "capa_miolo":
            capa = resolve_os_relative_pdf(folder, record.get("arquivoCapa") or "")
            miolo = resolve_os_relative_pdf(folder, record.get("arquivoMiolo") or "")
            return MODE_ESPIRAL, [capa, miolo]
        unico = resolve_os_relative_pdf(folder, record.get("arquivoUnico") or "")
        return MODE_ESPIRAL, [unico]
    # unico e folha_dobrada usam ArquivoUnico
    unico = resolve_os_relative_pdf(folder, record.get("arquivoUnico") or "")
    if modo == MODE_FOLHA_DOBRADA:
        return MODE_FOLHA_DOBRADA, [unico]
    return MODE_UNICO, [unico]


def resolve_prova_web_pdf(ano: int, os_id: int) -> tuple[Optional[str], str]:
    """
    PDF representativo da Prova WEB para download/leitura direta.

    No modo capa+miolo devolve o miolo (documento principal). Retorna
    (caminho_físico, nome_exibição) ou (None, "") quando indisponível.
    """
    return resolve_prova_web_pdf_parte(ano, os_id, parte=None)


def resolve_prova_web_pdf_parte(
    ano: int, os_id: int, parte: Optional[str] = None
) -> tuple[Optional[str], str]:
    """
    PDF da Prova WEB por parte: unico | capa | miolo (ou default legada).
    """
    record = get_prova_web_record(ano, os_id)
    if not record:
        return None, ""
    try:
        modo, paths = resolve_record_sources(ano, os_id, record)
    except (FileNotFoundError, ValueError) as exc:
        logger.warning("Prova WEB: PDF indisponível (%s/%s): %s", os_id, ano, exc)
        return None, ""

    parte_n = (parte or "").strip().lower() or None
    if modo == MODE_CAPA_MIOLO or (
        modo == MODE_ESPIRAL and len(paths) >= 2
    ):
        if parte_n == "capa":
            path = paths[0]
        elif parte_n in (None, "miolo"):
            path = paths[-1]
        else:
            path = paths[-1]
    else:
        path = paths[0]
    return path, os.path.basename(path)


def prova_web_pdf_sources_meta(record: dict[str, Any]) -> list[dict[str, str]]:
    """Lista {id,label} para a aba PDF (sem paths UNC)."""
    modo = (record.get("modo") or MODE_UNICO).strip()
    if modo == MODE_CAPA_MIOLO:
        out: list[dict[str, str]] = []
        if record.get("arquivoCapa"):
            out.append({"id": "capa", "label": "Capa"})
        if record.get("arquivoMiolo"):
            out.append({"id": "miolo", "label": "Miolo"})
        return out
    if modo == MODE_ESPIRAL:
        crop = record.get("cropJson") if isinstance(record.get("cropJson"), dict) else {}
        espiral = crop.get("espiral") if isinstance(crop, dict) else None
        kind = "unico"
        if isinstance(espiral, dict):
            kind = str(espiral.get("sourceKind") or "unico").strip().lower()
        if kind == "capa_miolo":
            out = []
            if record.get("arquivoCapa"):
                out.append({"id": "capa", "label": "Capa"})
            if record.get("arquivoMiolo"):
                out.append({"id": "miolo", "label": "Miolo"})
            return out
        if record.get("arquivoUnico"):
            return [{"id": "unico", "label": "Espiral"}]
        return []
    if record.get("arquivoUnico"):
        label = "Folheto" if modo == MODE_FOLHA_DOBRADA else "PDF"
        return [{"id": "unico", "label": label}]
    return []
