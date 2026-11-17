import fitz
from pathlib import Path
import sys
sys.path.insert(0, r"C:\dev\SagraWeb\app\backend")
from services.papelaria_jdf_service import prepare_marcas_pdf_with_ops

src=r"c:\Users\p_918713.REDECAMARA\.cursor\projects\c-dev-SagraWeb\attachments\c16ecf52-d347-4ca8-bd11-e70daea8512d\PastaMarks.pdf"
dest=Path(r"C:\dev\SagraWeb\estudos\_tmp_marcas_op_out.pdf")
prepare_marcas_pdf_with_ops(source_pdf_path=src, output_pdf_path=str(dest), nros=[6220,6221])
doc=fitz.open(dest)
page=doc[0]
# render preview
pix=page.get_pixmap(matrix=fitz.Matrix(1.5,1.5), alpha=False)
pix.save(r"C:\dev\SagraWeb\estudos\_tmp_marcas_op_preview.png")
print("=== all text spans ===")
for b in page.get_text("dict")["blocks"]:
  if b.get("type")!=0: continue
  for line in b["lines"]:
    for span in line["spans"]:
      t=span.get("text") or ""
      if t.strip():
        print(repr(t), "font", span.get("font"), "size", round(span.get("size",0),2), "dir", line.get("dir"), "bbox", [round(x,1) for x in span.get("bbox")])
# crop regions around OP text
# find SM74 bboxes
for b in page.get_text("dict")["blocks"]:
  if b.get("type")!=0: continue
  for line in b["lines"]:
    for span in line["spans"]:
      if "SM74" in (span.get("text") or ""):
        r=fitz.Rect(span["bbox"])
        r += (-20,-10,20,10)
        clip=page.get_pixmap(matrix=fitz.Matrix(3,3), clip=r, alpha=False)
        safe=("L" if line.get("dir",(1,0))[0]<0 else "R")
        clip.save(rf"C:\dev\SagraWeb\estudos\_tmp_op_{safe}.png")
        print("saved crop", safe, r)
doc.close()
