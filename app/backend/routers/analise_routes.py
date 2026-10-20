from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List, Optional
from database import db
from report_service import report_service 
import logging
import os
import datetime
import secrets
import string
from fastapi import UploadFile, File, Form
import shutil
import json
import glob
from .andamento_helpers import format_andamento_obs, format_ponto
from .os_audit_service import log_andamento_added, log_link_generated_db
from security.session_auth import get_session_from_request
from security.html_sanitize import sanitize_html_snapshot
from fastapi.templating import Jinja2Templates
from fastapi.responses import StreamingResponse
from fpdf import FPDF
import io
import re

# Body models para requisições
class FinalizeAnalysisRequest(BaseModel):
    versao: Optional[str] = "1"


class ClientUploadSessionRequest(BaseModel):
    os_id: int
    ano: int
    ponto: str
    token: str
    componente: str
    files: List[dict]
    id_item: Optional[int] = None


class ClientUploadCompleteRequest(BaseModel):
    os_id: int
    ano: int
    ponto: str
    token: str
    componente: str
    files: List[dict]
    id_item: Optional[int] = None


# Removed HTMLPDF class
templates = Jinja2Templates(directory="templates")


def _get_os_folder_path(ano: int, os_id: int) -> Optional[str]:
    """Localiza pasta da OS na rede (mesma regra de os_routes)."""
    from routers.os_routes import _get_os_folder_path as os_folder

    return os_folder(ano, os_id)


def _list_original_folders(target_os_dir: str) -> List[str]:
    """Pastas Original da OS na rede, na mesma ordem usada em /os/{ano}/{id}/versions."""
    if not target_os_dir or not os.path.isdir(target_os_dir):
        return []
    return sorted(
        name
        for name in os.listdir(target_os_dir)
        if os.path.isdir(os.path.join(target_os_dir, name))
        and name.lower().startswith(("original", "orignal"))
    )


def _resolve_original_folder_path(target_os_dir: str, versao_label: str) -> str:
    """Pasta Original vN correspondente à versão registrada na análise."""
    if not target_os_dir or not os.path.isdir(target_os_dir):
        raise ValueError("Pasta da OS não encontrada.")

    original_folders = _list_original_folders(target_os_dir)
    if not original_folders:
        raise ValueError("Nenhuma pasta Original encontrada na OS.")

    if len(original_folders) == 1:
        return os.path.join(target_os_dir, original_folders[0])

    label = (versao_label or "").strip()
    if not label:
        raise ValueError(
            "Versão da análise não definida. A Sefoc deve registrar a versão analisada antes do envio de arquivos."
        )

    for match in re.findall(r"\(([^)]+)\)", label):
        candidate = match.strip()
        if candidate.lower().startswith(("original", "orignal")):
            for folder in original_folders:
                if folder.lower() == candidate.lower():
                    return os.path.join(target_os_dir, folder)

    for folder in original_folders:
        if folder.lower() == label.lower():
            return os.path.join(target_os_dir, folder)

    if label.isdigit():
        idx = int(label)
        if 1 <= idx <= len(original_folders):
            return os.path.join(target_os_dir, original_folders[idx - 1])

    ver_match = re.search(r"v\s*(\d+)", label, re.IGNORECASE)
    if ver_match:
        idx = int(ver_match.group(1))
        if 1 <= idx <= len(original_folders):
            return os.path.join(target_os_dir, original_folders[idx - 1])

    disponiveis = ", ".join(f"v{i + 1} ({nome})" for i, nome in enumerate(original_folders))
    raise ValueError(
        f"Não foi possível identificar a pasta Original para a versão '{label}'. "
        f"Versões disponíveis: {disponiveis}."
    )


def _parse_version_index_from_analise_versao(
    versao_label: str,
    original_folders: List[str],
) -> int:
    """Índice 1-based da versão que o cliente visualiza (alinhado a /os/.../versions)."""
    label = (versao_label or "").strip()
    if not label:
        return max(1, len(original_folders))

    ver_match = re.search(r"v\s*(\d+)", label, re.IGNORECASE)
    if ver_match:
        return max(1, int(ver_match.group(1)))

    if label.isdigit():
        return max(1, int(label))

    for idx, folder in enumerate(original_folders, start=1):
        if folder.lower() == label.lower():
            return idx

    for match in re.findall(r"\(([^)]+)\)", label):
        candidate = match.strip()
        for idx, folder in enumerate(original_folders, start=1):
            if folder.lower() == candidate.lower():
                return idx

    return max(1, len(original_folders))


def _original_folder_name_for_version(version_index: int) -> str:
    """Nome de pasta Original para índice 1-based (v1 → Original; v2+ → Original V{n})."""
    if version_index <= 1:
        return "Original"
    return f"Original V{version_index}"


def _ensure_next_original_upload_folder(
    target_os_dir: str,
    versao_label: str,
) -> tuple[str, str]:
    """
    Cria pasta Original da próxima revisão (ex.: cliente na v4 → Original V5).
    Retorna (caminho_absoluto, nome_da_pasta).
    """
    final_dir, folder_name, _ = _resolve_client_portal_upload_folder(
        target_os_dir, versao_label, portal_session_active=False
    )
    return final_dir, folder_name


_PORTAL_UPLOAD_MANIFEST = ".portal_upload_manifest.json"


def _portal_manifest_path(upload_dir: str) -> str:
    return os.path.join(upload_dir, _PORTAL_UPLOAD_MANIFEST)


def _read_portal_upload_manifest(upload_dir: str) -> Optional[dict]:
    path = _portal_manifest_path(upload_dir)
    if not os.path.isfile(path):
        return None
    try:
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
        return data if isinstance(data, dict) else None
    except Exception as exc:
        logger.warning("Manifesto de upload do portal inválido em %s: %s", upload_dir, exc)
        return None


def _write_portal_upload_manifest(upload_dir: str, manifest: dict) -> None:
    path = _portal_manifest_path(upload_dir)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, ensure_ascii=False, indent=2)


def _remove_portal_upload_manifest(upload_dir: str) -> None:
    path = _portal_manifest_path(upload_dir)
    if os.path.isfile(path):
        try:
            os.remove(path)
        except OSError as exc:
            logger.warning("Não foi possível remover manifesto do portal: %s", exc)


def _portal_obs_display_label(componente_grupo: str) -> str:
    """Rótulo exibido no andamento (Capa / Miolo / Arq. Único)."""
    label = (componente_grupo or "").strip()
    lower = label.lower()
    if lower == "capa":
        return "Capa"
    if lower == "miolo":
        return "Miolo"
    if lower in ("arq. único", "arq. unico", "encarte"):
        return "Arq. Único"
    if label in ("Capa", "Miolo", "Arq. Único"):
        return label
    return "Arq. Único"


def _portal_obs_label_to_grupo(obs_label: str) -> str:
    if obs_label == "Capa":
        return "Capa"
    if obs_label == "Miolo":
        return "Miolo"
    if obs_label == "Arq. Único":
        return "Arq. Único"
    return obs_label.strip() or "Outros"


def _build_portal_execution_obs(manifest: dict) -> str:
    """Texto único do andamento Em Execução após conclusão do portal."""
    components = manifest.get("components") if isinstance(manifest.get("components"), dict) else {}
    version_index = int(manifest.get("version_index") or 0)
    lines = ["Novos arquivos enviados pelo cliente:"]

    ordered_labels = ("Capa", "Miolo", "Arq. Único")
    emitted: set[str] = set()
    for obs_label in ordered_labels:
        for grupo_key, filenames in components.items():
            if _portal_obs_display_label(grupo_key) != obs_label:
                continue
            names = [str(n).strip() for n in (filenames or []) if str(n).strip()]
            if not names:
                continue
            lines.append(f"{obs_label}: {', '.join(names)}")
            emitted.add(obs_label)
            break

    for grupo_key, filenames in components.items():
        obs_label = _portal_obs_display_label(grupo_key)
        if obs_label in emitted or obs_label in ordered_labels:
            continue
        names = [str(n).strip() for n in (filenames or []) if str(n).strip()]
        if names:
            lines.append(f"{obs_label}: {', '.join(names)}")

    lines.append("")
    lines.append(f"Analisar v{version_index}" if version_index else "Analisar v?")
    return "\n".join(lines)


def _resolve_client_portal_upload_folder(
    target_os_dir: str,
    versao_label: str,
    *,
    portal_session_active: bool,
) -> tuple[str, str, int]:
    """
    Pasta Original da próxima revisão para upload do portal.
    Com sessão ativa (token válido), reutiliza a pasta já aberta (capa + miolo na mesma versão).
    Retorna (caminho_absoluto, nome_da_pasta, índice_da_versão_destino).
    """
    if not target_os_dir or not os.path.isdir(target_os_dir):
        raise ValueError("Pasta da OS não encontrada.")

    original_folders = _list_original_folders(target_os_dir)
    current_idx = _parse_version_index_from_analise_versao(versao_label, original_folders)
    next_idx = current_idx + 1
    existing_lower = {name.lower(): name for name in original_folders}
    next_name = _original_folder_name_for_version(next_idx)

    if portal_session_active and next_name.lower() in existing_lower:
        actual_name = existing_lower[next_name.lower()]
        final_dir = os.path.join(target_os_dir, actual_name)
        manifest = _read_portal_upload_manifest(final_dir)
        if manifest and not manifest.get("complete"):
            return final_dir, actual_name, next_idx

    while next_name.lower() in existing_lower:
        next_idx += 1
        next_name = _original_folder_name_for_version(next_idx)

    final_dir = os.path.join(target_os_dir, next_name)
    os.makedirs(final_dir, exist_ok=True)
    return final_dir, next_name, next_idx


def _portal_manifest_components_for_os(
    ano: int,
    os_id: int,
    versao_label: str,
) -> set[str]:
    """Componentes com upload em andamento (manifesto na pasta da próxima revisão)."""
    target_os_dir = _get_os_folder_path(ano, os_id)
    if not target_os_dir or not os.path.isdir(target_os_dir):
        return set()
    original_folders = _list_original_folders(target_os_dir)
    current_idx = _parse_version_index_from_analise_versao(versao_label, original_folders)
    next_idx = current_idx + 1
    next_name = _original_folder_name_for_version(next_idx)
    existing_lower = {name.lower(): name for name in original_folders}
    if next_name.lower() not in existing_lower:
        return set()
    final_dir = os.path.join(target_os_dir, existing_lower[next_name.lower()])
    manifest = _read_portal_upload_manifest(final_dir)
    if not manifest or manifest.get("complete"):
        return set()
    components = manifest.get("components")
    if not isinstance(components, dict):
        return set()
    return {_componente_grupo_key(k) for k, v in components.items() if v}


def _resolve_os_folder_for_client_upload(ano: int, os_id: int) -> str:
    """Localiza a pasta da OS na rede para upload do portal client_pt."""
    target_os_dir = _get_os_folder_path(ano, os_id)
    if target_os_dir and os.path.isdir(target_os_dir):
        return target_os_dir

    dfs_root = r"\\redecamara\DfsData"
    if not os.path.exists(dfs_root):
        local_test = os.path.abspath(f"storage_test/{ano}/{os_id}")
        if os.path.isdir(local_test):
            logger.warning(
                "Upload cliente: DFS indisponível; usando pasta local de teste %s",
                local_test,
            )
            return local_test

    raise HTTPException(
        status_code=404,
        detail=(
            f"Pasta da OS {os_id}/{ano} não encontrada na rede "
            f"(Deputados_{ano}). Verifique se a pasta da OS existe antes do envio."
        ),
    )


