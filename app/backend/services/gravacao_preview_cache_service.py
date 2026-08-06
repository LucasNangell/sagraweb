"""Cache local de PNG para preview de TIFs de gravação (rede)."""
from __future__ import annotations

import hashlib
import io
import logging
import os
import threading
import time
from pathlib import Path
from typing import Any, Callable

from PIL import Image

logger = logging.getLogger(__name__)

PLATE_COMPOSITE_ORDER = ("C", "M", "Y", "K")


def _project_root() -> Path:
    from config_manager import PROJECT_ROOT

    return PROJECT_ROOT


def preview_cache_dir() -> Path:
    override = (os.getenv("SAGRA_GRAVACAO_PREVIEW_DIR") or "").strip()
    if override:
        return Path(override)
    return _project_root() / "data" / "gravacao_preview"


def _is_tif_file(source_path: str, nome: str) -> bool:
    for candidate in (nome, source_path):
        if candidate.lower().endswith((".tif", ".tiff")):
            return True
    return False


def _source_stat(source_path: str) -> tuple[float, int] | None:
    try:
        st = os.stat(source_path)
        return st.st_mtime, int(st.st_size)
    except OSError:
        return None


def build_source_fingerprint(source_path: str, nome: str) -> str | None:
    stat = _source_stat(source_path)
    if stat is None:
        return None
    mtime, size = stat
    payload = f"{source_path.strip()}\0{mtime}\0{size}\0{nome.strip()}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def cache_path_for_digest(digest: str, *, subdir: str = "") -> Path:
    base = preview_cache_dir()
    if subdir:
        return base / subdir / digest[:2] / f"{digest}.png"
    return base / digest[:2] / f"{digest}.png"


def is_cache_valid(cache_path: Path, source_path: str) -> bool:
    if not cache_path.is_file():
        return False
    stat = _source_stat(source_path)
    if stat is None:
        return False
    source_mtime, _ = stat
    try:
        return cache_path.stat().st_mtime >= source_mtime
    except OSError:
        return False


def _atomic_write_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    tmp_path.write_bytes(data)
    tmp_path.replace(path)


def write_preview_cache(source_path: str, nome: str) -> Path | None:
    from services.gravacao_externa_service import render_tif_preview_png

    digest = build_source_fingerprint(source_path, nome)
    if not digest:
        return None
    cache_path = cache_path_for_digest(digest)
    if is_cache_valid(cache_path, source_path):
        return cache_path

    started = time.perf_counter()
    png_bytes = render_tif_preview_png(source_path, filename=nome)
    _atomic_write_bytes(cache_path, png_bytes)
    elapsed = time.perf_counter() - started
    logger.info(
        "Preview cache gravado: %s -> %s (%.2fs)",
        nome,
        cache_path.name,
        elapsed,
    )
    return cache_path


def read_preview_cache(source_path: str, nome: str) -> bytes | None:
    digest = build_source_fingerprint(source_path, nome)
    if not digest:
        return None
    cache_path = cache_path_for_digest(digest)
    if not is_cache_valid(cache_path, source_path):
        return None
    try:
        return cache_path.read_bytes()
    except OSError:
        return None


def get_or_build_cached_preview(source_path: str, nome: str) -> bytes:
    cached = read_preview_cache(source_path, nome)
    if cached is not None:
        logger.debug("Preview cache hit: %s", nome)
        return cached
    cache_path = write_preview_cache(source_path, nome)
    if cache_path is None:
        from services.gravacao_externa_service import render_tif_preview_png

        return render_tif_preview_png(source_path, filename=nome)
    return cache_path.read_bytes()


def build_composite_fingerprint(group_key: str, color_digests: dict[str, str]) -> str:
    parts = [group_key.strip()]
    for color in sorted(color_digests):
        parts.append(f"{color}:{color_digests[color]}")
    payload = "\0".join(parts)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _composite_cache_valid(cache_path: Path, source_paths: list[str]) -> bool:
    if not cache_path.is_file():
        return False
    try:
        cache_mtime = cache_path.stat().st_mtime
    except OSError:
        return False
    for source_path in source_paths:
        stat = _source_stat(source_path)
        if stat is None:
            return False
        if cache_mtime < stat[0]:
            return False
    return True


