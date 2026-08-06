"""
Modelos de e-mail do sistema — persistência primária em MySQL (tabEmailTemplateConfig).

Substitui leitura direta de arquivos .htm/.html quando há personalização salva.
Variáveis no assunto/corpo: {{nr_os}}, {{ano}}, {{produto}}, {{titulo}},
{{solicitante}}, {{versao}}, {{nome}}, {{link}}, {{conteudo}}, etc.
"""
from __future__ import annotations

import json
import logging
import os
import re
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

from services import email_presets, email_template_store

_lock = threading.Lock()


def get_settings_path() -> Path:
    return email_template_store.get_file_path()

MAILBOX_SEPIM = "sepim.deapa@camara.leg.br"
MAILBOX_PAPELARIA = "papelaria.deapa@camara.leg.br"

VARIABLE_HINTS = [
    "nr_os",
    "nr_os_padded",
    "ano",
    "ano_curto",
    "produto",
    "titulo",
    "solicitante",
    "versao",
    "nome",
    "operador",
    "link",
    "conteudo",
]

SAMPLE_PREVIEW_VARS: Dict[str, str] = {
    "nr_os": "1234",
    "nr_os_padded": "1234",
    "ano": "2026",
    "ano_curto": "26",
    "produto": "Diário Oficial",
    "titulo": "Título de exemplo da publicação",
    "solicitante": "Maria da Silva",
    "versao": "2",
    "nome": "João Silva",
    "operador": "Maria Souza",
    "link": "http://cgrafsysvm/login/activate?token=exemplo",
    "conteudo": (
        "<div style='padding:12px;border:1px solid #ddd;'>"
        "<p><strong>1. Formato</strong> — exemplo de item de problemas técnicos.</p>"
        "</div>"
    ),
}

