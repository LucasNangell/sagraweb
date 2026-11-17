import fitz, os
from pathlib import Path
import sys
sys.path.insert(0, r"C:\dev\SagraWeb\app\backend")
from services.papelaria_jdf_service import _load_marcas_op_font, _MARCAS_OP_FONT_CANDIDATES, prepare_marcas_pdf_with_ops, MARCAS_OP_PLACEHOLDER
print("candidates", _MARCAS_OP_FONT_CANDIDATES)
font = _load_marcas_op_font()
print("font name", getattr(font, "name", None), getattr(font, "buffer", None) is not None)
# write with insert_text + fontfile
src = Path(r"C:\dev\SagraWeb\estudos\_tmp_hyphen_src2.pdf")
dest = Path(r"C:\dev\SagraWeb\estudos\_tmp_hyphen_out2.pdf")
doc=fitz.open(); page=doc.new_page(width=600,height=400)
page.insert_text((50,100), f"[{MARCAS_OP_PLACEHOLDER}]", fontsize=16)
doc.save(src); doc.close()

# manual write with insert_text fontfile
doc=fitz.open(src)
page=doc[0]
hits=page.search_for(MARCAS_OP_PLACEHOLDER)
fontpath=None
for p in _MARCAS_OP_FONT_CANDIDATES:
  if os.path.isfile(p):
    fontpath=p; break
print("fontpath", fontpath)
for hit in hits:
  page.add_redact_annot(hit, fill=(1,1,1))
page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE)
token="06220-06221_SM74"
for hit in hits:
  # try insert_text with fontfile
  page.insert_text(fitz.Point(hit.x0, hit.y1-2), token, fontsize=16.22, fontfile=fontpath, fontname="arialbd", color=(35/255, 31/255, 32/255))
doc.save(dest); doc.close()
doc=fitz.open(dest)
page=doc[0]
for b in page.get_text("rawdict")["blocks"]:
  if b.get("type")!=0: continue
  for line in b["lines"]:
    for span in line["spans"]:
      chars=span.get("chars") or []
      seq="".join(c.get("c","") for c in chars) if chars else (span.get("text") or "")
      if "SM74" in seq or "06220" in seq:
        print("insert_text result", repr(seq), [hex(ord(c)) for c in seq], "font", span.get("font"))
doc.close()

# TextWriter with morphatrix vs insert_htmlbox?
doc=fitz.open(); page=doc.new_page(width=600,height=400)
font=fitz.Font(fontfile=fontpath)
tw=fitz.TextWriter(page.rect)
tw.append(fitz.Point(50,100), "06220-06221_SM74", font=font, fontsize=16)
tw.write_text(page, color=(0,0,0))
# also try unicode minus / en-dash alternatives written as ascii
tw2=fitz.TextWriter(page.rect)
for i, ch in enumerate(["-", "\u2010", "\u2011", "\u2212", "\u2013"]):
  tw2.append(fitz.Point(50, 150+i*20), f"A{ch}B", font=font, fontsize=16)
tw2.write_text(page, color=(0,0,0))
out=Path(r"C:\dev\SagraWeb\estudos\_tmp_hyphen_chars.pdf")
doc.save(out); doc.close()
doc=fitz.open(out)
page=doc[0]
print("--- TextWriter hyphen variants ---")
for b in page.get_text("rawdict")["blocks"]:
  if b.get("type")!=0: continue
  for line in b["lines"]:
    for span in line["spans"]:
      chars=span.get("chars") or []
      seq="".join(c.get("c","") for c in chars) if chars else (span.get("text") or "")
      print(repr(seq), [hex(ord(c)) for c in seq])
doc.close()
