"""
Itens de problemas técnicos do Análise Lab (tabAnaliseLabItem).
"""
from __future__ import annotations

import logging
from typing import Any, Optional

from database import db
from services.analise_lab_service import (
    format_page_spec,
    get_session_by_id,
    parse_page_spec,
)
from services.prova_web_render_service import MODE_CAPA_MIOLO, MODE_UNICO

logger = logging.getLogger(__name__)

COMPONENTES = frozenset({"Capa", "Miolo", "Arq. Único"})
ESCOPOS = frozenset({"pagina", "paginas", "arquivo"})

_SELECT_ITEM = """
    ID, SessaoID, ID_ProblemaPadrao, Titulo, HtmlSnapshot, Obs,
    Componente, Escopo, Pagina, Paginas, VersaoLabel, Ordem,
    ResolucaoObrigatoria, ItemAnaliseID, PontoRegistro,
    DataRegistro, DataAtualizacao
"""


def _iso(value: Any) -> Optional[str]:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _row_to_item(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": int(row.get("ID") or 0),
        "sessaoId": int(row.get("SessaoID") or 0),
        "idProblemaPadrao": (
            int(row["ID_ProblemaPadrao"])
            if row.get("ID_ProblemaPadrao") is not None
            else None
        ),
        "titulo": (row.get("Titulo") or "").strip(),
        "htmlSnapshot": row.get("HtmlSnapshot") or "",
        "obs": (row.get("Obs") or "").strip() or None,
        "componente": (row.get("Componente") or "").strip(),
        "escopo": (row.get("Escopo") or "pagina").strip(),
        "pagina": int(row.get("Pagina") or 0),
        "paginas": (row.get("Paginas") or "").strip() or None,
        "versaoLabel": (row.get("VersaoLabel") or "").strip(),
        "ordem": int(row.get("Ordem") or 0),
        "resolucaoObrigatoria": bool(int(row.get("ResolucaoObrigatoria") or 0)),
        "itemAnaliseId": (
            int(row["ItemAnaliseID"]) if row.get("ItemAnaliseID") is not None else None
        ),
        "pontoRegistro": row.get("PontoRegistro"),
        "dataRegistro": _iso(row.get("DataRegistro")),
        "dataAtualizacao": _iso(row.get("DataAtualizacao")),
    }


def role_to_componente(role: str, *, modo: str) -> str:
    if (modo or "").strip().lower() == MODE_UNICO or modo == "unico":
        return "Arq. Único"
    r = (role or "").strip().lower()
    if r.startswith("cover"):
        return "Capa"
    return "Miolo"


def componente_for_pages(
    session: dict[str, Any],
    manifest: dict[str, Any],
    pages: list[int],
) -> dict[str, list[int]]:
    """Agrupa páginas por componente detectado (Capa / Miolo / Arq. Único)."""
    modo = (session.get("modo") or MODE_UNICO).strip().lower()
    if modo == "unico":
        modo = MODE_UNICO
    page_by_num = {
        int(p.get("page") or 0): p for p in (manifest.get("pages") or []) if p
    }
    grouped: dict[str, list[int]] = {}
    ordered = sorted({int(n) for n in pages if int(n) >= 1})
    if not ordered and modo == MODE_UNICO:
        return {"Arq. Único": []}
    for n in ordered:
        meta = page_by_num.get(n) or {}
        role = str(meta.get("role") or "page")
        comp = role_to_componente(role, modo=modo)
        grouped.setdefault(comp, []).append(n)
    return grouped


def item_occurrences(
    item: dict[str, Any],
    manifest: dict[str, Any],
) -> list[int]:
    """Lista ordenada de páginas onde o item aparece."""
    pages_meta = [p for p in (manifest.get("pages") or []) if p]
    all_nums = [int(p.get("page") or 0) for p in pages_meta if int(p.get("page") or 0) >= 1]
    escopo = (item.get("escopo") or "pagina").strip().lower()
    if escopo == "arquivo" or (not item.get("paginas") and int(item.get("pagina") or 0) == 0):
        componente = (item.get("componente") or "").strip()
        if componente == "Arq. Único" or not componente:
            return all_nums
        session_modo = MODE_CAPA_MIOLO if componente in ("Capa", "Miolo") else MODE_UNICO
        out: list[int] = []
        for p in pages_meta:
            n = int(p.get("page") or 0)
            if n < 1:
                continue
            if role_to_componente(str(p.get("role") or "page"), modo=session_modo) == componente:
                out.append(n)
        return out
    if item.get("paginas"):
        try:
            return [n for n in parse_page_spec(str(item["paginas"])) if n in set(all_nums) or not all_nums]
        except ValueError:
            return []
    pagina = int(item.get("pagina") or 0)
    return [pagina] if pagina >= 1 else []


