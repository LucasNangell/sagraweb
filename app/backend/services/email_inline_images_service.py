"""Embute imagens do corpo HTML como anexos inline (cid:) antes do envio via EWS.

O Outlook bloqueia imagens remotas por padrão e não exibe data: URIs; anexos inline
referenciados por cid: são exibidos sem bloqueio na maioria dos clientes.
"""
from __future__ import annotations

import base64
import hashlib
import html as html_lib
import logging
import os
import re
from pathlib import Path
from typing import Callable, List, Optional, Tuple
from urllib.parse import parse_qs, unquote, urljoin, urlparse

import requests

logger = logging.getLogger(__name__)

InlineImage = Tuple[str, bytes, str, str]

MAX_IMAGE_BYTES = 4 * 1024 * 1024
MAX_IMAGES_PER_EMAIL = 20
DOWNLOAD_TIMEOUT_SECONDS = 10
MAX_REDIRECTS = 3

DEFAULT_ALLOWED_HOST_PATTERNS = (
    "*.camara.leg.br",
    "*.camara.gov.br",
    "cgraf.online",
    "www.cgraf.online",
)

_REDIRECT_STATUSES = frozenset({301, 302, 303, 307, 308})
_LOCAL_PATH_PREFIXES = ("/email_images/", "/imagensemail/")

# IDs usados nos modelos de prova/PT (payload antigo no MySQL inclusive).
DRIVE_ID_TO_LOCAL_FILE = {
    "1VS_n8YA39TJR6XJBeH7UStcwjloXtZGC": "header.png",
    "1862FeQwKpoYYijvaquofPG7278nAxDHS": "invite_portal.png",
    "1U-x8Fxj-vKbFvLfahVx_KNAkI_Ny5L6W": "acessar_sagra.png",
    "1qbGsxjtwomsSl4yWNJ8O4CcVs4njhCgd": "footer.png",
    "1IidV2OowSeqX1w3mewGUxBEBzbq1atDE": "invite_portal.png",
    "1Tkv0XSNBdYpyTMR8agHWPLNhEYMjG2a0": "invite_portal.png",
    "1ADWADUPIaqTqGprsnJ_tcxmNCOyzRKiT": "invite_portal.png",
}

_IMG_SRC_RE = re.compile(
    r"""(<img\b[^>]*?\bsrc\s*=\s*)(["'])([^"']*)\2""",
    re.IGNORECASE,
)

_DATA_URI_RE = re.compile(
    r"^data:image/(?P<subtype>png|jpeg|jpg|gif|webp);base64,(?P<payload>.+)$",
    re.IGNORECASE | re.DOTALL,
)

_MIME_EXTENSIONS = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/bmp": ".bmp",
    "image/svg+xml": ".svg",
}

_EXTENSION_MIME = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".svg": "image/svg+xml",
}


def _sagra_public_host() -> str:
    explicit = (
        os.getenv("SAGRA_PUBLIC_WEB_BASE", "").strip()
        or os.getenv("SAGRA_PUBLIC_DOMAIN", "").strip()
    )
    if not explicit:
        try:
            from services.activation_email_service import resolve_link_web_base

            explicit = resolve_link_web_base()
        except Exception:
            return ""
    if "://" not in explicit:
        explicit = f"http://{explicit}"
    try:
        return (urlparse(explicit).hostname or "").strip().lower()
    except ValueError:
        return ""


def allowed_host_patterns() -> List[str]:
    patterns = list(DEFAULT_ALLOWED_HOST_PATTERNS)
    sagra_host = _sagra_public_host()
    if sagra_host:
        patterns.append(sagra_host)
    extra = os.getenv("EMAIL_INLINE_IMAGE_ALLOWED_HOSTS", "")
    patterns.extend(p.strip().lower() for p in extra.split(",") if p.strip())
    return patterns


