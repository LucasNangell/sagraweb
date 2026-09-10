"""Sonda local de leitura; nao e classificador nem altera o TIFF de origem."""
from __future__ import annotations

import argparse
import io
import json
from pathlib import Path
import subprocess
import sys
import time


def worker(mode: str, source: str) -> None:
    import numpy as np
    import psutil
    from PIL import Image
    import tifffile

    proc = psutil.Process()
    started = time.perf_counter()
    result = {"mode": mode}
    if mode == "pillow_preview":
        # Equivale ao caminho atual: load -> resize mode 1 -> tint -> PNG.
        Image.MAX_IMAGE_PIXELS = None  # Apenas neste subprocesso descartavel.
        with Image.open(source) as im:
            im.load()
            result["decode_s"] = time.perf_counter() - started
            w, h = im.size
            small = im.resize((2400, int(h * 2400 / w)), Image.Resampling.BOX)
            gray = small.convert("L")
            paper = Image.new("RGB", gray.size, "white")
            ink = Image.new("RGB", gray.size, (0, 255, 255))
            paper.paste(ink, mask=Image.eval(gray, lambda x: 255 - x))
            buffer = io.BytesIO()
            paper.save(buffer, format="PNG", compress_level=3)
            result["png_bytes"] = len(buffer.getvalue())
    elif mode == "tifffile_full_study":
        with tifffile.TiffFile(source) as tf:
            a = tf.pages[0].asarray().astype(np.uint8)
            result["decode_copy_s"] = time.perf_counter() - started
            h, w = a.shape
            mx, my = int(w * .08), int(h * .08)
            mean = float(a[my:h-my:5, mx:w-mx:5].mean())
            result["study_uniformity"] = max(mean, 1 - mean)
            result["study_says_blank"] = max(mean, 1 - mean) >= .9905
    elif mode == "tifffile_segments":
        with tifffile.TiffFile(source) as tf:
            pg = tf.pages[0]
            if pg.bitspersample != 1 or int(pg.photometric) != 0:
                raise ValueError("Esta sonda mede apenas o exemplo MINISWHITE 1-bit.")
            h, w = pg.shape
            rows = np.zeros(h, dtype=np.int64)
            count = 0
            for decoded, index, shape in pg.segments(maxworkers=1):
                if decoded is None:
                    raise ValueError("Strip ausente")
                strip = decoded[0, :, :, 0]
                y = index[2]
                counts = np.count_nonzero(strip, axis=1)
                rows[y:y+len(counts)] = counts
                count += 1
                del strip, decoded, counts
            result["strips"] = count
            result["ink_fraction"] = float(rows.sum() / (h*w))
            result["ink_per_vertical_decile"] = [int(x.sum()) for x in np.array_split(rows, 10)]
            bands = []
            active = rows > 0
            starts = np.flatnonzero(active & ~np.r_[False, active[:-1]])
            ends = np.flatnonzero(active & ~np.r_[active[1:], False])
            for y0, y1 in zip(starts, ends):
                bands.append({"y0": int(y0), "y1": int(y1), "ink": int(rows[y0:y1+1].sum())})
            result["bands"] = bands
    result["elapsed_s"] = time.perf_counter() - started
    result["peak_working_set_mib"] = proc.memory_info().peak_wset / 2**20
    print(json.dumps(result), flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--worker", choices=["pillow_preview", "tifffile_full_study", "tifffile_segments"])
    parser.add_argument("--source", default=str(Path(__file__).resolve().parents[2] / "docs" / "2026_OS 00801-PM-Coedi-Livro_Congre (Cad 0 A) (C).tif"))
    args = parser.parse_args()
    if args.worker:
        worker(args.worker, args.source)
        return
    import psutil
    import importlib.metadata as md
    report = {"source": args.source, "python": sys.version, "versions": {x: md.version(x) for x in ["pillow", "tifffile", "imagecodecs", "numpy"]}, "runs": [], "note": "Local; cache de SO nao limpo; nao representa SMB nem latencia de producao. Tempos excluem imports."}
    for mode in ["pillow_preview", "tifffile_full_study", "tifffile_segments"]:
        for repeat in range(3):
            p = subprocess.Popen([sys.executable, __file__, "--worker", mode, "--source", args.source], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            start = time.perf_counter()
            reason = None
            while p.poll() is None:
                try:
                    rss = psutil.Process(p.pid).memory_info().rss
                    if rss > 6 * 2**30 or time.perf_counter() - start > 45:
                        reason = "limite de 6 GiB ou 45s"
                        p.kill()
                        break
                except psutil.NoSuchProcess:
                    pass
                time.sleep(.05)
            out, err = p.communicate()
            item = json.loads(out) if p.returncode == 0 else {"mode": mode, "error": reason or err[-1500:]}
            item["repeat"] = repeat + 1
            report["runs"].append(item)
            print(json.dumps(item), flush=True)
    Path(__file__).with_name("benchmark.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
