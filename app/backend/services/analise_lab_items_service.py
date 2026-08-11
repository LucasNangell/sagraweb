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
    ResolucaoObrigatoria, CorrigidoSefoc, ObsCorrecaoSefoc,
    ItemAnaliseID, PontoRegistro,
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
        "corrigidoSefoc": bool(int(row.get("CorrigidoSefoc") or 0)),
        "obsCorrecaoSefoc": (row.get("ObsCorrecaoSefoc") or "").strip() or None,
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
    corrigido_sefoc: Optional[bool] = None,
    obs_correcao_sefoc: Optional[str] = None,
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
    if corrigido_sefoc is not None:
        corrigido = bool(corrigido_sefoc)
    else:
        corrigido = bool(current.get("corrigidoSefoc"))
    if not corrigido:
        obs_corr = None
    elif obs_correcao_sefoc is not None:
        obs_corr = (obs_correcao_sefoc or "").strip() or None
    else:
        obs_corr = current.get("obsCorrecaoSefoc")
    db.execute_query(
        """
        UPDATE tabAnaliseLabItem
        SET Titulo = %s, HtmlSnapshot = %s, Obs = %s, Componente = %s,
            Escopo = %s, Pagina = %s, Paginas = %s, Ordem = %s,
            ResolucaoObrigatoria = %s, CorrigidoSefoc = %s, ObsCorrecaoSefoc = %s,
            ItemAnaliseID = %s
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
            1 if corrigido else 0,
            obs_corr,
            analise_id,
            int(item_id),
        ),
    )
    return get_item(item_id)


def build_replica_payload(
    item: dict[str, Any],
    *,
    versao_label: str,
) -> dict[str, Any]:
    """Monta kwargs para add_item a partir de um item existente (versão atual)."""
    return {
        "titulo": item.get("titulo") or "Problema técnico",
        "html_snapshot": item.get("htmlSnapshot") or "",
        "componente": item.get("componente") or "Arq. Único",
        "escopo": item.get("escopo") or "pagina",
        "pagina": int(item.get("pagina") or 0),
        "paginas": item.get("paginas"),
        "versao_label": (versao_label or "").strip()[:128],
        "id_problema_padrao": item.get("idProblemaPadrao"),
        "obs": item.get("obs"),
        "resolucao_obrigatoria": bool(item.get("resolucaoObrigatoria")),
    }


def normalize_reorder_ids(
    ordered_ids: list[int],
    session_item_ids: set[int],
) -> list[int]:
    """Mantém a ordem pedida, filtrando ids que não pertencem à sessão."""
    seen: set[int] = set()
    out: list[int] = []
    for raw in ordered_ids:
        item_id = int(raw)
        if item_id in seen or item_id not in session_item_ids:
            continue
        seen.add(item_id)
        out.append(item_id)
    return out


def reorder_items(sessao_id: int, ordered_ids: list[int]) -> list[dict[str, Any]]:
    current = list_items(sessao_id)
    session_ids = {int(i["id"]) for i in current}
    normalized = normalize_reorder_ids(ordered_ids, session_ids)
    for idx, item_id in enumerate(normalized, start=1):
        db.execute_query(
            "UPDATE tabAnaliseLabItem SET Ordem = %(ord)s WHERE ID = %(id)s AND SessaoID = %(sid)s",
            {"ord": idx, "id": int(item_id), "sid": int(sessao_id)},
        )
    remaining = [i for i in current if int(i["id"]) not in set(normalized)]
    next_ord = len(normalized) + 1
    for item in remaining:
        db.execute_query(
            "UPDATE tabAnaliseLabItem SET Ordem = %(ord)s WHERE ID = %(id)s AND SessaoID = %(sid)s",
            {"ord": next_ord, "id": int(item["id"]), "sid": int(sessao_id)},
        )
        next_ord += 1
    return list_items(sessao_id)


def _copy_marks_for_item(
    sessao_id: int,
    *,
    source_item_id: int,
    target_item_id: int,
    ponto: Optional[int] = None,
) -> int:
    from services import analise_lab_service as marks_svc

    marks = [
        m
        for m in marks_svc.list_marks(sessao_id)
        if m.get("itemId") == int(source_item_id)
    ]
    copied = 0
    for mark in marks:
        marks_svc.add_mark(
            sessao_id,
            pagina=int(mark.get("pagina") or 0),
            tipo=str(mark.get("tipo") or ""),
            geometria=dict(mark.get("geometria") or {}),
            rotulo=mark.get("rotulo"),
            cor=str(mark.get("cor") or "red"),
            ponto=ponto,
            espelhar=bool(mark.get("espelhar")),
            pagina_origem=int(mark.get("paginaOrigem") or 0),
            paginas=mark.get("paginas"),
            item_id=int(target_item_id),
        )
        copied += 1
    return copied


def replicate_items(
    sessao_id: int,
    item_ids: list[int],
    *,
    versao_label: str,
    copiar_marcas: bool = False,
    ponto: Optional[int] = None,
) -> list[dict[str, Any]]:
    """Replica itens de versões anteriores para a versão atual da sessão."""
    created: list[dict[str, Any]] = []
    seen: set[int] = set()
    for raw_id in item_ids:
        item_id = int(raw_id)
        if item_id in seen:
            continue
        seen.add(item_id)
        source = get_item(item_id)
        if not source or int(source["sessaoId"]) != int(sessao_id):
            raise ValueError(f"Item {item_id} não encontrado nesta sessão.")
        payload = build_replica_payload(source, versao_label=versao_label)
        new_item = add_item(sessao_id, ponto=ponto, **payload)
        if copiar_marcas:
            _copy_marks_for_item(
                sessao_id,
                source_item_id=item_id,
                target_item_id=int(new_item["id"]),
                ponto=ponto,
            )
        created.append(new_item)
    return created


def delete_item(item_id: int) -> bool:
    before = get_item(item_id)
    if not before:
        return False
    db.execute_query(
        "DELETE FROM tabAnaliseLabMarca WHERE ItemID = %(id)s",
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


def _normalize_classic_componente(raw: str) -> str:
    value = (raw or "").strip()
    if value in COMPONENTES:
        return value
    lower = value.lower()
    if lower == "encarte":
        return "Arq. Único"
    if "capa" in lower and "miolo" not in lower:
        return "Capa"
    if "miolo" in lower:
        return "Miolo"
    return "Arq. Único"


def _classic_items_for_os(ano: int, os_id: int) -> list[dict[str, Any]]:
    """Lê itens de tabAnaliseItens da OS; [] se não houver análise clássica."""
    header = db.execute_query(
        "SELECT ID FROM tabAnalises WHERE OS=%s AND Ano=%s LIMIT 1",
        (int(os_id), int(ano)),
    )
    if not header:
        return []
    id_analise = int(header[0]["ID"])

    # Tenta select completo; cai para colunas mínimas se o schema antigo falhar.
    queries = [
        """
        SELECT i.ID AS id, i.ID_ProblemaPadrao AS idProblemaPadrao,
               i.Obs AS obs, i.HTML_Snapshot AS html,
               i.Componente AS componente, i.Versao AS versaoLabel,
               i.ResolucaoObrigatoria AS resolucaoObrigatoria,
               i.CorrigidoSefoc AS corrigidoSefoc,
               i.ObsCorrecaoSefoc AS obsCorrecaoSefoc,
               COALESCE(NULLIF(TRIM(p.TituloPT), ''), CONCAT('Item #', i.ID)) AS titulo
        FROM tabAnaliseItens i
        LEFT JOIN tabProblemasPadrao p ON i.ID_ProblemaPadrao = p.ID
        WHERE i.ID_Analise = %s
        ORDER BY i.ID ASC
        """,
        """
        SELECT i.ID AS id, i.ID_ProblemaPadrao AS idProblemaPadrao,
               i.Obs AS obs, i.HTML_Snapshot AS html,
               i.Componente AS componente, i.Versao AS versaoLabel,
               i.ResolucaoObrigatoria AS resolucaoObrigatoria,
               0 AS corrigidoSefoc, NULL AS obsCorrecaoSefoc,
               COALESCE(NULLIF(TRIM(p.TituloPT), ''), CONCAT('Item #', i.ID)) AS titulo
        FROM tabAnaliseItens i
        LEFT JOIN tabProblemasPadrao p ON i.ID_ProblemaPadrao = p.ID
        WHERE i.ID_Analise = %s
        ORDER BY i.ID ASC
        """,
        """
        SELECT i.ID AS id, i.ID_ProblemaPadrao AS idProblemaPadrao,
               i.Obs AS obs, i.HTML_Snapshot AS html,
               i.Componente AS componente, NULL AS versaoLabel,
               COALESCE(i.ResolucaoObrigatoria, 0) AS resolucaoObrigatoria,
               0 AS corrigidoSefoc, NULL AS obsCorrecaoSefoc,
               COALESCE(NULLIF(TRIM(p.TituloPT), ''), CONCAT('Item #', i.ID)) AS titulo
        FROM tabAnaliseItens i
        LEFT JOIN tabProblemasPadrao p ON i.ID_ProblemaPadrao = p.ID
        WHERE i.ID_Analise = %s
        ORDER BY i.ID ASC
        """,
    ]
    last_exc: Exception | None = None
    for sql in queries:
        try:
            rows = db.execute_query(sql, (id_analise,))
            return list(rows or [])
        except Exception as exc:
            last_exc = exc
            continue
    if last_exc:
        logger.warning(
            "Falha ao ler tabAnaliseItens para OS %s/%s: %s",
            os_id,
            ano,
            last_exc,
        )
    return []


def import_classic_items(sessao_id: int, ano: int, os_id: int) -> int:
    """
    Importa itens clássicos faltantes para a sessão Lab (idempotente).

    - Não sobrescreve linhas Lab já existentes.
    - Só importa itens cujo ID_Analise pertence à mesma OS.
    - Grava ItemAnaliseID para sincronizar no concluir.
    """
    sid = int(sessao_id)
    session = get_session_by_id(sid)
    if not session:
        return 0
    if int(session.get("nroProtocolo") or 0) != int(os_id) or int(
        session.get("anoProtocolo") or 0
    ) != int(ano):
        logger.warning(
            "import_classic_items: sessão %s não pertence à OS %s/%s",
            sid,
            os_id,
            ano,
        )
        return 0

    classic_rows = _classic_items_for_os(ano, os_id)
    if not classic_rows:
        return 0

    classic_ids = [int(r["id"]) for r in classic_rows if r.get("id") is not None]
    if not classic_ids:
        return 0

    placeholders = ", ".join(["%s"] * len(classic_ids))
    already = db.execute_query(
        f"""
        SELECT ItemAnaliseID AS id
        FROM tabAnaliseLabItem
        WHERE ItemAnaliseID IN ({placeholders})
        """,
        tuple(classic_ids),
    )
    already_ids = {
        int(r["id"]) for r in (already or []) if r.get("id") is not None
    }

    created = 0
    ordem = _next_ordem(sid)
    for row in classic_rows:
        classic_id = int(row.get("id") or 0)
        if classic_id <= 0 or classic_id in already_ids:
            continue

        titulo = (row.get("titulo") or "").strip() or f"Item #{classic_id}"
        componente = _normalize_classic_componente(str(row.get("componente") or ""))
        versao_label = (row.get("versaoLabel") or session.get("versaoLabel") or "").strip()[
            :128
        ]
        obs = (row.get("obs") or "").strip() or None
        html = row.get("html") or ""
        id_padrao = row.get("idProblemaPadrao")
        reso = 1 if int(row.get("resolucaoObrigatoria") or 0) else 0
        corrigido = 1 if int(row.get("corrigidoSefoc") or 0) else 0
        obs_corr = (row.get("obsCorrecaoSefoc") or "").strip() or None
        if not corrigido:
            obs_corr = None

        try:
            db.execute_query(
                """
                INSERT INTO tabAnaliseLabItem
                    (SessaoID, ID_ProblemaPadrao, Titulo, HtmlSnapshot, Obs,
                     Componente, Escopo, Pagina, Paginas, VersaoLabel, Ordem,
                     ResolucaoObrigatoria, CorrigidoSefoc, ObsCorrecaoSefoc,
                     ItemAnaliseID)
                VALUES (%s, %s, %s, %s, %s, %s, 'arquivo', 0, NULL, %s, %s,
                        %s, %s, %s, %s)
                """,
                (
                    sid,
                    int(id_padrao) if id_padrao is not None else None,
                    titulo[:255],
                    html,
                    obs,
                    componente,
                    versao_label,
                    ordem,
                    reso,
                    corrigido,
                    obs_corr,
                    classic_id,
                ),
            )
            already_ids.add(classic_id)
            ordem += 1
            created += 1
        except Exception as exc:
            # UNIQUE / race: outro request já importou — trata como existente.
            msg = str(exc).lower()
            if "duplicate" in msg or "uq_lab_item_analise" in msg:
                already_ids.add(classic_id)
                continue
            logger.warning(
                "Falha ao importar item clássico %s para sessão %s: %s",
                classic_id,
                sid,
                exc,
            )
    return created

