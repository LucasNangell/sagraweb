from database import db

rows = db.execute_query(
    """
    SELECT NroProtocoloLink AS os, AnoProtocoloLink AS ano, CodStatus, SetorLink, SituacaoLink,
           `Observaçao` AS obs
    FROM tabAndamento
    WHERE UltimoStatus=1 AND SituacaoLink=%s AND NroProtocoloLink IN (6247,6248,6249,6250)
    ORDER BY NroProtocoloLink
    """,
    ("Encam. de Docum.",),
)
for r in rows or []:
    print(dict(r))
