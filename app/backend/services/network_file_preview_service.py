"""Preview e inspeção pré-salvamento de arquivos de gravação na rede."""
from __future__ import annotations

import logging
import os
import hashlib
import json
from copy import deepcopy
from functools import lru_cache
from threading import Lock, Semaphore
from dataclasses import dataclass
from typing import Any, Literal

from fastapi import HTTPException
from services.tif_packed_statistics import packed_statistics, supports_packed
from services.tif_inspection_cache import read_inspection, write_inspection

logger = logging.getLogger(__name__)

InspectionStatus = Literal["done", "unsupported", "error"]
GraphicsStatus = Literal["with_graphics", "blank_graphics", "inconclusive", "error"]

MAX_INSPECTION_FILES = 50
MAX_TIF_PIXELS = 3_000_000_000
MAX_TIF_BYTES = 500 * 1024 * 1024
FEATURE_VERSION = "plate-grid-v2"
GRID_SIZE = 16
# No máximo dois arquivos; o fallback expandido mantém um decode por processo.
_decode_slot = Semaphore(2)
_legacy_decode_slot = Semaphore(1)
_inspection_locks = [Lock() for _ in range(64)]


@dataclass(frozen=True)
class NetworkFilePick:
    absolute_path: str
    nome: str
    maquina: str = ""


def _ext(nome: str, source_path: str = "") -> str:
    name_ext = os.path.splitext(nome or "")[1].lower()
    if name_ext:
        return name_ext
    return os.path.splitext(source_path or "")[1].lower()


def is_pdf_file(nome: str, source_path: str = "") -> bool:
    return _ext(nome, source_path) == ".pdf"


def is_tif_file(nome: str, source_path: str = "") -> bool:
    return _ext(nome, source_path) in {".tif", ".tiff"}


def _source_fingerprint(source_path: str) -> dict[str, Any]:
    st = os.stat(source_path)
    return {
        "size": int(st.st_size),
        "mtime_ns": int(getattr(st, "st_mtime_ns", int(st.st_mtime * 1_000_000_000))),
    }


def _merge_active_rows(active: Any, max_gap: int) -> list[tuple[int, int]]:
    import numpy as np

    rows = np.flatnonzero(active)
    if rows.size == 0:
        return []
    bands: list[tuple[int, int]] = []
    start = int(rows[0])
    prev = int(rows[0])
    for raw in rows[1:]:
        row = int(raw)
        if row - prev <= max_gap:
            prev = row
            continue
        bands.append((start, prev))
        start = row
        prev = row
    bands.append((start, prev))
    return bands


def _segment_to_2d(segment: Any, width: int) -> Any:
    import numpy as np

    arr = np.asarray(segment)
    arr = np.squeeze(arr)
    if arr.ndim == 2:
        if arr.shape[1] != width:
            return arr.reshape((-1, width))
        return arr
    if arr.ndim == 1:
        return arr.reshape((-1, width))
    return arr.reshape((-1, width))


def _is_allowed_blank_mark(
    *,
    y0: int,
    y1: int,
    x0: int,
    x1: int,
    width: int,
    height: int,
) -> bool:
    if x1 < x0:
        return True
    y_mid = ((y0 + y1) / 2) / height
    band_h = (y1 - y0 + 1) / height
    x_span = (x1 - x0 + 1) / width
    near_edge = x0 <= width * 0.06 or x1 >= width * 0.94

    if y1 <= height * 0.06:
        return band_h <= 0.05
    if y0 >= height * 0.82:
        return band_h <= 0.12
    if 0.30 <= y_mid <= 0.45 and band_h <= 0.035 and x_span >= 0.55:
        return True
    if near_edge and band_h <= 0.05 and x_span <= 0.25:
        return True
    return False


