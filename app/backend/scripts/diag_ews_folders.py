"""Diagnóstico EWS: pastas e contagem de não lidos."""
from __future__ import annotations

import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(BACKEND.parent / "services"))

import config_manager  # noqa: F401
from services.ews_service import EWSService, MailboxFolderTarget, _xml_escape

EWS_URL = "https://ce.camara.leg.br/EWS/Exchange.asmx"
MAILBOXES = [
    "sepim.deapa@camara.leg.br",
    "papelaria.deapa@camara.leg.br",
]
TARGET_NAMES = ["Entrada de Provas", "Entrada de Prob. Tec."]


def list_child_folders(svc: EWSService, parent: MailboxFolderTarget) -> list[tuple[str, str, int | None]]:
    parent_xml = svc._parent_folder_ids_xml(parent)
    body = f"""
<m:FindFolder Traversal="Shallow">
  <m:FolderShape>
    <t:BaseShape>Default</t:BaseShape>
    <t:AdditionalProperties>
      <t:FieldURI FieldURI="folder:DisplayName"/>
      <t:FieldURI FieldURI="folder:UnreadCount"/>
      <t:FieldURI FieldURI="folder:TotalCount"/>
    </t:AdditionalProperties>
  </m:FolderShape>
  {parent_xml}
</m:FindFolder>
"""
    root = svc._post(svc._soap_envelope(body))
    ns = svc._ns()
    out: list[tuple[str, str, int | None]] = []
    for folder in root.findall(".//t:Folder", namespaces=ns):
        name = (folder.findtext("./t:DisplayName", namespaces=ns) or "").strip()
        fid_el = folder.find("./t:FolderId", namespaces=ns)
        if fid_el is None:
            continue
        fid = fid_el.get("Id") or ""
        unread_txt = folder.findtext("./t:UnreadCount", namespaces=ns)
        unread = int(unread_txt) if unread_txt and unread_txt.isdigit() else None
        out.append((name, fid, unread))
    return out


def list_folders_deep(svc: EWSService, parent: MailboxFolderTarget, indent: int = 0) -> None:
    parent_xml = svc._parent_folder_ids_xml(parent)
    body = f"""
<m:FindFolder Traversal="Deep">
  <m:FolderShape>
    <t:BaseShape>Default</t:BaseShape>
    <t:AdditionalProperties>
      <t:FieldURI FieldURI="folder:DisplayName"/>
      <t:FieldURI FieldURI="folder:UnreadCount"/>
    </t:AdditionalProperties>
  </m:FolderShape>
  {parent_xml}
</m:FindFolder>
"""
    root = svc._post(svc._soap_envelope(body))
    ns = svc._ns()
    for folder in root.findall(".//t:Folder", namespaces=ns):
        name = (folder.findtext("./t:DisplayName", namespaces=ns) or "").strip()
        unread_txt = folder.findtext("./t:UnreadCount", namespaces=ns)
        unread = int(unread_txt) if unread_txt and unread_txt.isdigit() else 0
        if unread > 0:
            print(" " * indent + f"!! [{unread} unread] {name!r}")