_TEMPLATE_DEFS: Dict[str, Dict[str, Any]] = {
    "activation": {
        "label": "Ativação de cadastro (senha)",
        "description": "E-mail enviado ao criar usuário ou reenviar ativação.",
        "category": "sistema",
        "default_subject": "SAGRA Web — Ative seu cadastro",
        "default_html": """<html><body style="font-family:Segoe UI,sans-serif;color:#333;">
<p>Olá, <strong>{{nome}}</strong>,</p>
<p>Seu acesso ao SAGRA Web foi cadastrado. Clique no link abaixo para
definir sua senha e ativar o cadastro:</p>
<p><a href="{{link}}">{{link}}</a></p>
<p>O link expira em 48 horas.</p>
<p style="color:#666;font-size:12px;">Se você não solicitou este cadastro, ignore este e-mail.</p>
</body></html>""",
        "subject_variables": ["nome", "link"],
        "html_variables": ["nome", "link"],
        "file_fallback": None,
        "mailbox_key": "activation",
    },
    "cliente_activation": {
        "label": "Ativação — portal do cliente",
        "description": "E-mail ao cadastrar cliente externo (gabinete ou órgão) ou subconta.",
        "category": "sistema",
        "default_subject": "Portal do Cliente — crie sua senha de acesso",
        "default_html": """<html><body style="font-family:Segoe UI,sans-serif;color:#333;">
<p>Olá, <strong>{{nome}}</strong>,</p>
<p>Seu acesso ao <strong>Portal do Cliente</strong> vinculado ao {{vinculo_tipo}}
<strong>{{gabinete}}</strong> foi criado pela Coordenação Gráfica.</p>
<p><strong>No primeiro acesso você deve criar sua senha</strong> — clique no botão abaixo
(não use a tela de login com e-mail/senha antes de concluir este passo):</p>
<p><a href="{{link}}" style="display:inline-block;padding:12px 24px;background:#00a859;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;">Criar minha senha</a></p>
<p style="font-size:12px;color:#666;">Ou copie o link: <a href="{{link}}">{{link}}</a></p>
<p>O link expira em 48 horas.</p>
<p style="color:#666;font-size:12px;">Após criar a senha, acesse o portal em
<a href="{{portal_url}}">{{portal_url}}</a></p>
</body></html>""",
        "subject_variables": ["nome", "gabinete", "vinculo_tipo", "link", "portal_url"],
        "html_variables": ["nome", "gabinete", "vinculo_tipo", "tipo_conta", "link", "portal_url"],
        "file_fallback": None,
        "mailbox_key": "activation",
    },
    "password_reset": {
        "label": "Recuperação de senha",
        "description": "E-mail enviado quando o usuário solicita redefinição de senha.",
        "category": "sistema",
        "default_subject": "SAGRA Web — Redefinição de senha",
        "default_html": """<html><body style="font-family:Segoe UI,sans-serif;color:#333;">
<p>Olá, <strong>{{nome}}</strong>,</p>
<p>Recebemos uma solicitação para redefinir sua senha no SAGRA Web. Clique no link abaixo:</p>
<p><a href="{{link}}">{{link}}</a></p>
<p>O link expira em 1 hora.</p>
<p style="color:#666;font-size:12px;">Se você não solicitou a redefinição, ignore este e-mail. Sua senha permanece inalterada.</p>
</body></html>""",
        "subject_variables": ["nome", "link"],
        "html_variables": ["nome", "link"],
        "file_fallback": None,
        "mailbox_key": "activation",
    },
    "gravacao_iniciada": {
        "label": "Gravação externa iniciada",
        "description": "Notificação enviada quando a gravação externa é iniciada.",
        "category": "sistema",
        "default_subject": "SAGRA Web — Gravação iniciada — OS {{nr_os}}/{{ano}}",
        "default_html": """<html><body style="font-family:Segoe UI,sans-serif;color:#333;">
<p>Olá, <strong>{{nome}}</strong>,</p>
<p>A gravação externa da OS <strong>{{nr_os}}/{{ano}}</strong> foi iniciada.</p>
<p>Operador: {{operador}}</p>
</body></html>""",
        "subject_variables": ["nr_os", "ano"],
        "html_variables": ["nome", "nr_os", "ano", "operador"],
        "file_fallback": None,
        "mailbox_key": "activation",
    },
    "gravacao_encaminhada": {
        "label": "OS encaminhada para Gravação Externa",
        "description": "Notificação enviada ao lançar o andamento Gravação Externa.",
        "category": "sistema",
        "default_subject": "SAGRA Web — OS {{nr_os}}/{{ano}} encaminhada para Gravação Externa",
        "default_html": """<html><body style="font-family:Segoe UI,sans-serif;color:#333;">
<p>Olá, <strong>{{nome}}</strong>,</p>
<p>A OS <strong>{{nr_os}}/{{ano}}</strong> foi encaminhada para Gravação Externa.</p>
<p>Responsável pelo encaminhamento: {{operador}}</p>
</body></html>""",
        "subject_variables": ["nr_os", "ano"],
        "html_variables": ["nome", "nr_os", "ano", "operador"],
        "file_fallback": None,
        "mailbox_key": "activation",
    },
    "gravacao_concluida": {
        "label": "Gravação externa concluída",
        "description": "Notificação enviada quando a gravação externa é concluída.",
        "category": "sistema",
        "default_subject": "SAGRA Web — Gravação concluída — OS {{nr_os}}/{{ano}}",
        "default_html": """<html><body style="font-family:Segoe UI,sans-serif;color:#333;">
<p>Olá, <strong>{{nome}}</strong>,</p>
<p>A gravação externa da OS <strong>{{nr_os}}/{{ano}}</strong> foi concluída.</p>
<p>Operador: {{operador}}</p>
</body></html>""",
        "subject_variables": ["nr_os", "ano"],
        "html_variables": ["nome", "nr_os", "ano", "operador"],
        "file_fallback": None,
        "mailbox_key": "activation",
    },
    "proof_os": {
        "label": "Envio de prova de OS",
        "description": "Corpo HTML ao enviar prova pela caixa SEPIM.",
        "category": "envio",
        "default_subject": (
            "Cgraf: Prova {{versao}} OS {{nr_os_padded}}/{{ano_curto}} - "
            "{{produto}} - {{solicitante}}"
        ),
        "default_html": (
            "<html><body style=\"font-family:Segoe UI,sans-serif;color:#333;\">"
            "<p>Prezado(a),</p>"
            "<p>A prova da ordem de serviço <strong>{{nr_os}}/{{ano}}</strong> — "
            "{{produto}} está disponível para visualização e aprovação no portal.</p>"
            "<p>Clique no botão abaixo para visualizar o PDF e registrar sua aprovação "
            "ou solicitação de alteração:</p>"
            "<p>"
            "<a href=\"{{link}}\" style=\"display:inline-block;padding:12px 18px;"
            "background:#1f4e79;color:#ffffff;text-decoration:none;border-radius:6px;"
            "font-weight:600;\">Visualizar e aprovar prova</a>"
            "</p>"
            "<p style=\"font-size:12px;color:#666;\">"
            "Caso o botão não funcione, copie e cole o link abaixo no navegador:<br>"
            "{{link}}"
            "</p>"
            "</body></html>"
        ),
        "subject_variables": [
            "versao",
            "nr_os",
            "nr_os_padded",
            "ano",
            "ano_curto",
            "produto",
            "solicitante",
        ],
        "html_variables": ["nr_os", "ano", "versao", "produto", "solicitante", "link"],
        "file_fallback": "emailProvaOS.htm",
        "mailbox_key": "os_lt_5000",
    },
    "proof_sp": {
        "label": "Envio de prova de SP",
        "description": "Corpo HTML ao enviar prova pela caixa Papelaria.",
        "category": "envio",
        "default_subject": (
            "Cgraf: Prova {{versao}} OS {{nr_os_padded}}/{{ano_curto}} - "
            "{{produto}} - {{solicitante}}"
        ),
        "default_html": (
            "<html><body style=\"font-family:Segoe UI,sans-serif;color:#333;\">"
            "<p>Prezado(a),</p>"
            "<p>A prova da ordem de serviço <strong>{{nr_os}}/{{ano}}</strong> — "
            "{{produto}} (Papelaria) está disponível para visualização e aprovação no portal.</p>"
            "<p>Clique no botão abaixo para visualizar o PDF e registrar sua aprovação "
            "ou solicitação de alteração:</p>"
            "<p>"
            "<a href=\"{{link}}\" style=\"display:inline-block;padding:12px 18px;"
            "background:#1f4e79;color:#ffffff;text-decoration:none;border-radius:6px;"
            "font-weight:600;\">Visualizar e aprovar prova</a>"
            "</p>"
            "<p style=\"font-size:12px;color:#666;\">"
            "Caso o botão não funcione, copie e cole o link abaixo no navegador:<br>"
            "{{link}}"
            "</p>"
            "</body></html>"
        ),
        "subject_variables": [
            "versao",
            "nr_os",
            "nr_os_padded",
            "ano",
            "ano_curto",
            "produto",
            "solicitante",
        ],
        "html_variables": ["nr_os", "ano", "versao", "produto", "solicitante", "link"],
        "file_fallback": "emailProvaSP.htm",
        "mailbox_key": "os_gte_5000",
    },
    "pt_send_subject": {
        "label": "Assunto — problemas técnicos (envio)",
        "description": "Assunto ao enviar relatório de problemas técnicos por e-mail.",
        "category": "assunto",
        "default_subject": (
            "CGraf: Problemas Técnicos, arq. v{{versao}} OS {{nr_os_padded}}/{{ano_curto}} "
            "- {{produto}} - {{titulo}}"
        ),
        "default_html": "",
        "subject_variables": [
            "versao",
            "nr_os",
            "nr_os_padded",
            "ano",
            "ano_curto",
            "produto",
            "titulo",
        ],
        "html_variables": [],
        "file_fallback": None,
        "mailbox_key": "by_os",
    },
    "pt_report_wrapper": {
        "label": "Envio de problemas técnicos",
        "description": (
            "Modelo que envolve o relatório gerado na análise. Use {{conteudo}} "
            "ou #HTMLAQUI no lugar do corpo dinâmico."
        ),
        "category": "relatorio",
        "default_subject": "",
        "default_html": (
            "<html><body style='font-family:Segoe UI,sans-serif;'>"
            "<h2>Problemas técnicos — OS {{nr_os}}/{{ano}}</h2>"
            "{{conteudo}}"
            "</body></html>"
        ),
        "subject_variables": ["nr_os", "ano", "produto", "titulo"],
        "html_variables": ["nr_os", "ano", "produto", "titulo", "conteudo"],
        "file_fallback": "emailfinal.html",
        "mailbox_key": None,
    },
    "pt_protocol_link": {
        "label": "Link do portal — problemas técnicos (protocolo)",
        "description": (
            "HTML gravado em tabProtocolos ao gerar link; substitui href do portal. "
            "Use {{link}} para o URL do cliente."
        ),
        "category": "relatorio",
        "default_subject": "",
        "default_html": (
            "<html><body><p>Prezado(a),</p>"
            "<p>Problemas técnicos identificados na OS {{nr_os}}/{{ano}}.</p>"
            "<p><a href=\"{{link}}\">Acessar relatório</a></p></body></html>"
        ),
        "subject_variables": ["nr_os", "ano", "versao"],
        "html_variables": ["nr_os", "ano", "versao", "link"],
        "file_fallback": "email_pt2.html",
        "mailbox_key": None,
    },
    "os_arquivos_link": {
        "label": "Envio de arquivos — nova OS (< 5000)",
        "description": (
            "E-mail ao cliente solicitando arquivos da OS recém-aberta. "
            "Use {{link}} para o portal de upload."
        ),
        "category": "envio",
        "default_subject": (
            "CGraf: Envio de arquivos OS {{nr_os_padded}}/{{ano_curto}} — {{produto}}"
        ),
        "default_html": (
            "<html><body style=\"font-family:Segoe UI,sans-serif;color:#333;\">"
            "<p>Prezado(a),</p>"
            "<p>Solicitamos o envio dos arquivos da ordem de serviço "
            "<strong>{{nr_os}}/{{ano}}</strong> — {{titulo}} ({{produto}}).</p>"
            "<p><a href=\"{{link}}\">Enviar arquivos pelo portal</a></p>"
            "<p style=\"color:#666;font-size:12px;\">"
            "Este link é pessoal e não exige login no sistema.</p>"
            "</body></html>"
        ),
        "subject_variables": [
            "nr_os",
            "nr_os_padded",
            "ano",
            "ano_curto",
            "produto",
            "titulo",
        ],
        "html_variables": [
            "nr_os",
            "ano",
            "produto",
            "titulo",
            "solicitante",
            "link",
        ],
        "file_fallback": None,
        "mailbox_key": "os_lt_5000",
    },
}


