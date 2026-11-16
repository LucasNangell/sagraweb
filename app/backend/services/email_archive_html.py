"""Monta snapshot HTML autocontido de um e-mail (abre no navegador sem Outlook)."""
from __future__ import annotations

import base64
import html as html_lib
import logging
import mimetypes
import re
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

logger = logging.getLogger(__name__)

_CID_SRC_RE = re.compile(
    r"""(\bsrc\s*=\s*)(["'])cid:([^"']+)\2""",
    re.IGNORECASE,
)
_BODY_INNER_RE = re.compile(
    r"<body\b[^>]*>(.*?)</body>",
    re.IGNORECASE | re.DOTALL,
)
_HTML_DOC_RE = re.compile(r"<!DOCTYPE\b|<html\b", re.IGNORECASE)


def _normalize_cid(value: str) -> str:
    return (value or "").strip().strip("<>").strip().lower()


def _guess_mime(filename: str, fallback: str = "application/octet-stream") -> str:
    mime, _ = mimetypes.guess_type(filename or "")
    return mime or fallback


def _extract_body_fragment(body_html: str) -> str:
    raw = (body_html or "").strip()
    if not raw:
        return "<p><em>(sem corpo)</em></p>"
    match = _BODY_INNER_RE.search(raw)
    if match:
        return match.group(1).strip() or "<p><em>(sem corpo)</em></p>"
    if _HTML_DOC_RE.search(raw):
        return raw
    return raw


def _replace_cid_with_data_uris(
    body_html: str,
    cid_map: Mapping[str, Tuple[str, bytes]],
) -> str:
    if not cid_map:
        return body_html

    def _repl(match: re.Match[str]) -> str:
        prefix, quote, cid_raw = match.group(1), match.group(2), match.group(3)
        key = _normalize_cid(cid_raw)
        part = cid_map.get(key)
        if not part:
            return match.group(0)
        mime, data = part
        b64 = base64.b64encode(data).decode("ascii")
        return f"{prefix}{quote}data:{mime};base64,{b64}{quote}"

    return _CID_SRC_RE.sub(_repl, body_html)


def _format_from(sender_name: str, sender_email: str) -> str:
    name = (sender_name or "").strip()
    email = (sender_email or "").strip()
    if name and email:
        return f"{name} <{email}>"
    return name or email or "—"


def build_email_archive_html(
    *,
    subject: str,
    sender_name: str = "",
    sender_email: str = "",
    display_to: str = "",
    date: str = "",
    body_html: str = "",
    cid_map: Optional[Mapping[str, Tuple[str, bytes]]] = None,
    attachment_names: Optional[Sequence[str]] = None,
) -> bytes:
    """
    Gera HTML UTF-8 autocontido com cabeçalho, corpo e imagens cid: embutidas.
    cid_map: content_id normalizado -> (mime_type, bytes).
    """
    safe_subject = html_lib.escape((subject or "E-mail").strip() or "E-mail")
    meta_rows = [
        ("De", _format_from(sender_name, sender_email)),
        ("Para", (display_to or "").strip() or "—"),
        ("Enviado", (date or "").strip() or "—"),
        ("Assunto", (subject or "").strip() or "—"),
    ]
    header_html = "".join(
        f'<div class="meta-row"><span class="meta-label">{html_lib.escape(label)}:</span> '
        f'<span class="meta-value">{html_lib.escape(value)}</span></div>'
        for label, value in meta_rows
    )

    fragment = _extract_body_fragment(body_html)
    fragment = _replace_cid_with_data_uris(fragment, cid_map or {})

    att_names = [n.strip() for n in (attachment_names or []) if (n or "").strip()]
    if att_names:
        items = "".join(f"<li>{html_lib.escape(name)}</li>" for name in att_names)
        attachments_html = (
            '<div class="attachments"><h2>Anexos</h2><ul>'
            f"{items}</ul>"
            "<p class=\"note\">Anexos não embutidos neste arquivo HTML "
            "(consulte a pasta Sefoc / Outlook quando necessário).</p></div>"
        )
    else:
        attachments_html = ""

    doc = f"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>{safe_subject}</title>