def _save_client_upload_file(upload: UploadFile, dest_dir: str) -> str:
    """Grava um arquivo enviado pelo cliente na pasta destino (gravação atômica)."""
    safe_name = os.path.basename(upload.filename or "arquivo")
    if not safe_name or safe_name in (".", ".."):
        raise ValueError("Nome de arquivo inválido.")

    dest_path = os.path.join(dest_dir, safe_name)
    tmp_path = dest_path + ".uploading"
    try:
        upload.file.seek(0)
        with open(tmp_path, "wb") as out:
            shutil.copyfileobj(upload.file, out)
        if os.path.getsize(tmp_path) <= 0:
            raise ValueError(f"Arquivo vazio ou inválido: {safe_name}")
        os.replace(tmp_path, dest_path)
    except Exception:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass
        raise
    finally:
        try:
            upload.file.close()
        except Exception:
            pass

    if not os.path.isfile(dest_path):
        raise ValueError(f"Falha ao confirmar gravação do arquivo: {safe_name}")

    return safe_name


_CLIENT_UPLOAD_OBS_MARKER = "enviado(s) pelo cliente"
_CLIENT_UPLOAD_OBS_MARKER_V2 = "Novos arquivos enviados pelo cliente"
_CLIENT_UPLOAD_COMP_RE = re.compile(
    r"enviado\(s\) pelo cliente em [^(]+\(\s*([^—)]+?)\s*—",
    re.IGNORECASE,
)
_CLIENT_UPLOAD_V2_LINE_RE = re.compile(
    r"^(Capa|Miolo|Arq\. Único):\s*.+",
    re.IGNORECASE | re.MULTILINE,
)


def _componente_grupo_key(componente: Optional[str]) -> str:
    label = (componente or "").strip()
    return label if label else "Outros"


def _get_client_uploaded_componentes(
    os_id: int,
    ano: int,
    versao_label: Optional[str] = None,
) -> List[str]:
    """Componentes com upload registrado (manifesto em andamento ou andamento concluído)."""
    found: set[str] = set()

    if versao_label:
        found.update(_portal_manifest_components_for_os(ano, os_id, versao_label))

    rows = db.execute_query(
        """
        SELECT Observaçao FROM tabAndamento
        WHERE NroProtocoloLink = %s AND AnoProtocoloLink = %s
          AND (Observaçao LIKE %s OR Observaçao LIKE %s)
        """,
        (
            os_id,
            ano,
            f"%{_CLIENT_UPLOAD_OBS_MARKER}%",
            f"%{_CLIENT_UPLOAD_OBS_MARKER_V2}%",
        ),
    )
    for row in rows or []:
        obs = str(row.get("Observaçao") or "")
        if _CLIENT_UPLOAD_OBS_MARKER_V2 in obs:
            for match in _CLIENT_UPLOAD_V2_LINE_RE.finditer(obs):
                label = match.group(1).strip()
                if label:
                    found.add(_portal_obs_label_to_grupo(label))
            continue
        for match in _CLIENT_UPLOAD_COMP_RE.finditer(obs):
            comp = match.group(1).strip()
            if comp:
                found.add(_componente_grupo_key(comp))
    return sorted(found)


def _client_portal_upload_status(
    items: List[dict],
    os_id: int,
    ano: int,
    *,
    versao_label: Optional[str] = None,
) -> dict:
    """
    Estado de envio do portal: componentes já enviados e se todos os pendentes
    já receberam arquivo (ou não há mais itens pendentes).
    """
    uploaded = set(_get_client_uploaded_componentes(os_id, ano, versao_label=versao_label))
    groups_with_pending: set[str] = set()
    for item in items or []:
        if item.get("desconsiderado") or item.get("resolver"):
            continue
        groups_with_pending.add(_componente_grupo_key(item.get("componenteOrigem")))
    groups_needing_upload = [g for g in groups_with_pending if g not in uploaded]
    if groups_with_pending:
        portal_complete = len(groups_needing_upload) == 0
    else:
        # Sem itens pendentes: conclusão só se houve envio de arquivo registrado
        portal_complete = len(uploaded) > 0
    return {
        "componentesEnviados": sorted(uploaded),
        "portalComplete": portal_complete,
    }


def _resolve_version_display_label(ano: int, os_id: int, versao_stored: Optional[str]) -> str:
    """Rótulo legível da versão (ex.: v2 (Original v2)) para o portal do cliente."""
    if not versao_stored or not str(versao_stored).strip():
        return "—"
    stored = str(versao_stored).strip()
    if re.search(r"\([^)]*original", stored, re.IGNORECASE):
        return stored

    os_folder = _get_os_folder_path(ano, os_id)
    if not os_folder or not os.path.isdir(os_folder):
        return stored

    original_folders = _list_original_folders(os_folder)
    if not original_folders:
        return stored

    ver_match = re.search(r"v\s*(\d+)", stored, re.IGNORECASE)
    if ver_match:
        idx = int(ver_match.group(1))
        if 1 <= idx <= len(original_folders):
            return f"v{idx} ({original_folders[idx - 1]})"

    for idx, folder in enumerate(original_folders, start=1):
        if folder.lower() == stored.lower():
            return f"v{idx} ({folder})"

    return stored


def _item_matches_analise_version(
    item_versao: Optional[str],
    analise_versao: Optional[str],
    ano: int,
    os_id: int,
) -> bool:
    """Mesma regra do front (itemMatchesVersion): item pertence à versão ativa da análise."""
    current = (analise_versao or "").strip()
    if not current:
        return True

    stored = (item_versao or "").strip()
    if not stored:
        return False

    if stored == current:
        return True

    current_match = re.search(r"v\s*(\d+)", current, re.IGNORECASE)
    stored_match = re.search(r"v\s*(\d+)", stored, re.IGNORECASE)
    if current_match and stored_match and current_match.group(1) == stored_match.group(1):
        return True

    os_folder = _get_os_folder_path(ano, os_id)
    original_folders = _list_original_folders(os_folder) if os_folder else []
    if current_match and original_folders:
        idx = int(current_match.group(1))
        if 1 <= idx <= len(original_folders):
            folder_label = original_folders[idx - 1]
            if stored.lower() == folder_label.lower():
                return True

    stored_lower = stored.lower()
    current_lower = current.lower()
    if stored_lower in current_lower or current_lower in stored_lower:
        return True

    if original_folders and current_match:
        idx = int(current_match.group(1))
        if 1 <= idx <= len(original_folders):
            folder_lower = original_folders[idx - 1].lower()
            if stored_lower == folder_lower or stored_lower in folder_lower:
                return True

    return False


def _filter_items_for_analise_version(
    items: Optional[List[dict]],
    analise_versao: Optional[str],
    ano: int,
    os_id: int,
    *,
    versao_field: str = "versaoOrigem",
) -> List[dict]:
    """Mantém só PTs da versão atual (exclui importados / registrados em versões anteriores)."""
    if not items:
        return []
    _refresh_analise_item_versao_column_flag()
    if not _analise_item_versao_column_exists:
        return list(items)
    if not (analise_versao or "").strip():
        return list(items)
    return [
        i
        for i in items
        if _item_matches_analise_version(i.get(versao_field), analise_versao, ano, os_id)
    ]


def _normalize_client_portal_item(item: dict) -> dict:
    """Garante booleans JSON para flags tinyint do MySQL."""
    return {
        **item,
        "desconsiderado": bool(item.get("desconsiderado")),
        "resolver": bool(item.get("resolver")),
        "resolucaoObrigatoria": bool(item.get("resolucaoObrigatoria")),
        "corrigidoSefoc": bool(item.get("corrigidoSefoc")),
    }


def _validate_client_token_row(os_id: int, ano: int, token: str) -> dict:
    token_rec = db.execute_query(
        "SELECT ID_Analise, DataExpiracao FROM tabClientTokens WHERE NroProtocolo=%s AND AnoProtocolo=%s AND Token=%s",
        (os_id, ano, token),
    )
    if not token_rec:
        raise HTTPException(status_code=403, detail="Acesso negado. Token inválido ou expirado.")
    if token_rec[0].get("DataExpiracao"):
        raise HTTPException(status_code=403, detail="Acesso negado. Link expirado (arquivos já enviados).")
    return token_rec[0]


def _resolve_client_upload_item_context(
    id_analise: int,
    id_item: Optional[int],
    componente: Optional[str],
) -> tuple[str, str]:
    item_titulo = ""
    item_componente = ""
    if id_item:
        item_row = db.execute_query(
            "SELECT i.Componente as componente, p.TituloPT as titulo FROM tabAnaliseItens i "
            "LEFT JOIN tabProblemasPadrao p ON i.ID_ProblemaPadrao = p.ID WHERE i.ID=%s AND i.ID_Analise=%s",
            (id_item, id_analise),
        )
        if not item_row:
            raise HTTPException(status_code=404, detail="Item da análise não encontrado.")
        item_titulo = item_row[0].get("titulo") or "Problema técnico"
        item_componente = item_row[0].get("componente") or ""
    elif componente and str(componente).strip():
        item_componente = str(componente).strip()
    return item_titulo, item_componente


def _finalize_client_portal_upload(
    *,
    os_id: int,
    ano: int,
    token: str,
    ponto: str,
    id_analise: int,
    versao_label: str,
    item_titulo: str,
    item_componente: str,
    folder_name: str,
    saved_files: List[str],
    upload_dir: str,
    version_index: int,
) -> dict:
    comp_key = _componente_grupo_key(item_componente)
    manifest = _read_portal_upload_manifest(upload_dir) or {
        "version_index": version_index,
        "components": {},
        "complete": False,
    }
    manifest["version_index"] = version_index
    components = manifest.get("components")
    if not isinstance(components, dict):
        components = {}
    prev_files = components.get(comp_key)
    if isinstance(prev_files, list):
        merged = list(prev_files)
        for name in saved_files:
            if name not in merged:
                merged.append(name)
        components[comp_key] = merged
    else:
        components[comp_key] = list(saved_files)
    manifest["components"] = components
    manifest["complete"] = False
    _write_portal_upload_manifest(upload_dir, manifest)

    _refresh_analise_item_versao_column_flag()
    versao_col_status = (
        "i.Versao as versaoOrigem,"
        if _analise_item_versao_column_exists
        else "NULL as versaoOrigem,"
    )
    status_items = db.execute_query(
        f"""
        SELECT i.Componente as componenteOrigem, {versao_col_status}
               i.Desconsiderado as desconsiderado, i.Resolver as resolver
        FROM tabAnaliseItens i WHERE i.ID_Analise = %s
        """,
        (id_analise,),
    )
    status_items = _filter_items_for_analise_version(
        status_items, versao_label, ano, os_id
    )
    normalized_status_items = [_normalize_client_portal_item(i) for i in status_items]
    upload_status = _client_portal_upload_status(
        normalized_status_items, os_id, ano, versao_label=versao_label
    )

    if upload_status["portalComplete"]:

        def transaction(cursor):
            obs = _build_portal_execution_obs(manifest)
            cod = add_movement_internal(
                cursor, os_id, ano, "Em Execução", "SEFOC", ponto, obs
            )
            cursor.execute(
                "UPDATE tabClientTokens SET DataExpiracao = NOW() WHERE Token = %s",
                (token,),
            )
            return cod

        new_cod = db.execute_transaction([transaction])[0]
        if new_cod:
            _push_movement_to_mdb(new_cod, os_id, ano, task_name="portal_upload_complete")
        _remove_portal_upload_manifest(upload_dir)

        from routers.realtime import broadcast_os_system_update

        broadcast_os_system_update(
            os_id,
            ano,
            "portal_upload_complete",
            setor="SEFOC",
            origem="portal_cliente",
        )

    return {
        "status": "success",
        "files": saved_files,
        "folder": folder_name,
        "item_titulo": item_titulo,
        "componente": comp_key if item_componente else None,
        "componentesEnviados": upload_status["componentesEnviados"],
        "portalComplete": upload_status["portalComplete"],
    }