def _load_raw() -> Dict[str, Any]:
    return email_template_store.load_persisted()


def _save_raw(data: Dict[str, Any]) -> None:
    email_template_store.save_persisted(data)


def _uploaded_presets_index(raw: Dict[str, Any]) -> List[Dict[str, Any]]:
    items = raw.get("uploaded_presets")
    if not isinstance(items, list):
        return []
    return [e for e in items if isinstance(e, dict)]


def _uploaded_presets_for(
    template_id: str,
    raw: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    data = raw if raw is not None else _load_raw()
    return [
        e
        for e in _uploaded_presets_index(data)
        if str(e.get("template_id") or "") == template_id
    ]


def list_preset_options_for(template_id: str) -> List[Dict[str, str]]:
    raw = _load_raw()
    return email_presets.list_preset_options(
        template_id,
        _uploaded_presets_for(template_id, raw),
    )


def upload_email_preset_file(
    template_id: str,
    *,
    filename: str,
    content: bytes,
    label: str = "",
    apply_to_template: bool = True,
    subject: str = "",
) -> Dict[str, Any]:
    if template_id not in email_presets.CONFIGURABLE_TEMPLATE_IDS:
        raise KeyError(template_id)
    html = email_presets.extract_html_from_upload(content, filename)
    preset_id = email_presets.new_upload_preset_id()
    email_presets.save_uploaded_preset_file(preset_id, html)
    display_label = (label or "").strip() or Path(filename).name
    from datetime import datetime

    with _lock:
        raw = _load_raw()
        uploads = _uploaded_presets_index(raw)
        uploads.append(
            {
                "id": preset_id,
                "template_id": template_id,
                "label": display_label,
                "original_filename": Path(filename).name,
                "created_at": datetime.now().isoformat(timespec="seconds"),
            }
        )
        raw["uploaded_presets"] = uploads
        if apply_to_template:
            templates = raw.get("templates")
            if not isinstance(templates, dict):
                templates = {}
            entry = templates.get(template_id)
            if not isinstance(entry, dict):
                entry = {}
            entry.update(
                {
                    "content_mode": "preset",
                    "preset_id": preset_id,
                    "use_custom": True,
                    "html": "",
                    "updated_at": datetime.now().isoformat(timespec="seconds"),
                }
            )
            if subject or not entry.get("subject"):
                defaults = get_template_defaults(template_id)
                entry["subject"] = subject or entry.get("subject") or defaults["default_subject"]
            templates[template_id] = entry
            raw["templates"] = templates
        _save_raw(raw)
    return {
        "preset": {
            "id": preset_id,
            "label": display_label,
            "template_id": template_id,
        },
        "template": get_template_effective(template_id) if apply_to_template else None,
    }


def delete_uploaded_email_preset(template_id: str, preset_id: str) -> Dict[str, Any]:
    if template_id not in email_presets.CONFIGURABLE_TEMPLATE_IDS:
        raise KeyError(template_id)
    preset = str(preset_id or "").strip()
    if not email_presets.is_upload_preset_id(preset):
        raise ValueError("preset_id inválido")

    with _lock:
        raw = _load_raw()
        uploads = _uploaded_presets_index(raw)
        found = next(
            (e for e in uploads if e.get("id") == preset and e.get("template_id") == template_id),
            None,
        )
        if not found:
            raise ValueError("Modelo cadastrado não encontrado")
        raw["uploaded_presets"] = [e for e in uploads if e.get("id") != preset]
        templates = raw.get("templates")
        if isinstance(templates, dict):
            entry = templates.get(template_id)
            if isinstance(entry, dict) and entry.get("preset_id") == preset:
                del templates[template_id]
                raw["templates"] = templates
        _save_raw(raw)
    email_presets.delete_uploaded_preset_file(preset)
    return {"deleted": preset_id, "template": get_template_effective(template_id)}


def _read_file_template(filename: str) -> str:
    if not filename:
        return ""
    candidates = [
        filename,
        os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), filename),
        str(email_template_store.get_file_path().parent.parent / filename),
        os.path.join(str(email_template_store.get_file_path().parent.parent), filename),
        fr"\\cgrafsysvm\sagraweb\{filename}",
    ]
    for path in candidates:
        if not os.path.exists(path):
            continue
        for encoding in ("utf-8", "cp1252", "utf-16"):
            try:
                with open(path, "r", encoding=encoding) as fh:
                    content = fh.read()
                if content.strip():
                    return content
            except (OSError, UnicodeError):
                continue
    return ""


