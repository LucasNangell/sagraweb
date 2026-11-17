import fitz
from pathlib import Path
MM=25.4/72.0
H=605.0
W=745.0
p=Path(r"c:\Users\p_918713.REDECAMARA\.cursor\projects\c-dev-SagraWeb\attachments\c16ecf52-d347-4ca8-bd11-e70daea8512d\06220-JoaoCury-PastaAvulsocBolso_Imposi__o_v1.pdf")
doc=fitz.open(p)
page=doc[0]
# render and also find non-white ink density per region
zoom=2
pix=page.get_pixmap(matrix=fitz.Matrix(zoom,zoom), alpha=False)
out=Path(r"c:\Users\p_918713.REDECAMARA\.cursor\projects\c-dev-SagraWeb\attachments\c16ecf52-d347-4ca8-bd11-e70daea8512d\imposicao_export_preview.png")
pix.save(out)
print("saved", out)

# Expected ClipBoxes in PDF coords (y from top)
slots=[
 ("Pasta1", 372.46, 285.0, 320.0, 220.0),
 ("Pasta2", 52.46, 65.0, 320.0, 220.0),
 ("P1_as_center_wrong", 372.46-160, 395-110, 320, 220),
]
for name,x,y,w,h in slots:
    # jdf LL (x,y) size wxh -> pdf
    pdf_x0=x; pdf_x1=x+w
    pdf_y0=H-(y+h); pdf_y1=H-y
    print(f"{name} jdf_LL=({x:.2f},{y:.2f}) center=({x+w/2:.2f},{y+h/2:.2f})")
    print(f"  pdf_box=({pdf_x0:.2f},{pdf_y0:.2f},{pdf_x1:.2f},{pdf_y1:.2f})")

# Sample ink in expected Pasta1 and Pasta2 boxes vs shifted
import array
def ink_score(x0,y0,x1,y1):
    # pdf mm to pix
    px0=int(x0*zoom/MM); py0=int(y0*zoom/MM); px1=int(x1*zoom/MM); py1=int(y1*zoom/MM)
    px0=max(0,px0); py0=max(0,py0); px1=min(pix.width-1,px1); py1=min(pix.height-1,py1)
    n=0; dark=0
    # subsample
    for py in range(py0,py1,4):
        for px in range(px0,px1,4):
            i=(py*pix.width+px)*3
            r,g,b=pix.samples[i],pix.samples[i+1],pix.samples[i+2]
            n+=1
            if r+g+b < 600: dark+=1
    return dark, n, (100.0*dark/n if n else 0)

for name,x,y,w,h in [
 ("slot_P1",372.46,285,320,220),
 ("slot_P2",52.46,65,320,220),
 ("if_center_was_372",212.46,285,320,220),
 ("target_c_P1_box",532.46-160,395-110,320,220),
]:
    pdf_y0=H-(y+h); pdf_y1=H-y
    d,n,pct=ink_score(x,pdf_y0,x+w,pdf_y1)
    print(f"ink {name}: dark%={pct:.1f} samples={n}")
doc.close()
