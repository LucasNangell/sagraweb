"""Estatísticas exatas de TIFF 1-bit, sem expandir cada bit em um byte."""
from __future__ import annotations

import numpy as np

_POPCOUNT = np.array([i.bit_count() for i in range(256)], dtype=np.uint8)
_FIRST = np.array([8 - i.bit_length() if i else 8 for i in range(256)], dtype=np.int32)
_LAST = np.array([7 - ((i & -i).bit_length() - 1) if i else -1 for i in range(256)], dtype=np.int32)


def supports_packed(page) -> bool:
    # Outros codecs/FillOrder continuam usando o decoder completo de tifffile.
    return (getattr(page, "compression", None) in (1, 5)
            and getattr(page, "fillorder", 1) == 1
            and getattr(page, "predictor", 1) == 1
            and not getattr(page, "is_tiled", False))


def _interval_counts(packed, counts, start: int, end: int):
    """Conta [start,end), incluindo fronteiras que não coincidem com bytes."""
    first, left = divmod(start, 8)
    last, right = divmod(end, 8)
    if first == last:
        mask = (255 >> left) & ((255 << (8 - right)) & 255)
        return _POPCOUNT[packed[:, first] & mask].astype(np.int64)
    result = counts[:, first + bool(left):last].sum(axis=1, dtype=np.int64)
    if left:
        result += _POPCOUNT[packed[:, first] & (255 >> left)]
    if right:
        result += _POPCOUNT[packed[:, last] & ((255 << (8 - right)) & 255)]
    return result


def packed_statistics(page, width: int, height: int, grid_size: int):
    import imagecodecs

    row_counts = np.zeros(height, dtype=np.int64)
    row_min_x = np.full(height, width, dtype=np.int32)
    row_max_x = np.full(height, -1, dtype=np.int32)
    row_inner = np.zeros(height, dtype=np.int64)
    grid = np.zeros((grid_size, grid_size), dtype=np.int64)
    x_edges = np.linspace(0, width, grid_size + 1, dtype=int)
    y_edges = np.linspace(0, height, grid_size + 1, dtype=int)
    stride = (width + 7) // 8
    rows_per_strip = int(page.rowsperstrip)
    strip_count = (height + rows_per_strip - 1) // rows_per_strip
    if len(page.dataoffsets) != strip_count or len(page.databytecounts) != strip_count:
        raise ValueError("Número de strips TIFF inválido.")
    handle = page.parent.filehandle
    for strip_index, (offset, byte_count) in enumerate(zip(page.dataoffsets, page.databytecounts)):
        y_start = strip_index * rows_per_strip
        rows = min(rows_per_strip, height - y_start)
        expected = rows * stride
        if offset <= 0 or byte_count <= 0 or offset + byte_count > handle.size:
            raise ValueError("Strip TIFF ausente ou truncado.")
        handle.seek(offset)
        raw = handle.read(byte_count)
        # Buffer limitado; nunca aloca a saída pelo tamanho declarado no stream.
        data = imagecodecs.lzw_decode(raw, out=expected + 1) if page.compression == 5 else raw
        if len(data) != expected:
            raise ValueError("Tamanho do strip TIFF incompatível com suas dimensões.")
        packed = np.frombuffer(data, dtype=np.uint8).reshape(rows, stride).copy()
        if int(page.photometric) == 1:
            np.bitwise_not(packed, out=packed)
        if width % 8:
            packed[:, -1] &= (255 << (8 - width % 8)) & 255
        # NumPy 2 oferece popcount vetorizado; mantém compatibilidade com NumPy 1.
        byte_counts = np.bitwise_count(packed) if hasattr(np, "bitwise_count") else _POPCOUNT[packed]
        row_counts[y_start:y_start + rows] = byte_counts.sum(axis=1, dtype=np.int64)
        row_inner[y_start:y_start + rows] = _interval_counts(
            packed, byte_counts, int(width * .08), int(width * .92),
        )
        for gx in range(grid_size):
            column_counts = _interval_counts(packed, byte_counts, int(x_edges[gx]), int(x_edges[gx + 1]))
            for gy in range(grid_size):
                lo = max(y_start, int(y_edges[gy]))
                hi = min(y_start + rows, int(y_edges[gy + 1]))
                if hi > lo:
                    grid[gy, gx] += column_counts[lo-y_start:hi-y_start].sum()
        for local_y in np.flatnonzero(row_counts[y_start:y_start + rows]):
            active = np.flatnonzero(packed[local_y])
            first, last = int(active[0]), int(active[-1])
            row_min_x[y_start + local_y] = first * 8 + _FIRST[packed[local_y, first]]
            row_max_x[y_start + local_y] = last * 8 + _LAST[packed[local_y, last]]
    return row_counts, row_min_x, row_max_x, row_inner, grid