def render_template_string(template: str, variables: Optional[Dict[str, Any]] = None) -> str:
    if not template:
        return ""
    vars_map = dict(SAMPLE_PREVIEW_VARS)
    if variables:
        for key, value in variables.items():
            if value is not None:
                vars_map[str(key)] = str(value)
    nr = vars_map.get("nr_os", "")
    try:
        nr_int = int(str(nr).strip() or "0")
        vars_map.setdefault("nr_os_padded", f"{nr_int:04d}")
    except ValueError:
        vars_map.setdefault("nr_os_padded", str(nr))
    ano = str(vars_map.get("ano", ""))
    if ano and "ano_curto" not in vars_map:
        vars_map["ano_curto"] = ano[-2:]

    result = template
    for key, value in vars_map.items():
        token = "{{" + key + "}}"
        if token in result:
            result = result.replace(token, str(value))
    return result


def get_global_send_mailboxes() -> Dict[str, str]:
    with _lock:
        raw = _load_raw()
    send = raw.get("send_mailboxes")
    if not isinstance(send, dict):
        send = {}
    return {
        "os_lt_5000": str(send.get("os_lt_5000") or MAILBOX_SEPIM).strip() or MAILBOX_SEPIM,
        "os_gte_5000": str(send.get("os_gte_5000") or MAILBOX_PAPELARIA).strip()
        or MAILBOX_PAPELARIA,
        "activation": str(send.get("activation") or "").strip(),
    }


