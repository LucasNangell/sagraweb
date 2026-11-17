import fitz, os
from pathlib import Path
p=Path(r"c:\Users\p_918713.REDECAMARA\.cursor\projects\c-dev-SagraWeb\attachments\c16ecf52-d347-4ca8-bd11-e70daea8512d\PastaMarks.pdf")
doc=fitz.open(p)
page=doc[0]
for f in page.get_fonts(full=True):
    print(f)
    xref=f[0]
    try:
        extracted=doc.extract_font(xref)
        print(" extracted", extracted[0], extracted[1], len(extracted[3] or b""))
    except Exception as e:
        print(" extract err", e)
# windows font
for cand in [r"C:\Windows\Fonts\arialbd.ttf", r"C:\Windows\Fonts\ARIALBD.TTF"]:
    print(cand, os.path.isfile(cand))
    if os.path.isfile(cand):
        font=fitz.Font(fontfile=cand)
        print(" ok", font.name)
doc.close()
