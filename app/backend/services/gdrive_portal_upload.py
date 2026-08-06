"""
Upload do portal cliente via Google Drive (resumable).

O navegador envia os bytes direto para googleapis.com; o túnel zrok só
transporta metadados (sessão + confirmação). O servidor baixa do Drive na rede local.
"""
from __future__ import annotations

import glob
import hashlib
import io
import logging
import os
import re
import secrets
from pathlib import Path
from typing import Any, Optional

import requests
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

logger = logging.getLogger(__name__)

SCOPES = ["https://www.googleapis.com/auth/drive"]
_DRIVE_UPLOAD_INIT = "https://www.googleapis.com/upload/drive/v3/files"


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name, "").strip().lower()
    if not raw:
        return default
    return raw in ("1", "true", "yes", "on")


def is_portal_gdrive_upload_enabled() -> bool:
    return _env_bool("SAGRA_PORTAL_UPLOAD_GDRIVE", False)


def credentials_dir() -> Path:
    raw = os.getenv("SAGRA_GDRIVE_CREDENTIALS_DIR", "config/gdrive").strip()
    path = Path(raw)
    if not path.is_absolute():
        # Raiz do projeto = pai de app/backend
        backend_dir = Path(__file__).resolve().parents[1]
        project_root = backend_dir.parent.parent
        path = project_root / path
    return path


def staging_folder_name() -> str:
    return os.getenv("SAGRA_GDRIVE_STAGING_FOLDER", "Originais").strip() or "Originais"


def _load_credentials() -> Optional[Credentials]:
    cred_dir = credentials_dir()
    token_path = cred_dir / "token.json"
    if not token_path.is_file():
        return None

    creds = Credentials.from_authorized_user_file(str(token_path), SCOPES)
    if creds and creds.valid:
        return creds
    if creds and creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
            token_path.write_text(creds.to_json(), encoding="utf-8")
            return creds
        except Exception as exc:
            logger.error("Falha ao renovar token Google Drive: %s", exc)
            return None

    secrets = sorted(cred_dir.glob("client_secret*.json"))
    if not secrets:
        return None
    try:
        flow = InstalledAppFlow.from_client_secrets_file(str(secrets[0]), SCOPES)
        creds = flow.run_local_server(port=0)
        token_path.write_text(creds.to_json(), encoding="utf-8")
        return creds
    except Exception as exc:
        logger.error("OAuth Google Drive indisponível: %s", exc)
        return None


def gdrive_config_ready() -> bool:
    if not is_portal_gdrive_upload_enabled():
        return False
    cred_dir = credentials_dir()
    has_secret = bool(list(cred_dir.glob("client_secret*.json")))
    has_token = (cred_dir / "token.json").is_file()
    return has_secret and has_token


def get_drive_service():
    creds = _load_credentials()
    if not creds:
        raise RuntimeError(
            "Credenciais Google Drive ausentes ou expiradas. "
            "Configure config/gdrive (client_secret + token.json)."
        )
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def _find_folder_id(service, name: str) -> str:
    safe = name.replace("'", "\\'")
    query = (
        f"name = '{safe}' and mimeType = 'application/vnd.google-apps.folder' "
        "and trashed = false"
    )
    results = (
        service.files()
        .list(
            q=query,
            fields="files(id, name)",
            supportsAllDrives=True,
            includeItemsFromAllDrives=True,
            pageSize=10,
        )
        .execute()
    )
    files = results.get("files") or []
    if not files:
        raise RuntimeError(f"Pasta Google Drive '{name}' não encontrada.")
    return files[0]["id"]


_staging_folder_id_cache: Optional[str] = None


def get_staging_folder_id(service) -> str:
    global _staging_folder_id_cache
    if _staging_folder_id_cache:
        return _staging_folder_id_cache
    _staging_folder_id_cache = _find_folder_id(service, staging_folder_name())
    return _staging_folder_id_cache


def build_staging_filename(
    ano: int,
    os_id: int,
    componente: str,
    token: str,
    original_name: str,
) -> str:
    safe_comp = re.sub(r"[^\w\-]+", "_", (componente or "arquivo").strip())[:40]
    tok = hashlib.sha256(token.encode("utf-8")).hexdigest()[:12]
    uid = secrets.token_hex(4)
    base = os.path.basename(original_name or "arquivo")
    return f"portal_{ano}_{os_id}_{safe_comp}_{tok}_{uid}__{base}"


