"""
Diagnóstico manual de export Corel (Cabecalho/Rodape).

Uso na estação (Corel instalado):

  python worker/papelaria_worker/tools/diag_corel_export.py [caminho\\TimbradoA4.cdr]

Imprime assinaturas COM de ExportEx / ExportBitmap / PublishToPDF
e testa cada estratégia isoladamente, reportando o erro real de cada uma.
"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))


def _print_typeinfo(obj, name: str) -> None:
    print(f"\n=== {name} ===")
    ole = getattr(obj, "_oleobj_", None)
    if ole is None:
        print("  (sem _oleobj_)")
        return
    try:
        ti = ole.GetTypeInfo()
        ta = ti.GetTypeAttr()
        for i in range(ta.cFuncs):
            fd = ti.GetFuncDesc(i)
            names = ti.GetNames(fd.memid)
            func_name = names[0] if names else "?"
            if func_name.lower() not in {
                "exportex",
                "exportbitmap",
                "publishtopdf",
                "createexportoptions",
                "createstructexportoptions",
            }:
                continue
            print(f"  {func_name} names={list(names)} cParams={fd.cParams}")
    except Exception as exc:
        print(f"  typeinfo falhou: {exc}")


def _try(label: str, fn) -> None:
    print(f"\n--- {label} ---")
    try:
        fn()
        print("  OK")
    except Exception as exc:
        print(f"  ERRO: {type(exc).__name__}: {exc}")


def main() -> int:
    cdr = sys.argv[1] if len(sys.argv) > 1 else ""
    import pythoncom
    import win32com.client

    pythoncom.CoInitialize()
    corel = win32com.client.DispatchEx("CorelDRAW.Application")
    corel = win32com.client.dynamic.Dispatch(corel)
    print(f"Corel: {getattr(corel, 'Name', '?')} {getattr(corel, 'Version', '?')}")
    _print_typeinfo(corel, "Application")

    doc = None
    if cdr and os.path.isfile(cdr):
        doc = corel.OpenDocument(os.path.abspath(cdr))
    else:
        doc = corel.CreateDocument()
        print("(sem CDR — usando documento vazio)")
    doc = win32com.client.dynamic.Dispatch(doc)
    _print_typeinfo(doc, "Document")

    tmp = tempfile.mkdtemp(prefix="diag_corel_export_")
    pdf = os.path.join(tmp, "t.pdf")
    svg = os.path.join(tmp, "t.svg")
    png = os.path.join(tmp, "t.png")

    def publish():
        doc.PublishToPDF(pdf)
        print(f"  PDF {os.path.getsize(pdf)} bytes")

    _try("PublishToPDF", publish)

    filtro_svg = int(getattr(corel, "cdrSVG", 1714))
    filtro_png = int(getattr(corel, "cdrPNG", 802))
    rng = int(getattr(corel, "cdrSelection", 1))
    img = int(getattr(corel, "cdrRGBColorImage", 4))

    def export_ex_opts():
        opts = corel.CreateStructExportOptions()
        doc.ExportEx(svg, filtro_svg, rng, opts)

    def export_ex_two():
        doc.ExportEx(svg, filtro_svg)

    def export_bitmap_11():
        doc.ExportBitmap(png, filtro_png, rng, img, 0, 0, 600, 600, 1, False, False)

    _try("CreateStructExportOptions + ExportEx", export_ex_opts)
    _try("ExportEx(path, filtro)", export_ex_two)
    _try("ExportBitmap 11 args", export_bitmap_11)

    if os.path.isfile(pdf) and os.path.getsize(pdf) > 0:
        try:
            import fitz

            pdf_doc = fitz.open(pdf)
            page = pdf_doc[0]
            svg_txt = page.get_svg_image(text_as_path=True)
            print(f"\nPyMuPDF SVG chars={len(svg_txt or '')} has_path={'<path' in (svg_txt or '').lower()}")
            pix = page.get_pixmap(dpi=600)
            print(f"PyMuPDF PNG {pix.width}x{pix.height}")
            pdf_doc.close()
        except Exception as exc:
            print(f"\nPyMuPDF: {exc}")

    try:
        if doc is not None:
            doc.Close()
    except Exception:
        pass
    print(f"\nTemp: {tmp}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
