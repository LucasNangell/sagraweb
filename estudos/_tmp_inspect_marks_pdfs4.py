from pathlib import Path
import re
DIR=Path(r"c:\Users\p_918713.REDECAMARA\.cursor\projects\c-dev-SagraWeb\attachments\c16ecf52-d347-4ca8-bd11-e70daea8512d")
for name in ("PastaMarks.pdf","TimbradoMarks.pdf"):
    raw=(DIR/name).read_bytes()
    print("="*70, name, "bytes", len(raw))
    # search ascii strings of interest
    for pat in [b"Pasta1", b"Pasta2", b"Pasta", b"TxtOP", b"Timbrado", b"SM74", b"0000-0000", b"/Title", b"Corel", b"Illustrator", b"BBox"]:
        idxs=[]
        start=0
        while True:
            i=raw.find(pat, start)
            if i<0: break
            idxs.append(i)
            start=i+1
            if len(idxs)>=5: break
        print(pat, "count_at_least", len(idxs), "first", idxs[:3])
        for i in idxs[:2]:
            snippet=raw[max(0,i-40):i+80]
            print(" ", snippet)