def _normalize_scope(
    *,
    escopo: str,
    pagina: int = 0,
    paginas: Optional[str] = None,
) -> tuple[str, int, Optional[str]]:
    esc = (escopo or "pagina").strip().lower()
    if esc not in ESCOPOS:
        raise ValueError("Escopo inválido.")
    if esc == "arquivo":
        return "arquivo", 0, None
    if esc == "paginas" or (paginas and str(paginas).strip()):
        pages = parse_page_spec(str(paginas or pagina))
        return "paginas", pages[0], format_page_spec(pages)
    if int(pagina) < 1:
        raise ValueError("Informe a página.")
    return "pagina", int(pagina), None


def list_items(sessao_id: int) -> list[dict[str, Any]]:
    rows = db.execute_query(
        f"""
        SELECT {_SELECT_ITEM}
        FROM tabAnaliseLabItem
        WHERE SessaoID = %(sid)s
        ORDER BY Ordem ASC, ID ASC
        """,
        {"sid": int(sessao_id)},
    )
    return [_row_to_item(r) for r in (rows or [])]


def get_item(item_id: int) -> Optional[dict[str, Any]]:
    rows = db.execute_query(
        f"""
        SELECT {_SELECT_ITEM}
        FROM tabAnaliseLabItem
        WHERE ID = %(id)s
        LIMIT 1
        """,
        {"id": int(item_id)},
    )
    if not rows:
        return None
    return _row_to_item(rows[0])


def _next_ordem(sessao_id: int) -> int:
    rows = db.execute_query(
        "SELECT COALESCE(MAX(Ordem), 0) AS m FROM tabAnaliseLabItem WHERE SessaoID = %(sid)s",
        {"sid": int(sessao_id)},
    )
    return int((rows or [{}])[0].get("m") or 0) + 1