def is_allowed_image_host(host: str, patterns: Optional[List[str]] = None) -> bool:
    host = (host or "").strip().lower().rstrip(".")
    if not host or host == "localhost":
        return False
    # Nome NetBIOS da intranet (ex.: cgrafsysvm); IPv6 literal tem ":" e fica de fora.
    if "." not in host and ":" not in host:
        return True
    for pattern in patterns if patterns is not None else allowed_host_patterns():
        if pattern.startswith("*."):
            suffix = pattern[1:]
            if host.endswith(suffix) or host == pattern[2:]:
                return True
        elif host == pattern:
            return True
    return False


def _extension_for(mime: str) -> str:
    return _MIME_EXTENSIONS.get(mime.lower(), ".img")


def _mime_from_filename(name: str) -> str:
    return _EXTENSION_MIME.get(Path(name).suffix.lower(), "image/png")


def _filename_from_url(url: str, mime: str) -> str:
    try:
        name = os.path.basename(unquote(urlparse(url).path or ""))
    except ValueError:
        name = ""
    name = re.sub(r'[\\/:*?"<>|]+', "_", name).strip()
    if not name or "." not in name:
        return f"imagem{_extension_for(mime)}"
    return name


def _safe_local_name(name: str) -> Optional[str]:
    cleaned = Path(unquote(name or "")).name.strip()
    if not cleaned or cleaned in {".", ".."}:
        return None
    if "/" in cleaned or "\\" in cleaned:
        return None
    return cleaned


def email_images_dirs() -> List[Path]:
    dirs: List[Path] = []
    env_dir = os.getenv("EMAIL_IMAGES_DIR", "").strip()
    if env_dir:
        dirs.append(Path(env_dir))
    try:
        from config_manager import PROJECT_ROOT

        root = Path(PROJECT_ROOT)
        dirs.append(root / "email_images")
        dirs.append(root / "shared" / "email_images")
    except Exception:
        pass
    return dirs


def _is_inside(directory: Path, candidate: Path) -> bool:
    try:
        candidate.resolve().relative_to(directory.resolve())
        return True
    except (ValueError, OSError):
        return False


def resolve_local_email_image(filename: str) -> Optional[Tuple[bytes, str]]:
    """Lê um arquivo de shared/email_images; retorna (bytes, mime) ou None."""
    name = _safe_local_name(filename)
    if not name:
        return None
    for directory in email_images_dirs():
        try:
            path = (directory / name).resolve()
        except OSError:
            continue
        if not _is_inside(directory, path) or not path.is_file():
            continue
        try:
            size = path.stat().st_size
            if size <= 0 or size > MAX_IMAGE_BYTES:
                logger.warning(
                    "Imagem local de e-mail vazia ou acima de %s bytes: %s",
                    MAX_IMAGE_BYTES,
                    path,
                )
                return None
            raw = path.read_bytes()
        except OSError as exc:
            logger.warning("Falha ao ler imagem local de e-mail %s: %s", path, exc)
            continue
        if not raw or len(raw) > MAX_IMAGE_BYTES:
            return None
        return raw, _mime_from_filename(name)
    return None


def _drive_id_from_url(parsed) -> Optional[str]:
    host = (parsed.hostname or "").lower()
    if "drive.google.com" not in host and "googleusercontent.com" not in host:
        return None
    qs = parse_qs(parsed.query)
    for key in ("id", "export"):
        values = qs.get(key) or []
        if values and values[0] not in ("view", "download", "open"):
            return values[0]
    match = re.search(r"/d/([A-Za-z0-9_-]{20,})", parsed.path or "")
    return match.group(1) if match else None


def local_filename_for_src(value: str, parsed) -> Optional[str]:
    path = unquote(parsed.path or "")
    if not path and value.startswith("/"):
        path = unquote(value.split("?", 1)[0])
    lower = path.lower()
    for prefix in _LOCAL_PATH_PREFIXES:
        idx = lower.find(prefix)
        if idx >= 0:
            rest = path[idx + len(prefix) :]
            return _safe_local_name(rest.split("/")[0])
    drive_id = _drive_id_from_url(parsed)
    if drive_id:
        mapped = DRIVE_ID_TO_LOCAL_FILE.get(drive_id)
        return _safe_local_name(mapped) if mapped else None
    return None


