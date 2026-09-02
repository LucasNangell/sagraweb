# services/ews_service.py
from __future__ import annotations

import base64
import hashlib
import logging
import os
import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import requests
from requests_negotiate_sspi import HttpNegotiateAuth
from lxml import etree


logger = logging.getLogger(__name__)

_PONTO_ALIAS_RE = re.compile(r"^P_\d+$", re.IGNORECASE)


class EWSUnavailableError(RuntimeError):
    """Exchange indisponível ou timeout — mensagem segura para o cliente."""


def _ensure_dotenv_loaded() -> None:
    try:
        import config_manager  # noqa: F401
    except ImportError:
        pass


def _resolve_ews_auth(
    username: Optional[str] = None,
    password: Optional[str] = None,
):
    user = (username or "").strip()
    pwd = password or ""
    if user and pwd:
        try:
            from requests_ntlm import HttpNtlmAuth
        except ImportError as exc:
            raise RuntimeError(
                "Credenciais EWS fornecidas, mas o pacote requests-ntlm não está instalado. "
                "Instale com: pip install requests-ntlm"
            ) from exc
        logger.info("EWS: usando autenticação NTLM (credenciais explícitas)")
        return HttpNtlmAuth(user, pwd)

    _ensure_dotenv_loaded()
    env_user = (os.environ.get("EWS_USERNAME") or os.environ.get("EWS_USER") or "").strip()
    env_password = os.environ.get("EWS_PASSWORD") or ""
    if env_user and env_password:
        try:
            from requests_ntlm import HttpNtlmAuth
        except ImportError as exc:
            raise RuntimeError(
                "EWS_USERNAME/EWS_PASSWORD definidos, mas o pacote requests-ntlm não está instalado. "
                "Instale com: pip install requests-ntlm"
            ) from exc
        logger.info("EWS: usando autenticação NTLM (EWS_USERNAME definido no ambiente)")
        return HttpNtlmAuth(env_user, env_password)
    return HttpNegotiateAuth()


def _configure_ews_session_proxies(session: requests.Session) -> None:
    """
    O requests herda HTTP_PROXY/HTTPS_PROXY do Windows. No servidor de produção
    isso costuma apontar para um proxy interno (ex.: 10.120.1.14:3128) inacessível
    a partir do CGrafSysVM, causando timeout no EWS. Por padrão usamos conexão direta.
    Defina EWS_HTTPS_PROXY no .env apenas se o EWS exigir proxy explícito.
    """
    explicit = (
        (os.environ.get("EWS_HTTPS_PROXY") or "").strip()
        or (os.environ.get("EWS_HTTP_PROXY") or "").strip()
    )
    session.trust_env = False
    if explicit:
        session.proxies = {"http": explicit, "https": explicit}
        logger.info("EWS: usando proxy explícito (EWS_HTTPS_PROXY / EWS_HTTP_PROXY)")
    else:
        session.proxies = {}
        logger.debug("EWS: conexão direta (proxy de ambiente ignorado)")


@dataclass(frozen=True)
class MailboxFolderTarget:
    """
    Um alvo EWS = (mailbox, folder)
    folder_type:
      - "distinguished_inbox": Inbox raiz (DistinguishedFolderId Id="inbox")
      - "folder_id": FolderId fixo (subpasta com Id conhecido)
    """
    mailbox: str
    folder_type: str
    folder_label: str
    folder_id: Optional[str] = None


