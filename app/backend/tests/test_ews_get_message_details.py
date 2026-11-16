"""Testes — GetItem / get_message_details (shape SOAP e parse do body)."""
from __future__ import annotations

from unittest.mock import MagicMock

from lxml import etree


def _getitem_success_xml(*, body_html: str = "<p>corpo</p>", display_to: str = "dest@camara.leg.br") -> bytes:
    # Exchange devolve o HTML do Body como texto escapado no SOAP (não como nós filhos).
    escaped_body = (
        body_html.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )
    return f"""
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages"
               xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types">
  <soap:Body>
    <m:GetItemResponse>
      <m:ResponseMessages>
        <m:GetItemResponseMessage ResponseClass="Success">
          <m:ResponseCode>NoError</m:ResponseCode>
          <m:Items>
            <t:Message>
              <t:ItemId Id="AAMkAGItem" ChangeKey="CQAAABY"/>
              <t:Subject>Assunto teste</t:Subject>
              <t:DateTimeReceived>2026-11-16T12:00:00Z</t:DateTimeReceived>
              <t:HasAttachments>false</t:HasAttachments>
              <t:Body BodyType="HTML">{escaped_body}</t:Body>
              <t:IsRead>false</t:IsRead>
              <t:DisplayTo>{display_to}</t:DisplayTo>
              <t:From>
                <t:Mailbox>
                  <t:Name>Remetente</t:Name>
                  <t:EmailAddress>remetente@camara.leg.br</t:EmailAddress>
                </t:Mailbox>
              </t:From>
            </t:Message>
          </m:Items>
        </m:GetItemResponseMessage>
      </m:ResponseMessages>
    </m:GetItemResponse>
  </soap:Body>
</soap:Envelope>
""".encode("utf-8")


class TestGetMessageDetailsSoapShape:
    def test_usa_item_display_to_e_escapa_item_id(self):
        from services.ews_service import EWSService

        svc = EWSService(ews_url="https://example.test/EWS/Exchange.asmx")
        posted: list[str] = []

        def _capture(envelope: str):
            posted.append(envelope)
            return etree.fromstring(_getitem_success_xml())

        svc._post = MagicMock(side_effect=_capture)

        item_id = 'AAMkA&G<"x">'
        details = svc.get_message_details(item_id)

        assert len(posted) == 1
        envelope = posted[0]
        assert 'FieldURI="item:DisplayTo"' in envelope
        assert 'FieldURI="message:DisplayTo"' not in envelope
        assert 'Id="AAMkA&amp;G&lt;&quot;x&quot;&gt;"' in envelope
        assert details["body"] == "<p>corpo</p>"
        assert details["display_to"] == "dest@camara.leg.br"
        assert details["subject"] == "Assunto teste"
        assert details["sender_email"] == "remetente@camara.leg.br"
