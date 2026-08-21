"""
Modelos de e-mail múltiplos por grupo/variante (tabEmailTemplateModel).

Compatível com templates legados em tabEmailTemplateConfig / email_template_service.
"""
from __future__ import annotations

import logging
import os
import re
import threading
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from database import db

logger = logging.getLogger(__name__)

_lock = threading.Lock()

VALID_GRUPOS = frozenset(
    {"prova_os", "prova_sp", "problema_tecnico", "timbrado_a4_digital"}
)
VALID_VARIANTES = frozenset({"portal", "sem_portal"})
LEGACY_BY_GRUPO = {
    "prova_os": "proof_os",
    "prova_sp": "proof_sp",
    "problema_tecnico": "pt_report_wrapper",
}

PLACEHOLDER_TEXTO = "{TEXTO_AQUI}"
PLACEHOLDER_HTML_AQUI = "#HTMLAQUI"
UNSUBSTITUTED_MARKERS = (
    PLACEHOLDER_TEXTO,
    PLACEHOLDER_HTML_AQUI,
    "{{conteudo}}",
)

DEFAULT_PT_SEM_PORTAL_HTML = (
    "<html><body style='font-family:Segoe UI,sans-serif;color:#333;'>"
    "<h2>Problemas técnicos — OS {{nr_os}}/{{ano}}</h2>"
    "<p>Segue a relação de problemas técnicos detectados na ordem de serviço.</p>"
    f"{PLACEHOLDER_TEXTO}"
    "</body></html>"
)

DEFAULT_PROVA_SEM_PORTAL_HTML = (
    "<html><body style=\"font-family:Segoe UI,sans-serif;color:#333;\">"
    "<p>Prezado(a),</p>"
    "<p>Segue em anexo o PDF da prova da ordem de serviço "
    "<strong>{{nr_os}}/{{ano}}</strong> — {{produto}}.</p>"
    "<p>Versão: {{versao}}</p>"
    "<p>Atenciosamente,<br>Coordenação Gráfica</p>"
    "</body></html>"
)

DEFAULT_TIMBRADO_A4_DIGITAL_SUBJECT = (
    "CGraf: Timbrado A4 Digital da SP {{nr_os}}/{{ano}}"
)

DEFAULT_TIMBRADO_A4_DIGITAL_HTML = (
    "<html><body style=\"font-family:Segoe UI,sans-serif;color:#333;\">"
    "<p>Segue anexo arquivo Word contendo Timbrado A4 digital, editável, "
    "solicitado pela SP mencionada no Assunto deste e-mail.</p>"
    "<p style=\"font-size:12px;color:#666;\">"
    "OS <strong>{{nr_os}}/{{ano}}</strong> — {{produto}}"
    "</p>"
    "<p>Atenciosamente,<br>Coordenação Gráfica — SEFOC</p>"
    "</body></html>"
)

# Seeds idempotentes — Nome fixo por grupo/variante
_SEED_SPECS: List[Dict[str, Any]] = [
    {
        "grupo": "prova_os",
        "variante": "portal",
        "nome": "Padrão — com portal",
        "ativo": 1,
        "anexar_pdf": 0,
        "ordem": 10,
    },
    {
        "grupo": "prova_os",
        "variante": "sem_portal",
        "nome": "Padrão — com anexo PDF",
        "ativo": 0,
        "anexar_pdf": 1,
        "ordem": 20,
        "html_override": DEFAULT_PROVA_SEM_PORTAL_HTML,
    },
    {
        "grupo": "prova_sp",
        "variante": "portal",
        "nome": "Padrão — com portal",
        "ativo": 1,
        "anexar_pdf": 0,
        "ordem": 10,
    },
    {
        "grupo": "prova_sp",
        "variante": "sem_portal",
        "nome": "Padrão — com anexo PDF",
        "ativo": 0,
        "anexar_pdf": 1,
        "ordem": 20,
        "html_override": DEFAULT_PROVA_SEM_PORTAL_HTML,
    },
    {
        "grupo": "problema_tecnico",
        "variante": "portal",
        "nome": "Padrão — com portal",
        "ativo": 1,
        "anexar_pdf": 0,
        "ordem": 10,
    },
    {
        "grupo": "problema_tecnico",
        "variante": "sem_portal",
        "nome": "Padrão — corpo inline",
        "ativo": 0,
        "anexar_pdf": 0,
        "ordem": 20,
        "html_override": DEFAULT_PT_SEM_PORTAL_HTML,
    },
    {
        "grupo": "timbrado_a4_digital",
        "variante": "sem_portal",
        "nome": "Timbrado A4 Digital",
        "ativo": 1,
        "anexar_pdf": 1,
        "ordem": 10,
        "assunto_override": DEFAULT_TIMBRADO_A4_DIGITAL_SUBJECT,
        "html_override": DEFAULT_TIMBRADO_A4_DIGITAL_HTML,
    },
]


