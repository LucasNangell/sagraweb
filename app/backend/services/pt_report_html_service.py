"""Normalização e estilos do relatório PT para e-mail inline e relatório consolidado."""

from __future__ import annotations



import base64
import hashlib
import logging
import os
import re
import unicodedata
from dataclasses import dataclass
from typing import List, Optional, Tuple
from urllib.parse import unquote

logger = logging.getLogger(__name__)



from services.pdf_html_convert import PT_DOCUMENT_STYLES



_STYLE_BLOCK_RE = re.compile(r"<style\b[^>]*>[\s\S]*?</style>", re.IGNORECASE)

_STYLE_PLACEHOLDER_RE = re.compile(

    r'<span\s+data-sagra-style-ph="\d+"\s*>\s*</span>',

    re.IGNORECASE,

)

_BODY_RE = re.compile(r"<body[^>]*>([\s\S]*)</body>", re.IGNORECASE)

_H2_RE = re.compile(r"(<h2[^>]*>)([\s\S]*?)(</h2>)", re.IGNORECASE)

_LABEL_BLOCK_RE = re.compile(

    r"<(p|h1|h2|h3|h4|h5|h6|span|strong|b)(\s[^>]*)?>([\s\S]*?)</\1>",

    re.IGNORECASE,

)

_LEADING_LABEL_BLOCK_RE = re.compile(

    r'^\s*<(p|h1|h2|h3|h4|h5|h6|span|strong|b)(\s[^>]*)?>([\s\S]*?)</\1>\s*',

    re.IGNORECASE,

)



_MANUAL_TECNICO_LABELS = frozenset({"manual tecnico", "manual técnico"})



_EMAIL_WRAPPER_FONT_OVERRIDE = (

    "margin: 0 0 28px 0; font-size: 16px; line-height: 1.45; "

    "color: #000000; font-family: Calibri, sans-serif;"

)

_EMAIL_WRAPPER_NEUTRAL = "margin: 0 0 28px 0;"



_ITEM_SNAPSHOT_RE = re.compile(

    r"<div\s+class=['\"]item-snapshot['\"][^>]*>([\s\S]*?)</div>",

    re.IGNORECASE,

)



_INDICATION_IMG_SRC_RE = re.compile(
    r'src=(["\'])(?:(?:https?://[^/"\']+)?)?/?(?:sagra/)?api/analise/item/(?P<item_id>\d+)/indication/(?P<filename>[^"\'?]+)(?:\?[^"\']*)?\1',
    re.IGNORECASE,
)

_DATA_IMAGE_SRC_RE = re.compile(
    r'src=(["\'])data:image/(?P<subtype>png|jpeg|jpg|webp);base64,(?P<payload>[^"\']+)\1',
    re.IGNORECASE,
)

_API_IMG_SRC_RE = re.compile(
    r'(src=["\'])(/(?:sagra/)?api/[^"\']+)(["\'])',
    re.IGNORECASE,
)

_MAX_INDICATION_IMAGE_BYTES = 4 * 1024 * 1024


@dataclass(frozen=True)
class EmailInlineImage:
    content_id: str
    filename: str
    content: bytes
    mime_type: str


_PT_EMAIL_REPORT_EXTRA_STYLES = """

.pt-email-report { font-family: "Calibri", "Arial", sans-serif; font-size: 11pt; line-height: 1.4; color: #000000; }

.pt-email-report .document-container { max-width: 100%; margin: 0; padding: 0; box-shadow: none; background: transparent; }

.pt-email-report .item-snapshot { margin-bottom: 16px; }

"""





def _normalize_label_text(value: str) -> str:

    text = re.sub(r"<[^>]+>", "", value or "")

    text = unicodedata.normalize("NFKD", text)

    text = "".join(ch for ch in text if not unicodedata.combining(ch))

    return re.sub(r"\s+", " ", text).strip().lower()





def is_manual_tecnico_label(html_fragment: str) -> bool:

    """Verdadeiro somente quando o texto do bloco é exatamente Manual Técnico."""

    return _normalize_label_text(html_fragment) in _MANUAL_TECNICO_LABELS





def strip_manual_tecnico_labels(html: str) -> str:

    """Remove apenas blocos cujo conteúdo textual é Manual Técnico."""

    if not (html or "").strip():

        return html or ""



    body = html

    prev = None

    while body != prev:

        prev = body

        body = _LABEL_BLOCK_RE.sub(

            lambda m: "" if is_manual_tecnico_label(m.group(3)) else m.group(0),

            body,

        )



    body = body.lstrip()

    while True:

        match = _LEADING_LABEL_BLOCK_RE.match(body)

        if not match or not is_manual_tecnico_label(match.group(3)):

            break

        body = body[match.end() :].lstrip()



    return body





def _extract_body_fragment(html: str) -> str:

    match = _BODY_RE.search(html)

    if match:

        return match.group(1)

    return html.replace("<!DOCTYPE", "").replace("<!doctype", "")





def _collect_style_blocks(html: str) -> List[str]:

    return [block.strip() for block in _STYLE_BLOCK_RE.findall(html or "") if block.strip()]