def save_global_send_mailboxes(
    *,
    os_lt_5000: str,
    os_gte_5000: str,
    activation: str = "",
) -> Dict[str, str]:
    with _lock:
        raw = _load_raw()
        raw["send_mailboxes"] = {
            "os_lt_5000": os_lt_5000.strip() or MAILBOX_SEPIM,
            "os_gte_5000": os_gte_5000.strip() or MAILBOX_PAPELARIA,
            "activation": activation.strip(),
        }
        _save_raw(raw)
    return get_global_send_mailboxes()


def get_gravacao_notification_settings() -> Dict[str, Dict[str, Any]]:
    with _lock:
        raw = _load_raw()
    stored = raw.get("gravacao_notifications")
    if not isinstance(stored, dict):
        stored = {}

    result: Dict[str, Dict[str, Any]] = {}
    for event in ("encaminhada", "iniciada", "concluida"):
        entry = stored.get(event)
        if not isinstance(entry, dict):
            entry = {}
        mode = str(entry.get("mode") or "usuario").strip().lower()
        if mode not in {"usuario", "personalizado"}:
            mode = "usuario"
        recipients = entry.get("recipients")
        if not isinstance(recipients, list):
            recipients = []
        enabled = entry.get("enabled")
        if not isinstance(enabled, bool):
            enabled = True
        result[event] = {
            "enabled": enabled,
            "mode": mode,
            "recipients": [
                str(value).strip()
                for value in recipients
                if str(value).strip()
            ],
        }
    return result


def save_gravacao_notification_settings(
    settings: Dict[str, Dict[str, Any]],
) -> Dict[str, Dict[str, Any]]:
    normalized: Dict[str, Dict[str, Any]] = {}
    for event in ("encaminhada", "iniciada", "concluida"):
        entry = settings.get(event) or {}
        mode = str(entry.get("mode") or "usuario").strip().lower()
        if mode not in {"usuario", "personalizado"}:
            raise ValueError(f"Modo de destinatário inválido para gravação {event}.")
        enabled = entry.get("enabled")
        if not isinstance(enabled, bool):
            enabled = True
        recipients = entry.get("recipients") or []
        if enabled and mode == "personalizado" and not recipients:
            raise ValueError(
                f"Informe ao menos um destinatário para gravação {event}."
            )
        normalized[event] = {
            "enabled": enabled,
            "mode": mode,
            "recipients": list(dict.fromkeys(
                str(value).strip().lower()
                for value in recipients
                if str(value).strip()
            )),
        }
    with _lock:
        raw = _load_raw()
        raw["gravacao_notifications"] = normalized
        _save_raw(raw)
    return get_gravacao_notification_settings()