def ensure_email_template_model_schema() -> None:
    db.execute_query(
        """
        CREATE TABLE IF NOT EXISTS tabEmailTemplateModel (
            Id INT NOT NULL AUTO_INCREMENT,
            Grupo VARCHAR(32) NOT NULL,
            Variante VARCHAR(32) NOT NULL,
            Nome VARCHAR(120) NOT NULL,
            Assunto VARCHAR(500) NOT NULL DEFAULT '',
            Html LONGTEXT NOT NULL,
            Ativo TINYINT(1) NOT NULL DEFAULT 0,
            AnexarPdf TINYINT(1) NOT NULL DEFAULT 0,
            ContentMode VARCHAR(16) NOT NULL DEFAULT 'custom',
            PresetId VARCHAR(64) NULL,
            Ordem INT NOT NULL DEFAULT 0,
            CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UpdatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UpdatedByPonto VARCHAR(20) NULL,
            LegacyTemplateId VARCHAR(64) NULL,
            PRIMARY KEY (Id),
            KEY idx_email_tpl_grupo_variante (Grupo, Variante),
            KEY idx_email_tpl_ativo (Grupo, Variante, Ativo)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """
    )


def _row_to_dict(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": int(row["Id"]),
        "grupo": str(row["Grupo"]),
        "variante": str(row["Variante"]),
        "nome": str(row["Nome"]),
        "assunto": str(row.get("Assunto") or ""),
        "html": str(row.get("Html") or ""),
        "ativo": bool(row.get("Ativo")),
        "anexar_pdf": bool(row.get("AnexarPdf")),
        "content_mode": str(row.get("ContentMode") or "custom"),
        "preset_id": row.get("PresetId"),
        "ordem": int(row.get("Ordem") or 0),
        "created_at": row.get("CreatedAt"),
        "updated_at": row.get("UpdatedAt"),
        "updated_by_ponto": row.get("UpdatedByPonto"),
        "legacy_template_id": row.get("LegacyTemplateId"),
    }


def _legacy_effective_html_subject(legacy_id: str) -> Tuple[str, str, str, Optional[str]]:
    from services import email_template_service as legacy

    eff = legacy.get_template_effective(legacy_id)
    subject = str(eff.get("subject") or eff.get("default_subject") or "")
    html = str(eff.get("html") or eff.get("default_html") or "")
    mode = str(eff.get("content_mode") or "custom")
    preset = str(eff.get("preset_id") or "") or None
    return subject, html, mode, preset  # type: ignore[return-value]


