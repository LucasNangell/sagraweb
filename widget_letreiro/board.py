"""Regras do painel/setor usadas pelo letreiro (port de dashboard-setor/utils.ts)."""
from __future__ import annotations

from typing import Any, Iterable, Optional

INBOX_COLUMN_SOURCE = "inbox"
INBOX_DISPLAY_SITUACAO = "Novo e-mail"
FINISHED_SITUACOES = frozenset({"Entregue", "Cancelada", "Cancelado"})
GRAVACAO_SITUACOES = frozenset({"Gravação", "Gravação Parcial"})
DASHBOARD_NEW_HIGHLIGHT_MS = 30_000

QueueItem = dict[str, Any]
DashboardOsItem = dict[str, Any]
DashboardConfig = dict[str, Any]
DashboardColumn = dict[str, Any]


def is_inbox_column(col: dict[str, Any]) -> bool:
    return col.get("source") == INBOX_COLUMN_SOURCE


def dashboard_config_has_inbox_column(config: DashboardConfig) -> bool:
    return any(is_inbox_column(col) for col in config.get("columns") or [])


def resolve_priority_type(prioridade: Optional[str]) -> Optional[str]:
    if not prioridade:
        return None
    if "Prometido" in prioridade:
        return "priority-high"
    if "Solicitado" in prioridade:
        return "priority-medium"
    return None


def resolve_display_situacao(item: QueueItem) -> str:
    situacao = item.get("situacao") or ""
    obs_text = str(item.get("observacao") or "").lower()
    if situacao == "Em Execução" and "analis" in obs_text:
        return "Analisar arquivo"
    return situacao


def matches_column_status(situacao: str, status_filter: str) -> bool:
    value = (situacao or "").strip()
    filt = (status_filter or "").strip()
    if not filt:
        return False
    if value == filt:
        return True
    if filt.endswith("/"):
        return value.startswith(filt)
    return False


def format_os_number(nr_os: int | str, ano: int) -> str:
    try:
        nr = int(nr_os)
    except (TypeError, ValueError):
        nr = 0
        prefix = "OS"
    else:
        prefix = "OS" if nr < 5000 else "SP"
    year_suffix = str(ano)[-2:]
    return f"{prefix} {nr_os}/{year_suffix}"


def format_queue_display_label(item: QueueItem) -> str:
    if item.get("row_kind") == "sub_os":
        return format_os_number(
            item.get("parent_nr_os") if item.get("parent_nr_os") is not None else item.get("nr_os"),
            item.get("parent_ano") if item.get("parent_ano") is not None else item.get("ano"),
        )
    return format_os_number(item.get("nr_os"), item.get("ano"))


def format_queue_display_situacao(item: QueueItem) -> str:
    situacao = resolve_display_situacao(item)
    if item.get("row_kind") != "sub_os":
        return situacao
    comp = str(item.get("componente_nome") or "").strip()
    if not comp:
        return situacao
    prefix = f"[{comp}]"
    if situacao.startswith(prefix):
        return situacao
    return f"{prefix} {situacao}" if situacao else prefix


def os_belongs_to_dashboard_sector(item: QueueItem, sector: str) -> bool:
    situacao = (item.get("situacao") or "").strip()
    if situacao in FINISHED_SITUACOES:
        return False
    if sector == "Gravação":
        return situacao in GRAVACAO_SITUACOES
    item_setor = (item.get("setor") or "").strip()
    return item_setor == sector.strip()


def resolve_column_sector(col: dict[str, Any], board_sector: str) -> str:
    override = str(col.get("sector") or "").strip()
    return override or (board_sector or "").strip()


def collect_dashboard_sectors(config: DashboardConfig) -> list[str]:
    seen: set[str] = set()
    sectors: list[str] = []

    def push(raw: str) -> None:
        sector = (raw or "").strip()
        if not sector or sector in seen:
            return
        seen.add(sector)
        sectors.append(sector)

    push(str(config.get("sector") or ""))
    for col in config.get("columns") or []:
        if is_inbox_column(col):
            continue
        push(resolve_column_sector(col, str(config.get("sector") or "")))
    return sectors