def resolve_send_mailbox(os_id: int, template_mailbox_key: Optional[str] = None) -> str:
    boxes = get_global_send_mailboxes()
    if template_mailbox_key == "activation" and boxes.get("activation"):
        return boxes["activation"]
    if template_mailbox_key == "os_lt_5000":
        return boxes["os_lt_5000"]
    if template_mailbox_key == "os_gte_5000":
        return boxes["os_gte_5000"]
    if os_id >= 5000:
        return boxes["os_gte_5000"]
    return boxes["os_lt_5000"]


def _template_stored(template_id: str) -> Dict[str, Any]:
    with _lock:
        raw = _load_raw()
    templates = raw.get("templates")
    if not isinstance(templates, dict):
        return {}
    entry = templates.get(template_id)
    return entry if isinstance(entry, dict) else {}


def get_template_defaults(template_id: str) -> Dict[str, Any]:
    meta = _TEMPLATE_DEFS.get(template_id)
    if not meta:
        raise KeyError(template_id)
    html = meta.get("default_html") or ""
    file_name = meta.get("file_fallback")
    if file_name:
        file_html = _read_file_template(str(file_name))
        if file_html.strip():
            html = file_html
    return {
        "id": template_id,
        "label": meta["label"],
        "description": meta.get("description", ""),
        "category": meta.get("category", "outros"),
        "default_subject": meta.get("default_subject") or "",
        "default_html": html,
        "subject_variables": meta.get("subject_variables") or [],
        "html_variables": meta.get("html_variables") or [],
        "mailbox_key": meta.get("mailbox_key"),
    }


def _meta_inline_default_html(template_id: str) -> str:
    meta = _TEMPLATE_DEFS.get(template_id) or {}
    return str(meta.get("default_html") or "")


def get_preset_html(preset_id: str, template_id: str) -> str:
    return email_presets.resolve_preset_html(
        preset_id,
        template_id,
        read_legacy_file=_read_file_template,
        inline_default_html=_meta_inline_default_html(template_id),
    )


def _stored_content_mode(stored: Dict[str, Any]) -> str:
    mode = str(stored.get("content_mode") or "").strip().lower()
    if mode in ("preset", "custom"):
        return mode
    if bool(stored.get("use_custom")):
        if (stored.get("html") or "").strip():
            return "custom"
        if str(stored.get("preset_id") or "").strip():
            return "preset"
        return "custom"
    return "system"


def _has_persisted_override(stored: Dict[str, Any]) -> bool:
    if not stored:
        return False
    mode = _stored_content_mode(stored)
    if mode == "preset" and str(stored.get("preset_id") or "").strip():
        return True
    if mode == "custom":
        return True
    if bool(stored.get("use_custom")):
        return bool(
            (stored.get("subject") or "").strip()
            or (stored.get("html") or "").strip()
            or str(stored.get("preset_id") or "").strip()
        )
    return False


def get_template_effective(template_id: str) -> Dict[str, Any]:
    defaults = get_template_defaults(template_id)
    stored = _template_stored(template_id)
    content_mode = "system"
    preset_id: Optional[str] = None
    if _has_persisted_override(stored):
        content_mode = _stored_content_mode(stored)
        preset_id = str(stored.get("preset_id") or "").strip() or None
        subject = str(
            stored.get("subject")
            if stored.get("subject") is not None
            else defaults["default_subject"]
        )
        if content_mode == "preset" and preset_id:
            html = get_preset_html(preset_id, template_id)
        else:
            html = str(
                stored.get("html") if stored.get("html") is not None else defaults["default_html"]
            )
        use_custom = True
    else:
        subject = defaults["default_subject"]
        html = defaults["default_html"]
        use_custom = False
    return {
        **defaults,
        "subject": subject,
        "html": html,
        "use_custom": use_custom,
        "content_mode": content_mode,
        "preset_id": preset_id,
        "available_presets": list_preset_options_for(template_id),
        "updated_at": stored.get("updated_at"),
    }