def ensure_default_email_template_models() -> None:
    """Seed idempotente dos modelos padrão."""
    ensure_email_template_model_schema()
    for spec in _SEED_SPECS:
        grupo = spec["grupo"]
        variante = spec["variante"]
        nome = spec["nome"]
        existing = db.execute_query(
            """
            SELECT Id FROM tabEmailTemplateModel
            WHERE Grupo = %s AND Variante = %s AND Nome = %s
            LIMIT 1
            """,
            (grupo, variante, nome),
        )
        if existing:
            continue
        legacy_id = LEGACY_BY_GRUPO.get(grupo)
        if legacy_id:
            subject, html, mode, preset = _legacy_effective_html_subject(legacy_id)
        else:
            subject, html, mode, preset = "", "", "custom", None
        if spec.get("assunto_override"):
            subject = str(spec["assunto_override"])
        if spec.get("html_override"):
            html = spec["html_override"]
            mode = "custom"
            preset = None
        if variante == "sem_portal" and grupo.startswith("prova_") and not spec.get("html_override"):
            html = DEFAULT_PROVA_SEM_PORTAL_HTML
        db.execute_query(
            """
            INSERT INTO tabEmailTemplateModel
                (Grupo, Variante, Nome, Assunto, Html, Ativo, AnexarPdf,
                 ContentMode, PresetId, Ordem, LegacyTemplateId)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                grupo,
                variante,
                nome,
                subject,
                html,
                1 if spec.get("ativo") else 0,
                1 if spec.get("anexar_pdf") else 0,
                mode,
                preset,
                spec.get("ordem", 0),
                legacy_id,
            ),
        )
        logger.info("Seed modelo e-mail: %s / %s / %s", grupo, variante, nome)
    _normalize_single_active_per_grupo()


def list_email_template_models(
    *,
    grupo: Optional[str] = None,
    variante: Optional[str] = None,
) -> List[Dict[str, Any]]:
    ensure_default_email_template_models()
    _normalize_single_active_per_grupo()
    clauses = []
    params: List[Any] = []
    if grupo:
        clauses.append("Grupo = %s")
        params.append(grupo)
    if variante:
        clauses.append("Variante = %s")
        params.append(variante)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    rows = db.execute_query(
        f"""
        SELECT * FROM tabEmailTemplateModel
        {where}
        ORDER BY Grupo, Variante, Ordem, Nome
        """,
        tuple(params) if params else None,
    )
    return [_row_to_dict(r) for r in (rows or [])]


def get_email_template_model(model_id: int) -> Dict[str, Any]:
    rows = db.execute_query(
        "SELECT * FROM tabEmailTemplateModel WHERE Id = %s LIMIT 1",
        (model_id,),
    )
    if not rows:
        raise KeyError(model_id)
    return _row_to_dict(rows[0])


def _validate_model_fields(
    *,
    grupo: str,
    variante: str,
    assunto: str,
    html: str,
    anexar_pdf: bool,
    is_new: bool = False,
) -> None:
    if grupo not in VALID_GRUPOS:
        raise ValueError(f"Grupo inválido: {grupo}")
    if variante not in VALID_VARIANTES:
        raise ValueError(f"Variante inválida: {variante}")
    if not (assunto or "").strip():
        raise ValueError("Informe o assunto do modelo.")
    if not (html or "").strip():
        raise ValueError("Informe o HTML do modelo.")
    if anexar_pdf and grupo == "problema_tecnico":
        raise ValueError("Anexar PDF não se aplica a problemas técnicos.")
    if anexar_pdf and variante == "portal":
        raise ValueError("Anexar PDF só se aplica a modelos sem portal.")
    if variante == "portal":
        anexar_pdf = False
    if variante == "sem_portal" and grupo == "problema_tecnico":
        if not _has_dynamic_placeholder(html):
            raise ValueError(
                "Modelos de problemas técnicos sem portal devem conter "
                f"{PLACEHOLDER_TEXTO}, {{{{conteudo}}}} ou {PLACEHOLDER_HTML_AQUI}."
            )
    if grupo == "timbrado_a4_digital" and variante != "sem_portal":
        raise ValueError(
            "Timbrado A4 Digital usa apenas a variante sem portal (com anexos DOCX)."
        )


def _has_dynamic_placeholder(html: str) -> bool:
    h = html or ""
    return (
        PLACEHOLDER_TEXTO in h
        or PLACEHOLDER_HTML_AQUI in h
        or "{{conteudo}}" in h
    )


def _resolve_model_html(model: Dict[str, Any]) -> str:
    stored = str(model.get("html") or "").strip()
    if stored:
        return stored
    mode = str(model.get("content_mode") or "custom")
    preset = str(model.get("preset_id") or "").strip()
    legacy = str(model.get("legacy_template_id") or LEGACY_BY_GRUPO.get(model["grupo"]) or "")
    if mode == "preset" and preset and legacy:
        from services import email_template_service as legacy_svc

        return legacy_svc.get_preset_html(preset, legacy)
    return ""


def create_email_template_model(
    *,
    grupo: str,
    variante: str,
    nome: str,
    assunto: str,
    html: str,
    anexar_pdf: bool = False,
    content_mode: str = "custom",
    preset_id: Optional[str] = None,
    ordem: int = 50,
    updated_by_ponto: Optional[str] = None,
) -> Dict[str, Any]:
    _validate_model_fields(
        grupo=grupo,
        variante=variante,
        assunto=assunto,
        html=html,
        anexar_pdf=anexar_pdf,
        is_new=True,
    )
    legacy_id = LEGACY_BY_GRUPO.get(grupo)
    db.execute_query(
        """
        INSERT INTO tabEmailTemplateModel
            (Grupo, Variante, Nome, Assunto, Html, Ativo, AnexarPdf,
             ContentMode, PresetId, Ordem, LegacyTemplateId, UpdatedByPonto)
        VALUES (%s, %s, %s, %s, %s, 0, %s, %s, %s, %s, %s, %s)
        """,
        (
            grupo,
            variante,
            nome.strip(),
            assunto,
            html,
            1 if anexar_pdf else 0,
            content_mode,
            preset_id,
            ordem,
            legacy_id,
            updated_by_ponto,
        ),
    )
    rows = db.execute_query("SELECT MAX(Id) AS mid FROM tabEmailTemplateModel")
    new_id = int(rows[0]["mid"])
    return get_email_template_model(new_id)


def update_email_template_model(
    model_id: int,
    *,
    nome: Optional[str] = None,
    assunto: Optional[str] = None,
    html: Optional[str] = None,
    anexar_pdf: Optional[bool] = None,
    content_mode: Optional[str] = None,
    preset_id: Optional[str] = None,
    ordem: Optional[int] = None,
    updated_by_ponto: Optional[str] = None,
) -> Dict[str, Any]:
    current = get_email_template_model(model_id)
    merged = {
        "nome": nome if nome is not None else current["nome"],
        "assunto": assunto if assunto is not None else current["assunto"],
        "html": html if html is not None else current["html"],
        "anexar_pdf": anexar_pdf if anexar_pdf is not None else current["anexar_pdf"],
        "content_mode": content_mode if content_mode is not None else current["content_mode"],
        "preset_id": preset_id if preset_id is not None else current.get("preset_id"),
        "ordem": ordem if ordem is not None else current["ordem"],
    }
    if html is not None:
        merged["content_mode"] = "custom"
        merged["preset_id"] = None
    if current["variante"] == "portal":
        merged["anexar_pdf"] = False
    _validate_model_fields(
        grupo=current["grupo"],
        variante=current["variante"],
        assunto=merged["assunto"],
        html=merged["html"],
        anexar_pdf=merged["anexar_pdf"],
    )
    db.execute_query(
        """
        UPDATE tabEmailTemplateModel SET
            Nome = %s, Assunto = %s, Html = %s, AnexarPdf = %s,
            ContentMode = %s, PresetId = %s, Ordem = %s, UpdatedByPonto = %s
        WHERE Id = %s
        """,
        (
            merged["nome"],
            merged["assunto"],
            merged["html"],
            1 if merged["anexar_pdf"] else 0,
            merged["content_mode"],
            merged.get("preset_id"),
            merged["ordem"],
            updated_by_ponto,
            model_id,
        ),
    )
    return get_email_template_model(model_id)


def _normalize_single_active_per_grupo() -> None:
    """Garante no máximo um modelo ativo por categoria (Grupo)."""
    for grupo in VALID_GRUPOS:
        rows = db.execute_query(
            """
            SELECT Id FROM tabEmailTemplateModel
            WHERE Grupo = %s AND Ativo = 1
            ORDER BY UpdatedAt DESC, Id DESC
            """,
            (grupo,),
        )
        if len(rows) <= 1:
            continue
        keep_id = int(rows[0]["Id"])
        db.execute_query(
            """
            UPDATE tabEmailTemplateModel SET Ativo = 0
            WHERE Grupo = %s AND Id <> %s AND Ativo = 1
            """,
            (grupo, keep_id),
        )
        logger.info(
            "Normalizado modelo ativo do grupo %s: mantido Id=%s, desativados %s",
            grupo,
            keep_id,
            len(rows) - 1,
        )


def activate_email_template_model(model_id: int, *, updated_by_ponto: Optional[str] = None) -> Dict[str, Any]:
    model = get_email_template_model(model_id)

    def txn(cursor):
        # Apenas um modelo ativo por categoria (Grupo), independente da variante.
        cursor.execute(
            """
            UPDATE tabEmailTemplateModel SET Ativo = 0
            WHERE Grupo = %s AND Id <> %s
            """,
            (model["grupo"], model_id),
        )
        cursor.execute(
            """
            UPDATE tabEmailTemplateModel SET Ativo = 1, UpdatedByPonto = %s
            WHERE Id = %s
            """,
            (updated_by_ponto, model_id),
        )

    db.execute_transaction([txn])
    return get_email_template_model(model_id)


def deactivate_email_template_model(model_id: int, *, updated_by_ponto: Optional[str] = None) -> Dict[str, Any]:
    db.execute_query(
        "UPDATE tabEmailTemplateModel SET Ativo = 0, UpdatedByPonto = %s WHERE Id = %s",
        (updated_by_ponto, model_id),
    )
    return get_email_template_model(model_id)


def delete_email_template_model(model_id: int) -> None:
    model = get_email_template_model(model_id)
    if model["ativo"]:
        raise ValueError("Não é possível excluir o modelo ativo. Ative outro modelo antes.")
    db.execute_query("DELETE FROM tabEmailTemplateModel WHERE Id = %s", (model_id,))


def resolve_active_email_template_for_grupo(grupo: str) -> Optional[Dict[str, Any]]:
    """Retorna o único modelo ativo da categoria (Grupo)."""
    ensure_default_email_template_models()
    _normalize_single_active_per_grupo()
    rows = db.execute_query(
        """
        SELECT * FROM tabEmailTemplateModel
        WHERE Grupo = %s AND Ativo = 1
        ORDER BY Ordem, Id
        LIMIT 1
        """,
        (grupo,),
    )
    if rows:
        return _row_to_dict(rows[0])
    return None


def resolve_active_email_template(grupo: str, variante: str) -> Optional[Dict[str, Any]]:
    """Compatibilidade: só retorna se o modelo ativo do grupo tiver a variante pedida."""
    active = resolve_active_email_template_for_grupo(grupo)
    if active and str(active.get("variante")) == variante:
        return active
    return None


def _legacy_fallback_render(grupo: str, variables: Dict[str, Any], inner_html: Optional[str]) -> Tuple[str, str]:
    from services import email_template_service as legacy

    legacy_id = LEGACY_BY_GRUPO[grupo]
    if grupo == "problema_tecnico" and inner_html:
        subject_tpl = legacy.get_rendered_subject("pt_send_subject", variables)
        html_out = legacy.wrap_report_html(inner_html, variables)
        return subject_tpl, html_out
    subject = legacy.get_rendered_subject(legacy_id, variables)
    html = legacy.get_rendered_html(legacy_id, variables)
    return subject, html


def render_email_model(
    model: Dict[str, Any],
    variables: Dict[str, Any],
    *,
    inner_html: Optional[str] = None,
    clear_link: bool = False,
) -> Tuple[str, str]:
    from services.email_template_service import render_template_string

    html_tpl = _resolve_model_html(model)
    vars_map = dict(variables)
    if clear_link:
        vars_map["link"] = ""
    if inner_html is not None:
        vars_map["conteudo"] = inner_html

    subject = render_template_string(str(model.get("assunto") or ""), vars_map).strip()
    rendered = render_template_string(html_tpl, vars_map)

    if inner_html is not None:
        if PLACEHOLDER_TEXTO in rendered:
            rendered = rendered.replace(PLACEHOLDER_TEXTO, inner_html)
        if PLACEHOLDER_HTML_AQUI in rendered:
            rendered = rendered.replace(PLACEHOLDER_HTML_AQUI, inner_html)

    if clear_link and "{{link}}" in rendered:
        rendered = rendered.replace("{{link}}", "")

    _assert_no_unsubstituted_placeholders(rendered, grupo=model.get("grupo"), inner_required=inner_html is not None)
    return subject, rendered


def _assert_no_unsubstituted_placeholders(
    html: str,
    *,
    grupo: Optional[str] = None,
    inner_required: bool = False,
) -> None:
    for marker in UNSUBSTITUTED_MARKERS:
        if marker in (html or ""):
            raise ValueError(
                f"O corpo do e-mail ainda contém placeholder não substituído ({marker}). "
                "Verifique o modelo ativo."
            )


def proof_grupo_for_os(os_id: int) -> str:
    return "prova_sp" if os_id >= 5000 else "prova_os"


def resolve_proof_send_plan(os_id: int) -> Dict[str, Any]:
    """
    Define modelo e modo de envio de prova.

    Usa o único modelo ativo da categoria (Grupo). Anexo quando AnexarPdf=1.
    """
    grupo = proof_grupo_for_os(os_id)
    active = resolve_active_email_template_for_grupo(grupo)
    if active:
        use_attachment = bool(active.get("anexar_pdf"))
        return {
            "grupo": grupo,
            "variante": active.get("variante") or ("sem_portal" if use_attachment else "portal"),
            "model": active,
            "use_attachment": use_attachment,
            "legacy_fallback": False,
        }
    return {
        "grupo": grupo,
        "variante": "portal",
        "model": None,
        "use_attachment": False,
        "legacy_fallback": True,
    }


def resolve_pt_send_plan() -> Dict[str, Any]:
    active = resolve_active_email_template_for_grupo("problema_tecnico")
    if active:
        use_inline = str(active.get("variante")) == "sem_portal"
        return {
            "grupo": "problema_tecnico",
            "variante": active.get("variante") or "portal",
            "model": active,
            "use_inline_body": use_inline,
            "legacy_fallback": False,
        }
    return {
        "grupo": "problema_tecnico",
        "variante": "portal",
        "model": None,
        "use_inline_body": False,
        "legacy_fallback": True,
    }


def resolve_timbrado_digital_send_plan() -> Dict[str, Any]:
    """Modelo ativo do grupo Timbrado A4 Digital (sempre com anexos DOCX)."""
    active = resolve_active_email_template_for_grupo("timbrado_a4_digital")
    if active:
        return {
            "grupo": "timbrado_a4_digital",
            "variante": active.get("variante") or "sem_portal",
            "model": active,
            "use_attachment": True,
            "legacy_fallback": False,
        }
    return {
        "grupo": "timbrado_a4_digital",
        "variante": "sem_portal",
        "model": None,
        "use_attachment": True,
        "legacy_fallback": True,
    }


def render_timbrado_digital_email(
    variables: Dict[str, Any],
    *,
    plan: Optional[Dict[str, Any]] = None,
) -> Tuple[str, str]:
    plan = plan or resolve_timbrado_digital_send_plan()
    model = plan.get("model")
    vars_map = dict(variables or {})
    if model:
        return render_email_model(model, vars_map, clear_link=True)
    subject = render_template_string_safe(
        DEFAULT_TIMBRADO_A4_DIGITAL_SUBJECT, vars_map
    )
    html = render_template_string_safe(DEFAULT_TIMBRADO_A4_DIGITAL_HTML, vars_map)
    return subject, html


def render_template_string_safe(template: str, variables: Dict[str, Any]) -> str:
    from services.email_template_service import render_template_string

    return render_template_string(template, variables).strip()


def build_problemas_tecnicos_inner_html(ano: int, os_id: int, versao: Optional[str] = None) -> str:
    """Monta HTML consolidado dos itens de análise (Capa/Miolo)."""
    from routers.analise_routes import build_consolidated_pt_inner_html

    return build_consolidated_pt_inner_html(ano, os_id, versao=versao)


def resolve_pt_portal_link(ano: int, os_id: int) -> str:
    """URL do portal PT para o cliente (token em tabClientTokens)."""
    rows = db.execute_query(
        """
        SELECT t.Token
        FROM tabClientTokens t
        INNER JOIN tabAnalises a ON a.ID = t.ID_Analise
        WHERE a.OS = %s AND a.Ano = %s
          AND t.NroProtocolo = %s AND t.AnoProtocolo = %s
        LIMIT 1
        """,
        (os_id, ano, os_id, ano),
    )
    if not rows or not (rows[0].get("Token") or "").strip():
        return ""
    try:
        from services.activation_email_service import resolve_link_web_base

        host_url = resolve_link_web_base()
        token = str(rows[0]["Token"]).strip()
        return f"{host_url.rstrip('/')}/portal/pt/{token}?os={os_id}&ano={ano}"
    except Exception as exc:
        logger.warning("Não foi possível montar link do portal PT: %s", exc)
        return ""


def load_or_build_pt_inner_html(ano: int, os_id: int, versao: Optional[str] = None) -> str:
    rows = db.execute_query(
        "SELECT RelatorioHTML FROM tabAnalises WHERE OS = %s AND Ano = %s LIMIT 1",
        (os_id, ano),
    )
    if rows and (rows[0].get("RelatorioHTML") or "").strip():
        return str(rows[0]["RelatorioHTML"])
    inner = build_problemas_tecnicos_inner_html(ano, os_id, versao=versao)
    if not inner or not inner.strip():
        raise ValueError(
            "Nenhum problema técnico encontrado para esta análise. "
            "Conclua a análise antes do envio."
        )
    return inner


def render_proof_email(
    os_id: int,
    variables: Dict[str, Any],
    *,
    proof_link: str = "",
    use_attachment: bool = False,
    plan: Optional[Dict[str, Any]] = None,
) -> Tuple[str, str]:
    plan = plan or resolve_proof_send_plan(os_id)
    vars_map = dict(variables)
    if use_attachment or plan.get("use_attachment"):
        vars_map["link"] = ""
        clear_link = True
    else:
        vars_map["link"] = proof_link
        clear_link = False

    model = plan.get("model")
    if model and not plan.get("legacy_fallback"):
        return render_email_model(model, vars_map, clear_link=clear_link)

    from services import email_template_service as legacy

    legacy_id = legacy.proof_template_id(os_id)
    subject = legacy.get_rendered_subject(legacy_id, vars_map)
    html = legacy.get_rendered_html(legacy_id, vars_map)
    if clear_link and proof_link == "":
        html = html.replace(proof_link, "") if proof_link else html
        html = re.sub(r'<a[^>]*href=["\']?\s*["\']?[^>]*>\s*</a>', "", html, flags=re.I)
    return subject, html


def render_pt_email(
    ano: int,
    os_id: int,
    variables: Dict[str, Any],
    *,
    plan: Optional[Dict[str, Any]] = None,
) -> Tuple[str, str]:
    plan = plan or resolve_pt_send_plan()
    vars_map = dict(variables)

    if plan.get("model") and not plan.get("legacy_fallback"):
        if plan.get("use_inline_body"):
            from services.pt_report_html_service import (
                prepare_pt_inline_email_inner_html,
                relax_pt_inline_email_wrapper_styles,
            )

            inner = load_or_build_pt_inner_html(ano, os_id, versao=vars_map.get("versao"))
            inner = prepare_pt_inline_email_inner_html(inner)
            subject, html = render_email_model(plan["model"], vars_map, inner_html=inner)
            return subject, relax_pt_inline_email_wrapper_styles(html)

        if not (vars_map.get("link") or "").strip():
            vars_map["link"] = resolve_pt_portal_link(ano, os_id)
        return render_email_model(plan["model"], vars_map, inner_html=None)

    rows = db.execute_query(
        "SELECT RelatorioEmail, RelatorioHTML FROM tabAnalises WHERE OS = %s AND Ano = %s",
        (os_id, ano),
    )
    cached_email = ""
    if rows:
        cached_email = str(
            rows[0].get("RelatorioEmail") or rows[0].get("RelatorioHTML") or ""
        ).strip()

    if plan.get("legacy_fallback"):
        if cached_email:
            from services import email_template_service as legacy

            subject = legacy.get_rendered_subject("pt_send_subject", vars_map)
            return subject, cached_email
        inner = load_or_build_pt_inner_html(ano, os_id, versao=vars_map.get("versao"))
        return _legacy_fallback_render("problema_tecnico", vars_map, inner)

    raise ValueError(
        "HTML do e-mail de problemas técnicos não encontrado. Conclua a análise primeiro."
    )


def render_model_preview(model_id: int, variables: Optional[Dict[str, Any]] = None) -> Dict[str, str]:
    from services.email_template_service import SAMPLE_PREVIEW_VARS

    model = get_email_template_model(model_id)
    vars_map = dict(SAMPLE_PREVIEW_VARS)
    if variables:
        vars_map.update({k: str(v) for k, v in variables.items() if v is not None})
    sample_inner = vars_map.get("conteudo") or (
        "<p><strong>1. Formato</strong> — exemplo de item PT.</p>"
    )
    inner = sample_inner if model["grupo"] == "problema_tecnico" and model["variante"] == "sem_portal" else None
    subject, html = render_email_model(model, vars_map, inner_html=inner, clear_link=model.get("anexar_pdf", False))
    return {"subject": subject, "html": html, "nome": model["nome"]}


def send_model_test_email(model_id: int, to_email: str, *, updated_by_ponto: Optional[str] = None) -> Dict[str, str]:
    from services.email_template_service import resolve_send_mailbox

    model = get_email_template_model(model_id)
    rendered = render_model_preview(model_id)
    subject = rendered["subject"]
    if not subject.upper().startswith("[TESTE"):
        subject = f"[TESTE] {subject}"
    html = rendered["html"]

    grupo = model["grupo"]
    os_sample = 5001 if grupo in ("prova_sp", "timbrado_a4_digital") else 100
    legacy_key = LEGACY_BY_GRUPO.get(grupo, "proof_sp" if grupo == "timbrado_a4_digital" else "proof_os")
    from services.email_template_service import get_template_defaults

    mailbox_key = get_template_defaults(legacy_key).get("mailbox_key")
    if grupo == "timbrado_a4_digital":
        mailbox_key = "os_gte_5000"
    from_mailbox = None
    if mailbox_key:
        from services.email_template_service import get_global_send_mailboxes, MAILBOX_SEPIM, MAILBOX_PAPELARIA

        boxes = get_global_send_mailboxes()
        if mailbox_key == "os_lt_5000":
            from_mailbox = boxes["os_lt_5000"]
        elif mailbox_key == "os_gte_5000":
            from_mailbox = boxes["os_gte_5000"]
        elif mailbox_key == "activation":
            from_mailbox = boxes.get("activation") or None
        else:
            from_mailbox = resolve_send_mailbox(os_sample, mailbox_key)

    from services.email_config_service import DEFAULT_EWS_URL, DEFAULT_VERIFY_SSL
    from services.ews_service import EWSService

    ews_url = os.getenv("EWS_URL", DEFAULT_EWS_URL)
    verify_ssl = os.getenv("EWS_VERIFY_SSL", str(DEFAULT_VERIFY_SSL)).lower() in ("1", "true", "yes")
    service = EWSService(ews_url=ews_url, verify_ssl=verify_ssl)
    logger.info(
        "Teste modelo id=%s grupo=%s variante=%s to=%s",
        model_id,
        model["grupo"],
        model["variante"],
        to_email,
    )
    service.send_email(to=[to_email], subject=subject, html_body=html, from_mailbox=from_mailbox)
    return {"to": to_email, "subject": subject, "from_mailbox": from_mailbox or ""}