def _decoded_statistics(page, width: int, height: int):
    import numpy as np

    row_counts = np.zeros(height, dtype=np.int64)
    row_min_x = np.full(height, width, dtype=np.int32)
    row_max_x = np.full(height, -1, dtype=np.int32)
    row_inner_counts = np.zeros(height, dtype=np.int64)
    grid = np.zeros((GRID_SIZE, GRID_SIZE), dtype=np.int64)
    y_edges = np.linspace(0, height, GRID_SIZE + 1, dtype=int)
    x_edges = np.linspace(0, width, GRID_SIZE + 1, dtype=int)
    with _legacy_decode_slot:
        for decoded, index, _shape in page.segments(maxworkers=1):
            if decoded is None:
                raise ValueError("Segmento TIFF ausente.")
            strip_2d = _segment_to_2d(decoded, width)
            y_start = int(index[2]) if len(index) > 2 else 0
            rows_len = min(int(strip_2d.shape[0]), height - y_start)
            if rows_len <= 0:
                continue
            strip_2d = strip_2d[:rows_len]
            if int(getattr(page, "photometric", 0)) == 1:
                strip_2d = np.logical_not(strip_2d)
            counts = np.count_nonzero(strip_2d, axis=1)
            row_counts[y_start:y_start + rows_len] = counts
            for gy in range(GRID_SIZE):
                lo = max(y_start, int(y_edges[gy]))
                hi = min(y_start + rows_len, int(y_edges[gy + 1]))
                if hi > lo:
                    for gx in range(GRID_SIZE):
                        grid[gy, gx] += np.count_nonzero(
                            strip_2d[lo-y_start:hi-y_start, x_edges[gx]:x_edges[gx + 1]]
                        )
            for local_y in np.flatnonzero(counts > 0):
                row = strip_2d[int(local_y)]
                xs = np.flatnonzero(row)
                global_y = y_start + int(local_y)
                row_min_x[global_y] = int(xs[0])
                row_max_x[global_y] = int(xs[-1])
                row_inner_counts[global_y] = np.count_nonzero(row[int(width * .08):int(width * .92)])
    return row_counts, row_min_x, row_max_x, row_inner_counts, grid