router = APIRouter()
logger = logging.getLogger(__name__)


def _clean_item_html_snapshot(
    html: Optional[str],
    titulo: Optional[str] = None,
) -> Optional[str]:
    """Remove rótulos duplicados dos snapshots PT (ex.: Manual Técnico)."""
    if html is None:
        return None
    text = str(html).strip()
    if not text:
        return html
    from services.pt_report_html_service import normalize_item_snapshot_for_report

    cleaned = normalize_item_snapshot_for_report(text, item_titulo=titulo)
    safe = sanitize_html_snapshot(cleaned)
    return safe if safe is not None else cleaned


def _titulo_for_padrao(id_padrao: Optional[int]) -> Optional[str]:
    if not id_padrao:
        return None
    rows = db.execute_query(
        "SELECT TituloPT FROM tabProblemasPadrao WHERE ID = %s LIMIT 1",
        (id_padrao,),
    )
    if rows:
        return rows[0].get("TituloPT")
    return None


def _titulo_for_analise_item(item_id: int) -> Optional[str]:
    titulo_sql, migracao_join = _analise_item_titulo_sql_parts()
    rows = db.execute_query(
        f"""
        SELECT {titulo_sql}
        FROM tabAnaliseItens i
        LEFT JOIN tabProblemasPadrao p ON i.ID_ProblemaPadrao = p.ID
        {migracao_join}
        WHERE i.ID = %s
        LIMIT 1
        """,
        (item_id,),
    )
    if rows:
        return rows[0].get("titulo")
    return None


def _analise_item_titulo_sql_parts() -> tuple:
    """Título na árvore: biblioteca ou registro importado do SAT (sem alterar schema)."""
    try:
        from services.sat_registro_pt_migration import migracao_sat_table_exists

        if migracao_sat_table_exists():
            return (
                "COALESCE(p.TituloPT, m.ProbTecTitulo) AS titulo",
                "LEFT JOIN tabMigracaoSatRegistroPT m ON m.ID_AnaliseItem = i.ID",
            )
    except Exception:
        pass
    return ("p.TituloPT AS titulo", "")


_analise_item_versao_column_checked = False
_analise_item_versao_column_exists = False
_analise_item_corrigido_column_checked = False
_analise_item_corrigido_column_exists = False


def _refresh_analise_item_corrigido_column_flag() -> None:
    """Garante colunas de correção interna SEFOC em tabAnaliseItens."""
    global _analise_item_corrigido_column_checked, _analise_item_corrigido_column_exists
    if _analise_item_corrigido_column_checked:
        return
    try:
        rows = db.execute_query(
            "SELECT 1 AS ok FROM information_schema.COLUMNS "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tabAnaliseItens' "
            "AND COLUMN_NAME = 'CorrigidoSefoc' LIMIT 1"
        )
        if not rows:
            db.execute_query(
                "ALTER TABLE tabAnaliseItens ADD COLUMN CorrigidoSefoc TINYINT(1) NOT NULL DEFAULT 0"
            )
            db.execute_query(
                "ALTER TABLE tabAnaliseItens ADD COLUMN ObsCorrecaoSefoc TEXT NULL"
            )
            logger.info("Colunas CorrigidoSefoc/ObsCorrecaoSefoc criadas em tabAnaliseItens")
        _analise_item_corrigido_column_exists = True
    except Exception as e:
        logger.warning("Colunas CorrigidoSefoc em tabAnaliseItens indisponíveis: %s", e)
        _analise_item_corrigido_column_exists = False
    _analise_item_corrigido_column_checked = True


def _analise_items_client_sql_filter() -> str:
    """Exclui itens desconsiderados e corrigidos internamente (não vão ao cliente)."""
    _refresh_analise_item_corrigido_column_flag()
    clause = "i.Desconsiderado = 0"
    if _analise_item_corrigido_column_exists:
        clause += " AND COALESCE(i.CorrigidoSefoc, 0) = 0"
    return clause


def _refresh_analise_item_versao_column_flag() -> None:
    """Garante coluna Versao em tabAnaliseItens (DEV / migração automática segura)."""
    global _analise_item_versao_column_checked, _analise_item_versao_column_exists
    if _analise_item_versao_column_checked:
        return
    try:
        rows = db.execute_query(
            "SELECT 1 AS ok FROM information_schema.COLUMNS "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tabAnaliseItens' "
            "AND COLUMN_NAME = 'Versao' LIMIT 1"
        )
        if not rows:
            db.execute_query(
                "ALTER TABLE tabAnaliseItens ADD COLUMN Versao VARCHAR(50) NULL DEFAULT NULL "
                "AFTER Componente"
            )
            logger.info("Coluna Versao criada em tabAnaliseItens")
        _analise_item_versao_column_exists = True
    except Exception as e:
        logger.warning("Coluna Versao em tabAnaliseItens indisponível: %s", e)
        _analise_item_versao_column_exists = False
    _analise_item_versao_column_checked = True

class ProblemaItem(BaseModel):
    id_padrao: int
    obs: Optional[str] = ""
    html_snapshot: Optional[str] = None
    componente: Optional[str] = None

class AnaliseRequest(BaseModel):
    nro_os: int
    ano_os: int
    versao: str
    componente: str
    usuario: str
    problemas: List[ProblemaItem]

class AnalysisEnsureRequest(BaseModel):
    nro_os: int
    ano_os: int
    usuario: str

class AnaliseItemAddRequest(BaseModel):
    id_analise: int
    id_padrao: int
    componente: Optional[str] = None
    versao: Optional[str] = None
    obs: Optional[str] = ""
    html_snapshot: Optional[str] = None

class AnaliseItemUpdateRequest(BaseModel):
    id_item: int
    obs: Optional[str] = None
    html_snapshot: Optional[str] = None
    componente: Optional[str] = None

class ToggleResolucaoObrigatoriaRequest(BaseModel):
    id_item: int
    resolucao_obrigatoria: bool


class ToggleCorrigidoSefocRequest(BaseModel):
    id_item: int
    corrigido_sefoc: bool
    obs_correcao_sefoc: Optional[str] = None


class AnaliseMetaUpdateRequest(BaseModel):
    """Versão analisada e componente (persistidos para o portal do cliente)."""
    versao: Optional[str] = None
    componente: Optional[str] = None


class LibraryItemAddRequest(BaseModel):
    titulo: str
    html_snapshot: str
    categoria: Optional[str] = "Geral"

