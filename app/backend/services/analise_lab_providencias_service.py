"""
Providências estruturadas por item do Análise Lab (tabAnaliseLabItemProvidencia).
"""
from __future__ import annotations

import logging
import re
from html.parser import HTMLParser
from typing import Any, Optional

from database import db

logger = logging.getLogger(__name__)

TIPO_LIVRE = "livre"
TIPO_AUTORIZAR = "autorizar_impressao"
ORIGEM_BIBLIOTECA = "biblioteca"
ORIGEM_SISTEMA = "sistema"
ORIGEM_MANUAL = "manual"

AUTORIZAR_TEXTO = "Autorizar impressão desconsiderando o problema"

_SELECT = """
    ID, LabItemID, Texto, Tipo, Ordem, Selecionada, Origem,
    DataRegistro, DataAtualizacao
"""


def _iso(value: Any) -> Optional[str]:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _row_to_prov(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": int(row.get("ID") or 0),
        "labItemId": int(row.get("LabItemID") or 0),
        "texto": (row.get("Texto") or "").strip(),
        "tipo": (row.get("Tipo") or TIPO_LIVRE).strip() or TIPO_LIVRE,
        "ordem": int(row.get("Ordem") or 0),
        "selecionada": bool(int(row.get("Selecionada") or 0)),
        "origem": (row.get("Origem") or ORIGEM_MANUAL).strip() or ORIGEM_MANUAL,
        "dataRegistro": _iso(row.get("DataRegistro")),
        "dataAtualizacao": _iso(row.get("DataAtualizacao")),
    }


class _ActionItemParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._in_action = False
        self._buf: list[str] = []
        self.items: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, Optional[str]]]) -> None:
        classes = ""
        for name, value in attrs:
            if name == "class" and value:
                classes = value
                break
        if tag.lower() in ("li", "div", "p") and "action-item" in classes.split():
            self._in_action = True
            self._buf = []

    def handle_endtag(self, tag: str) -> None:
        if self._in_action and tag.lower() in ("li", "div", "p"):
            text = re.sub(r"\s+", " ", "".join(self._buf)).strip()
            if text:
                self.items.append(text)
            self._in_action = False
            self._buf = []

    def handle_data(self, data: str) -> None:
        if self._in_action:
            self._buf.append(data)


def parse_providencias_from_html(html: str) -> list[str]:
    """Extrai textos de .action-item; fallback: itens de lista após 'Providências'."""
    raw = html or ""
    if not raw.strip():
        return []
    parser = _ActionItemParser()
    try:
        parser.feed(raw)
    except Exception:
        parser.items = []
    if parser.items:
        return parser.items

    # Fallback: <li> após um heading/barra com "Provid"
    texts: list[str] = []
    lower = raw.lower()
    idx = lower.find("provid")
    chunk = raw[idx:] if idx >= 0 else raw
    for m in re.finditer(
        r"<li[^>]*>(.*?)</li>", chunk, flags=re.IGNORECASE | re.DOTALL
    ):
        text = re.sub(r"<[^>]+>", "", m.group(1))
        text = re.sub(r"\s+", " ", text).strip()
        if text and normalize_label(text) != "providencias":
            texts.append(text)
    return texts


def normalize_label(value: str) -> str:
    import unicodedata

    s = unicodedata.normalize("NFD", value or "")
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn")
    return re.sub(r"\s+", " ", s).strip().lower()


def is_autorizar_texto(texto: str) -> bool:
    return normalize_label(texto or "") == normalize_label(AUTORIZAR_TEXTO)


