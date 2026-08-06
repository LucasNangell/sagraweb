"""
Credenciais DEPOL — pedidos pré-OS, vínculo, execução via fila Papelaria.
"""
from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Optional

from config_manager import config_manager
from credenciais_depol_schema import (
    ensure_credenciais_depol_schema,
    reset_credenciais_depol_schema_cache,
)
from database import db

logger = logging.getLogger(__name__)

STATUS_ABERTO = "aberto"
STATUS_VINCULADO = "vinculado"
STATUS_EM_EXECUCAO = "em_execucao"
STATUS_CONCLUIDO = "concluido"
STATUS_CANCELADO = "cancelado"
STATUS_FALHA = "falha"

PRODUTO_CREDENCIAIS_DEPOL = "Credenciais DEPOL"
TIPO_JOB_CREDENCIAIS_DEPOL = "credenciais_depol"

PAGE_W_MM = 85
PAGE_H_MM = 120

_UNSAFE_FILENAME = re.compile(r'[\\/*?:"<>|]|\.\.')
_JPG_EXTS = {".jpg", ".jpeg", ".JPG", ".JPEG"}
_ALLOWED_SVGS = frozenset({"TXT01.svg", "TXT02.svg", "TXT03.svg"})

DEFAULT_LAYOUT: dict[str, Any] = {
    "page_w_mm": PAGE_W_MM,
    "page_h_mm": PAGE_H_MM,
    # x_mm/y_mm = centro único do bloco SVG (igual para TXT01/02/03)
    "svgs": {
        "1": {"x_mm": 42.5, "y_mm": 101.0, "w_mm": 75.0, "h_mm": 22.0},
        "2": {"x_mm": 42.5, "y_mm": 101.0, "w_mm": 75.0, "h_mm": 28.0},
        "3": {"x_mm": 42.5, "y_mm": 101.0, "w_mm": 75.0, "h_mm": 35.0},
    },
}


def _paths_config() -> dict[str, str]:
    cfg = config_manager.get("credenciais_depol") or {}
    if not isinstance(cfg, dict):
        cfg = {}
    jpg = str(
        cfg.get("jpg_dir")
        or r"\\redecamara\DfsData\CGraf\Sefoc\Deputados\_Temp\2025\Credenciais Depol\JPG"
    ).strip()
    svg = str(
        cfg.get("svg_dir")
        or r"\\redecamara\DfsData\CGraf\Sefoc\Deputados\_Temp\2025\Credenciais Depol"
    ).strip()
    return {"jpg_dir": jpg, "svg_dir": svg}


DEFAULT_AUTO_OS_SETTINGS: dict[str, Any] = {
    "auto_criar_os": False,
    "os_template_nro": 20,
    "os_template_ano": 2026,
}


def get_auto_os_settings() -> dict[str, Any]:
    cfg = config_manager.get("credenciais_depol") or {}
    if not isinstance(cfg, dict):
        cfg = {}
    nro = cfg.get("os_template_nro", DEFAULT_AUTO_OS_SETTINGS["os_template_nro"])
    ano = cfg.get("os_template_ano", DEFAULT_AUTO_OS_SETTINGS["os_template_ano"])
    try:
        nro_i = int(nro)
    except (TypeError, ValueError):
        nro_i = int(DEFAULT_AUTO_OS_SETTINGS["os_template_nro"])
    try:
        ano_i = int(ano)
    except (TypeError, ValueError):
        ano_i = int(DEFAULT_AUTO_OS_SETTINGS["os_template_ano"])
    return {
        "auto_criar_os": bool(cfg.get("auto_criar_os", False)),
        "os_template_nro": nro_i,
        "os_template_ano": ano_i,
        "jpg_dir": _paths_config()["jpg_dir"],
        "svg_dir": _paths_config()["svg_dir"],
    }


def update_auto_os_settings(
    *,
    auto_criar_os: Optional[bool] = None,
    os_template_nro: Optional[int] = None,
    os_template_ano: Optional[int] = None,
) -> dict[str, Any]:
    cfg = config_manager.get("credenciais_depol")
    if not isinstance(cfg, dict):
        cfg = {}
    else:
        cfg = dict(cfg)
    if auto_criar_os is not None:
        cfg["auto_criar_os"] = bool(auto_criar_os)
    if os_template_nro is not None:
        n = int(os_template_nro)
        if n < 1:
            raise ValueError("os_template_nro inválido.")
        cfg["os_template_nro"] = n
    if os_template_ano is not None:
        a = int(os_template_ano)
        if a < 2000 or a > 2100:
            raise ValueError("os_template_ano inválido.")
        cfg["os_template_ano"] = a
    config_manager.set("credenciais_depol", cfg)
    config_manager.save_config()
    return get_auto_os_settings()