def _compose_layers_from_png_bytes(layers: list[Image.Image]) -> bytes:
    from PIL import ImageChops

    if len(layers) < 2:
        raise ValueError("Composição requer ao menos 2 camadas.")

    max_w = max(layer.size[0] for layer in layers)
    max_h = max(layer.size[1] for layer in layers)
    target_size = (max_w, max_h)
    composite = Image.new("RGB", target_size, (255, 255, 255))
    for index, layer in enumerate(layers):
        rgb = layer.convert("RGB")
        if rgb.size != target_size:
            logger.warning(
                "Composite preview: redimensionando camada %s de %s para %s",
                index,
                rgb.size,
                target_size,
            )
            rgb = rgb.resize(target_size, Image.Resampling.BOX)
        composite = ImageChops.multiply(composite, rgb)

    buffer = io.BytesIO()
    composite.save(buffer, format="PNG", compress_level=3)
    return buffer.getvalue()


def get_or_build_composite_preview(
    separations: dict[str, dict[str, Any]],
    group_key: str,
    path_resolver: Callable[[dict[str, Any]], str],
) -> bytes:
    if len(separations) < 2:
        from fastapi import HTTPException

        raise HTTPException(
            status_code=400,
            detail="Composição requer ao menos 2 separações para esta chapa.",
        )

    color_digests: dict[str, str] = {}
    source_paths: list[str] = []
    layer_pngs: list[bytes] = []

    for channel in PLATE_COMPOSITE_ORDER:
        arq = separations.get(channel)
        if not arq:
            continue
        source_path = path_resolver(arq)
        nome = str(arq.get("nome") or "")
        digest = build_source_fingerprint(source_path, nome)
        if not digest:
            from fastapi import HTTPException

            raise HTTPException(status_code=404, detail=f"Arquivo não encontrado: {nome}")
        color_digests[channel] = digest
        source_paths.append(source_path)
        layer_pngs.append(get_or_build_cached_preview(source_path, nome))

    if len(layer_pngs) < 2:
        from fastapi import HTTPException

        raise HTTPException(
            status_code=400,
            detail="Composição requer ao menos 2 separações.",
        )

    composite_digest = build_composite_fingerprint(group_key, color_digests)
    cache_path = cache_path_for_digest(composite_digest, subdir="composite")
    if _composite_cache_valid(cache_path, source_paths):
        logger.debug("Composite preview cache hit: %s", group_key)
        return cache_path.read_bytes()

    layers: list[Image.Image] = []
    try:
        for png_bytes in layer_pngs:
            layers.append(Image.open(io.BytesIO(png_bytes)))
        png_bytes = _compose_layers_from_png_bytes(layers)
    finally:
        for layer in layers:
            layer.close()

    _atomic_write_bytes(cache_path, png_bytes)
    logger.info("Composite preview cache gravado: %s -> %s", group_key, cache_path.name)
    return png_bytes


def warm_previews_for_arquivos(arquivos: list[dict[str, Any]]) -> None:
    for arq in arquivos:
        source_path = str(arq.get("absolute_path") or "").strip()
        nome = str(arq.get("nome") or "").strip()
        if not source_path or not _is_tif_file(source_path, nome):
            continue
        try:
            write_preview_cache(source_path, nome)
        except Exception as exc:
            logger.warning(
                "Falha ao gerar preview cache para %s: %s",
                nome or source_path,
                exc,
            )


def warm_composites_for_arquivos(
    arquivos: list[dict[str, Any]],
    path_resolver: Callable[[dict[str, Any]], str],
) -> None:
    from services.plate_filename_utils import parse_plate_filename

    groups: dict[str, dict[str, dict[str, Any]]] = {}
    for arq in arquivos:
        nome = str(arq.get("nome") or "")
        parsed = parse_plate_filename(nome)
        if not parsed.group_key or not parsed.color:
            continue
        groups.setdefault(parsed.group_key, {})[parsed.color] = arq

    for group_key, separations in groups.items():
        if len(separations) < 2:
            continue
        try:
            get_or_build_composite_preview(separations, group_key, path_resolver)
        except Exception as exc:
            logger.warning(
                "Falha ao gerar composite cache para %s: %s",
                group_key,
                exc,
            )


def _resolve_arquivo_path(arq: dict[str, Any]) -> str:
    source_path = str(arq.get("absolute_path") or "").strip()
    if not source_path:
        raise ValueError("absolute_path ausente")
    from services.network_files_service import validate_network_arquivos_input

    validated = validate_network_arquivos_input(
        [{"absolute_path": source_path, "nome": str(arq.get("nome") or "")}]
    )
    return str(validated[0]["absolute_path"])