def dashboard_item_key(item: QueueItem) -> str:
    if item.get("row_kind") == "sub_os" and item.get("sub_os_id") is not None:
        parent_nr = item.get("parent_nr_os") if item.get("parent_nr_os") is not None else item.get("nr_os")
        parent_ano = item.get("parent_ano") if item.get("parent_ano") is not None else item.get("ano")
        return f"{parent_nr}-{parent_ano}-sub-{item.get('sub_os_id')}"
    return f"{item.get('nr_os')}-{item.get('ano')}"


def merge_dashboard_queue_sources(
    search_items: list[QueueItem],
    pcp_items: list[QueueItem],
) -> list[QueueItem]:
    pcp_main_by_key: dict[str, QueueItem] = {}
    for item in pcp_items:
        if item.get("row_kind") == "sub_os":
            continue
        pcp_main_by_key[dashboard_item_key(item)] = item

    seen: set[str] = set()
    merged: list[QueueItem] = []
    for item in search_items:
        key = dashboard_item_key(item)
        seen.add(key)
        pcp = pcp_main_by_key.get(key)
        if pcp:
            row = dict(item)
            row["pcp_ordem"] = pcp.get("pcp_ordem") if pcp.get("pcp_ordem") is not None else item.get("pcp_ordem")
            row["pcp_ultima_atualizacao"] = (
                pcp.get("pcp_ultima_atualizacao")
                if pcp.get("pcp_ultima_atualizacao") is not None
                else item.get("pcp_ultima_atualizacao")
            )
            merged.append(row)
        else:
            merged.append(item)

    for item in pcp_items:
        key = dashboard_item_key(item)
        if key in seen:
            continue
        seen.add(key)
        merged.append(item)
    return merged


def merge_dashboard_sector_item_lists(lists: Iterable[list[QueueItem]]) -> list[QueueItem]:
    seen: set[str] = set()
    merged: list[QueueItem] = []
    for lst in lists:
        for item in lst:
            key = dashboard_item_key(item)
            if key in seen:
                continue
            seen.add(key)
            merged.append(item)
    return merged


def _resolve_pcp_order(raw: Any) -> Optional[int]:
    try:
        if raw is None or raw == "":
            return None
        value = int(raw)
    except (TypeError, ValueError):
        return None
    return value


def _protocol_group(os: DashboardOsItem) -> int:
    try:
        nr = int(os.get("nr_os"))
    except (TypeError, ValueError):
        return 1
    return 0 if nr < 5000 else 1


def _sort_weight(os: DashboardOsItem) -> int:
    prio = os.get("prioridade") or ""
    if "Prometido p/" in prio:
        return 0
    if "Solicitado p/" in prio:
        return 1
    try:
        nr = int(os.get("nr_os"))
    except (TypeError, ValueError):
        return 3
    if nr < 5000:
        return 2
    return 3


def _parse_time(value: Any) -> float:
    if not value:
        return 0.0
    text = str(value).replace("T", " ")
    try:
        from datetime import datetime

        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M:%S.%f"):
            try:
                return datetime.strptime(text[:26], fmt).timestamp()
            except ValueError:
                continue
    except Exception:
        return 0.0
    return 0.0


def sort_by_pcp(a: DashboardOsItem, b: DashboardOsItem) -> int:
    group_a = _protocol_group(a)
    group_b = _protocol_group(b)
    if group_a != group_b:
        return group_a - group_b

    ordem_a = a.get("pcp_ordem")
    ordem_b = b.get("pcp_ordem")
    has_a = isinstance(ordem_a, int)
    has_b = isinstance(ordem_b, int)
    if has_a or has_b:
        if has_a and has_b:
            return int(ordem_a) - int(ordem_b)
        return -1 if has_a else 1

    w_a = _sort_weight(a)
    w_b = _sort_weight(b)
    if w_a != w_b:
        return w_a - w_b

    d_a = _parse_time(a.get("last_update"))
    d_b = _parse_time(b.get("last_update"))
    if d_a < d_b:
        return -1
    if d_a > d_b:
        return 1
    return 0


def _sort_items_pcp(items: list[DashboardOsItem]) -> None:
    from functools import cmp_to_key

    items.sort(key=cmp_to_key(sort_by_pcp))