def _safe_basename(name: str) -> str:
    raw = (name or "").strip()
    if not raw:
        raise ValueError("Nome de arquivo inválido.")
    if "/" in raw or "\\" in raw or _UNSAFE_FILENAME.search(raw):
        raise ValueError(f"Nome de arquivo inválido: {name!r}")
    base = os.path.basename(raw)
    if not base or base in (".", "..") or base != raw:
        raise ValueError(f"Nome de arquivo inválido: {name!r}")
    return base


def _normalize_linhas(linha1: str, linha2: Optional[str], linha3: Optional[str]) -> list[str]:
    l1 = (linha1 or "").strip()
    l2 = (linha2 or "").strip()
    l3 = (linha3 or "").strip()
    if not l1:
        raise ValueError("Linha 1 é obrigatória.")
    if l3 and not l2:
        raise ValueError("Informe a Linha 2 antes da Linha 3.")
    linhas = [l1]
    if l2:
        linhas.append(l2)
    if l3:
        linhas.append(l3)
    for i, ln in enumerate(linhas, start=1):
        if len(ln) > 255:
            raise ValueError(f"Linha {i} excede 255 caracteres.")
    return linhas


def _count_linhas(item: dict[str, Any]) -> int:
    n = 0
    for key in ("linha1", "linha2", "linha3"):
        if str(item.get(key) or "").strip():
            n += 1
        else:
            break
    return n


def svg_filename_for_linhas(n: int) -> str:
    if n < 1 or n > 3:
        raise ValueError("Quantidade de linhas deve ser entre 1 e 3.")
    return f"TXT0{n}.svg"


def resolve_modelo_jpg_path(modelo_arquivo: str) -> str:
    base = _safe_basename(modelo_arquivo)
    jpg_dir = _paths_config()["jpg_dir"]
    full = os.path.normpath(os.path.join(jpg_dir, base))
    real_file = os.path.realpath(full)
    real_base = os.path.realpath(jpg_dir)
    if not real_base.endswith(os.sep):
        real_base = real_base + os.sep
    if not real_file.startswith(real_base) and real_file != os.path.realpath(jpg_dir):
        raise ValueError("Caminho de modelo fora da pasta permitida.")
    if not os.path.isfile(full):
        raise FileNotFoundError(f"Modelo JPG não encontrado: {base}")
    ext = os.path.splitext(base)[1]
    if ext not in _JPG_EXTS and ext.lower() not in {".jpg", ".jpeg"}:
        raise ValueError("Modelo deve ser arquivo JPG.")
    return full


def resolve_svg_path(nome: str) -> str:
    base = _safe_basename(nome)
    if base not in _ALLOWED_SVGS:
        raise ValueError(f"SVG não permitido: {base}")
    svg_dir = _paths_config()["svg_dir"]
    full = os.path.normpath(os.path.join(svg_dir, base))
    real_file = os.path.realpath(full)
    real_base = os.path.realpath(svg_dir)
    if not real_base.endswith(os.sep):
        real_base = real_base + os.sep
    if not real_file.startswith(real_base) and real_file != os.path.realpath(svg_dir):
        raise ValueError("Caminho de SVG fora da pasta permitida.")
    if not os.path.isfile(full):
        raise FileNotFoundError(f"SVG não encontrado: {base}")
    return full


def _sync_shared_svg_position(
    layout: dict[str, Any], *, preferred_key: Optional[str] = None
) -> dict[str, Any]:
    """Posição X/Y é única para TXT01/02/03."""
    svgs = layout.get("svgs") if isinstance(layout.get("svgs"), dict) else {}
    order = []
    if preferred_key in ("1", "2", "3"):
        order.append(preferred_key)
    order.extend(k for k in ("1", "2", "3") if k != preferred_key)

    source = None
    for key in order:
        box = svgs.get(key)
        if isinstance(box, dict) and "x_mm" in box and "y_mm" in box:
            source = box
            break
    if source is None:
        return layout
    x = float(source["x_mm"])
    y = float(source["y_mm"])
    for key in ("1", "2", "3"):
        box = svgs.get(key)
        if not isinstance(box, dict):
            continue
        box["x_mm"] = x
        box["y_mm"] = y
    return layout


def _parse_layout(raw: Any) -> dict[str, Any]:
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            return json.loads(json.dumps(DEFAULT_LAYOUT))
    if not isinstance(raw, dict):
        return json.loads(json.dumps(DEFAULT_LAYOUT))
    out = json.loads(json.dumps(DEFAULT_LAYOUT))
    try:
        out["page_w_mm"] = float(raw.get("page_w_mm") or PAGE_W_MM)
        out["page_h_mm"] = float(raw.get("page_h_mm") or PAGE_H_MM)
    except (TypeError, ValueError):
        pass
    svgs_in = raw.get("svgs") if isinstance(raw.get("svgs"), dict) else {}
    preferred_key: Optional[str] = None
    for key in ("1", "2", "3"):
        box = svgs_in.get(key) if isinstance(svgs_in.get(key), dict) else {}
        base_box = out["svgs"][key]
        try:
            out["svgs"][key] = {
                "x_mm": float(box.get("x_mm", base_box["x_mm"])),
                "y_mm": float(box.get("y_mm", base_box["y_mm"])),
                "w_mm": float(box.get("w_mm", base_box["w_mm"])),
                "h_mm": float(box.get("h_mm", base_box["h_mm"])),
            }
        except (TypeError, ValueError):
            pass
        if preferred_key is None and isinstance(svgs_in.get(key), dict):
            preferred_key = key
    return _sync_shared_svg_position(out, preferred_key=preferred_key)