def warm_previews_for_arquivos_full(arquivos: list[dict[str, Any]]) -> None:
    warm_previews_for_arquivos(arquivos)
    warm_composites_for_arquivos(arquivos, _resolve_arquivo_path)


def enqueue_preview_warmup(arquivos: list[dict[str, Any]]) -> None:
    if not arquivos:
        return

    def _worker() -> None:
        started = time.perf_counter()
        logger.info("Iniciando warmup de preview para %s arquivo(s)", len(arquivos))
        try:
            warm_previews_for_arquivos_full(arquivos)
        except Exception as exc:
            logger.error("Erro no warmup de preview: %s", exc, exc_info=True)
        else:
            elapsed = time.perf_counter() - started
            logger.info("Warmup de preview concluído em %.2fs", elapsed)

    threading.Thread(target=_worker, name="gravacao-preview-warmup", daemon=True).start()


def _normalize_arquivo_key(absolute_path: str) -> str:
    return os.path.normcase(os.path.normpath(str(absolute_path).strip()))


def collect_arquivos_for_active_gravacao_previews() -> list[dict[str, Any]]:
    """Coleta TIFs das sessões ativas de Gravação Pendente e Externa (dedupe por path)."""
    from services.gravacao_externa_service import (
        build_session_detail,
        get_active_session,
        list_os_gravacao_externa,
    )
    from services.gravacao_pendente_service import (
        build_pendente_detail,
        get_active_pendente_session,
        list_os_gravacao_pendente,
    )

    collected: dict[str, dict[str, Any]] = {}

    def _add_arquivos(arquivos: list[dict[str, Any]] | None) -> None:
        for arq in arquivos or []:
            source_path = str(arq.get("absolute_path") or "").strip()
            nome = str(arq.get("nome") or "").strip()
            if not source_path or not _is_tif_file(source_path, nome):
                continue
            key = _normalize_arquivo_key(source_path)
            if key in collected:
                continue
            collected[key] = {
                "absolute_path": source_path,
                "nome": nome or Path(source_path).name,
            }

    try:
        pendente_items, _ = list_os_gravacao_pendente(limit=500, offset=0)
    except Exception as exc:
        logger.warning("Warmup: falha ao listar Gravação Pendente: %s", exc)
        pendente_items = []

    for item in pendente_items or []:
        try:
            ano = int(item["ano"])
            nr_os = int(item["nr_os"])
            session = get_active_pendente_session(ano, nr_os)
            if not session:
                continue
            detail = build_pendente_detail(session)
            _add_arquivos(detail.get("arquivos"))
        except Exception as exc:
            logger.warning(
                "Warmup: falha ao coletar arquivos Pendente OS %s/%s: %s",
                item.get("nr_os"),
                item.get("ano"),
                exc,
            )

    try:
        externa_items, _ = list_os_gravacao_externa(limit=500, offset=0)
    except Exception as exc:
        logger.warning("Warmup: falha ao listar Gravação Externa: %s", exc)
        externa_items = []

    for item in externa_items or []:
        try:
            ano = int(item["ano"])
            nr_os = int(item["nr_os"])
            session = get_active_session(ano, nr_os)
            if not session:
                continue
            detail = build_session_detail(session)
            _add_arquivos(detail.get("arquivos"))
        except Exception as exc:
            logger.warning(
                "Warmup: falha ao coletar arquivos Externa OS %s/%s: %s",
                item.get("nr_os"),
                item.get("ano"),
                exc,
            )

    return list(collected.values())


def enqueue_preview_warmup_for_active_sessions() -> None:
    """Enfileira warmup em background para OSs ativas (Pendente + Externa)."""

    def _collect_and_enqueue() -> None:
        try:
            arquivos = collect_arquivos_for_active_gravacao_previews()
            logger.info(
                "Warmup startup: %s arquivo(s) TIF nas sessões ativas de gravação",
                len(arquivos),
            )
            if arquivos:
                enqueue_preview_warmup(arquivos)
        except Exception as exc:
            logger.error(
                "Warmup startup: falha ao coletar/enfileirar previews: %s",
                exc,
                exc_info=True,
            )

    threading.Thread(
        target=_collect_and_enqueue,
        name="gravacao-preview-warmup-collect",
        daemon=True,
    ).start()