def _strip_style_blocks(html: str) -> str:

    out = _STYLE_BLOCK_RE.sub("", html or "")

    return _STYLE_PLACEHOLDER_RE.sub("", out)





def _strip_document_envelope(html: str) -> str:

    fragment = _extract_body_fragment(html)

    fragment = re.sub(r"<head\b[^>]*>[\s\S]*?</head>", "", fragment, flags=re.IGNORECASE)

    fragment = re.sub(r"</?html[^>]*>", "", fragment, flags=re.IGNORECASE)

    fragment = re.sub(r"</?body[^>]*>", "", fragment, flags=re.IGNORECASE)

    return fragment.strip()





def normalize_item_snapshot_for_report(

    snapshot: str,

    *,

    item_titulo: Optional[str] = None,

) -> str:

    """Remove envelope de documento e o rótulo fixo Manual Técnico (somente esse texto)."""

    del item_titulo  # mantido por compatibilidade; não remove títulos dos itens

    if not (snapshot or "").strip():

        return ""



    styles = _collect_style_blocks(snapshot)

    body = _strip_document_envelope(snapshot)

    body = _strip_style_blocks(body)

    body = strip_manual_tecnico_labels(body)



    body = re.sub(

        r'<div\s+class=["\']document-container["\'][^>]*>',

        '<div class="document-container">',

        body,

        count=1,

        flags=re.IGNORECASE,

    )

    body = body.strip()

    if styles:

        body = f"{''.join(styles)}{body}"

    return body





def merge_embedded_styles_from_html(html: str) -> str:

    blocks = _collect_style_blocks(html)

    if not blocks:

        return ""

    seen: set[str] = set()

    merged: List[str] = []

    for block in blocks:

        inner_match = re.search(r"<style[^>]*>([\s\S]*?)</style>", block, re.IGNORECASE)

        inner = (inner_match.group(1) if inner_match else block).strip()

        if inner and inner not in seen:

            seen.add(inner)

            merged.append(inner)

    return "\n".join(merged)





def normalize_consolidated_item_snapshots(html: str) -> str:

    """Reprocessa snapshots já consolidados (RelatorioHTML salvo anteriormente)."""

    source = html or ""

    if not source.strip():

        return source



    parts: List[str] = []

    last_end = 0

    for match in _ITEM_SNAPSHOT_RE.finditer(source):

        parts.append(source[last_end : match.start()])

        inner = normalize_item_snapshot_for_report(match.group(1))

        parts.append(

            f"<div class='item-snapshot' style='margin-bottom: 20px;'>{inner}</div>"

        )

        last_end = match.end()



    if last_end == 0:

        return strip_manual_tecnico_labels(

            normalize_item_snapshot_for_report(source)

        )



    parts.append(source[last_end:])

    return strip_manual_tecnico_labels("".join(parts))





def _indication_storage_path(item_id: int, filename: str) -> str | None:
    safe_name = os.path.basename(unquote(filename or ""))
    if not safe_name or safe_name != unquote(filename or ""):
        return None
    full = os.path.abspath(
        os.path.join("storage", "analise_indications", str(item_id), safe_name)
    )
    return full if os.path.isfile(full) else None


def _indication_image_mime(filename: str) -> str:
    lower = filename.lower()
    if lower.endswith((".jpg", ".jpeg")):
        return "image/jpeg"
    if lower.endswith(".webp"):
        return "image/webp"
    return "image/png"


def _register_inline_image(
    *,
    inline_images: List[EmailInlineImage],
    cid_by_key: dict[str, str],
    seq_counter: List[int],
    key: str,
    filename: str,
    raw: bytes,
    mime: str,
) -> str:
    if key in cid_by_key:
        return cid_by_key[key]
    seq_counter[0] += 1
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()[:10]
    cid = f"ind-{seq_counter[0]}-{digest}@sagra"
    cid_by_key[key] = cid
    inline_images.append(
        EmailInlineImage(
            content_id=cid,
            filename=filename,
            content=raw,
            mime_type=mime,
        )
    )
    return cid