def _normalize_layout_payload(layout: Any) -> dict[str, Any]:
    parsed = _sync_shared_svg_position(_parse_layout(layout))
    for key, box in parsed["svgs"].items():
        # Apenas posição (centro); tamanho do SVG vem do arquivo.
        if not isinstance(box.get("x_mm"), (int, float)) or not isinstance(
            box.get("y_mm"), (int, float)
        ):
            raise ValueError(f"Layout SVG {key}: informe centro X/Y em mm.")
    return parsed


def _modelo_dict(row: dict) -> dict[str, Any]:
    arquivo = str(row["ArquivoJpg"])
    return {
        "id": int(row["ID"]),
        "arquivo_jpg": arquivo,
        "nome": arquivo,
        "nome_exibicao": (str(row["NomeExibicao"]).strip() if row.get("NomeExibicao") else arquivo),
        "ativo": bool(row.get("Ativo", 1)),
        "ordem": int(row.get("Ordem") or 0),
        "layout": _parse_layout(row.get("LayoutJson")),
        "thumb_url": f"/api/credenciais-depol/modelos/{arquivo}/thumb",
        "atualizado_em": row.get("AtualizadoEm"),
    }


def list_modelos_admin(*, only_ativos: bool = False) -> list[dict[str, Any]]:
    try:
        ensure_credenciais_depol_schema()
    except RuntimeError:
        reset_credenciais_depol_schema_cache()
        ensure_credenciais_depol_schema()

    if only_ativos:
        rows = db.execute_query(
            """
            SELECT * FROM tabCredenciaisDepolModelos
            WHERE Ativo = 1
            ORDER BY Ordem ASC, ArquivoJpg ASC
            """
        )
    else:
        rows = db.execute_query(
            """
            SELECT * FROM tabCredenciaisDepolModelos
            ORDER BY Ordem ASC, ArquivoJpg ASC
            """
        )
    return [_modelo_dict(r) for r in (rows or [])]


def get_modelo_by_id(modelo_id: int) -> Optional[dict[str, Any]]:
    ensure_credenciais_depol_schema()
    rows = db.execute_query(
        "SELECT * FROM tabCredenciaisDepolModelos WHERE ID = %(id)s LIMIT 1",
        {"id": int(modelo_id)},
    )
    if not rows:
        return None
    return _modelo_dict(rows[0])


def get_modelo_by_arquivo(arquivo: str) -> Optional[dict[str, Any]]:
    ensure_credenciais_depol_schema()
    base = _safe_basename(arquivo)
    rows = db.execute_query(
        "SELECT * FROM tabCredenciaisDepolModelos WHERE ArquivoJpg = %(a)s LIMIT 1",
        {"a": base},
    )
    if not rows:
        return None
    return _modelo_dict(rows[0])


def list_modelos() -> list[dict[str, Any]]:
    """Modelos ativos para a aba Pedido (com layout)."""
    return list_modelos_admin(only_ativos=True)


def sync_modelos_from_folder() -> dict[str, Any]:
    """Upsert JPGs da pasta configurada; não remove registros existentes."""
    ensure_credenciais_depol_schema()
    jpg_dir = _paths_config()["jpg_dir"]
    if not os.path.isdir(jpg_dir):
        raise FileNotFoundError(f"Pasta de modelos indisponível: {jpg_dir}")

    found: list[str] = []
    for name in sorted(os.listdir(jpg_dir)):
        path = os.path.join(jpg_dir, name)
        if not os.path.isfile(path):
            continue
        if os.path.splitext(name)[1].lower() not in {".jpg", ".jpeg"}:
            continue
        found.append(name)

    inserted = 0
    skipped = 0
    default_json = json.dumps(DEFAULT_LAYOUT, ensure_ascii=False)

    for name in found:
        existing = db.execute_query(
            "SELECT ID FROM tabCredenciaisDepolModelos WHERE ArquivoJpg = %(a)s LIMIT 1",
            {"a": name},
        )
        if existing:
            skipped += 1
            continue
        db.execute_query(
            """
            INSERT INTO tabCredenciaisDepolModelos (
                ArquivoJpg, NomeExibicao, Ativo, Ordem, LayoutJson
            ) VALUES (%(a)s, %(nome)s, 1, %(ord)s, %(layout)s)
            """,
            {
                "a": name,
                "nome": os.path.splitext(name)[0],
                "ord": inserted + skipped,
                "layout": default_json,
            },
        )
        inserted += 1

    return {
        "encontrados": len(found),
        "inseridos": inserted,
        "ja_existentes": skipped,
        "modelos": list_modelos_admin(),
    }


