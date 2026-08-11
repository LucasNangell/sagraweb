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
    MODE_CAIXA,
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

RENDER_PENDING = "pending"
RENDER_RUNNING = "running"
RENDER_READY = "ready"
RENDER_ERROR = "error"
RENDER_CANCELLED = "cancelled"

RENDER_STATUSES = frozenset(
    {
        RENDER_PENDING,
        RENDER_RUNNING,
        RENDER_READY,
        RENDER_ERROR,
        RENDER_CANCELLED,
    }
)
RENDER_IN_FLIGHT = frozenset({RENDER_PENDING, RENDER_RUNNING})

_SELECT_PROVA_WEB_COLS = """
    Modo, ArquivoUnico, ArquivoCapa, ArquivoMiolo, CropJson,
    Versao, PastaRender, Status, RenderStatus, RenderError, RenderProgress,
    RenderStartedAt, RenderFinishedAt, PontoRegistro, DataRegistro, DataAtualizacao
"""


def os_folder_path(ano: int, os_id: int) -> Optional[str]:
    from routers.os_routes import _get_os_folder_path

    return _get_os_folder_path(ano, os_id)


def require_os_folder(ano: int, os_id: int) -> str:
    folder = os_folder_path(ano, os_id)
    if not folder or not os.path.isdir(folder):
        raise FileNotFoundError("Pasta da OS não encontrada na rede.")
    return folder


def _parse_json_object(raw: Any) -> Optional[dict[str, Any]]:
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


def _parse_crop_json(raw: Any) -> Optional[dict[str, Any]]:
    return _parse_json_object(raw)


def _normalize_render_status(raw: Any) -> str:
    value = (str(raw).strip().lower() if raw is not None else "") or RENDER_READY
    return value if value in RENDER_STATUSES else RENDER_READY


def is_render_ready(record: Optional[dict[str, Any]]) -> bool:
    if not record:
        return False
    return _normalize_render_status(record.get("renderStatus")) == RENDER_READY


def is_render_in_flight(record: Optional[dict[str, Any]]) -> bool:
    if not record:
        return False
    return _normalize_render_status(record.get("renderStatus")) in RENDER_IN_FLIGHT


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
    render_status = _normalize_render_status(row.get("RenderStatus"))
    render_error = (row.get("RenderError") or "").strip() or None
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
        "renderStatus": render_status,
        "renderError": render_error,
        "renderProgress": _parse_json_object(row.get("RenderProgress")),
        "renderStartedAt": _iso(row.get("RenderStartedAt")),
        "renderFinishedAt": _iso(row.get("RenderFinishedAt")),
        "pontoRegistro": row.get("PontoRegistro"),
        "dataRegistro": _iso(row.get("DataRegistro")),
        "dataAtualizacao": _iso(row.get("DataAtualizacao")),
    }


