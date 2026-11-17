import fitz
from pathlib import Path
MM=25.4/72.0
p=Path(r"c:\Users\p_918713.REDECAMARA\.cursor\projects\c-dev-SagraWeb\attachments\c16ecf52-d347-4ca8-bd11-e70daea8512d\06220-JoaoCury-PastaAvulsocBolso_Imposi__o_v1.pdf")
print("exists", p.exists(), "size", p.stat().st_size if p.exists() else 0)
doc=fitz.open(p)
print("pages", doc.page_count)
for i,page in enumerate(doc):
    r=page.rect
    print(f"page{i} mm={r.width*MM:.3f}x{r.height*MM:.3f}")
    # drawings / images / text blocks with size
    imgs=page.get_image_info(xrefs=True)
    print(" images", len(imgs))
    for info in imgs[:20]:
        bb=info.get("bbox")
        if not bb: continue
        w=(bb[2]-bb[0])*MM; h=(bb[3]-bb[1])*MM
        print(f"  img bbox_mm=({bb[0]*MM:.2f},{bb[1]*MM:.2f},{bb[2]*MM:.2f},{bb[3]*MM:.2f}) size={w:.2f}x{h:.2f}")
    # vector clusters large
    big=[]
    for d in page.get_drawings():
        rr=fitz.Rect(d["rect"])
        if rr.width*MM>50 and rr.height*MM>50:
            big.append(rr)
    print(" big draws", len(big))
    for j,rr in enumerate(sorted(big, key=lambda x:(x.y0,x.x0))[:15]):
        print(f"  draw{j} mm=({rr.x0*MM:.2f},{rr.y0*MM:.2f},{rr.x1*MM:.2f},{rr.y1*MM:.2f}) size={rr.width*MM:.2f}x{rr.height*MM:.2f}")
    # text
    for b in page.get_text("dict")["blocks"]:
        if b.get("type")!=0: continue
        for line in b["lines"]:
            for span in line["spans"]:
                t=span["text"].strip()
                if not t: continue
                bb=span["bbox"]
                if len(t)<40:
                    print(f"  text={t!r} mm=({bb[0]*MM:.2f},{bb[1]*MM:.2f})")
doc.close()

# Expected centers and LL
print("EXPECTED Pasta1 center", 532.46, 395, "LL", 532.46-160, 395-110)
print("EXPECTED Pasta2 center", 212.46, 175, "LL", 212.46-160, 175-110)
print("CURRENT slots Pasta1 LL", 372.46, 285, "Pasta2", 52.46, 65)
