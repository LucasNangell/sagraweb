"""Contexto Papelaria para provas do portal do cliente (token)."""
from __future__ import annotations

import json
from typing import Any, Optional

from database import db
from services.papelaria_jobs_service import STATUS_COMPLETED, list_jobs_for_os
from services.proof_files_service import resolve_proof_pdf_for_token_row


def _os_produto_e_cores(ano: int, os_id: int) -> tuple[str, str]:
    rows = db.execute_query(
        """
        SELECT d.TipoPublicacaoLink AS produto,
               d.Cores AS cores,
               d.CoresDescricao AS cores_descricao
        FROM tabProtocolos p
        LEFT JOIN tabDetalhesServico d
          ON p.NroProtocolo = d.NroProtocoloLinkDet
         AND p.AnoProtocolo = d.AnoProtocoloLinkDet
        WHERE p.NroProtocolo = %(nro)s AND p.AnoProtocolo = %(ano)s
        LIMIT 1
        """,
        {"nro": os_id, "ano": ano},
    )
    if not rows:
        return "", ""
    row = rows[0]
    produto = (row.get("produto") or "").strip()
    cores = (row.get("cores_descricao") or row.get("cores") or "").strip()
    return produto, cores


def _latest_completed_job(ano: int, os_id: int) -> Optional[dict[str, Any]]:
    jobs = list_jobs_for_os(ano, os_id, limit=20)
    for job in jobs:
        if job.get("status") == STATUS_COMPLETED and job.get("tem_arquivo_pdf"):
            return job
    return None


def resolve_papelaria_proof_context(
    proof_row: dict[str, Any],
    ano: int,
    os_id: int,
) -> Optional[dict[str, Any]]:
    """
    Identifica prova de Papelaria para mockup 3D no portal.

    Regra: OS >= 5000 (faixa Papelaria) e PDF de prova disponível.
    Metadados do mockup vêm do job concluído mais recente, quando existir.
    """
    if os_id < 5000:
        return None

    pdf_path, _display = resolve_proof_pdf_for_token_row(proof_row, ano, os_id)
    if not pdf_path:
        return None

    proof_id = int(proof_row["ID"])
    job = _latest_completed_job(ano, os_id)

    produto = ""
    arquivo_modelo = ""
    frente_verso = ""
    cores = ""
    mockup_config_json: Optional[str] = None
    job_id: Optional[int] = None

    if job:
        job_id = int(job["id"])
        produto = (job.get("produto") or "").strip()
        arquivo_modelo = (job.get("arquivo_modelo") or "").strip()
        dados = job.get("dados") or {}
        if isinstance(dados, dict):
            frente_verso = (
                str(dados.get("frente_verso") or dados.get("fv") or "")
            ).strip()
        modelo_id = job.get("modelo_id")
        if modelo_id:
            from services.papelaria_models_service import get_modelo_by_id

            modelo = get_modelo_by_id(int(modelo_id))
            if modelo:
                mockup_config_json = modelo.get("mockup_config_json")
                if not produto:
                    produto = (modelo.get("produto") or "").strip()
                if not arquivo_modelo:
                    arquivo_modelo = (modelo.get("arquivo_modelo") or "").strip()
                cores = (modelo.get("cores") or "").strip()
        if not cores:
            cores = (job.get("cores") or "").strip()
    else:
        produto, cores = _os_produto_e_cores(ano, os_id)

    if not cores:
        _, cores_os = _os_produto_e_cores(ano, os_id)
        cores = cores_os

    return {
        "proof_id": proof_id,
        "job_id": job_id,
        "pdf_path": pdf_path,
        "produto": produto,
        "arquivo_modelo": arquivo_modelo,
        "frente_verso": frente_verso,
        "cores": cores,
        "mockup_config_json": mockup_config_json,
    }


def _os_observ(ano: int, os_id: int) -> str:
    rows = db.execute_query(
        """
        SELECT d.Observ AS observ
        FROM tabDetalhesServico d
        WHERE d.NroProtocoloLinkDet = %(nro)s AND d.AnoProtocoloLinkDet = %(ano)s
        LIMIT 1
        """,
        {"nro": os_id, "ano": ano},
    )
    if not rows:
        return ""
    return str(rows[0].get("observ") or "").strip()


def build_portal_papelaria_edit_payload(
    proof_row: dict,
    ano: int,
    os_id: int,
) -> dict[str, Any] | None:
    """Dados para edição de campos e prévia ao vivo no portal de prova."""
    ctx = resolve_papelaria_proof_context(proof_row, ano, os_id)
    if not ctx or not ctx.get("job_id"):
        return None

    from services.papelaria_jobs_service import get_job
    from services.papelaria_models_service import get_modelo_with_preview

    job = get_job(int(ctx["job_id"]))
    if not job:
        return None

    modelo_id = job.get("modelo_id")
    modelo = get_modelo_with_preview(int(modelo_id)) if modelo_id else None
    job_dados = job.get("dados") if isinstance(job.get("dados"), dict) else {}

    return {
        "proof_id": ctx["proof_id"],
        "job_id": ctx["job_id"],
        "modelo_id": modelo_id,
        "job_dados": job_dados,
        "campos_formulario": (modelo or {}).get("campos_formulario") or [],
        "preview_config_json": (modelo or {}).get("preview_config_json"),
        "tem_preview_config": bool((modelo or {}).get("preview_config_json")),
        "produto": ctx.get("produto") or (modelo or {}).get("produto") or "",
        "arquivo_modelo": ctx.get("arquivo_modelo") or "",
        "frente_verso": ctx.get("frente_verso") or "",
        "cores": ctx.get("cores") or (modelo or {}).get("cores") or "",
        "os_observ": _os_observ(ano, os_id),
    }


def load_cliente_alteracao_prova(ano: int, os_id: int) -> dict[str, Any] | None:
    """Última solicitação de alteração de prova (token rejeitado com JSON de campos)."""
    if os_id < 5000:
        return None
    rows = db.execute_query(
        """
        SELECT AlteracoesJson, Versao
        FROM tabProofTokens
        WHERE NroProtocolo = %(nro)s AND AnoProtocolo = %(ano)s
          AND Aprovado = 0
          AND AlteracoesJson IS NOT NULL
        ORDER BY COALESCE(DataResposta, DataEnvio) DESC, ID DESC
        LIMIT 1
        """,
        {"nro": os_id, "ano": ano},
    )
    if not rows:
        return None
    raw = rows[0].get("AlteracoesJson")
    if raw is None:
        return None
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return None
    elif isinstance(raw, dict):
        parsed = raw
    else:
        return None
    if not isinstance(parsed, dict):
        return None
    campos = parsed.get("campos")
    if not isinstance(campos, dict):
        campos = {}
    return {
        "campos": {str(k): str(v) for k, v in campos.items()},
        "observacao_cliente": str(parsed.get("observacao_cliente") or "").strip(),
        "versao": str(parsed.get("versao") or rows[0].get("Versao") or "").strip(),
        "modelo_id": parsed.get("modelo_id"),
        "job_id": parsed.get("job_id"),
    }