@router.post("/analise/problemas-padrao/add")
def add_problema_padrao(req: LibraryItemAddRequest):
    try:
        safe_html = sanitize_html_snapshot(req.html_snapshot) or ""
        db.execute_query(
            "INSERT INTO tabProblemasPadrao (TituloPT, ProbTecHTML, Categoria) VALUES (%s, %s, %s)",
            (req.titulo, safe_html, req.categoria)
        )
        new_id = db.execute_query("SELECT MAX(ID) as ID FROM tabProblemasPadrao")[0]['ID']
        return {"status": "success", "id": new_id, "titulo": req.titulo}
    except Exception as e:
        logger.error(f"Erro ao adicionar problema padrão: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class LibraryItemUpdateRequest(BaseModel):
    titulo: str
    html_snapshot: str
    categoria: Optional[str] = "Geral"


@router.put("/analise/problemas-padrao/{item_id}")
def update_problema_padrao(item_id: int, req: LibraryItemUpdateRequest):
    try:
        existing = db.execute_query(
            "SELECT ID FROM tabProblemasPadrao WHERE ID = %s LIMIT 1",
            (item_id,),
        )
        if not existing:
            raise HTTPException(status_code=404, detail="Item da biblioteca não encontrado.")
        titulo = (req.titulo or "").strip()
        if not titulo:
            raise HTTPException(status_code=400, detail="Título obrigatório.")
        safe_html = sanitize_html_snapshot(req.html_snapshot) or ""
        categoria = (req.categoria or "Geral").strip() or "Geral"
        db.execute_query(
            """
            UPDATE tabProblemasPadrao
            SET TituloPT = %s, ProbTecHTML = %s, Categoria = %s
            WHERE ID = %s
            """,
            (titulo, safe_html, categoria, item_id),
        )
        return {
            "status": "success",
            "id": item_id,
            "titulo": titulo,
            "categoria": categoria,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erro ao atualizar problema padrão {item_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/analise/problemas-padrao/{item_id}")
def delete_problema_padrao(item_id: int):
    try:
        existing = db.execute_query(
            "SELECT ID, TituloPT FROM tabProblemasPadrao WHERE ID = %s LIMIT 1",
            (item_id,),
        )
        if not existing:
            raise HTTPException(status_code=404, detail="Item da biblioteca não encontrado.")

        # Desvincula referências (sem FK formal em vários ambientes).
        try:
            db.execute_query(
                "UPDATE tabAnaliseLabItem SET ID_ProblemaPadrao = NULL WHERE ID_ProblemaPadrao = %s",
                (item_id,),
            )
        except Exception:
            pass
        try:
            db.execute_query(
                "UPDATE tabAnaliseItens SET ID_ProblemaPadrao = NULL WHERE ID_ProblemaPadrao = %s",
                (item_id,),
            )
        except Exception:
            pass

        db.execute_query("DELETE FROM tabProblemasPadrao WHERE ID = %s", (item_id,))
        return {"status": "success", "id": item_id}
    except HTTPException:
        raise
    except Exception as e:
        err = str(e)
        logger.error(f"Erro ao excluir problema padrão {item_id}: {e}")
        if "foreign key" in err.lower() or "1451" in err:
            raise HTTPException(
                status_code=409,
                detail="Não é possível excluir: o item está vinculado a análises existentes.",
            )
        raise HTTPException(status_code=500, detail=err)


@router.get("/analise/problemas-padrao")
def get_problemas_padrao():
    rows = db.execute_query(
        "SELECT ID, TituloPT, ProbTecHTML, Categoria FROM tabProblemasPadrao ORDER BY Categoria, TituloPT"
    )
    for row in rows or []:
        row["ProbTecHTML"] = _clean_item_html_snapshot(
            row.get("ProbTecHTML"),
            row.get("TituloPT"),
        )
    return rows

@router.get("/files/list")
def list_files(path: str = Query(..., description="Caminho absoluto da pasta")):
    from security.file_access import resolve_allowed_directory

    dir_path = resolve_allowed_directory(path)
    if not dir_path.is_dir():
        return {"files": []}
    files = []
    for item in os.listdir(dir_path):
        full_path = os.path.join(str(dir_path), item)
        if os.path.isfile(full_path) and item.lower().endswith(('.pdf', '.jpg', '.png')):
            files.append({"name": item, "path": full_path, "type": "PDF" if item.endswith('.pdf') else "IMAGE"})
    return {"files": sorted(files, key=lambda x: x['name'])}

@router.get("/files/serve")
def serve_file(filepath: str):
    from security.file_access import resolve_allowed_file_path

    safe_path = resolve_allowed_file_path(filepath)
    return FileResponse(str(safe_path))


def _indication_storage_dir(item_id: int) -> str:
    base = os.path.abspath(os.path.join("storage", "analise_indications", str(item_id)))
    os.makedirs(base, exist_ok=True)
    return base


def _safe_indication_path(item_id: int, filename: str) -> str:
    safe_name = os.path.basename(filename or "")
    if not safe_name or safe_name != filename:
        raise HTTPException(status_code=400, detail="Nome de arquivo inválido.")
    if not safe_name.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
        raise HTTPException(status_code=400, detail="Formato de imagem não suportado.")
    full = os.path.join(_indication_storage_dir(item_id), safe_name)
    if not os.path.isfile(full):
        raise HTTPException(status_code=404, detail="Imagem não encontrada.")
    return full


def _rewrite_indication_urls_for_client(html: str, token: str, os_id: int, ano: int) -> str:
    """Acrescenta token na query de imagens de indicação para o portal público."""
    if not html or "indication/" not in html:
        return html or ""

    from urllib.parse import quote

    token_q = f"token={quote(token)}&os={os_id}&ano={ano}"

    def repl(match: re.Match) -> str:
        url = match.group(1)
        if "/indication/" not in url:
            return match.group(0)
        sep = "&" if "?" in url else "?"
        return f'src="{url}{sep}{token_q}"'

    return re.sub(r'src="([^"]*/analise/item/\d+/indication/[^"?]*)"', repl, html)


@router.post("/analise/item/{item_id}/indication-image")
async def upload_item_indication_image(item_id: int, file: UploadFile = File(...)):
    """Salva captura de indicação no arquivo (evita data URLs enormes no HTML)."""
    item_row = db.execute_query("SELECT ID FROM tabAnaliseItens WHERE ID=%s", (item_id,))
    if not item_row:
        raise HTTPException(status_code=404, detail="Item da análise não encontrado.")

    ext = ".png"
    orig = (file.filename or "").lower()
    if orig.endswith(".jpg") or orig.endswith(".jpeg"):
        ext = ".jpg"
    elif orig.endswith(".webp"):
        ext = ".webp"

    filename = f"{secrets.token_hex(8)}{ext}"
    dest_dir = _indication_storage_dir(item_id)
    dest_path = os.path.join(dest_dir, filename)

    with open(dest_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    from config_manager import config_manager

    url_path = f"{config_manager.get_api_path_prefix()}/analise/item/{item_id}/indication/{filename}"
    return {"status": "success", "filename": filename, "url": url_path}


@router.get("/analise/item/{item_id}/indication/{filename}")
def serve_item_indication_image(
    item_id: int,
    filename: str,
    request: Request,
    token: Optional[str] = Query(None),
    os: Optional[int] = Query(None),
    ano: Optional[int] = Query(None),
):
    """Serve imagem de indicação — sessão interna ou token do portal do cliente."""
    from security.session_auth import get_session_from_request

    session = get_session_from_request(request)
    if not session:
        if not token or os is None or ano is None:
            raise HTTPException(status_code=403, detail="Acesso negado.")
        token_row = _validate_client_token_row(os, ano, token)
        item_row = db.execute_query(
            "SELECT ID_Analise FROM tabAnaliseItens WHERE ID=%s",
            (item_id,),
        )
        if not item_row or item_row[0]["ID_Analise"] != token_row["ID_Analise"]:
            raise HTTPException(status_code=403, detail="Token inválido para esta imagem.")

    path = _safe_indication_path(item_id, filename)
    media = "image/jpeg" if filename.lower().endswith((".jpg", ".jpeg")) else "image/png"
    return FileResponse(path, media_type=media)

@router.post("/analise/save")
def save_analise(req: AnaliseRequest):
    try:
        problemas = []
        for p in req.problemas:
            d = p.dict()
            if d.get("html_snapshot"):
                d["html_snapshot"] = sanitize_html_snapshot(d["html_snapshot"])
            problemas.append(d)
        result = report_service.save_analysis(req.nro_os, req.ano_os, req.versao, req.componente, req.usuario, problemas)
        return {"status": "success", "analise_id": result['id']}
    except Exception as e:
        logger.error(f"Erro salvando analise: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/analise/finalize/{ano}/{os_id}")
def finalize_analysis(ano: int, os_id: int, request: FinalizeAnalysisRequest):
    """
    Finaliza a análise gerando HTML dos problemas técnicos e salvando no banco de dados.
    Este endpoint é chamado quando o usuário clica em "Concluir" na tela de análise.
    """
    try:
        # Obter versao do request body
        versao = request.versao if request.versao else "1"
        
        # Garantir que versao nunca seja None
        if not versao or versao.strip() == "":
            versao = "1"
        versao = versao.strip()
        
        logger.info(f"POST /analise/finalize/{ano}/{os_id} - Finalizando análise com versao: {versao}")
        
        # Buscar todos os itens da análise
        header = db.execute_query(
            "SELECT ID FROM tabAnalises WHERE OS=%s AND Ano=%s", 
            (os_id, ano)
        )
        
        if not header:
            raise HTTPException(status_code=404, detail="Análise não encontrada")
        
        anl_id = header[0]['ID']
        
        # Buscar problemas da análise
        items = db.execute_query("""
            SELECT i.ID as uniqueId, i.ID_ProblemaPadrao as originalId, i.Obs as obs, 
                   i.HTML_Snapshot as html, i.Componente as componenteOrigem, 
                   i.ResolucaoObrigatoria as resolucaoObrigatoria, p.TituloPT as titulo
            FROM tabAnaliseItens i 
            LEFT JOIN tabProblemasPadrao p ON i.ID_ProblemaPadrao = p.ID 
            WHERE i.ID_Analise = %s
        """, (anl_id,))
        
        if not items:
            logger.warning(f"Análise {os_id}/{ano} finalizada sem problemas identificados")
            html_problemas = "<p>Nenhum problema técnico foi identificado na análise.</p>"
        else:
            # Gerar HTML formatado com os problemas
            problemas_para_html = [
                {
                    'titulo': item.get('titulo', f'Problema {i+1}'),
                    'obs': item.get('obs', '')
                }
                for i, item in enumerate(items)
            ]
            
            # Importar função de email_routes
            from . import email_routes
            html_problemas = email_routes._generate_problemas_html(problemas_para_html)
            logger.info(f"HTML dos problemas gerado com {len(html_problemas)} bytes")
        
        # Salvar HTML no banco de dados na tabProtocolos
        logger.info(f"Atualizando tabProtocolos para NroProtocolo={os_id}, AnoProtocolo={ano}")
        resultado = db.execute_query("""
            UPDATE tabProtocolos 
            SET email_pt_html = %s, email_pt_versao = %s, email_pt_data = NOW()
            WHERE NroProtocolo = %s AND AnoProtocolo = %s
        """, (html_problemas, versao, os_id, ano))
        logger.info(f"Resultado UPDATE: {resultado} - Análise finalizada para OS {os_id}/{ano}")
        
        return {
            "status": "success",
            "message": "Análise finalizada e HTML dos problemas técnicos gerado",
            "html_preview": html_problemas[:200] + "..." if len(html_problemas) > 200 else html_problemas
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erro ao finalizar análise: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/analise/ensure")
def ensure_analise(req: AnalysisEnsureRequest):
    existing = db.execute_query("SELECT ID FROM tabAnalises WHERE OS=%s AND Ano=%s", (req.nro_os, req.ano_os))
    if existing: return {"id": existing[0]['ID'], "new": False}
    db.execute_query("INSERT INTO tabAnalises (OS, Ano, Usuario, Versao, Componente) VALUES (%s, %s, %s, '', '')", (req.nro_os, req.ano_os, req.usuario))
    new_rec = db.execute_query("SELECT ID FROM tabAnalises WHERE OS=%s AND Ano=%s", (req.nro_os, req.ano_os))
    return {"id": new_rec[0]['ID'], "new": True}

@router.patch("/analise/{ano}/{os_id}/meta")
def update_analise_meta(ano: int, os_id: int, req: AnaliseMetaUpdateRequest):
    """Persiste versão analisada e componente enquanto o analista trabalha na OS."""
    header = db.execute_query(
        "SELECT ID FROM tabAnalises WHERE OS=%s AND Ano=%s",
        (os_id, ano),
    )
    if not header:
        raise HTTPException(status_code=404, detail="Análise não encontrada.")
    if req.versao is None and req.componente is None:
        return {"status": "success"}
    _persist_analise_meta(os_id, ano, versao=req.versao, componente=req.componente)
    return {"status": "success"}


@router.get("/analise/{ano}/{os_id}/full")
def get_full_analysis(ano: int, os_id: int):
    _refresh_analise_item_versao_column_flag()
    _refresh_analise_item_corrigido_column_flag()
    header = db.execute_query("SELECT ID, Versao, Componente FROM tabAnalises WHERE OS=%s AND Ano=%s", (os_id, ano))
    if not header: return {"exists": False}
    anl_id = header[0]['ID']
    versao_col = "i.Versao as versaoOrigem," if _analise_item_versao_column_exists else "NULL as versaoOrigem,"
    corrigido_col = (
        "i.CorrigidoSefoc as corrigidoSefoc, i.ObsCorrecaoSefoc as obsCorrecaoSefoc,"
        if _analise_item_corrigido_column_exists
        else "0 as corrigidoSefoc, NULL as obsCorrecaoSefoc,"
    )
    titulo_sql, migracao_join = _analise_item_titulo_sql_parts()
    items = db.execute_query(f"""
        SELECT i.ID as uniqueId, i.ID_ProblemaPadrao as originalId, i.Obs as obs, i.HTML_Snapshot as html,
               i.Componente as componenteOrigem, {versao_col} {corrigido_col}
               i.ResolucaoObrigatoria as resolucaoObrigatoria, {titulo_sql}
        FROM tabAnaliseItens i
        LEFT JOIN tabProblemasPadrao p ON i.ID_ProblemaPadrao = p.ID
        {migracao_join}
        WHERE i.ID_Analise = %s
    """, (anl_id,))
    for item in items or []:
        if item.get("html"):
            item["html"] = _clean_item_html_snapshot(item.get("html"), item.get("titulo"))
    return {"exists": True, "id": anl_id, "versao": header[0]['Versao'], "componente": header[0]['Componente'], "items": items}


def _lookup_analise_context_by_item(item_id: int) -> Optional[dict]:
    _refresh_analise_item_versao_column_flag()
    versao_col = (
        "i.Versao AS item_versao"
        if _analise_item_versao_column_exists
        else "NULL AS item_versao"
    )
    rows = db.execute_query(
        f"""
        SELECT a.ID AS id_analise, a.OS AS os_id, a.Ano AS ano, a.Versao AS versao,
               {versao_col}
        FROM tabAnaliseItens i
        INNER JOIN tabAnalises a ON a.ID = i.ID_Analise
        WHERE i.ID = %s LIMIT 1
        """,
        (item_id,),
    )
    return rows[0] if rows else None


def _lookup_analise_context_by_id(id_analise: int) -> Optional[dict]:
    rows = db.execute_query(
        "SELECT ID AS id_analise, OS AS os_id, Ano AS ano, Versao AS versao "
        "FROM tabAnalises WHERE ID = %s LIMIT 1",
        (id_analise,),
    )
    return rows[0] if rows else None


def _resolve_pdf_versao(ctx: dict, override: Optional[str] = None) -> Optional[str]:
    for candidate in (override, ctx.get("versao"), ctx.get("item_versao")):
        text = (candidate or "").strip()
        if text:
            return text
    return None


def _refresh_analysis_pdf_after_item_change(
    *,
    os_id: int,
    ano: int,
    id_analise: Optional[int] = None,
    versao: Optional[str] = None,
    inner_html: Optional[str] = None,
) -> None:
    try:
        from services.pt_report_pdf_service import refresh_pt_analysis_pdf

        refresh_pt_analysis_pdf(
            ano,
            os_id,
            versao=versao,
            id_analise=id_analise,
            inner_html=inner_html,
        )
    except Exception as exc:
        logger.error("Erro ao recriar PDF de análise (OS %s/%s): %s", os_id, ano, exc)


@router.post("/analise/item/add")
def add_analise_item(req: AnaliseItemAddRequest):
    _refresh_analise_item_versao_column_flag()
    titulo = _titulo_for_padrao(req.id_padrao)
    safe_html = _clean_item_html_snapshot(req.html_snapshot, titulo)
    versao_val = (req.versao or "").strip() or None
    if _analise_item_versao_column_exists:
        db.execute_query(
            "INSERT INTO tabAnaliseItens (ID_Analise, ID_ProblemaPadrao, Componente, Versao, Obs, HTML_Snapshot) "
            "VALUES (%s, %s, %s, %s, %s, %s)",
            (req.id_analise, req.id_padrao, req.componente, versao_val, req.obs, safe_html),
        )
    else:
        db.execute_query(
            "INSERT INTO tabAnaliseItens (ID_Analise, ID_ProblemaPadrao, Componente, Obs, HTML_Snapshot) VALUES (%s, %s, %s, %s, %s)",
            (req.id_analise, req.id_padrao, req.componente, req.obs, safe_html),
        )
    last = db.execute_query("SELECT MAX(ID) as ID FROM tabAnaliseItens WHERE ID_Analise=%s", (req.id_analise,))
    ctx = _lookup_analise_context_by_id(req.id_analise)
    if ctx:
        _refresh_analysis_pdf_after_item_change(
            os_id=int(ctx["os_id"]),
            ano=int(ctx["ano"]),
            id_analise=req.id_analise,
            versao=_resolve_pdf_versao(ctx, req.versao),
        )
    return {"id": last[0]['ID']}

@router.post("/analise/item/update")
def update_analise_item(req: AnaliseItemUpdateRequest):
    if req.componente is not None:
        db.execute_query(
            "UPDATE tabAnaliseItens SET Componente=%s WHERE ID=%s",
            (req.componente.strip(), req.id_item),
        )
    if req.html_snapshot is not None:
        titulo = _titulo_for_analise_item(req.id_item)
        safe_html = _clean_item_html_snapshot(req.html_snapshot, titulo)
        db.execute_query("UPDATE tabAnaliseItens SET Obs=%s, HTML_Snapshot=%s WHERE ID=%s", (req.obs or "", safe_html, req.id_item))
    elif req.obs is not None:
        db.execute_query("UPDATE tabAnaliseItens SET Obs=%s WHERE ID=%s", (req.obs, req.id_item))
    ctx = _lookup_analise_context_by_item(req.id_item)
    if ctx:
        _refresh_analysis_pdf_after_item_change(
            os_id=int(ctx["os_id"]),
            ano=int(ctx["ano"]),
            id_analise=int(ctx["id_analise"]),
            versao=_resolve_pdf_versao(ctx),
        )
    return {"status": "success"}

@router.delete("/analise/item/{item_id}")
@router.post("/analise/item/{item_id}/delete")
def delete_analise_item(item_id: int):
    ctx = _lookup_analise_context_by_item(item_id)
    db.execute_query("DELETE FROM tabAnaliseItens WHERE ID=%s", (item_id,))
    if ctx:
        _refresh_analysis_pdf_after_item_change(
            os_id=int(ctx["os_id"]),
            ano=int(ctx["ano"]),
            id_analise=int(ctx["id_analise"]),
            versao=_resolve_pdf_versao(ctx),
        )
    return {"status": "success"}

@router.post("/analise/item/toggle-resolucao-obrigatoria")
def toggle_resolucao_obrigatoria(req: ToggleResolucaoObrigatoriaRequest):
    """Toggle do campo ResolucaoObrigatoria de um item de análise"""
    try:
        logger.info(f"Toggle resolução obrigatória - ID: {req.id_item}, Valor: {req.resolucao_obrigatoria}")
        
        # Verificar se o item existe
        item_check = db.execute_query("SELECT ID FROM tabAnaliseItens WHERE ID=%s", (req.id_item,))
        if not item_check:
            raise HTTPException(status_code=404, detail="Item não encontrado")
        
        # Atualizar
        db.execute_query(
            "UPDATE tabAnaliseItens SET ResolucaoObrigatoria=%s WHERE ID=%s",
            (1 if req.resolucao_obrigatoria else 0, req.id_item)
        )
        
        logger.info(f"Resolução obrigatória atualizada com sucesso para item {req.id_item}")
        ctx = _lookup_analise_context_by_item(req.id_item)
        if ctx:
            _refresh_analysis_pdf_after_item_change(
                os_id=int(ctx["os_id"]),
                ano=int(ctx["ano"]),
                id_analise=int(ctx["id_analise"]),
                versao=_resolve_pdf_versao(ctx),
            )
        return {"status": "success", "resolucao_obrigatoria": req.resolucao_obrigatoria}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erro ao atualizar resolução obrigatória: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro ao atualizar: {str(e)}")


@router.post("/analise/item/toggle-corrigido-sefoc")
def toggle_corrigido_sefoc(req: ToggleCorrigidoSefocRequest):
    """Marca item como corrigido internamente pela SEFOC (não enviado ao cliente)."""
    try:
        _refresh_analise_item_corrigido_column_flag()
        if not _analise_item_corrigido_column_exists:
            raise HTTPException(
                status_code=503,
                detail="Correção interna indisponível (colunas não migradas).",
            )
        item_check = db.execute_query("SELECT ID FROM tabAnaliseItens WHERE ID=%s", (req.id_item,))
        if not item_check:
            raise HTTPException(status_code=404, detail="Item não encontrado")
        obs_val = (req.obs_correcao_sefoc or "").strip() if req.corrigido_sefoc else ""
        db.execute_query(
            "UPDATE tabAnaliseItens SET CorrigidoSefoc=%s, ObsCorrecaoSefoc=%s WHERE ID=%s",
            (1 if req.corrigido_sefoc else 0, obs_val, req.id_item),
        )
        ctx = _lookup_analise_context_by_item(req.id_item)
        if ctx:
            _refresh_analysis_pdf_after_item_change(
                os_id=int(ctx["os_id"]),
                ano=int(ctx["ano"]),
                id_analise=int(ctx["id_analise"]),
                versao=_resolve_pdf_versao(ctx),
            )
        return {
            "status": "success",
            "corrigido_sefoc": req.corrigido_sefoc,
            "obs_correcao_sefoc": obs_val,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Erro ao atualizar correção SEFOC: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro ao atualizar: {str(e)}")


@router.post("/analise/preview")
def preview_analise(req: AnaliseRequest):
    problemas = []
    for p in req.problemas:
        d = p.dict()
        if d.get("html_snapshot"):
            d["html_snapshot"] = sanitize_html_snapshot(d["html_snapshot"])
        problemas.append(d)
    html = report_service.generate_final_html(req.nro_os, req.ano_os, req.versao, req.componente, req.usuario, problemas)
    return {"html": html}

@router.post("/debug/log")
def log_debug(item: dict):
    with open("server_debug.log", "a", encoding="utf-8") as f:
        f.write(f"[{datetime.datetime.now()}] {item.get('message')}\n")
    return {"status": "ok"}

class GenerateLinkRequest(BaseModel):
    versao: Optional[str] = None
    usuario: Optional[str] = None


def _persist_analise_meta(
    os_id: int,
    ano: int,
    versao: Optional[str] = None,
    componente: Optional[str] = None,
) -> None:
    """Grava Versao/Componente em tabAnalises (usado pelo client_pt.html)."""
    if versao is not None:
        db.execute_query(
            "UPDATE tabAnalises SET Versao = %s WHERE OS = %s AND Ano = %s",
            (versao.strip(), os_id, ano),
        )
    if componente is not None:
        db.execute_query(
            "UPDATE tabAnalises SET Componente = %s WHERE OS = %s AND Ano = %s",
            (componente.strip(), os_id, ano),
        )

def build_consolidated_pt_inner_html(
    ano: int,
    os_id: int,
    *,
    versao: Optional[str] = None,
    id_analise: Optional[int] = None,
) -> str:
    """Monta HTML interno consolidado dos problemas técnicos (sem wrapper de e-mail)."""
    import re

    if id_analise is None:
        header = db.execute_query(
            "SELECT ID, Versao FROM tabAnalises WHERE OS=%s AND Ano=%s",
            (os_id, ano),
        )
        if not header:
            return ""
        id_analise = header[0]["ID"]
        if not versao:
            versao = header[0].get("Versao")

    os_titulo = "Sem Título"
    os_produto = "Produto"
    try:
        details = db.execute_query(
            "SELECT Titulo, TipoPublicacaoLink FROM tabDetalhesServico "
            "WHERE NroProtocoloLinkDet=%s AND AnoProtocoloLinkDet=%s",
            (os_id, ano),
        )
        if details:
            os_titulo = details[0]["Titulo"] or "Sem Título"
            os_produto = details[0]["TipoPublicacaoLink"] or "Produto"
    except Exception as e_det:
        logger.warning("Erro ao buscar detalhes da OS: %s", e_det)

    _refresh_analise_item_versao_column_flag()
    versao_col = (
        "i.Versao as versaoOrigem"
        if _analise_item_versao_column_exists
        else "NULL as versaoOrigem"
    )
    items_raw = db.execute_query(
        f"""
        SELECT i.Componente, i.HTML_Snapshot, {versao_col},
               p.TituloPT AS titulo
        FROM tabAnaliseItens i
        LEFT JOIN tabProblemasPadrao p ON i.ID_ProblemaPadrao = p.ID
        WHERE i.ID_Analise = %s AND {_analise_items_client_sql_filter()}
        """,
        (id_analise,),
    )
    items = _filter_items_for_analise_version(items_raw, versao, ano, os_id)
    if not items:
        return ""

    safe_versao = versao if versao else ""
    ver_clean = (
        safe_versao.lower()
        .replace("original", "")
        .replace("v", "")
        .replace("(", "")
        .replace(")", "")
        .strip()
    )
    label_versao = f"V{ver_clean}" if ver_clean else "V?"

    html_final = f"""
        <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; background-color: white; padding-bottom: 50px;">
            <div style="margin-bottom: 30px;">
                <div style="background-color: #8B0000; color: white; padding: 10px 15px; font-weight: bold; font-style: italic; font-size: 20px; display: flex; align-items: center;">
                    <span style="margin-right: 10px;">&#10148;</span>
                    OS {os_id}/{ano} - {os_produto} - {os_titulo}
                </div>
                <div style="text-align: left; margin-top: 25px; color: #000; font-size: 14px;">
                    <p style="font-weight: bold; margin-bottom: 15px; font-size: 16px; text-indent: 40px;">PROBLEMAS TÉCNICOS - ARQUIVO {label_versao}</p>
                    <p style="margin-bottom: 15px; text-indent: 40px;">Segue a relação de Problemas Técnicos detectados na referida Ordem de Serviço.</p>
                    <p style="line-height: 1.5; text-indent: 40px;">
                        Informamos que o <span style="color: #990000; font-weight: bold;">serviço ficará pendente</span> até que os problemas descritos sejam solucionados ou que
                        a Gráfica seja informada a respeito dos procedimentos a serem adotados.
                    </p>
                </div>
            </div>
        """

    from services.pt_report_html_service import (
        normalize_item_snapshot_for_report,
        renumber_first_h2,
    )

    itens_capa = [i for i in items if i.get("Componente") == "Capa"]
    itens_miolo = [i for i in items if i.get("Componente") != "Capa"]
    has_capa_section = len(itens_capa) > 0
    has_miolo_section = len(itens_miolo) > 0
    show_section_headers = has_capa_section
    sec_idx = 1

    if has_capa_section:
        if show_section_headers:
            html_final += f"""
                <div class="section-capa" style="margin-bottom: 20px;">
                    <h3 style="background: #8B0000; color: white; padding: 10px 15px; font-style: italic; font-weight: bold; margin-bottom: 0;">{sec_idx}. Capa</h3>
                    <div style="padding: 15px;">
                """
        else:
            html_final += """<div class="section-capa" style="margin-bottom: 20px;"><div style="padding: 15px;">"""
        for i, item in enumerate(itens_capa, start=1):
            snapshot = normalize_item_snapshot_for_report(
                item.get("HTML_Snapshot", "") or "",
                item_titulo=item.get("titulo"),
            )
            new_snapshot = renumber_first_h2(snapshot, f"{sec_idx}.{i}.")
            html_final += f"<div class='item-snapshot' style='margin-bottom: 20px;'>{new_snapshot}</div>"
        html_final += "</div></div>"
        sec_idx += 1

    if has_miolo_section:
        if show_section_headers:
            html_final += f"""
                <div class="section-miolo" style="margin-top: 20px;">
                    <h3 style="background: #8B0000; color: white; padding: 10px 15px; font-style: italic; font-weight: bold; margin-bottom: 0;">{sec_idx}. Miolo / Conteúdo Interno</h3>
                    <div style="padding: 15px;">
                """
        else:
            html_final += """<div class="section-miolo" style="margin-top: 20px;"><div style="padding: 15px;">"""
        for i, item in enumerate(itens_miolo, start=1):
            snapshot = normalize_item_snapshot_for_report(
                item.get("HTML_Snapshot", "") or "",
                item_titulo=item.get("titulo"),
            )
            new_snapshot = renumber_first_h2(snapshot, f"{sec_idx}.{i}.")
            html_final += f"<div class='item-snapshot' style='margin-bottom: 20px;'>{new_snapshot}</div>"
        html_final += "</div></div>"

    html_final += "</div>"
    return html_final


def _persist_relatorio_analise(
    id_analise: int,
    os_id: int,
    ano: int,
    html_final: str,
    versao: Optional[str] = None,
    *,
    portal_url: Optional[str] = None,
) -> str:
    """Grava RelatorioHTML/RelatorioEmail usando o modelo ativo da categoria PT."""
    os_titulo = "Sem Título"
    os_produto = "Produto"
    try:
        details = db.execute_query(
            "SELECT Titulo, TipoPublicacaoLink FROM tabDetalhesServico "
            "WHERE NroProtocoloLinkDet=%s AND AnoProtocoloLinkDet=%s",
            (os_id, ano),
        )
        if details:
            os_titulo = details[0]["Titulo"] or "Sem Título"
            os_produto = details[0]["TipoPublicacaoLink"] or "Produto"
    except Exception as e_det:
        logger.warning("Erro ao buscar detalhes da OS: %s", e_det)

    variables = {
        "nr_os": os_id,
        "ano": ano,
        "produto": os_produto,
        "titulo": os_titulo,
        "versao": (versao or "").strip() or "1",
    }
    if portal_url:
        variables["link"] = portal_url

    email_completo = html_final
    try:
        from services.email_template_model_service import render_pt_email, resolve_pt_send_plan

        plan = resolve_pt_send_plan()
        if plan.get("legacy_fallback"):
            from services.email_template_service import wrap_report_html

            email_completo = wrap_report_html(html_final, variables)
        else:
            _, email_completo = render_pt_email(ano, os_id, variables, plan=plan)
    except Exception as e_email_gen:
        logger.error("Erro gerando RelatorioEmail: %s", e_email_gen)

    try:
        db.execute_query(
            "UPDATE tabAnalises SET RelatorioHTML = %s, RelatorioEmail = %s WHERE ID = %s",
            (html_final, email_completo, id_analise),
        )
    except Exception as e:
        err_msg = str(e).lower()
        try:
            if "unknown column" in err_msg:
                if "relatoriohtml" in err_msg:
                    db.execute_query("ALTER TABLE tabAnalises ADD COLUMN RelatorioHTML LONGTEXT")
                try:
                    db.execute_query("ALTER TABLE tabAnalises ADD COLUMN RelatorioEmail LONGTEXT")
                except Exception as e_col:
                    logger.exception("Não foi possível criar coluna RelatorioEmail: %s", e_col)
                db.execute_query(
                    "UPDATE tabAnalises SET RelatorioHTML = %s, RelatorioEmail = %s WHERE ID = %s",
                    (html_final, email_completo, id_analise),
                )
            else:
                raise
        except Exception as e2:
            logger.error("Erro ao persistir relatório análise: %s", e2)
    return email_completo


@router.post("/analise/{ano}/{os_id}/generate-link")
def generate_client_link(ano: int, os_id: int, request: Request, body: GenerateLinkRequest = None):
    # Nota: FastAPI injection de 'body' pode conflitar com 'request' se não tipado corretamente.
    # Vamos usar `req_body` se definido.
    
    # 1. Obter ID da Análise e Versão do Banco (Fallback)
    analise = db.execute_query("SELECT ID, Versao, Componente FROM tabAnalises WHERE OS=%s AND Ano=%s", (os_id, ano))
    if not analise:
        raise HTTPException(status_code=404, detail="Análise não encontrada. Salve-a antes de gerar o link.")
    
    id_analise = analise[0]['ID']
    db_versao = analise[0]['Versao']
    
    # Priorizar versão enviada pelo front, senão usar do banco
    versao = body.versao if (body and body.versao) else db_versao
    if versao and str(versao).strip():
        _persist_analise_meta(os_id, ano, versao=str(versao).strip())

    # --- Gerar Relatório HTML Personalizado (CONSOLIDADO) ---
    html_final = ""
    try:
        html_final = build_consolidated_pt_inner_html(
            ano, os_id, versao=versao, id_analise=id_analise
        )
        if html_final:
            try:
                db.execute_query(
                    "UPDATE tabAnalises SET RelatorioHTML = %s WHERE ID = %s",
                    (html_final, id_analise),
                )
            except Exception as e_inner:
                err_msg = str(e_inner).lower()
                if "unknown column" in err_msg and "relatoriohtml" in err_msg:
                    db.execute_query("ALTER TABLE tabAnalises ADD COLUMN RelatorioHTML LONGTEXT")
                    db.execute_query(
                        "UPDATE tabAnalises SET RelatorioHTML = %s WHERE ID = %s",
                        (html_final, id_analise),
                    )
                else:
                    raise
            logger.info("Relatório HTML interno salvo na tabAnalises para ID %s", id_analise)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Erro ao gerar relatório HTML personalizado: %s", e)
        raise HTTPException(status_code=500, detail=f"Erro ao salvar Relatório HTML: {str(e)}") from e

    # --- FIM NOVA LÓGICA ---

    # 2. Verificar se já existe token
    existing = db.execute_query("SELECT Token FROM tabClientTokens WHERE ID_Analise=%s AND NroProtocolo=%s AND AnoProtocolo=%s", (id_analise, os_id, ano))
    
    if existing:
        token = existing[0]['Token']
    else:
        # 3. Gerar novo token seguro
        token = secrets.token_urlsafe(48) 
        db.execute_query("INSERT INTO tabClientTokens (ID_Analise, NroProtocolo, AnoProtocolo, Token) VALUES (%s, %s, %s, %s)",
                         (id_analise, os_id, ano, token))

    # 4. Construir URL para portal do cliente (intranet cgrafsysvm; auth por token)
    from services.activation_email_service import resolve_link_web_base

    host_url = resolve_link_web_base()
    final_url = f"{host_url.rstrip('/')}/portal/pt/{token}?os={os_id}&ano={ano}"

    session = get_session_from_request(request)
    ponto = None
    if body and body.usuario:
        ponto = body.usuario
    elif session:
        ponto = str(session.ponto)

    try:
        log_link_generated_db(
            db,
            nro=os_id,
            ano=ano,
            url=final_url,
            link_type="problemas_tecnicos",
            ponto=ponto,
            origem="ANALISE",
        )
    except Exception as e_audit:
        logger.error(f"Erro ao registrar log de link gerado: {e_audit}")

    if html_final:
        try:
            _persist_relatorio_analise(
                id_analise,
                os_id,
                ano,
                html_final,
                versao=versao,
                portal_url=final_url,
            )
            logger.info("RelatorioEmail gerado com modelo ativo para ID %s", id_analise)
        except Exception as e_persist_email:
            logger.error("Erro ao persistir RelatorioEmail com modelo ativo: %s", e_persist_email)

        try:
            from services.pt_report_pdf_service import refresh_pt_analysis_pdf

            pdf_path = refresh_pt_analysis_pdf(
                ano,
                os_id,
                versao=versao,
                id_analise=id_analise,
                inner_html=html_final,
            )
            if pdf_path:
                logger.info("PDF consolidado de PT salvo em AdminDocs: %s", pdf_path)
        except Exception as e_pdf:
            logger.error("Erro ao gerar PDF consolidado de PT: %s", e_pdf)

    # 5. Gerar e salvar HTML do e-mail PT (modelo configurável)
    try:
        from services.email_template_service import (
            apply_protocol_link_template,
            get_template_defaults,
        )

        defaults = get_template_defaults("pt_protocol_link")
        base_html = defaults.get("default_html") or ""
        email_html = apply_protocol_link_template(
            base_html,
            final_url,
            {"nr_os": os_id, "ano": ano, "versao": versao},
        )
        db.execute_query(
            """
                UPDATE tabProtocolos
                SET email_pt_html = %s, email_pt_versao = %s, email_pt_data = NOW()
                WHERE NroProtocolo = %s AND AnoProtocolo = %s
            """,
            (email_html, versao, os_id, ano),
        )
    except Exception as e:
        logger.error("Erro ao gerar HTML do e-mail PT: %s", e)

    return {"url": final_url}

@router.get("/analise/client/{ano}/{os_id}")
def validate_client_token(ano: int, os_id: int, token: str = Query(...)):
    token_row = _validate_client_token_row(os_id, ano, token)
    id_analise = token_row["ID_Analise"]

    # 2. Buscar Dados da Análise (inclui relatório consolidado gerado no generate-link)
    header = db.execute_query(
        "SELECT ID, Versao, Componente, RelatorioHTML, RelatorioEmail FROM tabAnalises WHERE ID=%s",
        (id_analise,),
    )
    if not header:
        raise HTTPException(status_code=404, detail="Análise não encontrada.")

    os_titulo = "Sem Título"
    os_produto = "Produto"
    try:
        details = db.execute_query(
            "SELECT Titulo, TipoPublicacaoLink FROM tabDetalhesServico WHERE NroProtocoloLinkDet=%s AND AnoProtocoloLinkDet=%s",
            (os_id, ano),
        )
        if details:
            os_titulo = details[0].get("Titulo") or os_titulo
            os_produto = details[0].get("TipoPublicacaoLink") or os_produto
    except Exception as e_det:
        logger.warning("Detalhes da OS indisponíveis para portal cliente: %s", e_det)

    # 3. Buscar Itens (ações desconsiderar/resolver) — somente versão atual da análise
    _refresh_analise_item_versao_column_flag()
    _refresh_analise_item_corrigido_column_flag()
    titulo_sql, migracao_join = _analise_item_titulo_sql_parts()
    versao_col = (
        "i.Versao as versaoOrigem,"
        if _analise_item_versao_column_exists
        else "NULL as versaoOrigem,"
    )
    corrigido_col = (
        "i.CorrigidoSefoc as corrigidoSefoc,"
        if _analise_item_corrigido_column_exists
        else "0 as corrigidoSefoc,"
    )
    items = db.execute_query(f"""
        SELECT i.ID as uniqueId, i.ID_ProblemaPadrao as originalId, i.Obs as obs, i.HTML_Snapshot as html,
               i.Componente as componenteOrigem, {versao_col} {corrigido_col} {titulo_sql}, i.Desconsiderado as desconsiderado,
               i.Resolver as resolver, i.ResolucaoObrigatoria as resolucaoObrigatoria
        FROM tabAnaliseItens i
        LEFT JOIN tabProblemasPadrao p ON i.ID_ProblemaPadrao = p.ID
        {migracao_join}
        WHERE i.ID_Analise = %s
    """, (id_analise,))

    header_row = header[0]
    versao_raw = header_row.get("Versao")
    versao_label = _resolve_version_display_label(ano, os_id, versao_raw)
    items_for_portal = _filter_items_for_analise_version(items, versao_raw, ano, os_id)
    items_for_portal = [
        i for i in items_for_portal if not bool(i.get("corrigidoSefoc"))
    ]
    normalized_items = []
    for i in items_for_portal:
        item_row = _normalize_client_portal_item(i)
        if item_row.get("html"):
            item_row["html"] = _rewrite_indication_urls_for_client(
                item_row["html"], token, os_id, ano
            )
        normalized_items.append(item_row)

    upload_status = _client_portal_upload_status(
        normalized_items, os_id, ano, versao_label=versao_raw
    )

    return {
        "exists": True,
        "items": normalized_items,
        "componente": header_row.get("Componente"),
        "titulo": f"OS {os_id}/{ano}",
        "osTitulo": os_titulo,
        "osProduto": os_produto,
        "versao": versao_raw,
        "versaoLabel": versao_label,
        "relatorioHtml": header_row.get("RelatorioHTML"),
        "relatorioEmail": header_row.get("RelatorioEmail"),
        "componentesEnviados": upload_status["componentesEnviados"],
        "portalComplete": upload_status["portalComplete"],
    }

# --- HELPER DE ANDAMENTO ---
def add_movement_internal(cursor, os_id, ano, situacao, setor, ponto, obs):
    from services.andamento_operacional import insert_andamento_as_ultimo, next_cod_status_for_os

    obs_formatada = format_andamento_obs(obs or "")
    ponto_formatado = format_ponto(ponto)
    new_cod = next_cod_status_for_os(cursor, os_id, ano)
    insert_andamento_as_ultimo(
        cursor,
        cod_status=new_cod,
        nro=os_id,
        ano=ano,
        situacao=situacao,
        setor=setor,
        obs=obs_formatada,
        ponto=ponto_formatado,
    )
    log_andamento_added(
        cursor,
        nro=os_id,
        ano=ano,
        cod_status=new_cod,
        situacao=situacao,
        setor=setor,
        obs=obs_formatada,
        ponto=ponto_formatado,
        origem="ANALISE",
    )
    return new_cod


def _http_error_from_andamento_write(exc: Exception) -> HTTPException:
    if "Duplicate entry" in str(exc):
        return HTTPException(
            status_code=409, detail="Erro de concorrência. Tente novamente."
        )
    return HTTPException(status_code=500, detail=str(exc))


def _push_movement_to_mdb(cod_status: str, os_id: int, ano: int, *, task_name: str) -> None:
    """Replica andamento automático no MDB após commit MySQL (background)."""
    from routers.mdb_writer import push_andamento_to_mdb_after_mysql

    push_andamento_to_mdb_after_mysql(
        cod_status, os_id, ano, operation="insert", task_name=task_name
    )


# --- CLIENT PORTAL ENDPOINTS ---

@router.get("/client/report/{ano}/{os_id}")
def generate_client_report_pdf(ano: int, os_id: int, request: Request, token: str = Query(...)):
    # 1. Validar e Buscar Dados (Reutilizando logica)
    data = validate_client_token(ano, os_id, token)
    
    
    # 3. Gerar PDF com FPDF2
    try:
        pdf = FPDF()
        pdf.set_auto_page_break(auto=True, margin=15)
        pdf.add_page()
        
        # Cabeçalho
        pdf.set_font("Arial", "B", 16)
        pdf.cell(0, 10, f"Relatório Técnico - OS {os_id}/{ano}", ln=True, align="C")
        pdf.set_font("Arial", "", 12)
        pdf.cell(0, 10, data['titulo'], ln=True, align="C")
        pdf.line(10, 30, 200, 30)
        pdf.ln(10)
        
        # Itens
        for idx, item in enumerate(data['items'], start=1):
            # Título
            pdf.set_font("Arial", "B", 14)
            status_txt = ""
            if item.get('desconsiderado'):
                pdf.set_text_color(192, 57, 43)
                status_txt = " (DESCONSIDERADO)"
            elif item.get('resolver'):
                pdf.set_text_color(39, 174, 96)
                status_txt = " (RESOLVIDO)"
            else:
                pdf.set_text_color(0, 0, 0)
                
            pdf.cell(0, 10, f"{idx}. {item['titulo']}{status_txt}", ln=True)
            pdf.set_text_color(0, 0, 0)
            
            # Componente
            pdf.set_font("Arial", "I", 10)
            pdf.set_text_color(100, 100, 100)
            pdf.cell(0, 8, f"Componente: {item.get('componenteOrigem') or 'Geral'}", ln=True)
            pdf.set_text_color(0, 0, 0)
            
            # HTML Evidence (Fallback Seguro - Text Only)
            if item.get('html') and len(item['html'].strip()) > 0:
                # Remove tags basicas para nao poluir
                import re
                clean_text = re.sub('<[^<]+?>', '', item['html'])
                pdf.set_font("Courier", "", 9)
                pdf.multi_cell(0, 5, f"Evidencia (Texto):\n{clean_text[:2000]}") # Limit length
            else:
                pdf.set_font("Arial", "I", 10)
                pdf.cell(0, 10, "(Sem evidência visual)", ln=True)
                
            pdf.ln(5)
            
            # Observação
            pdf.set_font("Arial", "B", 10)
            pdf.cell(0, 6, "Observação Técnica:", ln=True)
            pdf.set_font("Arial", "", 10)
            pdf.multi_cell(0, 5, item.get('obs') or "(Sem observações)")
            
            pdf.ln(5)
            pdf.set_draw_color(200, 200, 200)
            pdf.line(10, pdf.get_y(), 200, pdf.get_y())
            pdf.set_draw_color(0, 0, 0)
            pdf.ln(5)
            
        # Output
        buffer = io.BytesIO()
        pdf.output(buffer)
        buffer.seek(0)
        
        return StreamingResponse(
            buffer, 
            media_type="application/pdf", 
            headers={"Content-Disposition": f"attachment; filename=Relatorio_OS_{os_id}_{ano}.pdf"}
        )
    except Exception as e:
        logger.error(f"Erro gerando PDF (FPDF): {e}")
        # Fallback de erro visível
        return StreamingResponse(
            io.BytesIO(f"Erro ao gerar PDF: {str(e)}".encode('utf-8')),
            media_type="text/plain"
        )

@router.get("/client/upload-mode")
def client_upload_mode():
    """Indica se o portal deve enviar arquivos direto ao Google Drive (economiza banda zrok)."""
    try:
        from services.gdrive_portal_upload import (
            gdrive_config_ready,
            is_portal_gdrive_upload_enabled,
        )

        if is_portal_gdrive_upload_enabled() and gdrive_config_ready():
            return {"mode": "gdrive", "enabled": True}
    except Exception as exc:
        logger.warning("Upload-mode gdrive indisponível: %s", exc)
    return {"mode": "server", "enabled": True}


@router.post("/client/upload-session")
def client_upload_session(req: ClientUploadSessionRequest):
    """Cria sessões de upload resumável no Drive (metadados apenas; bytes vão ao Google)."""
    try:
        from services.gdrive_portal_upload import (
            create_upload_sessions,
            gdrive_config_ready,
            is_portal_gdrive_upload_enabled,
        )

        if not is_portal_gdrive_upload_enabled() or not gdrive_config_ready():
            raise HTTPException(
                status_code=503,
                detail="Upload via Google Drive não está habilitado neste servidor.",
            )

        _validate_client_token_row(req.os_id, req.ano, req.token)
        if not req.files:
            raise HTTPException(status_code=400, detail="Nenhum arquivo informado.")

        uploads = create_upload_sessions(
            req.ano,
            req.os_id,
            req.componente,
            req.token,
            req.files,
        )
        return {"status": "success", "uploads": uploads}
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("upload-session error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/client/upload-complete")
def client_upload_complete(req: ClientUploadCompleteRequest):
    """Baixa arquivos do staging Drive para a pasta Original da OS na rede."""
    try:
        from services.gdrive_portal_upload import (
            fetch_and_consume_staging_file,
            gdrive_config_ready,
            get_drive_service,
            get_staging_folder_id,
            is_portal_gdrive_upload_enabled,
        )

        if not is_portal_gdrive_upload_enabled() or not gdrive_config_ready():
            raise HTTPException(
                status_code=503,
                detail="Upload via Google Drive não está habilitado neste servidor.",
            )
        if not req.files:
            raise HTTPException(status_code=400, detail="Nenhum arquivo informado.")

        token_row = _validate_client_token_row(req.os_id, req.ano, req.token)
        id_analise = token_row["ID_Analise"]

        header = db.execute_query(
            "SELECT Versao FROM tabAnalises WHERE ID=%s",
            (id_analise,),
        )
        versao_label = header[0]["Versao"] if header else ""

        item_titulo, item_componente = _resolve_client_upload_item_context(
            id_analise, req.id_item, req.componente
        )

        target_os_dir = _resolve_os_folder_for_client_upload(req.ano, req.os_id)
        final_dir, folder_name, version_index = _resolve_client_portal_upload_folder(
            target_os_dir, versao_label, portal_session_active=True
        )

        service = get_drive_service()
        staging_id = get_staging_folder_id(service)
        saved_files: List[str] = []

        for entry in req.files:
            file_id = str(entry.get("drive_file_id") or entry.get("id") or "").strip()
            original_name = str(entry.get("name") or "arquivo").strip()
            if not file_id:
                raise HTTPException(status_code=400, detail="drive_file_id ausente.")
            safe_name = os.path.basename(original_name)
            dest_path = os.path.join(final_dir, safe_name)
            tmp_path = dest_path + ".uploading"
            try:
                saved_name = fetch_and_consume_staging_file(
                    service,
                    file_id,
                    staging_id,
                    tmp_path,
                    ano=req.ano,
                    os_id=req.os_id,
                    token=req.token,
                    expected_original_name=original_name,
                )
                if os.path.getsize(tmp_path) <= 0:
                    raise ValueError(f"Arquivo vazio: {saved_name}")
                os.replace(tmp_path, dest_path)
                saved_files.append(saved_name)
            except Exception:
                if os.path.exists(tmp_path):
                    try:
                        os.remove(tmp_path)
                    except OSError:
                        pass
                raise

        logger.info(
            "Upload cliente (Drive) OS %s/%s: %s arquivo(s) em %s",
            req.os_id,
            req.ano,
            len(saved_files),
            final_dir,
        )

        return _finalize_client_portal_upload(
            os_id=req.os_id,
            ano=req.ano,
            token=req.token,
            ponto=req.ponto,
            id_analise=id_analise,
            versao_label=versao_label,
            item_titulo=item_titulo,
            item_componente=item_componente,
            folder_name=folder_name,
            saved_files=saved_files,
            upload_dir=final_dir,
            version_index=version_index,
        )
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("upload-complete error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/client/upload-files")
def client_upload_files(
    os_id: int = Form(...),
    ano: int = Form(...),
    ponto: str = Form(...),
    files: List[UploadFile] = File(...),
    componentes: str = Form(""),
    token: str = Form(...),
    id_item: Optional[int] = Form(None),
    componente: Optional[str] = Form(None),
):
    try:
        if not files:
            raise HTTPException(status_code=400, detail="Nenhum arquivo enviado.")

        token_row = _validate_client_token_row(os_id, ano, token)
        id_analise = token_row["ID_Analise"]

        header = db.execute_query(
            "SELECT Versao FROM tabAnalises WHERE ID=%s",
            (id_analise,),
        )
        versao_label = header[0]["Versao"] if header else ""

        item_titulo, item_componente = _resolve_client_upload_item_context(
            id_analise, id_item, componente
        )

        target_os_dir = _resolve_os_folder_for_client_upload(ano, os_id)
        final_dir, folder_name, version_index = _resolve_client_portal_upload_folder(
            target_os_dir, versao_label, portal_session_active=True
        )

        saved_files = []
        for file in files:
            saved_files.append(_save_client_upload_file(file, final_dir))

        logger.info(
            "Upload cliente OS %s/%s: %s arquivo(s) em %s (versão portal: %r → %s)",
            os_id,
            ano,
            len(saved_files),
            final_dir,
            versao_label,
            folder_name,
        )

        return _finalize_client_portal_upload(
            os_id=os_id,
            ano=ano,
            token=token,
            ponto=ponto,
            id_analise=id_analise,
            versao_label=versao_label,
            item_titulo=item_titulo,
            item_componente=item_componente,
            folder_name=folder_name,
            saved_files=saved_files,
            upload_dir=final_dir,
            version_index=version_index,
        )
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Upload error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class DisregardRequest(BaseModel):
    id_item: int
    nome_cliente: str
    ponto: str
    os_id: int
    ano: int

@router.post("/client/desconsiderar-item")
def client_disregard_item(req: DisregardRequest):
    # Verificar se o item tem resolução obrigatória
    item_check = db.execute_query(
        "SELECT ResolucaoObrigatoria FROM tabAnaliseItens WHERE ID = %s", 
        (req.id_item,)
    )
    
    if not item_check:
        raise HTTPException(status_code=404, detail="Item não encontrado")
    
    if item_check[0]['ResolucaoObrigatoria'] == 1:
        raise HTTPException(
            status_code=403, 
            detail="Este item possui resolução obrigatória e não pode ser desconsiderado"
        )
    
    def transaction(cursor):
        cursor.execute("""
            UPDATE tabAnaliseItens 
            SET Desconsiderado = 1, ClienteNome = %s, ClientePonto = %s, DataDesconsiderado = NOW()
            WHERE ID = %s
        """, (req.nome_cliente, req.ponto, req.id_item))
        
        cursor.execute("SELECT ID_Analise FROM tabAnaliseItens WHERE ID = %s", (req.id_item,))
        anl = cursor.fetchone()
        if not anl: return {"moved": False}
        
        id_analise = anl['ID_Analise']
        
        cursor.execute("SELECT COUNT(*) as ativos FROM tabAnaliseItens WHERE ID_Analise = %s AND Desconsiderado = 0", (id_analise,))
        res = cursor.fetchone()
        
        if res['ativos'] == 0:
            cod = add_movement_internal(
                cursor,
                req.os_id,
                req.ano,
                "Em Execução",
                "SEFOC",
                req.ponto,
                "Todos os itens técnicos foram desconsiderados pelo cliente.",
            )
            return {"moved": True, "cod_status": cod}

        return {"moved": False}

    try:
        res = db.execute_transaction([transaction])
        payload = res[0]
        if payload.get("moved") and payload.get("cod_status"):
            _push_movement_to_mdb(
                payload["cod_status"],
                req.os_id,
                req.ano,
                task_name="portal_items_disregarded",
            )
        if payload.get("moved"):
            from routers.realtime import broadcast_os_system_update

            broadcast_os_system_update(
                req.os_id,
                req.ano,
                "portal_items_disregarded",
                setor="SEFOC",
                origem="portal_cliente",
            )
        return payload
    except Exception as e:
        logger.error(f"Disregard error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

class ResolverRequest(BaseModel):
    id_item: int

@router.post("/client/resolver-item")
def client_resolve_item(req: ResolverRequest):
    def transaction(cursor):
        cursor.execute("""
            UPDATE tabAnaliseItens 
            SET Resolver = 1, Desconsiderado = 0, DataResolver = NOW()
            WHERE ID = %s
        """, (req.id_item,))
        return {"status": "success"}

    try:
        return db.execute_transaction([transaction])[0]
    except Exception as e:
        logger.error(f"Resolve error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

class LinkMovementRequest(BaseModel):

    os_id: int
    ano: int
    usuario: str
    link: str
    versao: str
    observacao: Optional[str] = None

@router.post("/analise/client/register-link-movement")
def register_link_movement(req: LinkMovementRequest):
    def transaction(cursor):
        # Limpeza da string de versão para formatar como PTVx
        ver_clean = req.versao.lower().replace("original", "").replace("v", "").replace("(", "").replace(")", "").strip()
        obs_ver = f"PTV{ver_clean}" if ver_clean else "PTV?"
        
        custom_obs = (req.observacao or "").strip()
        if custom_obs:
            obs = custom_obs
        else:
            obs = f"Problemas técnicos na {obs_ver} registrados"
        
        cod = add_movement_internal(
            cursor, req.os_id, req.ano, "Problemas Técnicos", "SEFOC", req.usuario, obs
        )
        return {"status": "success", "cod_status": cod}

    try:
        result = db.execute_transaction([transaction])[0]
        if result.get("cod_status"):
            _push_movement_to_mdb(
                result["cod_status"],
                req.os_id,
                req.ano,
                task_name="portal_link_movement",
            )
        from routers.realtime import broadcast_os_system_update

        broadcast_os_system_update(
            req.os_id,
            req.ano,
            "portal_link_movement",
            setor="SEFOC",
            origem="portal_cliente",
        )
        return result
    except Exception as e:
        logger.error(f"Link Register error: {e}")
        raise _http_error_from_andamento_write(e)

class PtvDispatchRequest(BaseModel):
    os_id: int
    ano: int
    usuario: str
    versao: str
    observacao: Optional[str] = None

@router.post("/analise/register-ptv-dispatch")
def register_ptv_dispatch(req: PtvDispatchRequest):
    """
    Registra andamento de Encaminhamento de Documentacao quando usuario clica em Concluir
    e a OS ja estava com status Problemas Tecnicos.
    """
    def transaction(cursor):
        ver_clean = req.versao.lower().replace("original", "").replace("v", "").replace("(", "").replace(")", "").strip()
        obs_ver = f"PTV{ver_clean}" if ver_clean else "PTV?"
        
        custom_obs = (req.observacao or "").strip()
        obs = custom_obs if custom_obs else f"Enviar {obs_ver}"
        
        cod = add_movement_internal(
            cursor, req.os_id, req.ano, "Encam. de Docum.", "SEFOC", req.usuario, obs
        )
        return {"status": "success", "cod_status": cod}

    try:
        result = db.execute_transaction([transaction])[0]
        if result.get("cod_status"):
            _push_movement_to_mdb(
                result["cod_status"],
                req.os_id,
                req.ano,
                task_name="portal_ptv_dispatch",
            )
        from routers.realtime import broadcast_os_system_update

        broadcast_os_system_update(
            req.os_id,
            req.ano,
            "portal_ptv_dispatch",
            setor="SEFOC",
            origem="portal_cliente",
        )
        return result
    except Exception as e:
        logger.error(f"PTV Dispatch Register error: {e}")
        raise _http_error_from_andamento_write(e)

@router.get("/os/{ano}/{id}/ultimo-andamento")
def get_last_movement(ano: int, id: int):
    try:
        from services.os_ultimo_andamento_service import fetch_operacional_row

        row = fetch_operacional_row(id, ano)
        if not row:
            return {"situacao": None}
        ponto = row.get("ponto")
        return {
            "situacao": row.get("situacao"),
            "setor": row.get("setor"),
            "ponto": ponto,
            "obs": row.get("observacao"),
            "data": row.get("data"),
            "usuario": ponto,
        }
    except Exception as e:
        logger.error(f"Error getting last movement: {e}")
        raise HTTPException(status_code=500, detail=str(e))

class StartAnalysisRequest(BaseModel):
    os_id: int
    ano: int
    ponto: str
    usuario: str

class ExecutionMovementRequest(BaseModel):
    os_id: int
    ano: int
    observacao: str
    ponto: str

@router.post("/analise/start")
def start_analysis_mark(req: StartAnalysisRequest):
    def transaction(cursor):
        cod = add_movement_internal(
            cursor, req.os_id, req.ano, "Recebido", "SEFOC", req.ponto, "Em análise"
        )
        return {"status": "started", "cod_status": cod}

    try:
        result = db.execute_transaction([transaction])[0]
        if result.get("cod_status"):
            _push_movement_to_mdb(
                result["cod_status"],
                req.os_id,
                req.ano,
                task_name="analise_start",
            )
        from routers.realtime import broadcast_os_system_update

        broadcast_os_system_update(
            req.os_id,
            req.ano,
            "analise_started",
            setor="SEFOC",
            situacao="Recebido",
            origem="analise",
        )
        return result
    except Exception as e:
        logger.error(f"Start analysis error: {e}")
        raise _http_error_from_andamento_write(e)

@router.get("/analise/legacy-pt/{sat_codigo}/pdf")
def serve_legacy_sat_pt_pdf(
    sat_codigo: int,
    request: Request,
    token: Optional[str] = Query(None),
    os: Optional[int] = Query(None),
    ano: Optional[int] = Query(None),
):
    """PDF legado importado do SAT (tabRegistroPT). Sessão interna ou token do portal."""
    from services.sat_registro_pt_migration import get_legacy_pdf_path

    session = get_session_from_request(request)
    if not session:
        if not token or os is None or ano is None:
            raise HTTPException(status_code=403, detail="Acesso negado.")
        _validate_client_token_row(os, ano, token)

    pdf_path = get_legacy_pdf_path(sat_codigo)
    if not pdf_path:
        raise HTTPException(status_code=404, detail="PDF legado não encontrado.")
    return FileResponse(pdf_path, media_type="application/pdf", filename=os.path.basename(pdf_path))


@router.post("/analise/register-execution-movement")
def register_execution_movement(req: ExecutionMovementRequest):
    """
    Registra andamento de "Em Execução" quando análise é concluída sem problemas técnicos
    """
    def transaction(cursor):
        cod = add_movement_internal(
            cursor, req.os_id, req.ano, "Em Execução", "SEFOC", req.ponto, req.observacao
        )
        return {
            "status": "success",
            "message": "Andamento registrado com sucesso",
            "cod_status": cod,
        }

    try:
        logger.info(f"Registrando andamento de execução para OS {req.os_id}/{req.ano}")
        result = db.execute_transaction([transaction])[0]
        if result.get("cod_status"):
            _push_movement_to_mdb(
                result["cod_status"],
                req.os_id,
                req.ano,
                task_name="portal_execution_movement",
            )
        from routers.realtime import broadcast_os_system_update

        broadcast_os_system_update(
            req.os_id,
            req.ano,
            "portal_execution_movement",
            setor="SEFOC",
            origem="portal_cliente",
        )
        logger.info(f"Andamento registrado: {result}")
        return result
    except Exception as e:
        logger.error(f"Error registering execution movement: {e}")
        raise _http_error_from_andamento_write(e)