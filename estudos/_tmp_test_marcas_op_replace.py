import fitz, math, os, sys
sys.path.insert(0, r"C:\dev\SagraWeb\app\backend")
from pathlib import Path
from services.papelaria_jdf_service import prepare_marcas_pdf_with_ops, MARCAS_OP_PLACEHOLDER
MM=25.4/72
src=Path(r"c:\Users\p_918713.REDECAMARA\.cursor\projects\c-dev-SagraWeb\attachments\c16ecf52-d347-4ca8-bd11-e70daea8512d\PastaMarks.pdf")
dest=Path(r"C:\dev\SagraWeb\estudos\_tmp_marcas_op_out.pdf")
prepare_marcas_pdf_with_ops(source_pdf_path=str(src), output_pdf_path=str(dest), nros=[6220])
doc=fitz.open(dest)
page=doc[0]
print("=== result ===")
for b in page.get_text("dict")["blocks"]:
    if b.get("type")!=0: continue
    for line in b["lines"]:
        direction=line.get("dir")
        for span in line["spans"]:
            t=span.get("text") or ""
            if "SM74" in t or "06220" in t or "Pasta" in t or "0000" in t:
                print(f" text={t!r} font={span.get('font')} size={span.get('size'):.2f} dir={direction} color={span.get('color')}")
print("placeholder left?", MARCAS_OP_PLACEHOLDER in page.get_text())
doc.close()