def _inspect_tif_graphics_uncached(source_path: str, nome: str | None = None, *, use_packed: bool = True) -> dict[str, Any]:
    """Classifica TIFF 1-bit de chapa sem carregar a página inteira em memória.

    A decisão "blank_graphics" é conservadora: só é emitida quando o arquivo
    tem baixo volume de tinta e todas as bandas encontradas parecem marcas de
    registro/calibragem conhecidas. Casos fora desse perfil ficam inconclusivos
    ou com grafismo, nunca "sem grafismo" por extrapolação.
    """
    try:
        import numpy as np
        import tifffile
        import imagecodecs
    except Exception as exc:  # pragma: no cover - depende do ambiente de deploy
        logger.warning("Dependências de inspeção TIFF indisponíveis: %s", exc)
        return {
            "graphics_status": "error",
            "blank_graphics": None,
            "reason": "Dependências de leitura TIFF indisponíveis no servidor. Verifique o pacote de produção.",
        }

    display_name = nome or os.path.basename(source_path)
    try:
        size_bytes = os.path.getsize(source_path)
        if size_bytes > MAX_TIF_BYTES:
            return {
                "graphics_status": "inconclusive",
                "blank_graphics": None,
                "reason": "TIFF acima do limite configurado para inspeção rápida.",
            }

        with tifffile.TiffFile(source_path) as tif:
            if len(tif.pages) != 1:
                return {
                    "graphics_status": "inconclusive",
                    "blank_graphics": None,
                    "reason": "TIFF multipágina exige validação manual.",
                    "pages": len(tif.pages),
                }
            page = tif.pages[0]
            shape = page.shape
            if len(shape) < 2:
                return {
                    "graphics_status": "inconclusive",
                    "blank_graphics": None,
                    "reason": "Formato de TIFF não suportado para inspeção.",
                }
            height, width = int(shape[-2]), int(shape[-1])
            pixels = width * height
            if pixels <= 0 or pixels > MAX_TIF_PIXELS:
                return {
                    "graphics_status": "inconclusive",
                    "blank_graphics": None,
                    "reason": "Dimensão fora do limite de inspeção rápida.",
                    "width": width,
                    "height": height,
                }
            if int(getattr(page, "bitspersample", 0) or 0) != 1:
                return {
                    "graphics_status": "inconclusive",
                    "blank_graphics": None,
                    "reason": "Somente TIFF 1-bit é classificado automaticamente.",
                    "width": width,
                    "height": height,
                }

            if (getattr(page, "is_tiled", False)
                or int(getattr(page, "samplesperpixel", 1)) != 1
                or int(getattr(page, "photometric", 0)) not in (0, 1)
                or min(width, height) < GRID_SIZE
                or int(getattr(page, "rowsperstrip", height)) * width > 256_000_000):
                return {
                    "graphics_status": "inconclusive", "blank_graphics": None,
                    "reason": "Organização do TIFF fora do limite de inspeção por faixas.",
                }

            statistics = (packed_statistics(page, width, height, GRID_SIZE)
                          if use_packed and supports_packed(page)
                          else _decoded_statistics(page, width, height))
            row_counts, row_min_x, row_max_x, row_inner_counts, grid = statistics
            y_edges = np.linspace(0, height, GRID_SIZE + 1, dtype=int)
            x_edges = np.linspace(0, width, GRID_SIZE + 1, dtype=int)

            total_ink = int(row_counts.sum())
            ink_fraction = total_ink / pixels
            active_threshold = max(1, int(width * 0.0005))
            active_rows = row_counts > active_threshold
            active_rows_fraction = float(np.count_nonzero(active_rows) / height)
            area = np.diff(y_edges)[:, None] * np.diff(x_edges)[None, :]
            features = [width / height, ink_fraction, active_rows_fraction,
                        *np.sqrt(grid / area).ravel().tolist()]
            common = {
                "width": width, "height": height, "ink_fraction": ink_fraction,
                "active_rows_fraction": active_rows_fraction,
                "feature_version": FEATURE_VERSION, "features": features,
            }

            if total_ink == 0:
                return {
                    **common,
                    "graphics_status": "blank_graphics",
                    "blank_graphics": True,
                    "reason": "Nenhum pixel de tinta encontrado.",
                    "width": width,
                    "height": height,
                    "ink_fraction": ink_fraction,
                }
            if ink_fraction >= 0.04 or active_rows_fraction >= 0.20:
                return {
                    **common,
                    "graphics_status": "with_graphics",
                    "blank_graphics": False,
                    "reason": "Distribuição de tinta incompatível com chapa sem grafismo.",
                    "width": width,
                    "height": height,
                    "ink_fraction": ink_fraction,
                    "active_rows_fraction": active_rows_fraction,
                }

            bands = _merge_active_rows(active_rows, max_gap=max(2, int(height * 0.0005)))
            band_payload: list[dict[str, Any]] = []
            allowed = True
            for y0, y1 in bands:
                rows_slice = slice(y0, y1 + 1)
                min_candidates = row_min_x[rows_slice]
                max_candidates = row_max_x[rows_slice]
                x0 = int(min_candidates.min(initial=width))
                x1 = int(max_candidates.max(initial=-1))
                ink = int(row_counts[rows_slice].sum())
                mark = _is_allowed_blank_mark(
                    y0=y0,
                    y1=y1,
                    x0=x0,
                    x1=x1,
                    width=width,
                    height=height,
                )
                # Cruzes laterais podem estar no meio da chapa (lado B).
                # O bounding box une as duas marcas e parecia conteúdo central.
                if (not mark and y1 - y0 + 1 <= height * 0.012
                    and x0 < width * 0.08 and x1 > width * 0.92
                    and row_inner_counts[rows_slice].sum() == 0):
                    mark = True
                allowed = allowed and mark
                band_payload.append(
                    {"y0": y0, "y1": y1, "x0": x0, "x1": x1, "ink": ink, "mark": mark}
                )

            if ink_fraction <= 0.025 and bands and allowed:
                return {
                    **common,
                    "graphics_status": "blank_graphics",
                    "blank_graphics": True,
                    "reason": "Apenas marcas de registro/calibragem detectadas.",
                    "width": width,
                    "height": height,
                    "ink_fraction": ink_fraction,
                    "active_rows_fraction": active_rows_fraction,
                    "bands": band_payload[:12],
                }
            return {
                **common,
                "graphics_status": "with_graphics",
                "blank_graphics": False,
                "reason": "Há tinta fora das áreas esperadas de registro/calibragem.",
                "width": width,
                "height": height,
                "ink_fraction": ink_fraction,
                "active_rows_fraction": active_rows_fraction,
                "bands": band_payload[:12],
            }
    except Exception as exc:
        logger.warning("Inspeção TIFF falhou para %s: %s", display_name, exc)
        return {
            "graphics_status": "error",
            "blank_graphics": None,
            "reason": "Não foi possível inspecionar o TIFF.",
        }


