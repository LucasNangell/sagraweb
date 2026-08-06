"""Lista todas as pastas com nome parecido com 'Entrada' e contagem de não lidos."""
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(BACKEND.parent / "services"))

import config_manager  # noqa: F401
from services.ews_service import EWSService, _xml_escape

svc = EWSService("https://ce.camara.leg.br/EWS/Exchange.asmx", verify_ssl=False)
ns = svc._ns()

for mb in ["sepim.deapa@camara.leg.br", "papelaria.deapa@camara.leg.br"]:
    print(f"\n=== {mb} — pastas com 'Entrada' ou 'Prob' ou unread>0 ===")
    body = f"""
<m:FindFolder Traversal="Deep">
  <m:FolderShape>
    <t:BaseShape>Default</t:BaseShape>
    <t:AdditionalProperties>
      <t:FieldURI FieldURI="folder:DisplayName"/>
      <t:FieldURI FieldURI="folder:UnreadCount"/>
      <t:FieldURI FieldURI="folder:TotalCount"/>
    </t:AdditionalProperties>
  </m:FolderShape>
  <m:ParentFolderIds>
    <t:DistinguishedFolderId Id="msgfolderroot">
      <t:Mailbox><t:EmailAddress>{_xml_escape(mb)}</t:EmailAddress></t:Mailbox>
    </t:DistinguishedFolderId>
  </m:ParentFolderIds>
</m:FindFolder>
"""
    root = svc._post(svc._soap_envelope(body))
    for folder in root.findall(".//t:Folder", namespaces=ns):
        name = (folder.findtext("./t:DisplayName", namespaces=ns) or "").strip()
        unread_txt = folder.findtext("./t:UnreadCount", namespaces=ns) or "0"
        total_txt = folder.findtext("./t:TotalCount", namespaces=ns) or "0"
        unread = int(unread_txt) if unread_txt.isdigit() else 0
        key = name.lower()
        if unread > 0 or "entrada" in key or "prob" in key:
            print(f"  [{unread} unread / {total_txt} total] {name!r}")
