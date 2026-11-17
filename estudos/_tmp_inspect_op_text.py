import fitz
from pathlib import Path
MM = 25.4 / 72
DIR = Path(r"c:\Users\p_918713.REDECAMARA\.cursor\projects\c-dev-SagraWeb\attachments\c16ecf52-d347-4ca8-bd11-e70daea8512d")
for name in ["PastaMarks.pdf", "06220-JoaoCury-PastaAvulsocBolso_Imposi__o_v1_2.pdf"]:
    p = DIR / name
    if not p.exists():
        print("missing", name)
        continue
    doc = fitz.open(p)
    page = doc[0]
    print("===", name, "===")
    for b in page.get_text("dict")["blocks"]:
        if b.get("type") != 0:
            continue
        for line in b["lines"]:
            direction = line.get("dir")
            wdir = line.get("wmode")
            for span in line["spans"]:
                t = span.get("text") or ""
                if not any(k in t for k in ("SM74", "0000", "06220", "Pasta", "OS")):
                    continue
                bb = span["bbox"]
                print(
                    f"  text={t!r} font={span.get('font')} size={span.get('size'):.2f} "
                    f"dir={direction} wmode={wdir} "
                    f"bbox_mm=({bb[0]*MM:.1f},{bb[1]*MM:.1f})-({bb[2]*MM:.1f},{bb[3]*MM:.1f}) "
                    f"color={span.get('color')} chars={span.get('chars') is not None}"
                )
                # matrix if present
                if "transform" in span:
                    print("   transform", span["transform"])
    print(" fonts", page.get_fonts()[:8])
    doc.close()