def add_item(
    sessao_id: int,
    *,
    titulo: str,
    html_snapshot: str,
    componente: str,
    escopo: str,
    pagina: int = 0,
    paginas: Optional[str] = None,
    versao_label: str = "",
    id_problema_padrao: Optional[int] = None,
    obs: Optional[str] = None,
    ponto: Optional[int] = None,
    resolucao_obrigatoria: bool = False,
) -> dict[str, Any]:
    titulo_n = (titulo or "").strip()[:255]
    if not titulo_n:
        raise ValueError("Título obrigatório.")
    comp = (componente or "").strip()
    if comp not in COMPONENTES:
        raise ValueError("Componente inválido.")
    esc, pagina_n, paginas_n = _normalize_scope(
        escopo=escopo, pagina=pagina, paginas=paginas
    )
    ordem = _next_ordem(sessao_id)
    db.execute_query(
        """
        INSERT INTO tabAnaliseLabItem
            (SessaoID, ID_ProblemaPadrao, Titulo, HtmlSnapshot, Obs,
             Componente, Escopo, Pagina, Paginas, VersaoLabel, Ordem,
             ResolucaoObrigatoria, PontoRegistro)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            int(sessao_id),
            int(id_problema_padrao) if id_problema_padrao is not None else None,
            titulo_n,
            html_snapshot or "",
            (obs or "").strip() or None,
            comp,
            esc,
            int(pagina_n),
            paginas_n,
            (versao_label or "").strip()[:128],
            ordem,
            1 if resolucao_obrigatoria else 0,
            ponto,
        ),
    )
    rows = db.execute_query(
        f"""
        SELECT {_SELECT_ITEM}
        FROM tabAnaliseLabItem
        WHERE SessaoID = %(sid)s
        ORDER BY ID DESC
        LIMIT 1
        """,
        {"sid": int(sessao_id)},
    )
    if not rows:
        raise RuntimeError("Falha ao gravar item.")
    return _row_to_item(rows[0])


def update_item(
    item_id: int,
    *,
    titulo: Optional[str] = None,
    html_snapshot: Optional[str] = None,
    obs: Optional[str] = None,
    componente: Optional[str] = None,
    escopo: Optional[str] = None,
    pagina: Optional[int] = None,
    paginas: Optional[str] = None,
    resolucao_obrigatoria: Optional[bool] = None,
    ordem: Optional[int] = None,
    item_analise_id: Optional[int] = None,
) -> Optional[dict[str, Any]]:
    current = get_item(item_id)
    if not current:
        return None
    titulo_n = (
        (titulo.strip()[:255] if isinstance(titulo, str) else current["titulo"])
        if titulo is not None
        else current["titulo"]
    )
    if not titulo_n:
        raise ValueError("Título obrigatório.")
    html_n = (
        html_snapshot if html_snapshot is not None else current.get("htmlSnapshot") or ""
    )
    obs_n = (
        (obs.strip() if isinstance(obs, str) else None)
        if obs is not None
        else current.get("obs")
    )
    comp = (componente or current["componente"]).strip()
    if comp not in COMPONENTES:
        raise ValueError("Componente inválido.")
    if escopo is not None or pagina is not None or paginas is not None:
        esc, pagina_n, paginas_n = _normalize_scope(
            escopo=escopo or current["escopo"],
            pagina=pagina if pagina is not None else int(current["pagina"]),
            paginas=paginas if paginas is not None else current.get("paginas"),
        )
    else:
        esc = current["escopo"]
        pagina_n = int(current["pagina"])
        paginas_n = current.get("paginas")
    reso = (
        bool(resolucao_obrigatoria)
        if resolucao_obrigatoria is not None
        else bool(current.get("resolucaoObrigatoria"))
    )
    ordem_n = int(ordem) if ordem is not None else int(current.get("ordem") or 0)
    analise_id = (
        int(item_analise_id)
        if item_analise_id is not None
        else current.get("itemAnaliseId")
    )
    db.execute_query(
        """
        UPDATE tabAnaliseLabItem
        SET Titulo = %s, HtmlSnapshot = %s, Obs = %s, Componente = %s,
            Escopo = %s, Pagina = %s, Paginas = %s, Ordem = %s,
            ResolucaoObrigatoria = %s, ItemAnaliseID = %s
        WHERE ID = %s
        """,
        (
            titulo_n,
            html_n,
            obs_n,
            comp,
            esc,
            pagina_n,
            paginas_n,
            ordem_n,
            1 if reso else 0,
            analise_id,
            int(item_id),
        ),
    )
    return get_item(item_id)


def delete_item(item_id: int) -> bool:
    before = get_item(item_id)
    if not before:
        return False
    db.execute_query(
        "UPDATE tabAnaliseLabMarca SET ItemID = NULL WHERE ItemID = %(id)s",
        {"id": int(item_id)},
    )
    db.execute_query(
        "DELETE FROM tabAnaliseLabItem WHERE ID = %(id)s",
        {"id": int(item_id)},
    )
    return True


def register_from_library(
    sessao_id: int,
    *,
    id_problema: int,
    escopo: str,
    pagina: int,
    paginas: Optional[str],
    versao_label: str,
    ponto: Optional[int],
    manifest: dict[str, Any],
    confirm_split: bool = False,
) -> dict[str, Any]:
    """
    Copia problema padrão e cria 1 ou N itens por componente.
    Retorna { items, needsConfirm?, splitPreview? }.
    """
    session = get_session_by_id(sessao_id)
    if not session:
        raise ValueError("Sessão não encontrada.")

    rows = db.execute_query(
        """
        SELECT ID, TituloPT, ProbTecHTML, Categoria
        FROM tabProblemasPadrao
        WHERE ID = %(id)s
        LIMIT 1
        """,
        {"id": int(id_problema)},
    )
    if not rows:
        raise ValueError("Problema padrão não encontrado.")
    padrao = rows[0]
    titulo = (padrao.get("TituloPT") or "").strip() or "Problema técnico"
    html = padrao.get("ProbTecHTML") or ""

    esc, pagina_n, paginas_n = _normalize_scope(
        escopo=escopo, pagina=pagina, paginas=paginas
    )

    if esc == "arquivo":
        modo = (session.get("modo") or MODE_UNICO).strip().lower()
        if modo in (MODE_CAPA_MIOLO, "capa_miolo"):
            pages_nums = [
                int(p.get("page") or 0)
                for p in (manifest.get("pages") or [])
                if int(p.get("page") or 0) >= 1
            ]
            grouped = componente_for_pages(session, manifest, pages_nums)
        else:
            grouped = {"Arq. Único": []}
    else:
        page_list = parse_page_spec(paginas_n) if paginas_n else [pagina_n]
        grouped = componente_for_pages(session, manifest, page_list)

    if len(grouped) > 1 and not confirm_split:
        return {
            "needsConfirm": True,
            "splitPreview": {
                comp: format_page_spec(plist) if plist else "arquivo"
                for comp, plist in grouped.items()
            },
            "items": [],
        }

    created: list[dict[str, Any]] = []
    for comp, plist in grouped.items():
        if esc == "arquivo" and not plist:
            item = add_item(
                sessao_id,
                titulo=titulo,
                html_snapshot=html,
                componente=comp,
                escopo="arquivo",
                pagina=0,
                paginas=None,
                versao_label=versao_label or session.get("versaoLabel") or "",
                id_problema_padrao=int(id_problema),
                ponto=ponto,
            )
        elif esc == "arquivo":
            item = add_item(
                sessao_id,
                titulo=titulo,
                html_snapshot=html,
                componente=comp,
                escopo="arquivo",
                pagina=0,
                paginas=None,
                versao_label=versao_label or session.get("versaoLabel") or "",
                id_problema_padrao=int(id_problema),
                ponto=ponto,
            )
        elif len(plist) == 1:
            item = add_item(
                sessao_id,
                titulo=titulo,
                html_snapshot=html,
                componente=comp,
                escopo="pagina",
                pagina=plist[0],
                paginas=None,
                versao_label=versao_label or session.get("versaoLabel") or "",
                id_problema_padrao=int(id_problema),
                ponto=ponto,
            )
        else:
            item = add_item(
                sessao_id,
                titulo=titulo,
                html_snapshot=html,
                componente=comp,
                escopo="paginas",
                pagina=plist[0],
                paginas=format_page_spec(plist),
                versao_label=versao_label or session.get("versaoLabel") or "",
                id_problema_padrao=int(id_problema),
                ponto=ponto,
            )
        created.append(item)

    return {"needsConfirm": False, "items": created, "splitPreview": None}
