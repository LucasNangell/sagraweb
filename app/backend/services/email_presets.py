"""Catálogo de modelos HTML/OFT padrão (arquivos em config/email_presets ou legado na rede)."""
from __future__ import annotations

import logging
import re
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from config_manager import PROJECT_ROOT

logger = logging.getLogger(__name__)

PRESETS_DIR = PROJECT_ROOT / "config" / "email_presets"
UPLOADS_DIR = PRESETS_DIR / "uploads"
UPLOAD_PRESET_PREFIX = "upload_"
MAX_UPLOAD_BYTES = 2 * 1024 * 1024
ALLOWED_UPLOAD_SUFFIXES = frozenset({".html", ".htm", ".oft"})

_HTML_BLOCK_RE = re.compile(r"<html[\s\S]*?</html>", re.IGNORECASE)
_CHARSET_META_RE = re.compile(
    r"charset\s*=\s*[\"']?\s*([\w.\-]+)",
    re.IGNORECASE,
)
_CONDITIONAL_COMMENT_RE = re.compile(
    r"<!--\[if[\s\S]*?<!\[endif\]-->",
    re.IGNORECASE,
)
_XML_CONDITIONAL_RE = re.compile(r"<!\[if[\s\S]*?<!\[endif\]>", re.IGNORECASE)
_HTML_COMMENT_RE = re.compile(r"<!--[\s\S]*?-->")
_O_P_TAG_RE = re.compile(r"</?o:p[^>]*>", re.IGNORECASE)

_CHARSET_ALIASES = {
    "windows-1252": "cp1252",
    "windows-1250": "cp1252",
    "cp1252": "cp1252",
    "iso-8859-1": "latin-1",
    "latin1": "latin-1",
    "utf-8": "utf-8",
    "utf8": "utf-8",
}

# Modelos editáveis na página Configurações
CONFIGURABLE_TEMPLATE_IDS = frozenset(
    {
        "pt_report_wrapper",
        "proof_os",
        "proof_sp",
        "activation",
        "cliente_activation",
        "password_reset",
        "gravacao_iniciada",
        "gravacao_encaminhada",
        "gravacao_concluida",
    }
)

# preset_id -> como carregar o HTML
_PRESET_SOURCES: Dict[str, Dict[str, Any]] = {
    "cgraf_layout_pt": {"kind": "bundle", "file": "cgraf_layout_pt.html"},
    "builtin_text": {"kind": "inline_default"},
    "builtin_wrapper": {"kind": "inline_default"},
    "legacy_emailProvaOS": {"kind": "legacy_file", "file": "emailProvaOS.htm"},
    "legacy_emailProvaSP": {"kind": "legacy_file", "file": "emailProvaSP.htm"},
    "legacy_emailfinal": {"kind": "legacy_file", "file": "emailfinal.html"},
}

# template_id -> opções exibidas na UI
TEMPLATE_PRESET_OPTIONS: Dict[str, List[Dict[str, str]]] = {
    "activation": [
        {"id": "cgraf_layout_pt", "label": "Layout Câmara (banner e botão)"},
        {"id": "builtin_text", "label": "Texto simples"},
    ],
    "password_reset": [
        {"id": "cgraf_layout_pt", "label": "Layout Câmara (banner e botão)"},
        {"id": "builtin_text", "label": "Texto simples"},
    ],
    "cliente_activation": [
        {"id": "cgraf_layout_pt", "label": "Layout Câmara (banner e botão)"},
        {"id": "builtin_text", "label": "Texto simples"},
    ],
    "gravacao_iniciada": [
        {"id": "builtin_text", "label": "Texto simples"},
    ],
    "gravacao_encaminhada": [
        {"id": "builtin_text", "label": "Texto simples"},
    ],
    "gravacao_concluida": [
        {"id": "builtin_text", "label": "Texto simples"},
    ],
    "proof_os": [
        {"id": "legacy_emailProvaOS", "label": "Modelo Outlook legado (emailProvaOS.htm)"},
        {"id": "builtin_text", "label": "Texto simples"},
    ],
    "proof_sp": [
        {"id": "legacy_emailProvaSP", "label": "Modelo Outlook legado (emailProvaSP.htm)"},
        {"id": "builtin_text", "label": "Texto simples"},
    ],
    "pt_report_wrapper": [
        {"id": "legacy_emailfinal", "label": "Modelo Outlook legado (emailfinal.html)"},
        {"id": "builtin_wrapper", "label": "Envelope simples ({{conteudo}})"},
    ],
}

