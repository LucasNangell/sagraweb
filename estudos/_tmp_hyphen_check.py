import fitz
from pathlib import Path
import sys
sys.path.insert(0, r"C:\dev\SagraWeb\app\backend")
from services.papelaria_jdf_service import prepare_marcas_pdf_with_ops, format_marcas_op_token, MARCAS_OP_PLACEHOLDER

print("token", repr(format_marcas_op_token([6220,6221])))
src = Path(r"C:\dev\SagraWeb\estudos\_tmp_hyphen_src.pdf")
dest = Path(r"C:\dev\SagraWeb\estudos\_tmp_hyphen_out.pdf")
doc = fitz.open()
page = doc.new_page(width=600, height=400)
page.insert_text((50,100), f"[{MARCAS_OP_PLACEHOLDER}]", fontsize=16)
doc.save(src); doc.close()
prepare_marcas_pdf_with_ops(source_pdf_path=str(src), output_pdf_path=str(dest), nros=[6220,6221])
doc = fitz.open(dest)
page = doc[0]
raw = page.get_text("rawdict")
for b in raw["blocks"]:
  if b.get("type")!=0: continue
  for line in b["lines"]:
    for span in line["spans"]:
      chars = span.get("chars") or []
      if not chars:
        t = span.get("text") or ""
        if "SM74" in t or "06220" in t:
          print("span text", repr(t), [hex(ord(c)) for c in t])
      else:
        seq = "".join(c.get("c","") for c in chars)
        if "SM74" in seq or "06220" in seq:
          print("chars", repr(seq), [hex(ord(c.get("c",""))) for c in chars])
# also content stream search
cont = page.read_contents()
for needle in [b"06220-06221", b"06220\xad06221", "06220-06221".encode(), bytes([0xad])]:
  print("needle", needle, "found", needle in cont)
# dump strings around SM74
idx = cont.find(b"SM74")
print("around SM74", cont[max(0,idx-40):idx+10])
doc.close()