def dedupe_autorizar_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Remove providência de sistema autorizar_impressao (legado); só livres."""
    kept: list[dict[str, Any]] = []
    for raw in rows or []:
        tipo = (raw.get("tipo") or TIPO_LIVRE).strip() or TIPO_LIVRE
        texto = (raw.get("texto") or "").strip()
        if tipo == TIPO_AUTORIZAR or is_autorizar_texto(texto):
            continue
        if not texto:
            continue
        row = dict(raw)
        row["tipo"] = TIPO_LIVRE
        if (row.get("origem") or "") == ORIGEM_SISTEMA:
            row["origem"] = ORIGEM_MANUAL
        kept.append(row)
    for i, row in enumerate(kept):
        row["ordem"] = i
    return kept


def _has_autorizar_dupes(rows: list[dict[str, Any]]) -> bool:
    likes = [
        r
        for r in rows
        if (r.get("tipo") or "") == TIPO_AUTORIZAR
        or is_autorizar_texto(r.get("texto") or "")
    ]
    return len(likes) > 0


def _rewrite_providencias(
    lab_item_id: int, rows: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    db.execute_query(
        "DELETE FROM tabAnaliseLabItemProvidencia WHERE LabItemID = %s",
        (int(lab_item_id),),
    )
    for i, row in enumerate(rows):
        _insert_row(
            lab_item_id,
            texto=row.get("texto") or "",
            tipo=row.get("tipo") or TIPO_LIVRE,
            ordem=int(row.get("ordem", i)),
            selecionada=bool(row.get("selecionada", True)),
            origem=row.get("origem") or ORIGEM_MANUAL,
        )
    return list_for_item_raw(lab_item_id)


def list_for_item_raw(lab_item_id: int) -> list[dict[str, Any]]:
    rows = db.execute_query(
        f"""
        SELECT {_SELECT}
        FROM tabAnaliseLabItemProvidencia
        WHERE LabItemID = %(id)s
        ORDER BY Ordem ASC, ID ASC
        """,
        {"id": int(lab_item_id)},
    )
    return [_row_to_prov(r) for r in (rows or [])]


def list_for_item(lab_item_id: int) -> list[dict[str, Any]]:
    rows = list_for_item_raw(lab_item_id)
    if not rows:
        return rows
    if not _has_autorizar_dupes(rows):
        return rows
    # Remove linhas legadas autorizar_impressao sem alterar ResolucaoObrigatoria.
    return _rewrite_providencias(lab_item_id, dedupe_autorizar_rows(rows))


def list_for_items(lab_item_ids: list[int]) -> dict[int, list[dict[str, Any]]]:
    ids = [int(x) for x in lab_item_ids if int(x) > 0]
    if not ids:
        return {}
    placeholders = ", ".join(["%s"] * len(ids))
    rows = db.execute_query(
        f"""
        SELECT {_SELECT}
        FROM tabAnaliseLabItemProvidencia
        WHERE LabItemID IN ({placeholders})
        ORDER BY LabItemID ASC, Ordem ASC, ID ASC
        """,
        tuple(ids),
    )
    out: dict[int, list[dict[str, Any]]] = {i: [] for i in ids}
    for row in rows or []:
        item_id = int(row.get("LabItemID") or 0)
        out.setdefault(item_id, []).append(_row_to_prov(row))
    for item_id, item_rows in list(out.items()):
        if not item_rows:
            continue
        if _has_autorizar_dupes(item_rows):
            out[item_id] = list_for_item(item_id)
    return out


def _insert_row(
    lab_item_id: int,
    *,
    texto: str,
    tipo: str,
    ordem: int,
    selecionada: bool,
    origem: str,
) -> None:
    db.execute_query(
        """
        INSERT INTO tabAnaliseLabItemProvidencia
            (LabItemID, Texto, Tipo, Ordem, Selecionada, Origem)
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        (
            int(lab_item_id),
            (texto or "").strip()[:4000],
            (tipo or TIPO_LIVRE)[:64],
            int(ordem),
            1 if selecionada else 0,
            (origem or ORIGEM_MANUAL)[:16],
        ),
    )


def seed_for_item(lab_item_id: int, html_snapshot: str) -> list[dict[str, Any]]:
    """Cria seed a partir do HTML (sem linha de sistema autorizar)."""
    existing = list_for_item_raw(lab_item_id)
    if existing:
        if _has_autorizar_dupes(existing):
            return _rewrite_providencias(lab_item_id, dedupe_autorizar_rows(existing))
        return existing

    parsed = parse_providencias_from_html(html_snapshot or "")
    ordem = 0
    for text in parsed:
        if is_autorizar_texto(text):
            continue
        _insert_row(
            lab_item_id,
            texto=text,
            tipo=TIPO_LIVRE,
            ordem=ordem,
            selecionada=True,
            origem=ORIGEM_BIBLIOTECA,
        )
        ordem += 1
    project_html_snapshot(lab_item_id)
    return list_for_item_raw(lab_item_id)


