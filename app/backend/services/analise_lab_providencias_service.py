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


def list_for_item(lab_item_id: int) -> list[dict[str, Any]]:
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
    """Cria seed a partir do HTML + linha sistema autorizar impressão."""
    existing = list_for_item(lab_item_id)
    if existing:
        ensure_autorizar_row(lab_item_id)
        sync_resolucao_obrigatoria(lab_item_id)
        return list_for_item(lab_item_id)

    parsed = parse_providencias_from_html(html_snapshot or "")
    ordem = 0
    for text in parsed:
        if normalize_label(text) == normalize_label(AUTORIZAR_TEXTO):
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
    _insert_row(
        lab_item_id,
        texto=AUTORIZAR_TEXTO,
        tipo=TIPO_AUTORIZAR,
        ordem=ordem,
        selecionada=False,  # default: resolução obrigatória
        origem=ORIGEM_SISTEMA,
    )
    sync_resolucao_obrigatoria(lab_item_id)
    project_html_snapshot(lab_item_id)
    return list_for_item(lab_item_id)


def ensure_autorizar_row(lab_item_id: int) -> None:
    rows = list_for_item(lab_item_id)
    if any(r["tipo"] == TIPO_AUTORIZAR for r in rows):
        return
    max_ordem = max((r["ordem"] for r in rows), default=-1)
    _insert_row(
        lab_item_id,
        texto=AUTORIZAR_TEXTO,
        tipo=TIPO_AUTORIZAR,
        ordem=max_ordem + 1,
        selecionada=False,
        origem=ORIGEM_SISTEMA,
    )


def sync_resolucao_obrigatoria(lab_item_id: int) -> bool:
    """Selecionada=0 em autorizar_impressao ⇒ ResolucaoObrigatoria=1."""
    rows = list_for_item(lab_item_id)
    autorizar = next((r for r in rows if r["tipo"] == TIPO_AUTORIZAR), None)
    obrig = True if autorizar is None else (not autorizar["selecionada"])
    db.execute_query(
        """
        UPDATE tabAnaliseLabItem
        SET ResolucaoObrigatoria = %s
        WHERE ID = %s
        """,
        (1 if obrig else 0, int(lab_item_id)),
    )
    return obrig


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
    """Substitui o conjunto de providências do item (exceto força linha sistema)."""
    cleaned: list[dict[str, Any]] = []
    has_autorizar = False
    for i, raw in enumerate(providencias or []):
        tipo = (raw.get("tipo") or TIPO_LIVRE).strip() or TIPO_LIVRE
        texto = (raw.get("texto") or "").strip()
        if tipo == TIPO_AUTORIZAR:
            has_autorizar = True
            texto = AUTORIZAR_TEXTO
            origem = ORIGEM_SISTEMA
        else:
            if not texto:
                continue
            origem = (raw.get("origem") or ORIGEM_MANUAL).strip() or ORIGEM_MANUAL
            if origem == ORIGEM_SISTEMA:
                origem = ORIGEM_MANUAL
        cleaned.append(
            {
                "texto": texto,
                "tipo": tipo,
                "ordem": int(raw.get("ordem") if raw.get("ordem") is not None else i),
                "selecionada": bool(raw.get("selecionada", True)),
                "origem": origem,
            }
        )
    if not has_autorizar:
        cleaned.append(
            {
                "texto": AUTORIZAR_TEXTO,
                "tipo": TIPO_AUTORIZAR,
                "ordem": len(cleaned),
                "selecionada": False,
                "origem": ORIGEM_SISTEMA,
            }
        )

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
    sync_resolucao_obrigatoria(lab_item_id)
    project_html_snapshot(lab_item_id)
    return list_for_item(lab_item_id)
