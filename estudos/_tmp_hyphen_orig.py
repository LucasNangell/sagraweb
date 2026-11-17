import fitz
src=r"c:\Users\p_918713.REDECAMARA\.cursor\projects\c-dev-SagraWeb\attachments\c16ecf52-d347-4ca8-bd11-e70daea8512d\PastaMarks.pdf"
doc=fitz.open(src)
page=doc[0]
for b in page.get_text("rawdict")["blocks"]:
  if b.get("type")!=0: continue
  for line in b["lines"]:
    for span in line["spans"]:
      chars=span.get("chars") or []
      seq="".join(c.get("c","") for c in chars) if chars else (span.get("text") or "")
      if "0000" in seq or "SM74" in seq or "Pasta" in seq:
        print(repr(seq), [hex(ord(c)) for c in seq], "font", span.get("font"), "dir", line.get("dir"))
doc.close()
