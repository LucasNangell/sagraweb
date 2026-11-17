import fitz, json, collections
from pathlib import Path
MM=25.4/72.0
DIR=Path(r"c:\Users\p_918713.REDECAMARA\.cursor\projects\c-dev-SagraWeb\attachments\c16ecf52-d347-4ca8-bd11-e70daea8512d")

def analyze(name):
    doc=fitz.open(DIR/name)
    page=doc[0]
    print("="*70, name)
    # AcroForm / widgets
    try:
        print("widgets", list(page.widgets() or []))
    except Exception as e:
        print("widgets err", e)
    # Annots
    for a in page.annots() or []:
        print("annot", a.type, a.info, a.rect)
    # XObjects on page
    print("xobjects", page.get_xobjects())
    # Resources dump via page xref
    xref=page.xref
    print("page xref", xref)
    try:
        print(doc.xref_object(xref)[:2000])
    except Exception as e:
        print(e)
    # Cluster ALL drawings by size buckets of interest
    drawings=page.get_drawings()
    # Collect unique rect sizes rounded to 0.1mm
    sizes=collections.Counter()
    rects=[]
    for d in drawings:
        rr=fitz.Rect(d["rect"])
        if rr.width<2 or rr.height<2: continue
        sizes[(round(rr.width*MM,1), round(rr.height*MM,1))] += 1
        rects.append(rr)
    print("top sizes mm:")
    for (w,h),c in sizes.most_common(25):
        print(f"  {w}x{h} count={c}")
    # Look for rects near 220x320, 440x320, 210x297, A4
    targets=[(220,320),(440,320),(210,297),(297,210),(148,210),(105,148)]
    for tw,th in targets:
        matches=[]
        for rr in rects:
            w,h=rr.width*MM, rr.height*MM
            if abs(w-tw)<3 and abs(h-th)<3:
                matches.append(rr)
            elif abs(w-th)<3 and abs(h-tw)<3:
                matches.append(rr)
        if matches:
            print(f"matches ~{tw}x{th}: {len(matches)}")
            for rr in sorted(matches, key=lambda x:(x.y0,x.x0))[:12]:
                print(f"  mm=({rr.x0*MM:.2f},{rr.y0*MM:.2f},{rr.x1*MM:.2f},{rr.y1*MM:.2f})")
    # Also look at path items that might be closed rectangles via items
    # Try extract text as rawdict for chars
    # Try get_text("rawdict") looking for writing mode / named
    # Scan full xref for /BBox near Pasta sizes
    print("--- xobjects with BBox ---")
    for xref in range(1, doc.xref_length()):
        try: s=doc.xref_object(xref)
        except: continue
        if "/BBox" in s and ("/Subtype /Form" in s or "/Type /XObject" in s or "Form" in s):
            # parse BBox
            m=__import__("re").search(r"/BBox\s*\[([^\]]+)\]", s)
            if not m: continue
            nums=[float(x) for x in m.group(1).split()]
            if len(nums)!=4: continue
            w=(nums[2]-nums[0])*MM; h=(nums[3]-nums[1])*MM
            if w>50 and h>50:
                print(f"xref{xref} bbox_mm={w:.2f}x{h:.2f} nums={nums}")
                # also print Name if nearby
                for ln in s.splitlines()[:8]:
                    if "Name" in ln or "BBox" in ln or "Form" in ln:
                        print(" ", ln.strip()[:200])
    # Try mutool-like: list page get_text trace
    # Cluster marks: find cross-like small drawings near corners - use bounding hulls of mark groups
    # Group drawings into spatial clusters with gap threshold 15mm
    clusters=[]
    for rr in sorted(rects, key=lambda x:(x.y0,x.x0)):
        if rr.width*MM>500: continue  # skip huge
        placed=False
        for i,c in enumerate(clusters):
            # expand and check distance
            exp=fitz.Rect(c)
            exp.x0 -= 40; exp.y0 -= 40; exp.x1 += 40; exp.y1 += 40
            if exp.intersects(rr):
                clusters[i]=c|rr
                placed=True
                break
        if not placed:
            clusters.append(fitz.Rect(rr))
    print(f"clusters={len(clusters)}")
    for i,c in enumerate(sorted(clusters, key=lambda x:(x.y0,x.x0))):
        w,h=c.width*MM,c.height*MM
        if w<5 or h<5: continue
        print(f" cluster{i} mm=({c.x0*MM:.2f},{c.y0*MM:.2f},{c.x1*MM:.2f},{c.y1*MM:.2f}) size={w:.2f}x{h:.2f}")
    doc.close()

analyze("PastaMarks.pdf")
analyze("TimbradoMarks.pdf")