def list_templates_public() -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for template_id in _TEMPLATE_DEFS:
        if template_id not in email_presets.CONFIGURABLE_TEMPLATE_IDS:
            continue
        eff = get_template_effective(template_id)
        out.append(
            {
                "id": eff["id"],
                "label": eff["label"],
                "description": eff["description"],
                "category": eff["category"],
                "subject": eff["subject"],
                "html": eff["html"],
                "default_subject": eff["default_subject"],
                "default_html": eff["default_html"],
                "use_custom": eff["use_custom"],
                "content_mode": eff.get("content_mode"),
                "preset_id": eff.get("preset_id"),
                "available_presets": eff.get("available_presets") or [],
                "subject_variables": eff["subject_variables"],
                "html_variables": eff["html_variables"],
                "mailbox_key": eff["mailbox_key"],
                "updated_at": eff.get("updated_at"),
            }
        )
    return out


def save_template(
    template_id: str,
    *,
    subject: str,
    html: str,
    use_custom: bool,
    content_mode: str = "custom",
    preset_id: str = "",
) -> Dict[str, Any]:
    if template_id not in _TEMPLATE_DEFS:
        raise KeyError(template_id)
    if template_id not in email_presets.CONFIGURABLE_TEMPLATE_IDS:
        raise KeyError(template_id)
    from datetime import datetime

    mode = str(content_mode or "custom").strip().lower()
    if mode not in ("preset", "custom"):
        raise ValueError("content_mode deve ser 'preset' ou 'custom'")
    preset = str(preset_id or "").strip()
    if mode == "preset":
        raw = _load_raw()
        uploaded = _uploaded_presets_for(template_id, raw)
        if not preset or not email_presets.is_valid_preset_for_template(
            template_id, preset, uploaded
        ):
            raise ValueError("preset_id inválido para este modelo")
    elif not (html or "").strip() and _TEMPLATE_DEFS[template_id].get("html_variables"):
        raise ValueError("Informe o HTML personalizado")

    with _lock:
        raw = _load_raw()
        templates = raw.get("templates")
        if not isinstance(templates, dict):
            templates = {}
        entry: Dict[str, Any] = {
            "subject": subject,
            "content_mode": mode,
            "use_custom": True,
            "updated_at": datetime.now().isoformat(timespec="seconds"),
        }
        if mode == "preset":
            entry["preset_id"] = preset
            entry["html"] = ""
        else:
            entry["html"] = html
            entry["preset_id"] = ""
        templates[template_id] = entry
        raw["templates"] = templates
        _save_raw(raw)
    return get_template_effective(template_id)


def reset_template(template_id: str) -> Dict[str, Any]:
    if template_id not in _TEMPLATE_DEFS:
        raise KeyError(template_id)
    with _lock:
        raw = _load_raw()
        templates = raw.get("templates")
        if isinstance(templates, dict) and template_id in templates:
            del templates[template_id]
            raw["templates"] = templates
            _save_raw(raw)
    return get_template_effective(template_id)


def get_rendered_subject(template_id: str, variables: Dict[str, Any]) -> str:
    eff = get_template_effective(template_id)
    subject_tpl = eff.get("subject") or eff.get("default_subject") or ""
    rendered = render_template_string(subject_tpl, variables).strip()
    logger.debug(
        "Assunto renderizado template=%s custom=%s path=%s",
        template_id,
        eff.get("use_custom"),
        email_template_store.get_file_path(),
    )
    return rendered


def get_rendered_html(template_id: str, variables: Dict[str, Any]) -> str:
    eff = get_template_effective(template_id)
    html_tpl = eff.get("html") or eff.get("default_html") or ""
    rendered = render_template_string(html_tpl, variables)
    content = variables.get("conteudo")
    if content is not None:
        if "#HTMLAQUI" in rendered:
            rendered = rendered.replace("#HTMLAQUI", str(content))
        elif "{{conteudo}}" not in html_tpl and "{{conteudo}}" not in (eff.get("default_html") or ""):
            pass
    return rendered


def wrap_report_html(inner_html: str, variables: Optional[Dict[str, Any]] = None) -> str:
    vars_map = dict(variables or {})
    vars_map["conteudo"] = inner_html
    eff = get_template_effective("pt_report_wrapper")
    html_tpl = eff.get("html") or eff.get("default_html") or ""
    if "#HTMLAQUI" in html_tpl:
        return html_tpl.replace("#HTMLAQUI", inner_html)
    return render_template_string(html_tpl, vars_map)


def apply_protocol_link_template(html: str, link_url: str, variables: Optional[Dict[str, Any]] = None) -> str:
    vars_map = dict(variables or {})
    vars_map["link"] = link_url
    eff = get_template_effective("pt_protocol_link")
    custom = eff.get("use_custom")
    if custom:
        base = eff.get("html") or ""
        if base.strip():
            return render_template_string(base, vars_map)
    pattern = r'href="[^"]*client_pt\.html[^"]*"'
    replacement = f'href="{link_url}"'
    if re.search(pattern, html):
        return re.sub(pattern, replacement, html)
    return render_template_string(eff.get("html") or html, vars_map)


