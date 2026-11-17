import fitz
from pathlib import Path
MM=25.4/72.0
DIR=Path(r"c:\Users\p_918713.REDECAMARA\.cursor\projects\c-dev-SagraWeb\attachments\c16ecf52-d347-4ca8-bd11-e70daea8512d")
# Render low-res overview to see layout, save png for inspection
for name in ("PastaMarks.pdf","TimbradoMarks.pdf"):
    doc=fitz.open(DIR/name)
    page=doc[0]
    # matrix for ~1000px wide
    zoom=1000/page.rect.width
    pix=page.get_pixmap(matrix=fitz.Matrix(zoom,zoom), alpha=False)
    out=DIR/(name.replace('.pdf','_preview.png'))
    pix.save(out)
    print("saved", out, pix.width, pix.height)
    doc.close()