def staging_name_matches_os(
    staging_name: str,
    ano: int,
    os_id: int,
    token: str,
) -> bool:
    tok = hashlib.sha256(token.encode("utf-8")).hexdigest()[:12]
    prefix = f"portal_{ano}_{os_id}_"
    return staging_name.startswith(prefix) and f"_{tok}_" in staging_name


def create_resumable_upload(
    creds: Credentials,
    staging_name: str,
    mime_type: str,
    size: int,
    parent_folder_id: str,
) -> str:
    """Retorna URL de upload resumável (PUT direto do navegador)."""
    metadata = {"name": staging_name, "parents": [parent_folder_id]}
    headers = {
        "Authorization": f"Bearer {creds.token}",
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": mime_type or "application/octet-stream",
        "X-Upload-Content-Length": str(size),
    }
    resp = requests.post(
        f"{_DRIVE_UPLOAD_INIT}?uploadType=resumable&supportsAllDrives=true",
        headers=headers,
        json=metadata,
        timeout=60,
    )
    if not resp.ok:
        raise RuntimeError(
            f"Falha ao iniciar upload no Drive ({resp.status_code})."
        )
    location = resp.headers.get("Location")
    if not location:
        raise RuntimeError("Drive não retornou URL de upload resumável.")
    return location


def create_upload_sessions(
    ano: int,
    os_id: int,
    componente: str,
    token: str,
    files: list[dict[str, Any]],
) -> list[dict[str, str]]:
    """
    files: [{name, size, mime?}]
    Retorna [{name, staging_name, upload_url, mime}]
    """
    creds = _load_credentials()
    if not creds:
        raise RuntimeError("Google Drive não configurado.")

    service = get_drive_service()
    folder_id = get_staging_folder_id(service)
    sessions: list[dict[str, str]] = []

    for item in files:
        original = str(item.get("name") or "arquivo").strip()
        if not original:
            raise ValueError("Nome de arquivo inválido.")
        try:
            size = int(item.get("size") or 0)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"Tamanho inválido para {original}") from exc
        if size <= 0:
            raise ValueError(f"Arquivo vazio ou tamanho inválido: {original}")

        mime = str(item.get("mime") or "application/octet-stream").strip()
        staging_name = build_staging_filename(ano, os_id, componente, token, original)
        upload_url = create_resumable_upload(creds, staging_name, mime, size, folder_id)
        sessions.append(
            {
                "name": original,
                "staging_name": staging_name,
                "upload_url": upload_url,
                "mime": mime,
            }
        )
    return sessions


def download_drive_file_to_path(service, file_id: str, dest_path: str) -> None:
    request = service.files().get_media(fileId=file_id, supportsAllDrives=True)
    buffer = io.BytesIO()
    downloader = MediaIoBaseDownload(buffer, request)
    done = False
    while not done:
        _, done = downloader.next_chunk()
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    with open(dest_path, "wb") as out:
        out.write(buffer.getvalue())


def fetch_and_consume_staging_file(
    service,
    file_id: str,
    staging_folder_id: str,
    dest_path: str,
    *,
    ano: int,
    os_id: int,
    token: str,
    expected_original_name: str,
) -> str:
    meta = (
        service.files()
        .get(
            fileId=file_id,
            fields="id, name, parents, trashed, mimeType",
            supportsAllDrives=True,
        )
        .execute()
    )
    if meta.get("trashed"):
        raise ValueError("Arquivo removido no Google Drive.")
    parents = meta.get("parents") or []
    if staging_folder_id not in parents:
        raise ValueError("Arquivo não pertence à pasta de staging do portal.")
    staging_name = meta.get("name") or ""
    if not staging_name_matches_os(staging_name, ano, os_id, token):
        raise ValueError("Nome do arquivo no Drive não confere com esta OS/token.")

    marker = "__"
    if marker in staging_name:
        original = staging_name.split(marker, 1)[1]
    else:
        original = expected_original_name
    if os.path.basename(expected_original_name) != os.path.basename(original):
        raise ValueError("Nome do arquivo não confere com o enviado pelo cliente.")

    download_drive_file_to_path(service, file_id, dest_path)
    try:
        service.files().delete(fileId=file_id, supportsAllDrives=True).execute()
    except Exception as exc:
        logger.warning("Não foi possível remover staging Drive %s: %s", file_id, exc)
    return os.path.basename(original)
