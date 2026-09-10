"""Valida o pacote no DEV e executa TIFF/LZW no Python real da API em PROD."""
from __future__ import annotations

import argparse
import io
import json
from pathlib import Path
import struct
import sys


def check_package(root: Path) -> dict:
    manifest = json.loads((root / "tiff-runtime.json").read_text(encoding="utf-8-sig"))
    vendor = root / "python_pkgs"
    for relative in (
        "tifffile/__init__.py", "imagecodecs/__init__.py", "PIL/__init__.py",
    ):
        if not (vendor / relative).is_file():
            raise RuntimeError(f"Biblioteca ausente no pacote: python_pkgs/{relative}")
    for relative in (
        "network_file_preview_service.py", "tif_packed_statistics.py", "tif_inspection_cache.py",
    ):
        if not (root / "app/backend/services" / relative).is_file():
            raise RuntimeError(f"Servico TIFF ausente no pacote: {relative}")
    tag = f"cp{manifest['python_tag']}-win_amd64"
    # Nesta versao o codec LZW faz parte de _imcd, inclusive suas DLLs empacotadas.
    if not (vendor / "imagecodecs" / f"_imcd.{tag}.pyd").is_file():
        raise RuntimeError(f"Codec nativo ausente/incompativel: _imcd.{tag}.pyd")
    return manifest


def check_runtime(root: Path, manifest: dict) -> dict:
    actual_tag = f"{sys.version_info.major}{sys.version_info.minor}"
    if actual_tag != manifest["python_tag"] or struct.calcsize("P") != 8:
        raise RuntimeError(
            f"Pacote exige Python {manifest['python_version']} x64; "
            f"interpretador atual: {sys.version.split()[0]} / {struct.calcsize('P') * 8} bits ({sys.executable})"
        )
    sys.path[:0] = [str(root / "python_pkgs"), str(root / "app/backend")]
    import imagecodecs
    import numpy as np
    import tifffile
    from PIL import Image
    from services.network_file_preview_service import _decoded_statistics, GRID_SIZE
    from services.tif_packed_statistics import packed_statistics, supports_packed

    if tuple(int(x) for x in np.__version__.split(".")[:2]) < (1, 24):
        raise RuntimeError("NumPy >=1.24 e necessario na instalacao Python da API.")
    raw = b"SAGRA TIFF LZW smoke test" * 8
    if imagecodecs.lzw_decode(imagecodecs.lzw_encode(raw), out=len(raw) + 1) != raw:
        raise RuntimeError("Falha no round-trip do codec LZW.")
    # Exercita DLLs, TIFF 1-bit, ultimo byte incompleto e o mesmo extrator da API.
    stream = io.BytesIO()
    with Image.new("1", (65, 97), 1) as image:
        image.putpixel((32, 48), 0)
        image.save(stream, format="TIFF", compression="tiff_lzw")
    stream.seek(0)
    with tifffile.TiffFile(stream) as tif:
        if not supports_packed(tif.pages[0]):
            raise RuntimeError("TIFF de teste nao reconhecido pelo extrator.")
        actual = packed_statistics(tif.pages[0], 65, 97, GRID_SIZE)
        expected = _decoded_statistics(tif.pages[0], 65, 97)
        for result, reference in zip(actual, expected):
            np.testing.assert_array_equal(result, reference)
        if int(actual[0].sum()) != 1:
            raise RuntimeError("Contagem de pixels inesperada no TIFF de teste.")
    return {"python": sys.executable, "numpy": np.__version__,
            "tifffile": tifffile.__version__, "imagecodecs": imagecodecs.__version__}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release-root", required=True, type=Path)
    parser.add_argument("--package-only", action="store_true")
    args = parser.parse_args()
    try:
        manifest = check_package(args.release_root)
        details = manifest if args.package_only else check_runtime(args.release_root, manifest)
        print("TIFF preflight OK: " + json.dumps(details, ensure_ascii=True))
        return 0
    except Exception as exc:
        print(f"TIFF preflight FALHOU: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
