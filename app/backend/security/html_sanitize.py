"""

Sanitização de HTML para campos html_snapshot (mitiga XSS armazenado).

Usa bleach quando disponível; fallback regex/stdlib caso contrário.

Preserva blocos <style> embutidos (formatação dos problemas técnicos).

"""

from __future__ import annotations



import html as html_module

import logging

import re

from typing import List, Optional, Tuple



logger = logging.getLogger(__name__)



_BLEACH_TAGS = [

    "p", "div", "span", "br", "strong", "em", "b", "i", "u",

    "h1", "h2", "h3", "h4", "h5", "h6",

    "ul", "ol", "li", "table", "thead", "tbody", "tr", "td", "th",

    "img", "a", "sub", "sup", "blockquote", "style",

]

_BLEACH_ATTRS = {

    "*": ["style", "class"],

    "img": ["src", "alt", "width", "height"],

    "a": ["href", "title", "target"],

    "td": ["colspan", "rowspan"],

    "th": ["colspan", "rowspan"],

    "span": ["data-sagra-style-ph"],

}



_STYLE_BLOCK_RE = re.compile(r"<style\b[^>]*>[\s\S]*?</style>", re.IGNORECASE)

# Placeholder em <span> — bleach remove comentários HTML (<!--SAGRA_STYLE_n--> era apagado).
_STYLE_PLACEHOLDER_RE = re.compile(
    r'<span\s+data-sagra-style-ph="(\d+)"\s*>\s*</span>',
    re.IGNORECASE,
)

_STYLE_COMMENT_RE = re.compile(r"<!--[\s\S]*?-->")



_SCRIPT_RE = re.compile(r"<script\b[^>]*>.*?</script>", re.IGNORECASE | re.DOTALL)

_IFRAME_RE = re.compile(

    r"<(iframe|object|embed|form|input|button|meta|link|base)\b[^>]*>",

    re.IGNORECASE,

)

_ON_ATTR_RE = re.compile(r"\s+on\w+\s*=\s*(['\"]).*?\1", re.IGNORECASE | re.DOTALL)

_JS_URL_RE = re.compile(r"(?i)(href|src)\s*=\s*['\"]\s*javascript:")





def _clean_style_tag_inner(css: str) -> str:
    """Remove comentários HTML inválidos dentro de <style> (export Word)."""
    out = _STYLE_COMMENT_RE.sub("", css)
    out = re.sub(r"<!--[\s\S]*$", "", out)
    out = re.sub(r"^\s*-->\s*", "", out, flags=re.MULTILINE)
    return out.strip()


def _normalize_preserved_style_tag(style_tag: str) -> str:
    m = re.match(r"(<style\b[^>]*>)([\s\S]*?)(</style>)", style_tag, re.IGNORECASE)
    if not m:
        return style_tag
    inner = _clean_style_tag_inner(m.group(2))
    return f"{m.group(1)}{inner}{m.group(3)}"


def _extract_style_blocks(raw: str) -> Tuple[str, List[str]]:
    styles: List[str] = []

    def repl(match: re.Match[str]) -> str:
        styles.append(_normalize_preserved_style_tag(match.group(0)))
        idx = len(styles) - 1
        return f'<span data-sagra-style-ph="{idx}"></span>'

    stripped = _STYLE_BLOCK_RE.sub(repl, raw)
    return stripped, styles





def _restore_style_blocks(text: str, styles: List[str]) -> str:

    def repl(match: re.Match[str]) -> str:

        idx = int(match.group(1))

        if 0 <= idx < len(styles):

            return styles[idx]

        return ""



    return _STYLE_PLACEHOLDER_RE.sub(repl, text)





def _sanitize_fallback(raw: str) -> str:

    text, styles = _extract_style_blocks(raw)

    text = _SCRIPT_RE.sub("", text)

    text = _IFRAME_RE.sub("", text)

    text = _ON_ATTR_RE.sub("", text)

    text = _JS_URL_RE.sub(r'\1="#"', text)

    return _restore_style_blocks(text, styles)





def sanitize_html_snapshot(raw: Optional[str]) -> Optional[str]:

    if raw is None:

        return None

    text = str(raw).strip()

    if not text:

        return raw



    text, preserved_styles = _extract_style_blocks(text)



    try:

        import bleach

        from bleach.css_sanitizer import CSSSanitizer



        _word_css_props = [
            "color", "background", "background-color", "font", "font-size",
            "font-weight", "font-family", "font-style", "font-variant",
            "text-align", "text-decoration", "text-indent", "text-transform",
            "letter-spacing", "word-spacing", "white-space", "tab-stops",
            "margin", "margin-top", "margin-bottom", "margin-left", "margin-right",
            "padding", "padding-top", "padding-bottom", "padding-left", "padding-right",
            "border", "border-top", "border-bottom", "border-left", "border-right",
            "border-collapse", "border-spacing", "width", "height",
            "max-width", "max-height", "min-width", "min-height",
            "display", "float", "clear", "position", "top", "left", "right", "bottom",
            "z-index", "line-height", "vertical-align", "list-style", "list-style-type",
            "background-image", "page-break-before", "page-break-after", "page-break-inside",
            "mso-style-priority", "mso-style-name", "mso-style-parent", "mso-style-next",
            "mso-margin-top-alt", "mso-margin-bottom-alt", "mso-padding-alt", "mso-border-alt",
            "mso-list", "mso-element", "mso-line-height-rule", "mso-pagination",
            "mso-ansi-language", "mso-fareast-language", "mso-bidi-language",
        ]
        css_sanitizer = CSSSanitizer(allowed_css_properties=_word_css_props)



        cleaned = bleach.clean(

            text,

            tags=_BLEACH_TAGS,

            attributes=_BLEACH_ATTRS,

            protocols=["http", "https", "mailto", "data"],

            css_sanitizer=css_sanitizer,

            strip=True,

        )

        cleaned = re.sub(

            r'(<a\b[^>]*\shref=["\'])data:[^"\']*(["\'])',

            r"\1#\2",

            cleaned,

            flags=re.IGNORECASE,

        )

        return _restore_style_blocks(cleaned, preserved_styles)

    except ImportError:

        logger.debug("bleach não instalado; usando sanitização fallback")

        return _sanitize_fallback(str(raw).strip())

    except Exception:

        logger.exception("Falha na sanitização bleach; aplicando fallback")

        return _sanitize_fallback(str(raw).strip())