<style>
  :root {{ color-scheme: light; }}
  body {{
    margin: 0;
    font-family: "Segoe UI", Tahoma, sans-serif;
    background: #f4f6f8;
    color: #1a1a1a;
  }}
  .wrap {{
    max-width: 960px;
    margin: 0 auto;
    padding: 16px;
  }}
  .card {{
    background: #fff;
    border: 1px solid #d8dee6;
    border-radius: 8px;
    overflow: hidden;
  }}
  .headers {{
    padding: 16px 20px;
    background: #f8fafc;
    border-bottom: 1px solid #e2e8f0;
  }}
  .meta-row {{ margin: 4px 0; font-size: 14px; line-height: 1.4; }}
  .meta-label {{ font-weight: 650; color: #334155; margin-right: 6px; }}
  .meta-value {{ color: #0f172a; word-break: break-word; }}
  .body {{
    padding: 20px;
    overflow-x: auto;
  }}
  .body img {{ max-width: 100%; height: auto; }}
  .attachments {{
    padding: 12px 20px 20px;
    border-top: 1px solid #e2e8f0;
    background: #fbfcfd;
  }}
  .attachments h2 {{
    margin: 0 0 8px;
    font-size: 14px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #475569;
  }}
  .attachments ul {{ margin: 0; padding-left: 18px; }}
  .attachments .note {{ margin: 8px 0 0; font-size: 12px; color: #64748b; }}
</style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="headers">{header_html}</div>
      <div class="body">{fragment}</div>
      {attachments_html}
    </div>
  </div>
</body>
</html>
"""
    return doc.encode("utf-8")


def collect_inline_cid_map(service: Any, details: Mapping[str, Any]) -> Dict[str, Tuple[str, bytes]]:
    """Baixa anexos inline do EWS e monta mapa cid -> (mime, bytes)."""
    cid_map: Dict[str, Tuple[str, bytes]] = {}
    for att in details.get("attachments") or []:
        if not att.get("is_inline"):
            continue
        content_id = _normalize_cid(str(att.get("content_id") or ""))
        att_id = att.get("attachment_id")
        if not content_id or not att_id:
            continue
        try:
            name, data = service.get_attachment_content(str(att_id))
        except Exception as exc:
            logger.warning("Falha ao baixar anexo inline %s: %s", content_id, exc)
            continue
        mime = _guess_mime(name, fallback="image/png")
        if not mime.startswith("image/"):
            # Inline não-imagem ainda pode ser referenciado; mantém octet-stream.
            mime = _guess_mime(name)
        cid_map[content_id] = (mime, data)
        # Alguns corpos usam o nome do arquivo como cid.
        name_key = _normalize_cid(name)
        if name_key and name_key not in cid_map:
            cid_map[name_key] = (mime, data)
    return cid_map


def non_inline_attachment_names(details: Mapping[str, Any]) -> List[str]:
    names: List[str] = []
    for att in details.get("attachments") or []:
        if att.get("is_inline"):
            continue
        name = str(att.get("name") or "").strip()
        if name:
            names.append(name)
    return names


def build_email_archive_html_from_details(service: Any, details: Mapping[str, Any]) -> bytes:
    """Convenience: details EWS + service → HTML autocontido."""
    cid_map = collect_inline_cid_map(service, details)
    return build_email_archive_html(
        subject=str(details.get("subject") or ""),
        sender_name=str(details.get("sender_name") or ""),
        sender_email=str(details.get("sender_email") or ""),
        display_to=str(details.get("display_to") or ""),
        date=str(details.get("date") or ""),
        body_html=str(details.get("body") or ""),
        cid_map=cid_map,
        attachment_names=non_inline_attachment_names(details),
    )