_LEGACY_PLACEHOLDER_REPLACEMENTS = (
    ("{url}", "{{link}}"),
    ("{nome}", "{{nome}}"),
    ("{link}", "{{link}}"),
)


def list_preset_options(
    template_id: str,
    uploaded: Optional[List[Dict[str, Any]]] = None,
) -> List[Dict[str, str]]:
    options = list(TEMPLATE_PRESET_OPTIONS.get(template_id, []))
    for entry in uploaded or []:
        if not isinstance(entry, dict):
            continue
        if str(entry.get("template_id") or "") != template_id:
            continue
        preset_id = str(entry.get("id") or "").strip()
        if not preset_id:
            continue
        options.append(
            {
                "id": preset_id,
                "label": str(entry.get("label") or entry.get("original_filename") or preset_id),
                "uploaded": True,
            }
        )
    return options


def is_valid_preset_for_template(
    template_id: str,
    preset_id: str,
    uploaded: Optional[List[Dict[str, Any]]] = None,
) -> bool:
    return any(p["id"] == preset_id for p in list_preset_options(template_id, uploaded))


def is_upload_preset_id(preset_id: str) -> bool:
    return str(preset_id or "").startswith(UPLOAD_PRESET_PREFIX)


def ensure_uploads_dir() -> Path:
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    return UPLOADS_DIR


def upload_storage_path(preset_id: str) -> Path:
    return ensure_uploads_dir() / f"{preset_id}.html"


def _charset_from_meta(data: bytes) -> Optional[str]:
    head = data[:16384].decode("ascii", errors="ignore")
    match = _CHARSET_META_RE.search(head)
    if not match:
        return None
    raw = match.group(1).lower().strip()
    return _CHARSET_ALIASES.get(raw, raw)


def _detect_encoding(data: bytes) -> Optional[str]:
    if data.startswith(b"\xff\xfe\x00\x00") or data.startswith(b"\xff\xfe"):
        return "utf-16-le"
    if data.startswith(b"\xfe\xff"):
        return "utf-16-be"
    if data.startswith(b"\xef\xbb\xbf"):
        return "utf-8-sig"
    return _charset_from_meta(data)


def _looks_like_broken_accents(text: str) -> bool:
    if "\ufffd" in text:
        return True
    return bool(
        re.search(
            r"Descri\s+o|Servi\s+o|informa\s+es|altera\s+es|n\s+o\s+aceitar|"
            r"Prova\s+PDF\s+\s+sempre|situa\s+es",
            text,
            re.IGNORECASE,
        )
    )


def decode_html_bytes(data: bytes) -> str:
    """Decodifica HTML do Outlook/Word respeitando charset declarado (ex.: windows-1252)."""
    declared = _detect_encoding(data)
    candidates: List[str] = []
    if declared:
        candidates.append(declared)
    for enc in ("cp1252", "utf-8-sig", "utf-8", "latin-1", "utf-16-le", "utf-16"):
        if enc not in candidates:
            candidates.append(enc)

    best_text = ""
    best_score = -1
    meta_wants_legacy = declared in ("cp1252", "latin-1") if declared else False

    for encoding in candidates:
        try:
            text = data.decode(encoding)
        except UnicodeError:
            continue
        if not text.strip():
            continue
        score = len(text)
        if meta_wants_legacy and encoding in ("cp1252", "latin-1"):
            score += 500_000
        if "ção" in text or "Descrição" in text or "Serviço" in text:
            score += 100_000
        if _looks_like_broken_accents(text):
            score -= 200_000
        if score > best_score:
            best_score = score
            best_text = text

    if best_text:
        return best_text
    return data.decode("cp1252", errors="replace")


