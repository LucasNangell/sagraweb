"""Admin: criar modelos a partir de upload .cdr e metadados."""
from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path
from typing import Any, Optional

from config_manager import config_manager
from database import db

from services.papelaria_models_service import (
    COREL_MODELS_DEV_DIR,
    COREL_MODELS_DFS_DIR,
    ORDEM_VARIAVEIS,
    ROTULOS_VARIAVEIS,
    build_campos_formulario,
    ensure_papelaria_modelos_table,
    extrair_variaveis,
    get_modelo_admin_by_id,
)

logger = logging.getLogger(__name__)
_CDR_EXT = ".cdr"
_SAFE_FILENAME_RE = re.compile(r"^[a-zA-Z0-9._-]{1,200}\.cdr$", re.IGNORECASE)


def list_produtos_distintos() -> list[str]:
    ensure_papelaria_modelos_table()
    rows = db.execute_query(
        """
        SELECT DISTINCT COALESCE(NULLIF(TRIM(Produto), ''), NULLIF(TRIM(NomeProduto), '')) AS produto
        FROM tabPapelariaModelos
        WHERE Ativo = 1
        ORDER BY produto ASC
        """
    )
    out: list[str] = []
    seen: set[str] = set()
    for row in rows or []:
        produto = (row.get("produto") or "").strip()
        if produto and produto not in seen:
            seen.add(produto)
            out.append(produto)
    return out


def _sanitize_cdr_filename(filename: str) -> str:
    name = os.path.basename(str(filename).replace("\\", "/")).strip()
    if not name.lower().endswith(_CDR_EXT):
        name = f"{Path(name).stem}{_CDR_EXT}"
    if not _SAFE_FILENAME_RE.match(name):
        raise ValueError("Nome de arquivo .cdr inválido.")
    return name


def extrair_variaveis_de_cdr_bytes(content: bytes) -> list[str]:
    if not content:
        return []
    texto = content.decode("latin-1", errors="ignore")
    vars_set = extrair_variaveis(texto)
    ordenadas: list[str] = []
    for var in ORDEM_VARIAVEIS:
        if var in vars_set:
            ordenadas.append(var)
    for var in sorted(vars_set):
        if var not in ordenadas:
            ordenadas.append(var)
    return ordenadas


def inferir_frente_verso(filename: str, frente_verso_informado: str) -> str:
    fv = (frente_verso_informado or "").strip()
    if fv:
        return fv
    base = Path(filename).stem.lower()
    if "fv" in base or "frenteverso" in base.replace("_", "").replace("-", ""):
        return "Frente e Verso"
    if base.endswith("v") or "verso" in base:
        return "Verso"
    return "Frente"


def build_campos_json_from_variaveis(variaveis: list[str]) -> dict[str, str]:
    campos: dict[str, str] = {}
    for var in variaveis:
        rotulo = ROTULOS_VARIAVEIS.get(var, var.replace("_", " ").title())
        campos[var] = f"{{{var}}}"
        if var == "nome_deputado":
            campos.setdefault("Nome", f"{{{var}}}")
    if not campos and variaveis:
        for var in variaveis:
            campos[var] = f"{{{var}}}"
    return campos


def _resolve_cdr_dir() -> Path:
    """Pasta WEB de modelos Corel — UNC em produção, local em DEV."""
    env = (os.getenv("SAGRA_PAPELARIA_MODELS_DIR") or "").strip()
    if env:
        dest = Path(env)
    elif config_manager.is_development():
        dest = COREL_MODELS_DEV_DIR
    else:
        dest = Path(COREL_MODELS_DFS_DIR)
    dest.mkdir(parents=True, exist_ok=True)
    return dest


def save_cdr_upload(filename: str, content: bytes) -> str:
    safe_name = _sanitize_cdr_filename(filename)
    if not content:
        raise ValueError("Arquivo .cdr vazio.")
    dest_dir = _resolve_cdr_dir()
    dest_path = dest_dir / safe_name
    temp_path = dest_dir / f".upload_{safe_name}.tmp"
    try:
        temp_path.write_bytes(content)
        if dest_path.exists():
            dest_path.unlink()
        temp_path.replace(dest_path)
    except OSError as exc:
        raise PermissionError(
            f"Não foi possível gravar o .cdr em {dest_dir}: {exc}"
        ) from exc
    finally:
        if temp_path.exists():
            try:
                temp_path.unlink()
            except OSError:
                pass
    return safe_name


