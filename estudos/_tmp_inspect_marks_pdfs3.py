import fitz, collections, statistics
from pathlib import Path
MM=25.4/72.0
DIR=Path(r"c:\Users\p_918713.REDECAMARA\.cursor\projects\c-dev-SagraWeb\attachments\c16ecf52-d347-4ca8-bd11-e70daea8512d")

def mark_centers(name):
    doc=fitz.open(DIR/name)
    page=doc[0]
    pts=[]
    for d in page.get_drawings():
        rr=fitz.Rect(d["rect"])
        # registration / crop mark-ish small
        w,h=rr.width*MM, rr.height*MM
        if 0.5 < w < 12 and 0.5 < h < 12:
            cx=(rr.x0+rr.x1)/2*MM
            cy=(rr.y0+rr.y1)/2*MM
            pts.append((cx,cy,w,h))
    print("="*70, name, "markish", len(pts))
    # Unique X and Y approx rounded 1mm
    xs=sorted({round(p[0]) for p in pts})
    ys=sorted({round(p[1]) for p in pts})
    print("unique X mm (~1):", xs)
    print("unique Y mm (~1):", ys)
    # denser histogram
    xh=collections.Counter(round(p[0]) for p in pts)
    yh=collections.Counter(round(p[1]) for p in pts)
    print("X hist top", xh.most_common(20))
    print("Y hist top", yh.most_common(20))
    # Also print all points sorted
    for p in sorted(pts, key=lambda t:(round(t[1]), round(t[0]))):
        print(f"  mark ({p[0]:.2f},{p[1]:.2f}) size={p[2]:.2f}x{p[3]:.2f}")
    # Text positions again with more detail via words
    print("words:")
    for w in page.get_text("words"):
        x0,y0,x1,y1,text,*_=w
        print(f"  {text!r} mm=({x0*MM:.2f},{y0*MM:.2f},{x1*MM:.2f},{y1*MM:.2f})")
    doc.close()

mark_centers("PastaMarks.pdf")
mark_centers("TimbradoMarks.pdf")