def sanitize_outlook_word_html(html: str) -> str:
    """Remove lixo do Word/Outlook e normaliza para UTF-8 em clientes de e-mail."""
    if not html:
        return html
    match = _HTML_BLOCK_RE.search(html)
    if match:
        html = match.group(0)
    html = _CONDITIONAL_COMMENT_RE.sub("", html)
    html = _XML_CONDITIONAL_RE.sub("", html)
    html = _HTML_COMMENT_RE.sub("", html)
    html = _O_P_TAG_RE.sub("", html)
    html = re.sub(
        r"(<meta\s+http-equiv\s*=\s*Content-Type\s+content\s*=\s*\")[^\"]*(\")",
        r"\1text/html; charset=utf-8\2",
        html,
        count=1,
        flags=re.IGNORECASE,
    )
    html = re.sub(
        r"(<meta\s+charset\s*=\s*)[\"']?[^\"'\s>]+([\"']?)",
        r"\1utf-8\2",
        html,
        count=1,
        flags=re.IGNORECASE,
    )
    return html.strip()


def prepare_html_for_email_storage(html: str) -> str:
    return normalize_legacy_placeholders(sanitize_outlook_word_html(html))


def extract_html_from_upload(data: bytes, filename: str) -> str:
    if not data:
        raise ValueError("Arquivo vazio.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise ValueError("Arquivo muito grande (máximo 2 MB).")
    suffix = Path(filename or "").suffix.lower()
    if suffix not in ALLOWED_UPLOAD_SUFFIXES:
        raise ValueError("Use arquivo .oft, .html ou .htm.")

    if suffix in (".html", ".htm"):
        text = decode_html_bytes(data)
        if not text.strip():
            raise ValueError("Não foi possível ler o arquivo HTML.")
        return prepare_html_for_email_storage(text)

    text = decode_html_bytes(data)
    match = _HTML_BLOCK_RE.search(text)
    if match:
        return prepare_html_for_email_storage(match.group(0))
    raise ValueError(
        "Não foi possível extrair HTML do arquivo OFT. "
        "No Outlook: Arquivo → Salvar como → Página da Web (.html) filtrada."
    )


def save_uploaded_preset_file(preset_id: str, html: str) -> None:
    path = upload_storage_path(preset_id)
    path.write_text(html, encoding="utf-8", newline="\n")


def delete_uploaded_preset_file(preset_id: str) -> None:
    path = upload_storage_path(preset_id)
    if path.is_file():
        path.unlink()


def new_upload_preset_id() -> str:
    return f"{UPLOAD_PRESET_PREFIX}{uuid.uuid4().hex[:12]}"


def _read_uploaded_preset_file(preset_id: str) -> str:
    path = upload_storage_path(preset_id)
    if not path.is_file():
        logger.warning("Arquivo de preset upload ausente: %s", path)
        return ""
    try:
        return normalize_legacy_placeholders(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError) as exc:
        logger.warning("Erro ao ler upload %s: %s", path, exc)
        return ""


def normalize_legacy_placeholders(html: str) -> str:
    if not html:
        return html
    out = html
    for old, new in _LEGACY_PLACEHOLDER_REPLACEMENTS:
        out = out.replace(old, new)
    return out


def _read_bundle_file(filename: str) -> str:
    path = PRESETS_DIR / filename
    if not path.is_file():
        logger.warning("Preset bundle ausente: %s", path)
        return ""
    for encoding in ("utf-8-sig", "utf-8", "cp1252"):
        try:
            return normalize_legacy_placeholders(path.read_text(encoding=encoding))
        except (OSError, UnicodeError) as exc:
            logger.warning("Erro ao ler preset %s (%s): %s", path, encoding, exc)
    return ""


def resolve_preset_html(
    preset_id: str,
    template_id: str,
    *,
    read_legacy_file,
    inline_default_html: str,
) -> str:
    """Carrega HTML do preset. read_legacy_file(filename) vem do email_template_service."""
    if is_upload_preset_id(preset_id):
        html = _read_uploaded_preset_file(preset_id)
        return html or inline_default_html
    spec = _PRESET_SOURCES.get(preset_id)
    if not spec:
        logger.warning("Preset desconhecido: %s", preset_id)
        return inline_default_html
    kind = spec.get("kind")
    if kind == "bundle":
        html = _read_bundle_file(str(spec.get("file") or ""))
        return html or inline_default_html
    if kind == "legacy_file":
        html = read_legacy_file(str(spec.get("file") or ""))
        return normalize_legacy_placeholders(html) or inline_default_html
    if kind == "inline_default":
        return inline_default_html
    return inline_default_html
