"""Lista mensagens recentes nas pastas monitoradas (lidas ou não)."""
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(BACKEND.parent / "services"))

import config_manager  # noqa: F401
from services.ews_service import EWSService, MailboxFolderTarget

svc = EWSService("https://ce.camara.leg.br/EWS/Exchange.asmx", verify_ssl=False)
ns = svc._ns()

for mb in ["sepim.deapa@camara.leg.br", "papelaria.deapa@camara.leg.br"]:
    print(f"\n=== {mb} ===")
    inbox = MailboxFolderTarget(mailbox=mb, folder_type="distinguished_inbox", folder_label="Inbox")
    for fname in ["Entrada de Provas", "Entrada de Prob. Tec."]:
        fid = svc.find_folder_id(inbox, fname)
        if not fid:
            print(f"{fname}: pasta não encontrada")
            continue
        tgt = MailboxFolderTarget(
            mailbox=mb, folder_type="folder_id", folder_label=fname, folder_id=fid
        )
        body = (
            '<m:FindItem Traversal="Shallow">'
            "<m:ItemShape><t:BaseShape>Default</t:BaseShape>"
            "<t:AdditionalProperties>"
            '<t:FieldURI FieldURI="item:Subject"/>'
            '<t:FieldURI FieldURI="message:IsRead"/>'
            '<t:FieldURI FieldURI="item:DateTimeReceived"/>'
            "</t:AdditionalProperties></m:ItemShape>"
            '<m:IndexedPageItemView MaxEntriesReturned="5" Offset="0" BasePoint="Beginning"/>'
            "<m:SortOrder><t:FieldOrder Order=\"Descending\">"
            '<t:FieldURI FieldURI="item:DateTimeReceived"/>'
            "</t:FieldOrder></m:SortOrder>"
            + svc._parent_folder_ids_xml(tgt)
            + "</m:FindItem>"
        )
        root = svc._post(svc._soap_envelope(body))
        msgs = root.findall(".//t:Message", namespaces=ns)
        print(f"\n{fname}: {len(msgs)} mensagens (amostra recentes, sem filtro leitura)")
        for m in msgs:
            subj = (m.findtext("./t:Subject", namespaces=ns) or "")[:55]
            is_read = m.findtext("./t:IsRead", namespaces=ns)
            dt = (m.findtext("./t:DateTimeReceived", namespaces=ns) or "")[:19]
            print(f"  [{is_read}] {dt} | {subj}")