def _read_limited(response: requests.Response) -> Optional[bytes]:
    declared = response.headers.get("Content-Length")
    if declared and declared.isdigit() and int(declared) > MAX_IMAGE_BYTES:
        return None
    chunks: List[bytes] = []
    total = 0
    for chunk in response.iter_content(chunk_size=64 * 1024):
        if not chunk:
            continue
        total += len(chunk)
        if total > MAX_IMAGE_BYTES:
            return None
        chunks.append(chunk)
    return b"".join(chunks)


def _negotiate_auth():
    try:
        from requests_negotiate_sspi import HttpNegotiateAuth
    except Exception:
        return None
    return HttpNegotiateAuth()


def download_image(
    url: str,
    *,
    verify_ssl: bool,
    session: Optional[requests.Session] = None,
) -> Optional[Tuple[bytes, str]]:
    """Baixa a imagem com limites; retorna (bytes, mime) ou None se falhar."""
    sess = session or requests.Session()
    sess.trust_env = False
    sess.proxies = {}

    def _get(target: str, auth=None) -> requests.Response:
        return sess.get(
            target,
            timeout=DOWNLOAD_TIMEOUT_SECONDS,
            allow_redirects=False,
            verify=verify_ssl,
            stream=True,
            auth=auth,
        )

    current = url
    auth = None
    hops = 0
    patterns = allowed_host_patterns()
    try:
        while True:
            response = _get(current, auth)
            if response.status_code == 401 and auth is None:
                response.close()
                auth = _negotiate_auth()
                if auth is None:
                    logger.warning("Imagem de e-mail exige autenticação: %s", current)
                    return None
                response = _get(current, auth)

            if response.status_code in _REDIRECT_STATUSES:
                location = (response.headers.get("Location") or "").strip()
                response.close()
                if not location or hops >= MAX_REDIRECTS:
                    logger.warning(
                        "Imagem de e-mail não baixada (HTTP %s): %s",
                        response.status_code,
                        current,
                    )
                    return None
                next_url = urljoin(current, location)
                parsed = urlparse(next_url)
                if parsed.scheme.lower() not in ("http", "https"):
                    logger.warning("Redirect de imagem com esquema inválido: %s", next_url)
                    return None
                if not is_allowed_image_host(parsed.hostname or "", patterns):
                    logger.warning(
                        "Redirect de imagem para host não permitido: %s -> %s",
                        current,
                        next_url,
                    )
                    return None
                hops += 1
                current = next_url
                continue

            try:
                if response.status_code != 200:
                    logger.warning(
                        "Imagem de e-mail não baixada (HTTP %s): %s",
                        response.status_code,
                        current,
                    )
                    return None
                mime = (response.headers.get("Content-Type") or "").split(";")[0].strip().lower()
                if not mime.startswith("image/"):
                    logger.warning(
                        "URL de imagem de e-mail não retornou imagem (%s): %s",
                        mime,
                        current,
                    )
                    return None
                raw = _read_limited(response)
                if not raw:
                    logger.warning(
                        "Imagem de e-mail vazia ou acima de %s bytes: %s",
                        MAX_IMAGE_BYTES,
                        current,
                    )
                    return None
                return raw, mime
            finally:
                response.close()
    except requests.RequestException as exc:
        logger.warning("Falha ao baixar imagem de e-mail %s: %s", current, exc)
        return None


def _remaining_remote_srcs(html: str) -> List[str]:
    found: List[str] = []
    for match in _IMG_SRC_RE.finditer(html or ""):
        src = html_lib.unescape(match.group(3)).strip()
        if src.lower().startswith("http://") or src.lower().startswith("https://"):
            found.append(src)
    return found