def update_modelo(
    modelo_id: int,
    *,
    nome_exibicao: Optional[str] = None,
    ativo: Optional[bool] = None,
    ordem: Optional[int] = None,
    layout: Any = None,
) -> dict[str, Any]:
    ensure_credenciais_depol_schema()
    current = get_modelo_by_id(modelo_id)
    if not current:
        raise LookupError("Modelo não encontrado.")

    sets: list[str] = []
    params: dict[str, Any] = {"id": int(modelo_id)}

    if nome_exibicao is not None:
        sets.append("NomeExibicao = %(nome)s")
        params["nome"] = (nome_exibicao or "").strip()[:200] or None
    if ativo is not None:
        sets.append("Ativo = %(ativo)s")
        params["ativo"] = 1 if ativo else 0
    if ordem is not None:
        sets.append("Ordem = %(ordem)s")
        params["ordem"] = int(ordem)
    if layout is not None:
        normalized = _normalize_layout_payload(layout)
        sets.append("LayoutJson = %(layout)s")
        params["layout"] = json.dumps(normalized, ensure_ascii=False)

    if not sets:
        return current

    db.execute_query(
        f"""
        UPDATE tabCredenciaisDepolModelos
        SET {", ".join(sets)}, AtualizadoEm = NOW()
        WHERE ID = %(id)s
        """,
        params,
    )
    updated = get_modelo_by_id(modelo_id)
    assert updated
    return updated


def resolve_thumb_path(nome: str) -> str:
    return resolve_modelo_jpg_path(nome)


def _itens_from_rows(rows: list[dict]) -> list[dict[str, Any]]:
    itens: list[dict[str, Any]] = []
    for r in rows:
        itens.append(
            {
                "id": int(r["ID"]),
                "pedido_id": int(r["PedidoID"]),
                "ordem": int(r["Ordem"]),
                "modelo_arquivo": str(r["ModeloArquivo"]),
                "linha1": str(r["Linha1"] or ""),
                "linha2": (str(r["Linha2"]) if r.get("Linha2") else None),
                "linha3": (str(r["Linha3"]) if r.get("Linha3") else None),
                "num_linhas": _count_linhas(
                    {
                        "linha1": r.get("Linha1"),
                        "linha2": r.get("Linha2"),
                        "linha3": r.get("Linha3"),
                    }
                ),
            }
        )
    return itens


def _get_itens(pedido_id: int) -> list[dict[str, Any]]:
    rows = db.execute_query(
        """
        SELECT * FROM tabCredenciaisDepolItens
        WHERE PedidoID = %(id)s
        ORDER BY Ordem ASC, ID ASC
        """,
        {"id": pedido_id},
    )
    return _itens_from_rows(rows or [])


def _pedido_dict(row: dict, *, with_itens: bool = True) -> dict[str, Any]:
    pid = int(row["ID"])
    out: dict[str, Any] = {
        "id": pid,
        "titulo": row.get("Titulo"),
        "observacao": row.get("Observacao"),
        "status": str(row.get("Status") or STATUS_ABERTO),
        "criado_por": str(row.get("CriadoPor") or ""),
        "criado_em": row.get("CriadoEm"),
        "ano_protocolo": row.get("AnoProtocolo"),
        "nro_protocolo": row.get("NroProtocolo"),
        "vinculado_por": row.get("VinculadoPor"),
        "vinculado_em": row.get("VinculadoEm"),
        "job_id": row.get("JobID"),
    }
    if with_itens:
        out["itens"] = _get_itens(pid)
    return out


def get_pedido(pedido_id: int) -> Optional[dict[str, Any]]:
    ensure_credenciais_depol_schema()
    rows = db.execute_query(
        "SELECT * FROM tabCredenciaisDepolPedidos WHERE ID = %(id)s LIMIT 1",
        {"id": pedido_id},
    )
    if not rows:
        return None
    return _pedido_dict(rows[0])


def list_pedidos(
    *,
    status: Optional[str] = None,
    ano: Optional[int] = None,
    nro: Optional[int] = None,
    abertos: bool = False,
) -> list[dict[str, Any]]:
    ensure_credenciais_depol_schema()
    clauses: list[str] = []
    params: dict[str, Any] = {}
    if abertos:
        clauses.append("Status = %(aberto)s")
        params["aberto"] = STATUS_ABERTO
    elif status:
        clauses.append("Status = %(status)s")
        params["status"] = status.strip()
    if ano is not None and nro is not None:
        clauses.append("AnoProtocolo = %(ano)s AND NroProtocolo = %(nro)s")
        params["ano"] = int(ano)
        params["nro"] = int(nro)
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    rows = db.execute_query(
        f"""
        SELECT * FROM tabCredenciaisDepolPedidos
        {where}
        ORDER BY CriadoEm DESC, ID DESC
        LIMIT 200
        """,
        params,
    )
    return [_pedido_dict(r) for r in (rows or [])]


