import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from database import db

rows = db.execute_query(
    """
    SELECT a.SituacaoLink, a.SetorLink, d.MaquinaLink, d.TipoPublicacaoLink, COUNT(*) c
    FROM tabAndamento a
    JOIN tabProtocolos p ON p.NroProtocolo=a.NroProtocoloLink AND p.AnoProtocolo=a.AnoProtocoloLink
    JOIN tabDetalhesServico d ON p.NroProtocolo=d.NroProtocoloLinkDet AND p.AnoProtocolo=d.AnoProtocoloLinkDet
    WHERE TRIM(d.TipoPublicacaoLink)='Folder' AND TRIM(d.MaquinaLink)='Digital Cor'
      AND (a.SituacaoLink LIKE 'Saída p/%%' OR a.SituacaoLink='Gravação' OR a.SituacaoLink LIKE 'Tramit%%')
    GROUP BY a.SituacaoLink, a.SetorLink, d.MaquinaLink, d.TipoPublicacaoLink
    ORDER BY c DESC LIMIT 30
    """
)
for r in rows:
    print(r)