class EWSService:
    def __init__(
        self,
        ews_url: str,
        verify_ssl: bool = True,
        timeout: int = 30,
        exchange_version: str = "Exchange2010_SP2",
        username: Optional[str] = None,
        password: Optional[str] = None,
    ):
        self.ews_url = ews_url
        self.verify_ssl = verify_ssl
        self.timeout = timeout
        self.exchange_version = exchange_version
        self.username = (username or "").strip() or None
        self.password = password if password is not None else None

        self.session = requests.Session()
        _configure_ews_session_proxies(self.session)
        self.session.auth = _resolve_ews_auth(self.username, self.password)
        self.session.headers.update(
            {
                "Content-Type": "text/xml; charset=utf-8",
                "Accept": "text/xml",
            }
        )

    # -------------------------
    # Helpers básicos
    # -------------------------

    def _post(self, soap_xml: str) -> etree._Element:
        try:
            r = self.session.post(
                self.ews_url,
                data=soap_xml.encode("utf-8"),
                verify=self.verify_ssl,
                timeout=self.timeout,
            )
            r.raise_for_status()
            return etree.fromstring(r.content)
        except requests.Timeout as exc:
            logger.error("EWS timeout (%ss): %s", self.timeout, self.ews_url)
            raise EWSUnavailableError(
                "Exchange não respondeu a tempo. Tente novamente em instantes."
            ) from exc
        except requests.ConnectionError as exc:
            logger.error("EWS conexão falhou: %s", self.ews_url)
            raise EWSUnavailableError(
                "Não foi possível conectar ao Exchange. Verifique rede ou tente mais tarde."
            ) from exc
        except requests.HTTPError as exc:
            status = exc.response.status_code if exc.response is not None else "?"
            logger.error("EWS HTTP %s: %s", status, self.ews_url)
            raise EWSUnavailableError(
                "Exchange retornou erro. Tente novamente em instantes."
            ) from exc
        except etree.XMLSyntaxError as exc:
            logger.error("EWS resposta XML inválida: %s", exc)
            raise EWSUnavailableError(
                "Resposta inválida do Exchange. Tente novamente."
            ) from exc

    def _soap_envelope(self, body_inner_xml: str) -> str:
        return f"""<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xmlns:xsd="http://www.w3.org/2001/XMLSchema"
               xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types"
               xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages">
  <soap:Header>
    <t:RequestServerVersion Version="{self.exchange_version}"/>
  </soap:Header>
  <soap:Body>
    {body_inner_xml}
  </soap:Body>
</soap:Envelope>"""

    @staticmethod
    def _ns() -> Dict[str, str]:
        return {
            "soap": "http://schemas.xmlsoap.org/soap/envelope/",
            "m": "http://schemas.microsoft.com/exchange/services/2006/messages",
            "t": "http://schemas.microsoft.com/exchange/services/2006/types",
        }

    @staticmethod
    def _contact_person_name(contact, mailbox_name: str, ns: Dict[str, str]) -> str:
        """Prefere DisplayName/GivenName; Mailbox.Name no GAL da Câmara costuma ser P_1234."""
        mailbox_name = (mailbox_name or "").strip()
        if contact is None:
            return mailbox_name
        full = (contact.findtext("./t:CompleteName/t:FullName", namespaces=ns) or "").strip()
        display = (contact.findtext("./t:DisplayName", namespaces=ns) or "").strip()
        given = (contact.findtext("./t:GivenName", namespaces=ns) or "").strip()
        if not given:
            given = (
                contact.findtext("./t:CompleteName/t:FirstName", namespaces=ns) or ""
            ).strip()
        surname = (contact.findtext("./t:Surname", namespaces=ns) or "").strip()
        if not surname:
            surname = (
                contact.findtext("./t:CompleteName/t:LastName", namespaces=ns) or ""
            ).strip()
        composed = " ".join(part for part in (given, surname) if part)
        for candidate in (full, display, composed):
            if candidate and not _PONTO_ALIAS_RE.fullmatch(candidate):
                return candidate
        return mailbox_name

    @staticmethod
    def _stable_short_id(s: str) -> int:
        # UI id curto, estável
        h = hashlib.md5(s.encode("utf-8")).hexdigest()[:8]
        return int(h, 16)

    # -------------------------
    # Folder resolvers
    # -------------------------

    def _parent_folder_ids_xml(self, target: MailboxFolderTarget) -> str:
        """
        Gera o XML correto para apontar o FindItem no folder alvo.
        """
        if target.folder_type == "distinguished_inbox":
            return f"""
<m:ParentFolderIds>
  <t:DistinguishedFolderId Id="inbox">
    <t:Mailbox>
      <t:EmailAddress>{target.mailbox}</t:EmailAddress>
    </t:Mailbox>
  </t:DistinguishedFolderId>
</m:ParentFolderIds>
"""
        if target.folder_type == "distinguished_sentitems":
            return f"""
<m:ParentFolderIds>
  <t:DistinguishedFolderId Id="sentitems">
    <t:Mailbox>
      <t:EmailAddress>{target.mailbox}</t:EmailAddress>
    </t:Mailbox>
  </t:DistinguishedFolderId>
</m:ParentFolderIds>
"""
        if target.folder_type == "distinguished_msgfolderroot":
            return f"""
<m:ParentFolderIds>
  <t:DistinguishedFolderId Id="msgfolderroot">
    <t:Mailbox>
      <t:EmailAddress>{_xml_escape(target.mailbox)}</t:EmailAddress>
    </t:Mailbox>
  </t:DistinguishedFolderId>
</m:ParentFolderIds>
"""
        if target.folder_type == "folder_id":
            if not target.folder_id:
                raise ValueError(f"folder_id ausente para target {target}")
            return f"""
<m:ParentFolderIds>
  <t:FolderId Id="{target.folder_id}"/>
</m:ParentFolderIds>
"""
        raise ValueError(f"folder_type inválido: {target.folder_type}")

    # -------------------------
    # FindItem (somente NÃO LIDOS)
    # -------------------------

    def find_unread_messages(
        self,
        target: MailboxFolderTarget,
        max_items: int = 20,
    ) -> List[Dict[str, Any]]:
        """
        Retorna lista básica de mensagens não lidas (item_id + change_key + metadados).
        Observação: para anexos e corpo completo, use get_message_details(item_id).
        """
        body = f"""
<m:FindItem Traversal="Shallow">
  <m:ItemShape>
    <t:BaseShape>IdOnly</t:BaseShape>
    <t:AdditionalProperties>
      <t:FieldURI FieldURI="item:Subject"/>
      <t:FieldURI FieldURI="item:DateTimeReceived"/>
      <t:FieldURI FieldURI="message:From"/>
      <t:FieldURI FieldURI="item:HasAttachments"/>
      <t:FieldURI FieldURI="message:IsRead"/>
      <t:FieldURI FieldURI="item:Body"/>
    </t:AdditionalProperties>
  </m:ItemShape>

  <m:IndexedPageItemView MaxEntriesReturned="{max_items}" Offset="0" BasePoint="Beginning"/>
  <m:Restriction>
    <t:IsEqualTo>
      <t:FieldURI FieldURI="message:IsRead"/>
      <t:FieldURIOrConstant>
        <t:Constant Value="false"/>
      </t:FieldURIOrConstant>
    </t:IsEqualTo>
  </m:Restriction>

  <m:SortOrder>
    <t:FieldOrder Order="Descending">
      <t:FieldURI FieldURI="item:DateTimeReceived"/>
    </t:FieldOrder>
  </m:SortOrder>

  {self._parent_folder_ids_xml(target)}
</m:FindItem>
"""
        envelope = self._soap_envelope(body)
        root = self._post(envelope)
        ns = self._ns()

        items = []
        # Message nodes
        for msg in root.findall(".//t:Message", namespaces=ns):
            item_id_el = msg.find("./t:ItemId", namespaces=ns)
            if item_id_el is None:
                continue

            item_id = item_id_el.get("Id")
            change_key = item_id_el.get("ChangeKey")

            subject = (msg.findtext("./t:Subject", namespaces=ns) or "").strip()
            dt_received = (msg.findtext("./t:DateTimeReceived", namespaces=ns) or "").strip()

            # From
            from_name = ""
            from_email = ""
            from_el = msg.find("./t:From/t:Mailbox", namespaces=ns)
            if from_el is not None:
                from_name = (from_el.findtext("./t:Name", namespaces=ns) or "").strip()
                from_email = (from_el.findtext("./t:EmailAddress", namespaces=ns) or "").strip()

            has_att = (msg.findtext("./t:HasAttachments", namespaces=ns) or "false").lower() == "true"

            # Body pode vir aqui (dependendo de permissão/versão/política)
            body_text = (msg.findtext("./t:Body", namespaces=ns) or "").strip()
            preview = (body_text[:100] + "...") if body_text else ""

            items.append(
                {
                    "item_id": item_id,
                    "change_key": change_key,
                    "subject": subject,
                    "date": dt_received,
                    "sender_name": from_name,
                    "sender_email": from_email,
                    "has_attachments": has_att,
                    "body": body_text,   # pode estar vazio em alguns cenários
                    "preview": preview,
                }
            )

        return items

    # -------------------------
    # GetItem (detalhes + anexos)
    # -------------------------

    def get_message_details(self, item_id: str) -> Dict[str, Any]:
        """
        Retorna body completo, anexos (nome + attachment_id) e o ChangeKey atual.
        """
        body = f"""
<m:GetItem>
  <m:ItemShape>
    <t:BaseShape>IdOnly</t:BaseShape>
    <t:IncludeMimeContent>false</t:IncludeMimeContent>
    <t:BodyType>HTML</t:BodyType>
    <t:AdditionalProperties>
      <t:FieldURI FieldURI="item:Subject"/>
      <t:FieldURI FieldURI="item:DateTimeReceived"/>
      <t:FieldURI FieldURI="message:From"/>
      <t:FieldURI FieldURI="message:IsRead"/>
      <t:FieldURI FieldURI="item:Body"/>
      <t:FieldURI FieldURI="item:HasAttachments"/>
      <t:FieldURI FieldURI="item:Attachments"/>
      <t:FieldURI FieldURI="item:Categories"/>
    </t:AdditionalProperties>
  </m:ItemShape>
  <m:ItemIds>
    <t:ItemId Id="{item_id}"/>
  </m:ItemIds>
</m:GetItem>
"""
        envelope = self._soap_envelope(body)
        root = self._post(envelope)
        ns = self._ns()

        msg = root.find(".//t:Message", namespaces=ns)
        if msg is None:
            raise RuntimeError("GetItem: Message não encontrado (item_id inválido ou sem permissão).")

        item_id_el = msg.find("./t:ItemId", namespaces=ns)
        change_key = item_id_el.get("ChangeKey") if item_id_el is not None else None

        subject = (msg.findtext("./t:Subject", namespaces=ns) or "").strip()
        dt_received = (msg.findtext("./t:DateTimeReceived", namespaces=ns) or "").strip()

        from_name = ""
        from_email = ""
        from_el = msg.find("./t:From/t:Mailbox", namespaces=ns)
        if from_el is not None:
            from_name = (from_el.findtext("./t:Name", namespaces=ns) or "").strip()
            from_email = (from_el.findtext("./t:EmailAddress", namespaces=ns) or "").strip()

        is_read = (msg.findtext("./t:IsRead", namespaces=ns) or "false").lower() == "true"
        has_att = (msg.findtext("./t:HasAttachments", namespaces=ns) or "false").lower() == "true"

        body_text = (msg.findtext("./t:Body", namespaces=ns) or "").strip()

        # Attachments: FileAttachment
        attachments: List[Dict[str, Any]] = []
        for fa in msg.findall(".//t:FileAttachment", namespaces=ns):
            name = (fa.findtext("./t:Name", namespaces=ns) or "").strip()
            att_id_el = fa.find("./t:AttachmentId", namespaces=ns)
            if att_id_el is None:
                continue
            att_id = att_id_el.get("Id")
            if att_id:
                is_inline = (
                    fa.findtext("./t:IsInline", namespaces=ns) or "false"
                ).lower() == "true"
                content_id = (fa.findtext("./t:ContentId", namespaces=ns) or "").strip()
                attachments.append(
                    {
                        "name": name,
                        "attachment_id": att_id,
                        "is_inline": is_inline,
                        "content_id": content_id,
                    }
                )

        return {
            "item_id": item_id,
            "change_key": change_key,
            "subject": subject,
            "date": dt_received,
            "sender_name": from_name,
            "sender_email": from_email,
            "is_read": is_read,
            "has_attachments": has_att,
            "body": body_text,
            "attachments": attachments,
        }

    def get_message_mime_content(self, item_id: str) -> bytes:
        """
        Retorna o conteúdo MIME bruto do e-mail (formato EML/MHT compatível).
        """
        body = f"""
<m:GetItem>
  <m:ItemShape>
    <t:BaseShape>IdOnly</t:BaseShape>
    <t:IncludeMimeContent>true</t:IncludeMimeContent>
  </m:ItemShape>
  <m:ItemIds>
    <t:ItemId Id="{item_id}"/>
  </m:ItemIds>
</m:GetItem>
"""
        envelope = self._soap_envelope(body)
        root = self._post(envelope)
        ns = self._ns()

        mime_node = root.find(".//t:MimeContent", namespaces=ns)
        if mime_node is None or not (mime_node.text or "").strip():
            raise RuntimeError("GetItem: MimeContent não retornado para a mensagem.")

        try:
            return base64.b64decode((mime_node.text or "").strip())
        except Exception as exc:
            raise RuntimeError(f"Falha ao decodificar MimeContent: {exc}") from exc

    # -------------------------
    # GetAttachment (download)
    # -------------------------

    def get_attachment_content(self, attachment_id: str) -> Tuple[str, bytes]:
        """
        Retorna (filename, bytes) do anexo.
        """
        body = f"""
<m:GetAttachment>
  <m:AttachmentIds>
    <t:AttachmentId Id="{attachment_id}"/>
  </m:AttachmentIds>
</m:GetAttachment>
"""
        envelope = self._soap_envelope(body)
        root = self._post(envelope)
        ns = self._ns()

        fa = root.find(".//t:FileAttachment", namespaces=ns)
        if fa is None:
            raise RuntimeError("GetAttachment: FileAttachment não encontrado.")

        name = (fa.findtext("./t:Name", namespaces=ns) or "attachment.bin").strip()
        content_b64 = (fa.findtext("./t:Content", namespaces=ns) or "").strip()
        if not content_b64:
            raise RuntimeError("GetAttachment: conteúdo vazio.")

        content = base64.b64decode(content_b64)
        return name, content

    # -------------------------
    # UpdateItem (marcar lido + categoria)
    # -------------------------

    def mark_as_read_and_categorize(
        self,
        item_id: str,
        category_text: str = "Pedido atendido (lido e proc.)",
    ) -> None:
        """
        Marca mensagem como lida e adiciona categoria.
        Observação: usa ChangeKey atual via GetItem.
        """
        details = self.get_message_details(item_id)
        change_key = details.get("change_key")
        if not change_key:
            raise RuntimeError("UpdateItem: não foi possível obter ChangeKey.")

        # Merge categorias (se já existir)
        existing_cats = []
        # (Como simplificação: adicionamos categoria sem ler lista existente do XML em detalhe.
        # Se você quiser "merge" real, dá pra parsear item:Categories no GetItem.)
        # Aqui: apenas seta Categories = category_text (mais compatível com seu uso atual).
        cats_xml = f"<t:String>{_xml_escape(category_text)}</t:String>"

        body = f"""
<m:UpdateItem ConflictResolution="AutoResolve" MessageDisposition="SaveOnly">
  <m:ItemChanges>
    <t:ItemChange>
      <t:ItemId Id="{item_id}" ChangeKey="{change_key}"/>
      <t:Updates>

        <t:SetItemField>
          <t:FieldURI FieldURI="message:IsRead"/>
          <t:Message>
            <t:IsRead>true</t:IsRead>
          </t:Message>
        </t:SetItemField>

        <t:SetItemField>
          <t:FieldURI FieldURI="item:Categories"/>
          <t:Message>
            <t:Categories>
              {cats_xml}
            </t:Categories>
          </t:Message>
        </t:SetItemField>

      </t:Updates>
    </t:ItemChange>
  </m:ItemChanges>
</m:UpdateItem>
"""
        envelope = self._soap_envelope(body)
        self._post(envelope)

    # -------------------------
    # CreateItem (send)
    # -------------------------

    def send_email(
        self,
        to: List[str],
        subject: str,
        html_body: str,
        from_mailbox: Optional[str] = None,
        attachments: Optional[List[Tuple[str, bytes]]] = None,
        inline_images: Optional[List[Tuple[str, bytes, str, str]]] = None,
        save_to_folder_id: Optional[str] = None,
    ) -> None:
        """
        Envia email via EWS.
        - from_mailbox: se tiver permissão de "enviar como" / "enviar em nome de", tente setar.
        - attachments: lista de (filename, bytes)
        - inline_images: lista de (filename, bytes, content_id, mime_type) para cid: no HTML
        - save_to_folder_id: ID da pasta onde salvar a cópia do item enviado.
          Se omitido e from_mailbox estiver definido, salva em Itens/Mensagens Enviados
          (sentitems) dessa mailbox.
        """
        to_xml = "\n".join(
            f"<t:Mailbox><t:EmailAddress>{_xml_escape(addr)}</t:EmailAddress></t:Mailbox>"
            for addr in to
        )

        from_xml = ""
        if from_mailbox:
            # Pode funcionar como "From" se tiver permissão no Exchange
            from_xml = f"""
<t:From>
  <t:Mailbox>
    <t:EmailAddress>{_xml_escape(from_mailbox)}</t:EmailAddress>
  </t:Mailbox>
</t:From>
"""

        att_xml = ""
        if attachments or inline_images:
            parts = []
            for filename, content in attachments or []:
                b64 = base64.b64encode(content).decode("ascii")
                parts.append(
                    f"""
<t:FileAttachment>
  <t:Name>{_xml_escape(filename)}</t:Name>
  <t:IsInline>false</t:IsInline>
  <t:Content>{b64}</t:Content>
</t:FileAttachment>
""".strip()
                )
            for filename, content, content_id, mime_type in inline_images or []:
                b64 = base64.b64encode(content).decode("ascii")
                parts.append(
                    f"""
<t:FileAttachment>
  <t:Name>{_xml_escape(filename)}</t:Name>
  <t:IsInline>true</t:IsInline>
  <t:ContentId>{_xml_escape(content_id)}</t:ContentId>
  <t:ContentType>{_xml_escape(mime_type)}</t:ContentType>
  <t:Content>{b64}</t:Content>
</t:FileAttachment>
""".strip()
                )
            att_xml = f"<t:Attachments>{''.join(parts)}</t:Attachments>"

        # Pasta destino da cópia (sempre na mailbox do From quando possível):
        # 1) subpasta explícita (ex. Saida de Provas sob Itens/Mensagens Enviados)
        # 2) senão, raiz sentitems da from_mailbox — evita cair na conta do serviço
        saved_folder_xml = ""
        if save_to_folder_id:
            saved_folder_xml = f"""
  <m:SavedItemFolderId>
    <t:FolderId Id="{_xml_escape(save_to_folder_id)}"/>
  </m:SavedItemFolderId>
"""
        elif from_mailbox and str(from_mailbox).strip():
            mailbox = str(from_mailbox).strip()
            saved_folder_xml = f"""
  <m:SavedItemFolderId>
    <t:DistinguishedFolderId Id="sentitems">
      <t:Mailbox>
        <t:EmailAddress>{_xml_escape(mailbox)}</t:EmailAddress>
      </t:Mailbox>
    </t:DistinguishedFolderId>
  </m:SavedItemFolderId>
"""

        body = f"""
<m:CreateItem MessageDisposition="SendAndSaveCopy">
  {saved_folder_xml}
  <m:Items>
    <t:Message>
      {from_xml}
      <t:ToRecipients>
        {to_xml}
      </t:ToRecipients>
      <t:Subject>{_xml_escape(subject)}</t:Subject>
      <t:Body BodyType="HTML">{_xml_escape(html_body)}</t:Body>
      {att_xml}
    </t:Message>
  </m:Items>
</m:CreateItem>
"""
        envelope = self._soap_envelope(body)
        self._post(envelope)


    def find_folder_id(self, parent_target: MailboxFolderTarget, folder_name: str) -> Optional[str]:
        """
        Busca o ID de uma subpasta pelo nome (shallow search).
        """
        parent_xml = self._parent_folder_ids_xml(parent_target)
        
        body = f"""
<m:FindFolder Traversal="Shallow">
  <m:FolderShape>
    <t:BaseShape>IdOnly</t:BaseShape>
    <t:AdditionalProperties>
      <t:FieldURI FieldURI="folder:DisplayName"/>
    </t:AdditionalProperties>
  </m:FolderShape>
  <m:Restriction>
    <t:IsEqualTo>
      <t:FieldURI FieldURI="folder:DisplayName"/>
      <t:FieldURIOrConstant>
        <t:Constant Value="{_xml_escape(folder_name)}"/>
      </t:FieldURIOrConstant>
    </t:IsEqualTo>
  </m:Restriction>
  {parent_xml}
</m:FindFolder>
"""
        envelope = self._soap_envelope(body)
        root = self._post(envelope)
        ns = self._ns()

        # Procura qualquer FolderID
        folder_id_el = root.find(".//t:FolderId", namespaces=ns)
        if folder_id_el is not None:
            return folder_id_el.get("Id")
        return None

    def list_child_folders(
        self,
        target: MailboxFolderTarget,
        *,
        deep: bool = False,
    ) -> List[Dict[str, Any]]:
        """Lista subpastas do alvo informado."""
        parent_xml = self._parent_folder_ids_xml(target)
        traversal = "Deep" if deep else "Shallow"
        body = f"""
<m:FindFolder Traversal="{traversal}">
  <m:FolderShape>
    <t:BaseShape>Default</t:BaseShape>
    <t:AdditionalProperties>
      <t:FieldURI FieldURI="folder:DisplayName"/>
      <t:FieldURI FieldURI="folder:UnreadCount"/>
      <t:FieldURI FieldURI="folder:TotalCount"/>
      <t:FieldURI FieldURI="folder:ParentFolderId"/>
    </t:AdditionalProperties>
  </m:FolderShape>
  {parent_xml}
</m:FindFolder>
"""
        root = self._post(self._soap_envelope(body))
        ns = self._ns()
        folders: List[Dict[str, Any]] = []
        for folder in root.findall(".//t:Folder", namespaces=ns):
            name = (folder.findtext("./t:DisplayName", namespaces=ns) or "").strip()
            fid_el = folder.find("./t:FolderId", namespaces=ns)
            if fid_el is None:
                continue
            fid = fid_el.get("Id") or ""
            change_key = fid_el.get("ChangeKey") or ""
            unread_txt = folder.findtext("./t:UnreadCount", namespaces=ns)
            total_txt = folder.findtext("./t:TotalCount", namespaces=ns)
            unread = int(unread_txt) if unread_txt and unread_txt.isdigit() else None
            total = int(total_txt) if total_txt and total_txt.isdigit() else None
            parent_el = folder.find("./t:ParentFolderId", namespaces=ns)
            parent_id = parent_el.get("Id") if parent_el is not None else None
            folders.append(
                {
                    "id": fid,
                    "change_key": change_key,
                    "name": name,
                    "unread_count": unread,
                    "total_count": total,
                    "parent_id": parent_id,
                }
            )
        folders.sort(key=lambda item: (item.get("name") or "").lower())
        return folders

    @staticmethod
    def _normalize_smtp_address(username: str) -> str:
        value = (username or "").strip()
        if "@" in value:
            return value.lower()
        if "\\" in value:
            value = value.split("\\", 1)[-1]
        return f"{value}@camara.leg.br".lower()

    def list_delegate_mailboxes(self, primary_smtp: str) -> List[str]:
        """Retorna caixas delegadas ao usuário autenticado."""
        body = f"""
<m:GetDelegate>
  <m:UserIds>
    <t:PrimarySmtpAddress>{_xml_escape(primary_smtp)}</t:PrimarySmtpAddress>
  </m:UserIds>
</m:GetDelegate>
"""
        root = self._post(self._soap_envelope(body))
        ns = self._ns()
        mailboxes: List[str] = []
        for mailbox in root.findall(".//t:Mailbox/t:EmailAddress", namespaces=ns):
            addr = (mailbox.text or "").strip().lower()
            if addr and addr not in mailboxes:
                mailboxes.append(addr)
        return mailboxes

    def probe_mailbox_access(self, mailbox: str) -> bool:
        """Verifica se a credencial atual consegue acessar a mailbox informada."""
        target = MailboxFolderTarget(
            mailbox=mailbox,
            folder_type="distinguished_inbox",
            folder_label="Inbox",
        )
        try:
            self.list_child_folders(target, deep=False)
            return True
        except Exception:
            return False

    def list_accessible_mailboxes(
        self,
        *,
        extra_candidates: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        """
        Descobre caixas acessíveis: primária, delegadas e candidatas conhecidas.
        """
        primary = self._normalize_smtp_address(self.username or "")
        candidates: List[str] = []
        if primary:
            candidates.append(primary)

        if primary:
            try:
                candidates.extend(self.list_delegate_mailboxes(primary))
            except Exception as exc:
                logger.warning("GetDelegate falhou para %s: %s", primary, exc)

        for addr in extra_candidates or []:
            normalized = addr.strip().lower()
            if normalized and normalized not in candidates:
                candidates.append(normalized)

        results: List[Dict[str, Any]] = []
        seen: set[str] = set()
        for mailbox in candidates:
            key = mailbox.lower()
            if key in seen:
                continue
            seen.add(key)
            accessible = self.probe_mailbox_access(mailbox)
            results.append(
                {
                    "address": mailbox,
                    "display_name": mailbox.split("@", 1)[0],
                    "is_primary": key == primary,
                    "accessible": accessible,
                }
            )
        results.sort(
            key=lambda item: (
                0 if item.get("is_primary") else 1,
                0 if item.get("accessible") else 1,
                item.get("address") or "",
            )
        )
        return results

    def resolve_names(self, query: str, *, max_results: int = 20) -> List[Dict[str, str]]:
        """Busca contatos no catálogo global (GAL) por ponto, nome ou e-mail."""
        q = (query or "").strip()
        if len(q) < 2:
            return []

        limit = max(1, min(int(max_results), 50))
        body = f"""
<m:ResolveNames ReturnFullContactData="true" SearchScope="ActiveDirectory" MaxAmbiguousResults="{limit}">
  <m:UnresolvedEntry>{_xml_escape(q)}</m:UnresolvedEntry>
</m:ResolveNames>
"""
        root = self._post(self._soap_envelope(body))
        ns = self._ns()

        for msg in root.findall(".//m:ResolveNamesResponseMessage", namespaces=ns):
            code = (msg.findtext("./m:ResponseCode", namespaces=ns) or "").strip()
            if code in ("NoResultsFound", "ErrorNameResolutionNoResults"):
                return []
            if code and code != "NoError":
                logger.warning("ResolveNames retornou %s para consulta '%s'", code, q)
                return []

        results: List[Dict[str, str]] = []
        seen: set[str] = set()
        resolutions = root.findall(".//t:Resolution", namespaces=ns)
        if resolutions:
            candidates = [(res, res.find("./t:Mailbox", namespaces=ns)) for res in resolutions]
        else:
            candidates = [(None, mb) for mb in root.findall(".//t:Mailbox", namespaces=ns)]

        for resolution, mailbox in candidates:
            if mailbox is None:
                continue
            name = (mailbox.findtext("./t:Name", namespaces=ns) or "").strip()
            email = (mailbox.findtext("./t:EmailAddress", namespaces=ns) or "").strip().lower()
            routing = (mailbox.findtext("./t:RoutingType", namespaces=ns) or "").strip().upper()
            if not email or "@" not in email:
                continue
            if routing and routing != "SMTP":
                continue
            if email in seen:
                continue
            seen.add(email)

            cargo = ""
            departamento = ""
            if resolution is not None:
                contact = resolution.find("./t:Contact", namespaces=ns)
                if contact is not None:
                    cargo = (contact.findtext("./t:JobTitle", namespaces=ns) or "").strip()
                    departamento = (contact.findtext("./t:Department", namespaces=ns) or "").strip()
                name = self._contact_person_name(contact, name, ns)

            results.append(
                {
                    "name": name or email,
                    "email": email,
                    "cargo": cargo,
                    "departamento": departamento,
                    "routing_type": routing or "SMTP",
                }
            )
        return results


def _xml_escape(s: str) -> str:
    # Escape mínimo seguro para texto em XML
    return (
        s.replace("&", "&amp;")
         .replace("<", "&lt;")
         .replace(">", "&gt;")
         .replace('"', "&quot;")
         .replace("'", "&apos;")
    )