def create_modelo_from_cdr(
    *,
    produto: str,
    frente_verso: str,
    cores: str,
    filename: str,
    content: bytes,
    mockup_config_json: Any = None,
    preview_config_json: Any = None,
    nome_exibicao: Optional[str] = None,
    inspect_id: Optional[str] = None,
) -> dict[str, Any]:
    ensure_papelaria_modelos_table()
    produto = (produto or "").strip()
    if not produto:
        raise ValueError("Produto obrigatório.")

    arquivo_modelo = save_cdr_upload(filename, content)
    campos: dict[str, str] = {}
    variaveis: list[str] = []
    campo_labels: dict[str, str] = {}
    preview_layout: Optional[dict[str, Any]] = None

    if inspect_id:
        try:
            from services import papelaria_cdr_inspect_service as inspect_svc

            inspect = inspect_svc.consume_completed_inspect(inspect_id.strip())
            campos_raw = inspect.get("campos") or {}
            if isinstance(campos_raw, dict) and campos_raw:
                campos = {str(k): str(v) for k, v in campos_raw.items()}
            variaveis_raw = inspect.get("variaveis") or []
            if isinstance(variaveis_raw, list):
                variaveis = [str(v) for v in variaveis_raw if str(v).strip()]
            raw_layout = inspect.get("preview_layout")
            if isinstance(raw_layout, dict):
                preview_layout = raw_layout
        except (LookupError, ValueError):
            logger.warning(
                "Inspeção %s indisponível ao criar modelo — fallback para extração local.",
                inspect_id,
            )

    if campos and inspect_id:
        from services.papelaria_models_service import normalize_campos_from_inspect

        campos, variaveis, campo_labels = normalize_campos_from_inspect(campos)

    if not campos:
        variaveis = extrair_variaveis_de_cdr_bytes(content)
        if not variaveis:
            variaveis = ["nome_deputado", "partido", "uf"]
        campos = build_campos_json_from_variaveis(variaveis)
    elif not variaveis:
        vars_set: set[str] = set()
        for texto in campos.values():
            vars_set.update(extrair_variaveis(str(texto)))
        from services.papelaria_models_service import _order_variaveis_list

        variaveis = _order_variaveis_list(list(vars_set))
    fv = inferir_frente_verso(arquivo_modelo, frente_verso)
    cores_val = (cores or "").strip() or "Policromia"

    mockup_normalized: Optional[str] = None
    if mockup_config_json is not None:
        from services import papelaria_mockup_config_service as mockup_svc

        mockup_normalized = mockup_svc.normalize_mockup_config_json(mockup_config_json)

    preview_normalized: Optional[str] = None
    if campos:
        from services import papelaria_live_preview_service as preview_svc

        preview_built = preview_svc.build_preview_config_from_inspect(
            campos,
            variaveis,
            fv,
            habilitar_campos_dinamicos=False,
            preview_layout=preview_layout,
        )
        preview_normalized = preview_svc.normalize_preview_config_json(preview_built)
    elif preview_config_json is not None:
        from services import papelaria_live_preview_service as preview_svc

        preview_normalized = preview_svc.normalize_preview_config_json(preview_config_json)

    rows = db.execute_query("SELECT COALESCE(MAX(Ordem), 0) AS max_ordem FROM tabPapelariaModelos")
    ordem = int((rows[0].get("max_ordem") if rows else 0) or 0) + 10

    from services.papelaria_models_service import _table_has_column

    has_legacy = _table_has_column("NomeProduto")

    cols = [
        "Produto",
        "FrenteVerso",
        "Cores",
        "ArquivoModelo",
        "CamposJson",
        "VariaveisJson",
        "Ativo",
        "Ordem",
    ]
    vals = [
        "%(produto)s",
        "%(frente_verso)s",
        "%(cores)s",
        "%(arquivo)s",
        "%(campos)s",
        "%(variaveis)s",
        "1",
        "%(ordem)s",
    ]
    if has_legacy:
        cols.extend(["NomeProduto", "NomeArquivo", "ConfigCampos"])
        vals.extend(["%(produto)s", "%(arquivo)s", "%(campos)s"])
    if _table_has_column("MockupConfigJson"):
        cols.append("MockupConfigJson")
        vals.append("%(mockup)s")
    if _table_has_column("PreviewConfigJson"):
        cols.append("PreviewConfigJson")
        vals.append("%(preview)s")
    nome_custom = (nome_exibicao or "").strip() or None
    if _table_has_column("NomeExibicao") and nome_custom:
        cols.append("NomeExibicao")
        vals.append("%(nome_exibicao)s")

    params = {
        "produto": produto,
        "frente_verso": fv,
        "cores": cores_val,
        "arquivo": arquivo_modelo,
        "campos": json.dumps(campos, ensure_ascii=False),
        "variaveis": json.dumps(variaveis, ensure_ascii=False),
        "ordem": ordem,
        "mockup": mockup_normalized,
        "preview": preview_normalized,
        "nome_exibicao": nome_custom,
    }

    db.execute_query(
        f"""
        INSERT INTO tabPapelariaModelos ({", ".join(cols)})
        VALUES ({", ".join(vals)})
        """,
        params,
    )

    created = db.execute_query(
        """
        SELECT ID FROM tabPapelariaModelos
        WHERE Produto = %(produto)s
          AND FrenteVerso = %(frente_verso)s
          AND Cores = %(cores)s
          AND ArquivoModelo = %(arquivo)s
        ORDER BY ID DESC
        LIMIT 1
        """,
        params,
    )
    if not created:
        raise RuntimeError("Modelo criado mas não encontrado após inserção.")

    modelo_id = int(created[0]["ID"])
    modelo = get_modelo_admin_by_id(modelo_id)
    if not modelo:
        raise RuntimeError("Modelo não encontrado após criação.")
    return {
        **modelo,
        "variaveis_extraidas": variaveis,
        "campos_formulario": build_campos_formulario(variaveis, campo_labels or None),
    }