def find_column_id(config: DashboardConfig, item: QueueItem) -> Optional[str]:
    situacao = item.get("situacao") or ""
    board_sector = str(config.get("sector") or "")
    for col in config.get("columns") or []:
        if is_inbox_column(col):
            continue
        column_sector = resolve_column_sector(col, board_sector)
        if not os_belongs_to_dashboard_sector(item, column_sector):
            continue
        statuses = col.get("statuses") or []
        if any(matches_column_status(situacao, status) for status in statuses):
            return col.get("id")
    return None


def _inbox_item_key(os: int, ano: int) -> str:
    return f"inbox:{os}-{ano}"


def _email_time(value: Optional[str]) -> float:
    return _parse_time(value)


def _build_inbox_item(ref: dict[str, Any], source_item: Optional[DashboardOsItem]) -> DashboardOsItem:
    nr_os = int(ref["os"])
    ano = int(ref["ano"])
    last_update = ref.get("date") or (source_item.get("last_update") if source_item else None)
    if source_item:
        item = dict(source_item)
        item.update(
            {
                "nr_os": nr_os,
                "ano": ano,
                "uniqueKey": _inbox_item_key(nr_os, ano),
                "displaySituacao": INBOX_DISPLAY_SITUACAO,
                "last_update": last_update,
                "lastColumnId": None,
                "isNew": False,
                "highlightUntil": 0,
                "row_kind": "main_os",
                "sub_os_id": None,
                "componente_nome": None,
            }
        )
        return item
    return {
        "nr_os": nr_os,
        "ano": ano,
        "uniqueKey": _inbox_item_key(nr_os, ano),
        "priorityType": None,
        "isNew": False,
        "displaySituacao": INBOX_DISPLAY_SITUACAO,
        "pcp_ordem": None,
        "last_update": last_update,
        "situacao": INBOX_DISPLAY_SITUACAO,
    }


def _fill_inbox_columns(
    columns: list[DashboardColumn],
    config: DashboardConfig,
    master_ops_map: dict[str, DashboardOsItem],
    inbox_os: Optional[list[dict[str, Any]]],
) -> None:
    refs = inbox_os or []
    for i, col in enumerate(config.get("columns") or []):
        if not is_inbox_column(col):
            continue
        unique_refs: dict[str, dict[str, Any]] = {}
        for ref in refs:
            try:
                os_n = int(ref.get("os"))
                ano = int(ref.get("ano"))
            except (TypeError, ValueError):
                continue
            if os_n <= 0 or ano <= 0:
                continue
            pair_key = f"{os_n}-{ano}"
            previous = unique_refs.get(pair_key)
            if previous and _email_time(previous.get("date")) >= _email_time(ref.get("date")):
                continue
            unique_refs[pair_key] = {"os": os_n, "ano": ano, "date": ref.get("date")}
        items = [
            _build_inbox_item(ref, master_ops_map.get(f"{ref['os']}-{ref['ano']}"))
            for ref in unique_refs.values()
        ]
        items.sort(
            key=lambda item: (-_email_time(item.get("last_update")), str(item.get("uniqueKey") or ""))
        )
        columns[i]["items"] = items


