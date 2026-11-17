import fitz
from pathlib import Path
MM=25.4/72
p=Path(r"c:\Users\p_918713.REDECAMARA\.cursor\projects\c-dev-SagraWeb\attachments\c16ecf52-d347-4ca8-bd11-e70daea8512d\TimbradoMarks.pdf")
doc=fitz.open(p)
page=doc[0]
print("=== TimbradoMarks ===")
for b in page.get_text("dict")["blocks"]:
    if b.get("type")!=0: continue
    for line in b["lines"]:
        direction=line.get("dir")
        for span in line["spans"]:
            t=span.get("text") or ""
            if "SM74" in t or "0000" in t or "Timbrado" in t:
                bb=span["bbox"]
                print(f" text={t!r} font={span.get('font')} size={span.get('size'):.2f} dir={direction} color={span.get('color')}")
doc.close()
# test Font arial bold
font=fitz.Font("arial", is_bold=True)
print("font name", font.name, "buffer", len(font.buffer) if font.buffer else 0)
