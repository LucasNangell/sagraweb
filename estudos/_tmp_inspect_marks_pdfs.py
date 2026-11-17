import fitz, re
from pathlib import Path
MM = 25.4/72.0
DIR = Path(r"c:\Users\p_918713.REDECAMARA\.cursor\projects\c-dev-SagraWeb\attachments\c16ecf52-d347-4ca8-bd11-e70daea8512d")
for name in ("PastaMarks.pdf","TimbradoMarks.pdf"):
    path = DIR/name
    print("="*70, name, path.exists())
    doc = fitz.open(path)
    for xref in range(1, doc.xref_length()):
        try: s = doc.xref_object(xref)
        except: continue
        if any(k in s for k in ("Pasta","TxtOP","Timbrado","/T (","Txt")):
            for ln in s.splitlines():
                if any(k in ln for k in ("Pasta","TxtOP","Timbrado","/T (","Txt","Name")):
                    print(f"xref{xref}: {ln.strip()[:240]}")
    for i,page in enumerate(doc):
        r=page.rect
        print(f"page{i} mm={r.width*MM:.3f}x{r.height*MM:.3f} pt={r.width:.2f}x{r.height:.2f}")
        for b in page.get_text("dict")["blocks"]:
            if b.get("type")!=0: continue
            for line in b["lines"]:
                for span in line["spans"]:
                    bb=span["bbox"]
                    print(f" text={span['text']!r} size={span['size']:.2f} bbox_mm=({bb[0]*MM:.2f},{bb[1]*MM:.2f},{bb[2]*MM:.2f},{bb[3]*MM:.2f}) bbox_pt=({bb[0]:.2f},{bb[1]:.2f},{bb[2]:.2f},{bb[3]:.2f})")
        drawings=page.get_drawings()
        big=[]
        for d in drawings:
            rr=fitz.Rect(d["rect"])
            if rr.width>50 and rr.height>50: big.append(rr)
        print("big drawings", len(big), "total", len(drawings))
        for j,rr in enumerate(sorted(big, key=lambda x:(x.y0,x.x0))[:30]):
            print(f" draw{j} mm=({rr.x0*MM:.2f},{rr.y0*MM:.2f},{rr.x1*MM:.2f},{rr.y1*MM:.2f}) size={rr.width*MM:.2f}x{rr.height*MM:.2f}")
        raw=page.read_contents().decode("latin-1","ignore")
        for m in re.finditer(r"/(Pasta\d+|Timbrado\d*|TxtOP\w*|OP\w+)", raw):
            print(" content_name", m.group(1), m.start())
        for m in re.finditer(r"/([A-Za-z][A-Za-z0-9_]{2,40})\s+Do", raw):
            print(" Do", m.group(1))
        # optional: widgets / optional content
    try: print("ocgs", doc.get_ocgs())
    except Exception as e: print("ocgs", e)
    # page get_bbox of text "TxtOPs" via search
    for i,page in enumerate(doc):
        for needle in ("TxtOPs","TxtOP","OP","00000","Pasta"):
            hits=page.search_for(needle)
            if hits:
                for h in hits:
                    print(f" search {needle!r} page{i} mm=({h.x0*MM:.2f},{h.y0*MM:.2f},{h.x1*MM:.2f},{h.y1*MM:.2f})")
    doc.close()
