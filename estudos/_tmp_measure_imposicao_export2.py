import fitz
from pathlib import Path
MM=25.4/72.0
H=605.0
p=Path(r"c:\Users\p_918713.REDECAMARA\.cursor\projects\c-dev-SagraWeb\attachments\c16ecf52-d347-4ca8-bd11-e70daea8512d\06220-JoaoCury-PastaAvulsocBolso_Imposi__o_v1.pdf")
doc=fitz.open(p)
page=doc[0]
# All drawing rects
rects=[]
for d in page.get_drawings():
    rr=fitz.Rect(d["rect"])
    if rr.width>1 and rr.height>1:
        rects.append(rr)
print("drawings", len(rects))
# Cluster into two large content groups by excluding margin marks (y near 0 or 605)
content=[]
for rr in rects:
    cy=(rr.y0+rr.y1)/2*MM
    if 40 < cy < 560:
        content.append(rr)
print("contentish", len(content))
if content:
    u=content[0]
    for r in content[1:]:
        u|=r
    # split left/right
    left=[r for r in content if (r.x0+r.x1)/2*MM < 372]
    right=[r for r in content if (r.x0+r.x1)/2*MM >= 372]
    for name,grp in [("left",left),("right",right)]:
        if not grp: 
            print(name,"empty"); continue
        u=grp[0]
        for r in grp[1:]: u|=r
        # PDF y from top -> JDF y from bottom
        x0,y0,x1,y1=u.x0*MM,u.y0*MM,u.x1*MM,u.y1*MM
        jdf_y0=H-y1; jdf_y1=H-y0
        cx=(x0+x1)/2; cy_pdf=(y0+y1)/2; cy_jdf=(jdf_y0+jdf_y1)/2
        print(f"{name} pdf_mm=({x0:.2f},{y0:.2f},{x1:.2f},{y1:.2f}) size={x1-x0:.2f}x{y1-y0:.2f}")
        print(f"  jdf_box=({x0:.2f},{jdf_y0:.2f},{x1:.2f},{jdf_y1:.2f}) center_jdf=({cx:.2f},{cy_jdf:.2f})")

# Text union per half
words=page.get_text("words")
for name,xmin,xmax in [("left",0,372),("right",372,745)]:
    ws=[w for w in words if xmin <= (w[0]+w[2])/2*MM < xmax and 40 < (w[1]+w[3])/2*MM < 560]
    if not ws: continue
    x0=min(w[0] for w in ws)*MM; x1=max(w[2] for w in ws)*MM
    y0=min(w[1] for w in ws)*MM; y1=max(w[3] for w in ws)*MM
    jdf_y0=H-y1; jdf_y1=H-y0
    print(f"text-{name} center_jdf=({(x0+x1)/2:.2f},{(jdf_y0+jdf_y1)/2:.2f}) box_jdf=({x0:.2f},{jdf_y0:.2f},{x1:.2f},{jdf_y1:.2f})")

print("target centers Pasta1(532.46,395) Pasta2(212.46,175)")
doc.close()