def inspection_token(source_path: str) -> str:
    raw = json.dumps([os.path.normcase(os.path.abspath(source_path)),
                      _source_fingerprint(source_path), FEATURE_VERSION], sort_keys=True)
    return hashlib.sha256(raw.encode()).hexdigest()


class _InspectionUnavailable(Exception):
    def __init__(self, result: dict[str, Any]):
        self.result = result


@lru_cache(maxsize=512)
def _cached_inspection(source_path: str, token: str) -> dict[str, Any]:
    persisted = read_inspection(token, FEATURE_VERSION)
    if persisted is not None:
        return persisted
    with _decode_slot:
        result = _inspect_tif_graphics_uncached(source_path)
        if result.get("graphics_status") == "error":
            raise _InspectionUnavailable(result)  # Não fixa falhas transitórias no cache.
        if result.get("features"):
            digest = hashlib.sha256()
            with open(source_path, "rb") as source:
                for chunk in iter(lambda: source.read(1024 * 1024), b""):
                    digest.update(chunk)
            if inspection_token(source_path) != token:
                raise HTTPException(409, "Arquivo alterado durante a inspeção. Selecione-o novamente.")
            result["content_sha256"] = digest.hexdigest()
            write_inspection(token, result, FEATURE_VERSION)
    return result


def inspect_tif_graphics(source_path: str, nome: str | None = None) -> dict[str, Any]:
    token = inspection_token(source_path)
    try:
        with _inspection_locks[hash(token) % len(_inspection_locks)]:
            result = deepcopy(_cached_inspection(source_path, token))
        if inspection_token(source_path) != token:
            raise HTTPException(409, "Arquivo alterado durante a inspeção. Selecione-o novamente.")
    except _InspectionUnavailable as exc:
        result = exc.result
    if result.get("features"):
        result["inspection_token"] = token
    return result


def inspect_network_file(source_path: str, nome: str, maquina: str = "") -> dict[str, Any]:
    fingerprint = _source_fingerprint(source_path)
    if is_pdf_file(nome, source_path):
        return {
            "nome": nome,
            "absolute_path": source_path,
            "type": "pdf",
            "status": "done",
            "preview_mime": "application/pdf",
            "blank_graphics": None,
            **fingerprint,
        }
    if not is_tif_file(nome, source_path):
        return {
            "nome": nome,
            "absolute_path": source_path,
            "type": "other",
            "status": "unsupported",
            "preview_mime": None,
            "blank_graphics": None,
            "reason": "Tipo de arquivo não suportado.",
            **fingerprint,
        }

    analysis = inspect_tif_graphics(source_path, nome)
    from services.tif_graphics_learning_service import apply_learning

    analysis = apply_learning(analysis, source_path, maquina)
    return {
        "nome": nome,
        "absolute_path": source_path,
        "type": "tif",
        "status": "done" if analysis.get("graphics_status") != "error" else "error",
        "preview_mime": "image/png",
        **fingerprint,
        **analysis,
        "maquina": maquina.strip().upper(),
    }


def validate_network_file_batch(files: list[dict[str, Any]]) -> list[NetworkFilePick]:
    if not isinstance(files, list) or any(not isinstance(f, dict) for f in files):
        raise HTTPException(status_code=422, detail="Lista de arquivos inválida.")
    if len(files) > MAX_INSPECTION_FILES:
        raise HTTPException(
            status_code=413,
            detail=f"Selecione no máximo {MAX_INSPECTION_FILES} arquivos por inspeção.",
        )
    result: list[NetworkFilePick] = []
    for raw in files:
        absolute_path = str(raw.get("absolute_path") or "").strip()
        nome = str(raw.get("nome") or os.path.basename(absolute_path)).strip()
        if not absolute_path or not nome:
            raise HTTPException(status_code=400, detail="Arquivo inválido.")
        maquina = raw.get("maquina") or ""
        if (not isinstance(maquina, str) or len(maquina) > 128
            or len(absolute_path) > 2048 or len(nome) > 255):
            raise HTTPException(status_code=422, detail="Metadados de arquivo inválidos.")
        result.append(NetworkFilePick(absolute_path=absolute_path, nome=nome, maquina=maquina))
    return result