def process_dashboard_data(
    raw_data: list[QueueItem],
    config: DashboardConfig,
    master_ops_map: dict[str, DashboardOsItem],
    *,
    now_ms: Optional[int] = None,
    is_initial_load: bool = False,
    inbox_os: Optional[list[dict[str, Any]]] = None,
) -> dict[str, Any]:
    import time as time_mod

    now = int(now_ms if now_ms is not None else time_mod.time() * 1000)
    incoming_ids: set[str] = set()
    has_new_items = False

    temp_columns: list[DashboardColumn] = []
    for col in config.get("columns") or []:
        row = dict(col)
        row["items"] = []
        temp_columns.append(row)

    temp_unmapped: list[DashboardOsItem] = []
    hidden = 0

    for os in raw_data:
        unique_key = dashboard_item_key(os)
        incoming_ids.add(unique_key)
        current_column_id = find_column_id(config, os)

        if unique_key in master_ops_map:
            item = master_ops_map[unique_key]
            _patch_dashboard_os_item(item, os)
            item["isNew"] = (item.get("highlightUntil") or 0) > now
        else:
            item = dict(os)
            item.update(
                {
                    "uniqueKey": unique_key,
                    "priorityType": resolve_priority_type(os.get("prioridade")),
                    "isNew": False,
                    "pcp_ordem": _resolve_pcp_order(os.get("pcp_ordem")),
                    "displaySituacao": format_queue_display_situacao(os),
                    "lastColumnId": None,
                    "highlightUntil": 0,
                }
            )
            if not is_initial_load:
                item["isNew"] = True
                item["highlightUntil"] = now + DASHBOARD_NEW_HIGHLIGHT_MS
                has_new_items = True
            master_ops_map[unique_key] = item

        if (
            not is_initial_load
            and current_column_id
            and item.get("lastColumnId")
            and item.get("lastColumnId") != current_column_id
        ):
            item["isNew"] = True
            item["highlightUntil"] = now + DASHBOARD_NEW_HIGHLIGHT_MS
            has_new_items = True

        item["lastColumnId"] = current_column_id

        col_index = next(
            (i for i, col in enumerate(config.get("columns") or []) if col.get("id") == current_column_id),
            -1,
        )
        if col_index != -1:
            temp_columns[col_index]["items"].append(item)
        else:
            hidden += 1
            temp_unmapped.append(item)

    for key in list(master_ops_map.keys()):
        if key not in incoming_ids:
            del master_ops_map[key]

    _fill_inbox_columns(temp_columns, config, master_ops_map, inbox_os)

    for col in temp_columns:
        if is_inbox_column(col):
            continue
        _sort_items_pcp(col["items"])
    _sort_items_pcp(temp_unmapped)

    return {
        "columns": temp_columns,
        "unmappedItems": temp_unmapped,
        "hiddenCount": hidden,
        "hasNewItems": has_new_items,
    }


def _patch_dashboard_os_item(item: DashboardOsItem, os: QueueItem) -> None:
    item["situacao"] = os.get("situacao")
    item["setor"] = os.get("setor")
    item["titulo"] = os.get("titulo")
    item["produto"] = os.get("produto")
    item["prioridade"] = os.get("prioridade")
    item["last_update"] = os.get("last_update")
    item["andamento_usuario"] = os.get("andamento_usuario")
    item["observacao"] = os.get("observacao")
    item["data_entrega"] = os.get("data_entrega")
    item["entreg_periodo"] = os.get("entreg_periodo")
    item["pcp_ordem"] = _resolve_pcp_order(os.get("pcp_ordem"))
    item["pcp_ultima_atualizacao"] = os.get("pcp_ultima_atualizacao")
    item["priorityType"] = resolve_priority_type(os.get("prioridade"))
    item["displaySituacao"] = format_queue_display_situacao(os)
    item["row_kind"] = os.get("row_kind")
    item["sub_os_id"] = os.get("sub_os_id")
    item["componente_nome"] = os.get("componente_nome")
    item["parent_nr_os"] = os.get("parent_nr_os")
    item["parent_ano"] = os.get("parent_ano")
    item["fornecedor_ponto"] = os.get("fornecedor_ponto")
    item["fornecedor_nome"] = os.get("fornecedor_nome")
    item["fornecedores"] = os.get("fornecedores")


def get_visible_dashboard_columns(columns: list[DashboardColumn]) -> list[DashboardColumn]:
    return [col for col in columns if not col.get("hideWhenEmpty") or col.get("items")]


def flatten_ticker_cards(columns: list[DashboardColumn]) -> list[dict[str, Any]]:
    cards: list[dict[str, Any]] = []
    for orig_idx, col in enumerate(columns):
        items = col.get("items") or []
        if col.get("hideWhenEmpty") and not items:
            continue
        for item in items:
            cards.append(
                {
                    "unique_key": item.get("uniqueKey") or dashboard_item_key(item),
                    "label": format_queue_display_label(item),
                    "situacao": item.get("displaySituacao") or "",
                    "priority": item.get("priorityType"),
                    "is_new": bool(item.get("isNew")),
                    "is_sub_os": item.get("row_kind") == "sub_os",
                    "column_index": orig_idx,
                    "column_title": col.get("title") or "",
                }
            )
    return cards