def _validate_itens_payload(itens: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not itens:
        raise ValueError("Informe ao menos uma credencial no pedido.")
    if len(itens) > 100:
        raise ValueError("Máximo de 100 credenciais por pedido.")
    clean: list[dict[str, Any]] = []
    for i, raw in enumerate(itens, start=1):
        modelo = _safe_basename(str(raw.get("modelo_arquivo") or ""))
        resolve_modelo_jpg_path(modelo)
        modelo_db = get_modelo_by_arquivo(modelo)
        if not modelo_db or not modelo_db.get("ativo"):
            raise ValueError(
                f"Modelo '{modelo}' não está ativo ou não foi cadastrado. "
                "Sincronize em Configurações → Credenciais DEPOL."
            )
        linhas = _normalize_linhas(
            str(raw.get("linha1") or ""),
            raw.get("linha2"),
            raw.get("linha3"),
        )
        item = {
            "ordem": int(raw.get("ordem") or i),
            "modelo_arquivo": modelo,
            "linha1": linhas[0],
            "linha2": linhas[1] if len(linhas) > 1 else None,
            "linha3": linhas[2] if len(linhas) > 2 else None,
        }
        clean.append(item)
    return clean


def create_pedido(
    *,
    criado_por: str,
    itens: list[dict[str, Any]],
    titulo: Optional[str] = None,
    observacao: Optional[str] = None,
) -> dict[str, Any]:
    ensure_credenciais_depol_schema()
    ponto = (criado_por or "").strip() or "0"
    clean_itens = _validate_itens_payload(itens)
    titulo_s = (titulo or "").strip()[:200] or None
    obs_s = (observacao or "").strip() or None

    def _insert(cursor) -> int:
        cursor.execute(
            """
            INSERT INTO tabCredenciaisDepolPedidos (
                Titulo, Observacao, Status, CriadoPor
            ) VALUES (%s, %s, %s, %s)
            """,
            (titulo_s, obs_s, STATUS_ABERTO, ponto),
        )
        pedido_id = int(cursor.lastrowid)
        for item in clean_itens:
            cursor.execute(
                """
                INSERT INTO tabCredenciaisDepolItens (
                    PedidoID, Ordem, ModeloArquivo, Linha1, Linha2, Linha3
                ) VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (
                    pedido_id,
                    item["ordem"],
                    item["modelo_arquivo"],
                    item["linha1"],
                    item["linha2"],
                    item["linha3"],
                ),
            )
        return pedido_id

    pedido_id = int(db.execute_transaction([_insert])[0])
    settings = get_auto_os_settings()

    if settings["auto_criar_os"]:
        try:
            _auto_criar_e_vincular_os(pedido_id, clean_itens, ponto, settings)
        except Exception:
            # Compensa: remove pedido órfão se a OS falhou
            try:
                db.execute_query(
                    "DELETE FROM tabCredenciaisDepolPedidos WHERE ID = %(id)s",
                    {"id": pedido_id},
                )
            except Exception:
                logger.exception(
                    "Falha ao compensar pedido DEPOL %s após erro na OS", pedido_id
                )
            raise

    pedido = get_pedido(pedido_id)
    if not pedido:
        raise RuntimeError("Falha ao recuperar pedido criado.")
    return pedido


def _auto_criar_e_vincular_os(
    pedido_id: int,
    clean_itens: list[dict[str, Any]],
    ponto: str,
    settings: dict[str, Any],
) -> None:
    from datetime import date, timedelta

    from services.os_duplicate_service import duplicate_os

    tmpl_nro = int(settings["os_template_nro"])
    tmpl_ano = int(settings["os_template_ano"])
    n = len(clean_itens)
    entreg = date.today() + timedelta(days=1)

    dup = duplicate_os(
        source_nro=tmpl_nro,
        source_ano=tmpl_ano,
        usuario=ponto,
        setor_andamento="SEORG",
        obs_andamento=f"{n} Credenciais DEPOL",
        modelos_arq=str(n),
        entreg_data=entreg,
    )

    try:
        from routers.mdb_writer import sync_os_from_mysql_to_mdb

        sync_os_from_mysql_to_mdb(
            dup.new_id,
            dup.new_year,
            sync_andamentos=True,
            cod_statuses=[dup.cod_status],
        )
    except Exception:
        logger.exception(
            "Sync MDB da OS DEPOL %s/%s falhou (pedido %s)",
            dup.new_id,
            dup.new_year,
            pedido_id,
        )

    vincular_pedido(pedido_id, dup.new_year, dup.new_id, ponto)


def update_pedido(
    pedido_id: int,
    *,
    titulo: Optional[str] = None,
    observacao: Optional[str] = None,
    itens: Optional[list[dict[str, Any]]] = None,
) -> dict[str, Any]:
    ensure_credenciais_depol_schema()
    pedido = get_pedido(pedido_id)
    if not pedido:
        raise LookupError("Pedido não encontrado.")
    if pedido["status"] != STATUS_ABERTO:
        raise ValueError("Só é possível editar pedidos com status aberto.")

    titulo_s = titulo if titulo is None else ((titulo or "").strip()[:200] or None)
    obs_s = observacao if observacao is None else ((observacao or "").strip() or None)
    clean_itens = _validate_itens_payload(itens) if itens is not None else None

    def _upd(cursor) -> None:
        if titulo is not None or observacao is not None:
            sets: list[str] = []
            params: list[Any] = []
            if titulo is not None:
                sets.append("Titulo = %s")
                params.append(titulo_s)
            if observacao is not None:
                sets.append("Observacao = %s")
                params.append(obs_s)
            params.append(pedido_id)
            cursor.execute(
                f"UPDATE tabCredenciaisDepolPedidos SET {', '.join(sets)} WHERE ID = %s",
                params,
            )
        if clean_itens is not None:
            cursor.execute(
                "DELETE FROM tabCredenciaisDepolItens WHERE PedidoID = %s",
                (pedido_id,),
            )
            for item in clean_itens:
                cursor.execute(
                    """
                    INSERT INTO tabCredenciaisDepolItens (
                        PedidoID, Ordem, ModeloArquivo, Linha1, Linha2, Linha3
                    ) VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    (
                        pedido_id,
                        item["ordem"],
                        item["modelo_arquivo"],
                        item["linha1"],
                        item["linha2"],
                        item["linha3"],
                    ),
                )

    db.execute_transaction([_upd])
    updated = get_pedido(pedido_id)
    if not updated:
        raise RuntimeError("Pedido sumiu após atualização.")
    return updated


def cancelar_pedido(pedido_id: int) -> dict[str, Any]:
    ensure_credenciais_depol_schema()
    pedido = get_pedido(pedido_id)
    if not pedido:
        raise LookupError("Pedido não encontrado.")
    if pedido["status"] in (STATUS_EM_EXECUCAO, STATUS_CONCLUIDO):
        raise ValueError("Não é possível cancelar pedido em execução ou concluído.")
    if pedido["status"] == STATUS_CANCELADO:
        return pedido
    db.execute_query(
        """
        UPDATE tabCredenciaisDepolPedidos
        SET Status = %(st)s, AnoProtocolo = NULL, NroProtocolo = NULL,
            VinculadoPor = NULL, VinculadoEm = NULL, JobID = NULL
        WHERE ID = %(id)s
        """,
        {"st": STATUS_CANCELADO, "id": pedido_id},
    )
    updated = get_pedido(pedido_id)
    assert updated
    return updated


def _validate_os_exists(ano: int, nro: int) -> None:
    rows = db.execute_query(
        """
        SELECT NroProtocolo FROM tabProtocolos
        WHERE AnoProtocolo = %(ano)s AND NroProtocolo = %(nro)s
        LIMIT 1
        """,
        {"ano": int(ano), "nro": int(nro)},
    )
    if not rows:
        raise LookupError(f"OS {nro}/{ano} não encontrada.")


def vincular_pedido(pedido_id: int, ano: int, nro: int, vinculado_por: str) -> dict[str, Any]:
    ensure_credenciais_depol_schema()
    pedido = get_pedido(pedido_id)
    if not pedido:
        raise LookupError("Pedido não encontrado.")
    if pedido["status"] != STATUS_ABERTO:
        raise ValueError("Só é possível vincular pedidos abertos.")
    _validate_os_exists(ano, nro)
    ponto = (vinculado_por or "").strip() or "0"
    db.execute_query(
        """
        UPDATE tabCredenciaisDepolPedidos
        SET Status = %(st)s,
            AnoProtocolo = %(ano)s,
            NroProtocolo = %(nro)s,
            VinculadoPor = %(ponto)s,
            VinculadoEm = NOW()
        WHERE ID = %(id)s AND Status = %(aberto)s
        """,
        {
            "st": STATUS_VINCULADO,
            "ano": int(ano),
            "nro": int(nro),
            "ponto": ponto,
            "id": pedido_id,
            "aberto": STATUS_ABERTO,
        },
    )
    updated = get_pedido(pedido_id)
    if not updated or updated["status"] != STATUS_VINCULADO:
        raise ValueError("Pedido não pôde ser vinculado (status alterado).")
    return updated


def desvincular_pedido(pedido_id: int) -> dict[str, Any]:
    ensure_credenciais_depol_schema()
    pedido = get_pedido(pedido_id)
    if not pedido:
        raise LookupError("Pedido não encontrado.")
    if pedido["status"] != STATUS_VINCULADO:
        raise ValueError("Só é possível desvincular pedidos com status vinculado.")
    if pedido.get("job_id"):
        raise ValueError("Pedido já possui job associado.")
    db.execute_query(
        """
        UPDATE tabCredenciaisDepolPedidos
        SET Status = %(st)s,
            AnoProtocolo = NULL,
            NroProtocolo = NULL,
            VinculadoPor = NULL,
            VinculadoEm = NULL
        WHERE ID = %(id)s AND Status = %(vinculado)s
        """,
        {
            "st": STATUS_ABERTO,
            "id": pedido_id,
            "vinculado": STATUS_VINCULADO,
        },
    )
    updated = get_pedido(pedido_id)
    assert updated
    return updated


def build_job_dados(pedido: dict[str, Any]) -> dict[str, Any]:
    """Compat: um pedido → payload de job (internamente usa batch)."""
    return build_job_dados_from_pedidos([pedido])


def build_job_dados_from_pedidos(pedidos: list[dict[str, Any]]) -> dict[str, Any]:
    """
    Monta payload do worker com itens de vários pedidos (mesma OS).

    Ordem estável: pedido.id ASC, depois ordem do item.
    Cada item leva pedido_id; o JSON raiz tem pedido_ids e pedido_id (primeiro).
    """
    if not pedidos:
        raise ValueError("Nenhum pedido para montar o job.")
    paths = _paths_config()
    itens_payload: list[dict[str, Any]] = []
    pedido_ids: list[int] = []
    ordered = sorted(pedidos, key=lambda p: int(p["id"]))
    for pedido in ordered:
        pid = int(pedido["id"])
        pedido_ids.append(pid)
        items = list(pedido.get("itens") or [])
        items.sort(key=lambda it: int(it.get("ordem") or 0))
        for item in items:
            n = _count_linhas(item)
            modelo_row = get_modelo_by_arquivo(item["modelo_arquivo"])
            layout = _parse_layout(
                modelo_row["layout"] if modelo_row else None
            )
            svg_box = (layout.get("svgs") or {}).get(str(n)) or DEFAULT_LAYOUT["svgs"][
                str(n)
            ]
            itens_payload.append(
                {
                    "pedido_id": pid,
                    "ordem": item["ordem"],
                    "modelo_arquivo": item["modelo_arquivo"],
                    "linha1": item.get("linha1") or "",
                    "linha2": item.get("linha2") or "",
                    "linha3": item.get("linha3") or "",
                    "num_linhas": n,
                    "svg_arquivo": svg_filename_for_linhas(n),
                    "svg_layout": {
                        "x_mm": float(svg_box["x_mm"]),
                        "y_mm": float(svg_box["y_mm"]),
                    },
                    "page_w_mm": float(layout.get("page_w_mm") or PAGE_W_MM),
                    "page_h_mm": float(layout.get("page_h_mm") or PAGE_H_MM),
                }
            )
    if not itens_payload:
        raise ValueError("Pedidos sem itens para gerar.")
    return {
        "pedido_id": pedido_ids[0],
        "pedido_ids": pedido_ids,
        "itens": itens_payload,
        "jpg_dir": paths["jpg_dir"],
        "svg_dir": paths["svg_dir"],
        "page_w_mm": PAGE_W_MM,
        "page_h_mm": PAGE_H_MM,
    }


def _validate_assets_for_exec(pedido: dict[str, Any]) -> None:
    paths = _paths_config()
    svg_dir = paths["svg_dir"]
    for item in pedido.get("itens") or []:
        resolve_modelo_jpg_path(item["modelo_arquivo"])
        n = _count_linhas(item)
        svg_name = svg_filename_for_linhas(n)
        svg_path = os.path.normpath(os.path.join(svg_dir, svg_name))
        if not os.path.isfile(svg_path):
            raise FileNotFoundError(f"SVG não encontrado: {svg_name}")


def list_pedidos_elegiveis_execucao(ano: int, nro: int) -> list[dict[str, Any]]:
    """Pedidos da OS em vinculado ou falha (prontos para (re)gerar)."""
    pedidos = list_pedidos(ano=int(ano), nro=int(nro))
    elegiveis = [
        p
        for p in pedidos
        if p["status"] in (STATUS_VINCULADO, STATUS_FALHA)
    ]
    return sorted(elegiveis, key=lambda p: int(p["id"]))


def executar_os(ano: int, nro: int, solicitado_por: str) -> dict[str, Any]:
    """
    Enfileira UM job Corel com todos os pedidos elegíveis da OS
    (vinculado + falha) → um CDR multipágina e uma prova.
    """
    ensure_credenciais_depol_schema()
    from services import papelaria_jobs_service as jobs_svc

    ano_i, nro_i = int(ano), int(nro)
    _validate_os_exists(ano_i, nro_i)

    da_os = list_pedidos(ano=ano_i, nro=nro_i)
    if any(p["status"] == STATUS_EM_EXECUCAO for p in da_os):
        raise ValueError("Já existe execução em andamento para esta OS.")

    elegiveis = list_pedidos_elegiveis_execucao(ano_i, nro_i)
    if not elegiveis:
        raise ValueError(
            "Nenhum pedido vinculado (ou com falha) para executar nesta OS."
        )
    for pedido in elegiveis:
        if not pedido.get("itens"):
            raise ValueError(f"Pedido #{pedido['id']} sem itens.")
        _validate_assets_for_exec(pedido)

    dados = build_job_dados_from_pedidos(elegiveis)
    job = jobs_svc.create_credenciais_depol_job(
        ano=ano_i,
        nro=nro_i,
        dados=dados,
        solicitado_por=(solicitado_por or "").strip() or "0",
    )
    job_id = int(job["id"])
    for pedido in elegiveis:
        db.execute_query(
            """
            UPDATE tabCredenciaisDepolPedidos
            SET Status = %(st)s, JobID = %(job_id)s
            WHERE ID = %(id)s AND Status IN (%(vinculado)s, %(falha)s)
            """,
            {
                "st": STATUS_EM_EXECUCAO,
                "job_id": job_id,
                "id": int(pedido["id"]),
                "vinculado": STATUS_VINCULADO,
                "falha": STATUS_FALHA,
            },
        )

    atualizados = [get_pedido(int(p["id"])) for p in elegiveis]
    atualizados = [p for p in atualizados if p]
    return {
        "pedido": atualizados[0] if atualizados else None,
        "pedidos": atualizados,
        "job": job,
        "num_pedidos": len(atualizados),
        "num_itens": len(dados["itens"]),
    }


def executar_pedido(pedido_id: int, solicitado_por: str) -> dict[str, Any]:
    """
    Executa a OS do pedido: todos os vinculados/falha da mesma OS
    entram no mesmo CDR/prova.
    """
    ensure_credenciais_depol_schema()
    pedido = get_pedido(pedido_id)
    if not pedido:
        raise LookupError("Pedido não encontrado.")
    if pedido["status"] not in (STATUS_VINCULADO, STATUS_FALHA):
        raise ValueError("Pedido precisa estar vinculado (ou com falha) para executar.")
    ano = int(pedido["ano_protocolo"])
    nro = int(pedido["nro_protocolo"])
    return executar_os(ano, nro, solicitado_por)


def get_pedido_job(pedido_id: int) -> dict[str, Any]:
    from services import papelaria_jobs_service as jobs_svc

    pedido = get_pedido(pedido_id)
    if not pedido:
        raise LookupError("Pedido não encontrado.")
    job = None
    job_id = pedido.get("job_id")
    if job_id:
        job = jobs_svc.get_job(int(job_id))
    return {"pedido": pedido, "job": job}


def on_job_completed(job: dict[str, Any]) -> None:
    if (job.get("tipo_job") or "") != TIPO_JOB_CREDENCIAIS_DEPOL:
        return
    ensure_credenciais_depol_schema()
    db.execute_query(
        """
        UPDATE tabCredenciaisDepolPedidos
        SET Status = %(st)s
        WHERE JobID = %(jid)s
        """,
        {
            "st": STATUS_CONCLUIDO,
            "jid": int(job["id"]),
        },
    )


def on_job_failed(job: dict[str, Any]) -> None:
    if (job.get("tipo_job") or "") != TIPO_JOB_CREDENCIAIS_DEPOL:
        return
    ensure_credenciais_depol_schema()
    db.execute_query(
        """
        UPDATE tabCredenciaisDepolPedidos
        SET Status = %(st)s
        WHERE JobID = %(jid)s
          AND Status = %(em)s
        """,
        {
            "st": STATUS_FALHA,
            "jid": int(job["id"]),
            "em": STATUS_EM_EXECUCAO,
        },
    )


def aprovar_prova_pedido(pedido_id: int, aprovado_por: str) -> dict[str, Any]:
    from services import papelaria_jobs_service as jobs_svc

    pedido = get_pedido(pedido_id)
    if not pedido:
        raise LookupError("Pedido não encontrado.")
    job_id = pedido.get("job_id")
    if not job_id:
        raise ValueError("Pedido sem job de geração.")
    result = jobs_svc.approve_job_prova(int(job_id), aprovado_por)
    return {"pedido": get_pedido(pedido_id), **result}


def descartar_prova_pedido(pedido_id: int, descartado_por: str) -> dict[str, Any]:
    from services import papelaria_jobs_service as jobs_svc

    pedido = get_pedido(pedido_id)
    if not pedido:
        raise LookupError("Pedido não encontrado.")
    job_id = pedido.get("job_id")
    if not job_id:
        raise ValueError("Pedido sem job de geração.")
    result = jobs_svc.discard_job_prova(int(job_id), descartado_por)
    # Todos os pedidos desse job voltam a vinculado para reexecução conjunta
    db.execute_query(
        """
        UPDATE tabCredenciaisDepolPedidos
        SET Status = %(st)s, JobID = NULL
        WHERE JobID = %(jid)s
        """,
        {"st": STATUS_VINCULADO, "jid": int(job_id)},
    )
    return {"pedido": get_pedido(pedido_id), "job": result}