def ensure_autorizar_row(lab_item_id: int) -> None:
    """Legado no-op: não força mais a linha autorizar_impressao."""
    rows = list_for_item_raw(lab_item_id)
    if _has_autorizar_dupes(rows):
        _rewrite_providencias(lab_item_id, dedupe_autorizar_rows(rows))


def sync_resolucao_obrigatoria(lab_item_id: int) -> bool:
    """
    Não deriva mais ResolucaoObrigatoria da providência autorizar.
    Retorna o valor atual gravado no item.
    """
    rows = db.execute_query(
        "SELECT ResolucaoObrigatoria FROM tabAnaliseLabItem WHERE ID = %s LIMIT 1",
        (int(lab_item_id),),
    )
    if not rows:
        return False
    return bool(int(rows[0].get("ResolucaoObrigatoria") or 0))


def build_providencias_html(providencias: list[dict[str, Any]]) -> str:
    selected = [p for p in providencias if p.get("selecionada")]
    if not selected:
        return ""
    items = "".join(
        f'<li class="action-item">{_escape_html(p.get("texto") or "")}</li>'
        for p in selected
    )
    return (
        '<div class="providencias-bar">Providências</div>'
        f'<ul class="action-list">{items}</ul>'
    )


def _escape_html(text: str) -> str:
    return (
        (text or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def strip_providencias_from_html(html: str) -> str:
    raw = html or ""
    raw = re.sub(
        r'<div[^>]*class="[^"]*providencias-bar[^"]*"[^>]*>.*?</div>',
        "",
        raw,
        flags=re.IGNORECASE | re.DOTALL,
    )
    raw = re.sub(
        r'<ul[^>]*class="[^"]*action-list[^"]*"[^>]*>.*?</ul>',
        "",
        raw,
        flags=re.IGNORECASE | re.DOTALL,
    )
    return raw.strip()


def project_html_snapshot(lab_item_id: int) -> None:
    """Reescreve HtmlSnapshot: descrição + bloco de providências selecionadas."""
    rows = db.execute_query(
        "SELECT HtmlSnapshot FROM tabAnaliseLabItem WHERE ID = %(id)s LIMIT 1",
        {"id": int(lab_item_id)},
    )
    if not rows:
        return
    base = strip_providencias_from_html(rows[0].get("HtmlSnapshot") or "")
    prov_html = build_providencias_html(list_for_item(lab_item_id))
    merged = f"{base}\n{prov_html}".strip() if prov_html else base
    db.execute_query(
        "UPDATE tabAnaliseLabItem SET HtmlSnapshot = %s WHERE ID = %s",
        (merged, int(lab_item_id)),
    )


def replace_for_item(
    lab_item_id: int,
    providencias: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Substitui o conjunto de providências do item (sem linha autorizar de sistema)."""
    cleaned: list[dict[str, Any]] = []
    for i, raw in enumerate(providencias or []):
        tipo = (raw.get("tipo") or TIPO_LIVRE).strip() or TIPO_LIVRE
        texto = (raw.get("texto") or "").strip()
        if tipo == TIPO_AUTORIZAR or is_autorizar_texto(texto):
            continue
        if not texto:
            continue
        origem = (raw.get("origem") or ORIGEM_MANUAL).strip() or ORIGEM_MANUAL
        if origem == ORIGEM_SISTEMA:
            origem = ORIGEM_MANUAL
        cleaned.append(
            {
                "texto": texto,
                "tipo": TIPO_LIVRE,
                "ordem": int(raw.get("ordem") if raw.get("ordem") is not None else i),
                "selecionada": bool(raw.get("selecionada", True)),
                "origem": origem,
            }
        )
    cleaned = dedupe_autorizar_rows(cleaned)

    db.execute_query(
        "DELETE FROM tabAnaliseLabItemProvidencia WHERE LabItemID = %s",
        (int(lab_item_id),),
    )
    for i, row in enumerate(cleaned):
        _insert_row(
            lab_item_id,
            texto=row["texto"],
            tipo=row["tipo"],
            ordem=int(row.get("ordem", i)),
            selecionada=bool(row.get("selecionada")),
            origem=row["origem"],
        )
    project_html_snapshot(lab_item_id)
    return list_for_item_raw(lab_item_id)