def get_prova_web_record(ano: int, os_id: int) -> Optional[dict[str, Any]]:
    """Última versão da Prova WEB da OS (ORDER BY Versao DESC)."""
    rows = db.execute_query(
        f"""
        SELECT {_SELECT_PROVA_WEB_COLS}
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
        f"""
        SELECT {_SELECT_PROVA_WEB_COLS}
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


def set_prova_web_render_state(
    ano: int,
    os_id: int,
    versao: int,
    *,
    render_status: str,
    render_error: Optional[str] = None,
    render_progress: Optional[dict[str, Any]] = None,
    touch_started: bool = False,
    touch_finished: bool = False,
    clear_error: bool = False,
    clear_progress: bool = False,
) -> None:
    if render_status not in RENDER_STATUSES:
        raise ValueError(f"RenderStatus inválido: {render_status}")
    progress_payload = None
    if render_progress is not None:
        progress_payload = json.dumps(render_progress, ensure_ascii=False)
    error_value = None if clear_error else render_error
    if error_value is not None:
        error_value = str(error_value).strip()[:512] or None
    sets = [
        "RenderStatus = %(render_status)s",
        "RenderError = %(render_error)s",
    ]
    if render_progress is not None or clear_progress:
        sets.append("RenderProgress = %(render_progress)s")
    if touch_started:
        sets.append("RenderStartedAt = NOW()")
    if touch_finished:
        sets.append("RenderFinishedAt = NOW()")
    params: dict[str, Any] = {
        "render_status": render_status,
        "render_error": error_value,
        "nro": os_id,
        "ano": ano,
        "versao": int(versao),
    }
    if render_progress is not None or clear_progress:
        params["render_progress"] = None if clear_progress else progress_payload
    db.execute_query(
        f"""
        UPDATE tabProvaWeb
        SET {", ".join(sets)}
        WHERE NroProtocolo = %(nro)s AND AnoProtocolo = %(ano)s
          AND Versao = %(versao)s
        """,
        params,
    )


def finalize_prova_web_render(
    ano: int,
    os_id: int,
    versao: int,
    *,
    render_status: str,
    render_error: Optional[str] = None,
    clear_error: bool = False,
    clear_progress: bool = False,
) -> bool:
    """Atualiza estado final só se ainda estiver `running` (evita race com replace)."""
    if render_status not in (RENDER_READY, RENDER_ERROR, RENDER_CANCELLED):
        raise ValueError(f"Status final inválido: {render_status}")
    applied = {"ok": False}
    error_value = None if clear_error else render_error
    if error_value is not None:
        error_value = str(error_value).strip()[:512] or None

    def _op(cursor) -> None:
        sets = [
            "RenderStatus = %s",
            "RenderError = %s",
            "RenderFinishedAt = NOW()",
        ]
        params: list[Any] = [render_status, error_value]
        if clear_progress:
            sets.append("RenderProgress = NULL")
        cursor.execute(
            f"""
            UPDATE tabProvaWeb
            SET {", ".join(sets)}
            WHERE NroProtocolo = %s AND AnoProtocolo = %s
              AND Versao = %s
              AND RenderStatus = %s
            """,
            (
                *params,
                os_id,
                ano,
                int(versao),
                RENDER_RUNNING,
            ),
        )
        applied["ok"] = int(cursor.rowcount or 0) == 1

    db.execute_transaction([_op])
    return bool(applied["ok"])


def mark_prova_web_render_pending(ano: int, os_id: int, versao: int) -> None:
    db.execute_query(
        """
        UPDATE tabProvaWeb
        SET RenderStatus = %(status)s,
            RenderError = NULL,
            RenderProgress = NULL,
            RenderStartedAt = NULL,
            RenderFinishedAt = NULL
        WHERE NroProtocolo = %(nro)s AND AnoProtocolo = %(ano)s
          AND Versao = %(versao)s
        """,
        {
            "status": RENDER_PENDING,
            "nro": os_id,
            "ano": ano,
            "versao": int(versao),
        },
    )


def update_prova_web_render_progress(
    ano: int,
    os_id: int,
    versao: int,
    *,
    done: int,
    total: int,
) -> bool:
    """Atualiza progresso só se ainda estiver `running`."""
    applied = {"ok": False}
    payload = json.dumps(
        {"done": max(0, int(done)), "total": max(0, int(total))},
        ensure_ascii=False,
    )

    def _op(cursor) -> None:
        cursor.execute(
            """
            UPDATE tabProvaWeb
            SET RenderProgress = %s
            WHERE NroProtocolo = %s AND AnoProtocolo = %s
              AND Versao = %s
              AND RenderStatus = %s
            """,
            (payload, os_id, ano, int(versao), RENDER_RUNNING),
        )
        applied["ok"] = int(cursor.rowcount or 0) == 1

    db.execute_transaction([_op])
    return bool(applied["ok"])


def claim_prova_web_render(ano: int, os_id: int, versao: int) -> bool:
    """pending → running. Retorna True se este worker ganhou o claim."""
    claimed = {"ok": False}

    def _op(cursor) -> None:
        cursor.execute(
            """
            UPDATE tabProvaWeb
            SET RenderStatus = %s,
                RenderError = NULL,
                RenderStartedAt = NOW(),
                RenderFinishedAt = NULL
            WHERE NroProtocolo = %s AND AnoProtocolo = %s
              AND Versao = %s
              AND RenderStatus = %s
            """,
            (
                RENDER_RUNNING,
                os_id,
                ano,
                int(versao),
                RENDER_PENDING,
            ),
        )
        claimed["ok"] = int(cursor.rowcount or 0) == 1

    db.execute_transaction([_op])
    return bool(claimed["ok"])


def list_prova_web_render_jobs(
    *, statuses: Optional[list[str]] = None
) -> list[dict[str, Any]]:
    wanted = [s for s in (statuses or list(RENDER_IN_FLIGHT)) if s in RENDER_STATUSES]
    if not wanted:
        return []
    placeholders = ", ".join(["%s"] * len(wanted))
    rows = db.execute_query(
        f"""
        SELECT {_SELECT_PROVA_WEB_COLS}, NroProtocolo, AnoProtocolo
        FROM tabProvaWeb
        WHERE RenderStatus IN ({placeholders})
        ORDER BY DataAtualizacao ASC
        """,
        tuple(wanted),
    )
    out: list[dict[str, Any]] = []
    for row in rows or []:
        rec = _row_to_record(row)
        out.append(
            {
                **rec,
                "nroProtocolo": int(row.get("NroProtocolo") or 0),
                "anoProtocolo": int(row.get("AnoProtocolo") or 0),
            }
        )
    return out


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
    if modo == MODE_CAIXA:
        crop = record.get("cropJson") if isinstance(record.get("cropJson"), dict) else {}
        caixa = crop.get("caixa") if isinstance(crop, dict) else None
        kind = "combined"
        if isinstance(caixa, dict):
            kind = str(caixa.get("sourceKind") or "combined").strip().lower()
        if kind == "separate":
            faca = resolve_os_relative_pdf(folder, record.get("arquivoCapa") or "")
            arte = resolve_os_relative_pdf(folder, record.get("arquivoMiolo") or "")
            return MODE_CAIXA, [faca, arte]
        unico = resolve_os_relative_pdf(folder, record.get("arquivoUnico") or "")
        return MODE_CAIXA, [unico]
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
        modo in (MODE_ESPIRAL, MODE_CAIXA) and len(paths) >= 2
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
    if modo == MODE_CAIXA:
        crop = record.get("cropJson") if isinstance(record.get("cropJson"), dict) else {}
        caixa = crop.get("caixa") if isinstance(crop, dict) else None
        kind = "combined"
        if isinstance(caixa, dict):
            kind = str(caixa.get("sourceKind") or "combined").strip().lower()
        if kind == "separate":
            out = []
            if record.get("arquivoCapa"):
                out.append({"id": "capa", "label": "Faca"})
            if record.get("arquivoMiolo"):
                out.append({"id": "miolo", "label": "Arte"})
            return out
        if record.get("arquivoUnico"):
            return [{"id": "unico", "label": "Caixa"}]
        return []
    if record.get("arquivoUnico"):
        label = "Folheto" if modo == MODE_FOLHA_DOBRADA else "PDF"
        return [{"id": "unico", "label": label}]
    return []