def embed_indication_images_for_email(html: str) -> Tuple[str, List[EmailInlineImage]]:
    """
    Embute imagens de indicação como anexos inline (cid:) para Outlook/Gmail.

    data: URLs no HTML não funcionam na maioria dos clientes de e-mail; cid é o padrão.
    """
    if not (html or "").strip():
        return html or "", []

    inline_images: List[EmailInlineImage] = []
    cid_by_key: dict[str, str] = {}
    seq_counter = [0]

    def repl_api(match: re.Match[str]) -> str:
        quote = match.group(1)
        item_id = int(match.group("item_id"))
        filename = unquote(match.group("filename"))
        path = _indication_storage_path(item_id, filename)
        if not path:
            logger.warning(
                "Imagem de indicação não encontrada para e-mail (item %s, %s)",
                item_id,
                filename,
            )
            return match.group(0)
        try:
            with open(path, "rb") as handle:
                raw = handle.read()
        except OSError as exc:
            logger.warning("Falha ao ler imagem de indicação %s: %s", path, exc)
            return match.group(0)
        if len(raw) > _MAX_INDICATION_IMAGE_BYTES:
            logger.warning(
                "Imagem de indicação muito grande para inline (%s bytes): %s",
                len(raw),
                path,
            )
            return match.group(0)
        cid = _register_inline_image(
            inline_images=inline_images,
            cid_by_key=cid_by_key,
            seq_counter=seq_counter,
            key=f"api:{item_id}:{filename}",
            filename=filename,
            raw=raw,
            mime=_indication_image_mime(filename),
        )
        logger.info(
            "Imagem de indicação embutida no e-mail (item %s, %s) como cid:%s",
            item_id,
            filename,
            cid,
        )
        return f"src={quote}cid:{cid}{quote}"

    out = html
    if "indication/" in html:
        out = _INDICATION_IMG_SRC_RE.sub(repl_api, out)

    def repl_data(match: re.Match[str]) -> str:
        quote = match.group(1)
        subtype = match.group("subtype").lower()
        payload = match.group("payload")
        key = f"data:{payload[:80]}"
        if key in cid_by_key:
            return f"src={quote}cid:{cid_by_key[key]}{quote}"
        try:
            raw = base64.b64decode(payload, validate=False)
        except Exception:
            return match.group(0)
        if not raw or len(raw) > _MAX_INDICATION_IMAGE_BYTES:
            return match.group(0)
        mime = "image/jpeg" if subtype in ("jpg", "jpeg") else f"image/{subtype}"
        ext = ".jpg" if subtype in ("jpg", "jpeg") else f".{subtype}"
        cid = _register_inline_image(
            inline_images=inline_images,
            cid_by_key=cid_by_key,
            seq_counter=seq_counter,
            key=key,
            filename=f"indication{ext}",
            raw=raw,
            mime=mime,
        )
        return f"src={quote}cid:{cid}{quote}"

    out = _DATA_IMAGE_SRC_RE.sub(repl_data, out)
    return out, inline_images


def embed_indication_images_for_pdf(html: str) -> str:
    """Substitui URLs de indicação por data:image para renderização em PDF."""
    if not (html or "").strip():
        return html or ""

    def repl_api(match: re.Match[str]) -> str:
        quote = match.group(1)
        item_id = int(match.group("item_id"))
        filename = unquote(match.group("filename"))
        path = _indication_storage_path(item_id, filename)
        if not path:
            logger.warning(
                "Imagem de indicação não encontrada para PDF (item %s, %s)",
                item_id,
                filename,
            )
            return match.group(0)
        try:
            with open(path, "rb") as handle:
                raw = handle.read()
        except OSError as exc:
            logger.warning("Falha ao ler imagem de indicação %s: %s", path, exc)
            return match.group(0)
        if not raw or len(raw) > _MAX_INDICATION_IMAGE_BYTES:
            return match.group(0)
        mime = _indication_image_mime(filename)
        b64 = base64.b64encode(raw).decode("ascii")
        return f"src={quote}data:{mime};base64,{b64}{quote}"

    out = html
    if "indication/" in html:
        out = _INDICATION_IMG_SRC_RE.sub(repl_api, out)
    return out


def absolutize_api_media_urls_for_preview(html: str, base_url: str) -> str:
    """URLs absolutas na prévia do e-mail (iframe carrega imagens com cookie de sessão)."""
    if not html or not base_url:
        return html
    base = base_url.rstrip("/")
    return _API_IMG_SRC_RE.sub(rf"\1{base}\2\3", html)


def prepare_pt_inline_email_inner_html(inner_html: str) -> str:

    """Inclui CSS do padrão de análise e evita herança de fonte do template de e-mail."""

    if not (inner_html or "").strip():

        return ""



    inner_html = normalize_consolidated_item_snapshots(inner_html)

    embedded_css = merge_embedded_styles_from_html(inner_html)

    body = _strip_style_blocks(inner_html)

    css_parts = [PT_DOCUMENT_STYLES.strip(), _PT_EMAIL_REPORT_EXTRA_STYLES.strip()]

    if embedded_css:

        css_parts.append(embedded_css)

    css = "\n".join(part for part in css_parts if part)

    return (

        f'<style type="text/css">\n{css}\n</style>'

        f'<div class="pt-email-report">{body}</div>'

    )





def relax_pt_inline_email_wrapper_styles(html: str) -> str:

    """Remove fonte/cor forçadas no div que envolve {TEXTO_AQUI} no modelo inline."""

    if not html:

        return html

    return html.replace(_EMAIL_WRAPPER_FONT_OVERRIDE, _EMAIL_WRAPPER_NEUTRAL)





def renumber_first_h2(html: str, prefix: str) -> str:

    """Prefixa numeração no primeiro h2 de conteúdo."""

    def repl(match: re.Match[str]) -> str:

        return f"{match.group(1)}{prefix} {match.group(2)}{match.group(3)}"



    return _H2_RE.sub(repl, html, count=1)