def main() -> None:
    svc = EWSService(ews_url=EWS_URL, verify_ssl=False)
    ns = svc._ns()

    for mailbox in MAILBOXES:
        print(f"\n{'=' * 60}\nMAILBOX: {mailbox}\n{'=' * 60}")
        inbox = MailboxFolderTarget(
            mailbox=mailbox,
            folder_type="distinguished_inbox",
            folder_label="Inbox",
        )

        print("\n-- Subpastas diretas da Inbox --")
        children = list_child_folders(svc, inbox)
        if not children:
            print("(nenhuma subpasta encontrada)")
        for name, fid, unread in sorted(children, key=lambda x: x[0].lower()):
            mark = " <-- ALVO" if name in TARGET_NAMES else ""
            print(f"  [{unread if unread is not None else '?'} unread] {name!r}{mark}")
            if name in TARGET_NAMES:
                tgt = MailboxFolderTarget(
                    mailbox=mailbox,
                    folder_type="folder_id",
                    folder_label=name,
                    folder_id=fid,
                )
                via_api = svc.find_unread_messages(tgt, max_items=50)
                print(f"       find_unread_messages => {len(via_api)} itens")

        print("\n-- Resolução find_folder_id (como a API) --")
        for folder_name in TARGET_NAMES:
            fid = svc.find_folder_id(inbox, folder_name)
            print(f"  {folder_name!r} => {('OK ' + fid[:24] + '...') if fid else 'NAO ENCONTRADA'}")

        for folder_name in TARGET_NAMES:
            fid = svc.find_folder_id(inbox, folder_name)
            if not fid:
                continue
            tgt = MailboxFolderTarget(
                mailbox=mailbox,
                folder_type="folder_id",
                folder_label=folder_name,
                folder_id=fid,
            )
            print(f"\n-- Subpastas dentro de {folder_name!r} --")
            nested = list_child_folders(svc, tgt)
            if not nested:
                print("  (nenhuma subpasta)")
            for nname, _, nunread in nested:
                print(f"  [{nunread if nunread is not None else '?'} unread] {nname!r}")

            # FindItem Deep vs Shallow
            for traversal in ("Shallow", "Deep"):
                try:
                    body = f"""
<m:FindItem Traversal="{traversal}">
  <m:ItemShape><t:BaseShape>IdOnly</t:BaseShape>
    <t:AdditionalProperties>
      <t:FieldURI FieldURI="item:Subject"/>
      <t:FieldURI FieldURI="message:IsRead"/>
    </t:AdditionalProperties>
  </m:ItemShape>
  <m:IndexedPageItemView MaxEntriesReturned="20" Offset="0" BasePoint="Beginning"/>
  <m:Restriction>
    <t:IsEqualTo>
      <t:FieldURI FieldURI="message:IsRead"/>
      <t:FieldURIOrConstant><t:Constant Value="false"/></t:FieldURIOrConstant>
    </t:IsEqualTo>
  </m:Restriction>
  {svc._parent_folder_ids_xml(tgt)}
</m:FindItem>
"""
                    root = svc._post(svc._soap_envelope(body))
                    msgs = root.findall(".//t:Message", namespaces=ns)
                    print(f"  {folder_name} ({traversal}): {len(msgs)} não lidos")
                except Exception as e:
                    print(f"  {folder_name} ({traversal}): ERRO {type(e).__name__}: {e}")

        print("\n-- Qualquer pasta com UnreadCount > 0 (árvore Deep da Inbox) --")
        try:
            list_folders_deep(svc, inbox)
        except Exception as e:
            print(f"  ERRO Deep FindFolder: {e}")

        msgroot = MailboxFolderTarget(
            mailbox=mailbox,
            folder_type="distinguished_inbox",
            folder_label="msgfolderroot",
        )
        # msgfolderroot via distinguished id override in helper - use raw xml
        print("\n-- Pastas com não lidos (Deep a partir de msgfolderroot) --")
        body = f"""
<m:FindFolder Traversal="Deep">
  <m:FolderShape>
    <t:BaseShape>Default</t:BaseShape>
    <t:AdditionalProperties>
      <t:FieldURI FieldURI="folder:DisplayName"/>
      <t:FieldURI FieldURI="folder:UnreadCount"/>
    </t:AdditionalProperties>
  </m:FolderShape>
  <m:ParentFolderIds>
    <t:DistinguishedFolderId Id="msgfolderroot">
      <t:Mailbox><t:EmailAddress>{_xml_escape(mailbox)}</t:EmailAddress></t:Mailbox>
    </t:DistinguishedFolderId>
  </m:ParentFolderIds>
</m:FindFolder>
"""
        try:
            root = svc._post(svc._soap_envelope(body))
            ns = svc._ns()
            found = False
            for folder in root.findall(".//t:Folder", namespaces=ns):
                name = (folder.findtext("./t:DisplayName", namespaces=ns) or "").strip()
                unread_txt = folder.findtext("./t:UnreadCount", namespaces=ns)
                unread = int(unread_txt) if unread_txt and unread_txt.isdigit() else 0
                if unread > 0:
                    found = True
                    print(f"  [{unread} unread] {name!r}")
            if not found:
                print("  (nenhuma pasta com não lidos em toda a mailbox)")
        except Exception as e:
            print(f"  ERRO: {e}")

        print("\n-- Não lidos na Inbox raiz (sem subpasta) --")
        body = f"""
<m:FindItem Traversal="Shallow">
  <m:ItemShape><t:BaseShape>IdOnly</t:BaseShape>
    <t:AdditionalProperties>
      <t:FieldURI FieldURI="item:Subject"/>
      <t:FieldURI FieldURI="message:IsRead"/>
    </t:AdditionalProperties>
  </m:ItemShape>
  <m:IndexedPageItemView MaxEntriesReturned="20" Offset="0" BasePoint="Beginning"/>
  <m:Restriction>
    <t:IsEqualTo>
      <t:FieldURI FieldURI="message:IsRead"/>
      <t:FieldURIOrConstant><t:Constant Value="false"/></t:FieldURIOrConstant>
    </t:IsEqualTo>
  </m:Restriction>
  {svc._parent_folder_ids_xml(inbox)}
</m:FindItem>
"""
        root = svc._post(svc._soap_envelope(body))
        msgs = root.findall(".//t:Message", namespaces=ns)
        print(f"  Inbox raiz: {len(msgs)} não lidos (amostra até 20)")
        for m in msgs[:5]:
            subj = (m.findtext("./t:Subject", namespaces=ns) or "")[:60]
            print(f"    - {subj!r}")


def find_all_unread_deep_mailbox(svc: EWSService, mailbox: str) -> int:
    body = f"""
<m:FindItem Traversal="Deep">
  <m:ItemShape><t:BaseShape>IdOnly</t:BaseShape>
    <t:AdditionalProperties>
      <t:FieldURI FieldURI="item:Subject"/>
      <t:FieldURI FieldURI="message:IsRead"/>
    </t:AdditionalProperties>
  </m:ItemShape>
  <m:IndexedPageItemView MaxEntriesReturned="100" Offset="0" BasePoint="Beginning"/>
  <m:Restriction>
    <t:IsEqualTo>
      <t:FieldURI FieldURI="message:IsRead"/>
      <t:FieldURIOrConstant><t:Constant Value="false"/></t:FieldURIOrConstant>
    </t:IsEqualTo>
  </m:Restriction>
  <m:ParentFolderIds>
    <t:DistinguishedFolderId Id="msgfolderroot">
      <t:Mailbox><t:EmailAddress>{_xml_escape(mailbox)}</t:EmailAddress></t:Mailbox>
    </t:DistinguishedFolderId>
  </m:ParentFolderIds>
</m:FindItem>
"""
    root = svc._post(svc._soap_envelope(body))
    return len(root.findall(".//t:Message", namespaces=svc._ns()))


if __name__ == "__main__":
    main()
    print("\n" + "=" * 60)
    print("RESUMO: não lidos em toda a mailbox (Deep + msgfolderroot)")
    print("=" * 60)
    svc = EWSService(ews_url=EWS_URL, verify_ssl=False)
    for mailbox in MAILBOXES:
        try:
            n = find_all_unread_deep_mailbox(svc, mailbox)
            print(f"  {mailbox}: {n} mensagens não lidas (todas as pastas)")
        except Exception as e:
            print(f"  {mailbox}: ERRO {e}")