def embed_images_for_email(
    html: str,
    *,
    verify_ssl: bool = True,
    downloader: Optional[Callable[[str], Optional[Tuple[bytes, str]]]] = None,
) -> Tuple[str, List[InlineImage]]:
    """
    Converte <img src> com data:image, arquivos locais de email_images ou http(s)
    de host permitido em anexos inline.

    Retorna o HTML com src="cid:..." e a lista (filename, bytes, content_id, mime)
    no formato de EWSService.send_email(inline_images=...). Imagens que falham
    mantêm o src original.
    """
    if not html or "<img" not in html.lower():
        return html or "", []

    fetch = downloader or (lambda url: download_image(url, verify_ssl=verify_ssl))
    patterns = allowed_host_patterns()
    inline_images: List[InlineImage] = []
    cid_by_key: dict[str, Optional[str]] = {}

    def register(key: str, filename: str, raw: bytes, mime: str) -> str:
        seq = len(inline_images) + 1
        digest = hashlib.sha256(key.encode("utf-8")).hexdigest()[:10]
        cid = f"img-{seq}-{digest}@sagra"
        inline_images.append((filename, raw, cid, mime))
        return cid

    def resolve(src: str) -> Optional[str]:
        value = html_lib.unescape(src).strip()
        if not value or value.lower().startswith("cid:"):
            return None

        data_match = _DATA_URI_RE.match(value)
        if data_match:
            key = "data:" + hashlib.sha256(value.encode("utf-8")).hexdigest()
            if key in cid_by_key:
                return cid_by_key[key]
            if len(inline_images) >= MAX_IMAGES_PER_EMAIL:
                return None
            try:
                raw = base64.b64decode(re.sub(r"\s+", "", data_match.group("payload")), validate=False)
            except Exception:
                raw = b""
            subtype = data_match.group("subtype").lower()
            mime = "image/jpeg" if subtype in ("jpg", "jpeg") else f"image/{subtype}"
            if not raw or len(raw) > MAX_IMAGE_BYTES:
                logger.warning("Imagem data: inválida ou acima do limite; mantida no HTML")
                cid_by_key[key] = None
                return None
            cid = register(key, f"imagem{_extension_for(mime)}", raw, mime)
            cid_by_key[key] = cid
            return cid

        try:
            parsed = urlparse(value)
        except ValueError:
            return None

        local_name = local_filename_for_src(value, parsed)
        if local_name:
            key = f"local:{local_name}"
            if key in cid_by_key:
                return cid_by_key[key]
            if len(inline_images) >= MAX_IMAGES_PER_EMAIL:
                logger.warning(
                    "Limite de %s imagens inline atingido; mantendo URL %s",
                    MAX_IMAGES_PER_EMAIL,
                    value,
                )
                return None
            local = resolve_local_email_image(local_name)
            if local:
                raw, mime = local
                cid = register(key, local_name, raw, mime)
                cid_by_key[key] = cid
                logger.info("Imagem local %s embutida no e-mail como cid:%s", local_name, cid)
                return cid

        if parsed.scheme.lower() not in ("http", "https"):
            return None
        if not is_allowed_image_host(parsed.hostname or "", patterns):
            return None
        key = f"url:{value}"
        if key in cid_by_key:
            return cid_by_key[key]
        if len(inline_images) >= MAX_IMAGES_PER_EMAIL:
            logger.warning("Limite de %s imagens inline atingido; mantendo URL %s", MAX_IMAGES_PER_EMAIL, value)
            return None
        result = fetch(value)
        if not result:
            cid_by_key[key] = None
            return None
        raw, mime = result
        cid = register(key, _filename_from_url(value, mime), raw, mime)
        cid_by_key[key] = cid
        logger.info("Imagem %s embutida no e-mail como cid:%s", value, cid)
        return cid

    def repl(match: re.Match[str]) -> str:
        cid = resolve(match.group(3))
        if not cid:
            return match.group(0)
        quote = match.group(2)
        return f"{match.group(1)}{quote}cid:{cid}{quote}"

    converted = _IMG_SRC_RE.sub(repl, html)
    leftover = _remaining_remote_srcs(converted)
    if leftover:
        logger.warning(
            "E-mail ainda contém %s imagem(ns) remota(s) não embutida(s): %s",
            len(leftover),
            ", ".join(leftover[:10]),
        )
    return converted, inline_images