def proof_template_id(os_id: int) -> str:
    return "proof_sp" if os_id >= 5000 else "proof_os"


def _resolve_from_mailbox_for_test(template_mailbox_key: Optional[str]) -> Optional[str]:
    boxes = get_global_send_mailboxes()
    if template_mailbox_key == "activation":
        activation = (boxes.get("activation") or "").strip()
        return activation or None
    if template_mailbox_key == "os_lt_5000":
        return boxes["os_lt_5000"]
    if template_mailbox_key == "os_gte_5000":
        return boxes["os_gte_5000"]
    if template_mailbox_key == "by_os":
        try:
            nr = int(str(SAMPLE_PREVIEW_VARS.get("nr_os", "1234")).strip() or "1234")
        except ValueError:
            nr = 1234
        return resolve_send_mailbox(nr, "by_os")
    if template_mailbox_key is None:
        return boxes["os_lt_5000"] or None
    return None


def render_template_for_preview(
    template_id: str,
    *,
    subject: str = "",
    html: str = "",
    use_custom: bool = True,
    content_mode: str = "custom",
    preset_id: str = "",
) -> Dict[str, str]:
    """Renderiza assunto/HTML com variáveis de exemplo (pré-visualização e teste)."""
    defaults = get_template_defaults(template_id)
    if use_custom:
        subject_src = subject
        if content_mode == "preset" and preset_id.strip():
            html_src = get_preset_html(preset_id.strip(), template_id)
        else:
            html_src = html
    else:
        eff = get_template_effective(template_id)
        subject_src = eff.get("subject") or ""
        html_src = eff.get("html") or ""

    variables = dict(SAMPLE_PREVIEW_VARS)
    rendered_subject = render_template_string(subject_src, variables)
    rendered_html = render_template_string(html_src, variables)
    from_mailbox = _resolve_from_mailbox_for_test(defaults.get("mailbox_key"))
    return {
        "subject": rendered_subject,
        "html": rendered_html,
        "label": defaults["label"],
        "from_mailbox": from_mailbox or "",
    }


def send_template_test_email(
    template_id: str,
    *,
    to_email: str,
    subject: str = "",
    html: str = "",
    use_custom: bool = True,
    content_mode: str = "custom",
    preset_id: str = "",
) -> Dict[str, str]:
    if template_id not in _TEMPLATE_DEFS:
        raise KeyError(template_id)

    to_clean = (to_email or "").strip()
    if not to_clean or "@" not in to_clean:
        raise ValueError("Informe um endereço de e-mail válido para o destinatário do teste.")

    draft = render_template_for_preview(
        template_id,
        subject=subject,
        html=html,
        use_custom=use_custom,
        content_mode=content_mode,
        preset_id=preset_id,
    )

    subject_out = (draft["subject"] or "").strip()
    if not subject_out:
        subject_out = f"[TESTE] {draft['label']}"
    elif not subject_out.upper().startswith("[TESTE"):
        subject_out = f"[TESTE] {subject_out}"

    html_out = (draft["html"] or "").strip()
    if not html_out:
        html_out = (
            "<html><body style=\"font-family:Segoe UI,sans-serif;color:#333;\">"
            "<p><em>E-mail de teste do Sagra Web. Este modelo não define corpo HTML "
            "(apenas assunto no envio real).</em></p>"
            "</body></html>"
        )

    from_mailbox = (draft.get("from_mailbox") or "").strip() or None

    from services.email_config_service import DEFAULT_EWS_URL, DEFAULT_VERIFY_SSL
    from services.ews_service import EWSService

    ews_url = os.getenv("EWS_URL", DEFAULT_EWS_URL)
    verify_ssl = os.getenv("EWS_VERIFY_SSL", str(DEFAULT_VERIFY_SSL)).lower() in (
        "1",
        "true",
        "yes",
    )
    service = EWSService(ews_url=ews_url, verify_ssl=verify_ssl)
    logger.info(
        "Teste de modelo %s: enviando para %s from=%s",
        template_id,
        to_clean,
        from_mailbox or "(conta autenticada EWS)",
    )
    service.send_email(
        to=[to_clean],
        subject=subject_out,
        html_body=html_out,
        from_mailbox=from_mailbox,
    )
    return {
        "to": to_clean,
        "subject": subject_out,
        "from_mailbox": from_mailbox or "",
        "label": draft["label"],
    }
