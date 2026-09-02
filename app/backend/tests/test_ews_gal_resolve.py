"""Testes — busca de contatos no catálogo global (GAL) via EWS."""
from __future__ import annotations

from unittest.mock import MagicMock

from lxml import etree


class TestResolveNames:
    def test_parseia_multiplos_contatos_smtp(self):
        from services.ews_service import EWSService

        xml = b"""
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages"
               xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types">
  <soap:Body>
    <m:ResolveNamesResponse ResponseClass="Success">
      <m:ResponseCode>NoError</m:ResponseCode>
      <m:ResolutionSet>
        <t:Resolution>
          <t:Mailbox>
            <t:Name>P_918713</t:Name>
            <t:EmailAddress>p_918713@camara.leg.br</t:EmailAddress>
            <t:RoutingType>SMTP</t:RoutingType>
          </t:Mailbox>
          <t:Contact>
            <t:CompleteName>
              <t:FullName>Joao da Silva</t:FullName>
            </t:CompleteName>
            <t:JobTitle>Analista Legislativo</t:JobTitle>
            <t:Department>DEAPA/CGraf</t:Department>
          </t:Contact>
        </t:Resolution>
        <t:Resolution>
          <t:Mailbox>
            <t:Name>Outro Usuario</t:Name>
            <t:EmailAddress>outro@camara.leg.br</t:EmailAddress>
            <t:RoutingType>SMTP</t:RoutingType>
          </t:Mailbox>
        </t:Resolution>
      </m:ResolutionSet>
    </m:ResolveNamesResponse>
  </soap:Body>
</soap:Envelope>
"""
        svc = EWSService(ews_url="https://example.test/EWS/Exchange.asmx")
        svc._post = MagicMock(return_value=etree.fromstring(xml))

        items = svc.resolve_names("P_918713")

        assert len(items) == 2
        assert items[0]["email"] == "p_918713@camara.leg.br"
        assert items[0]["name"] == "Joao da Silva"
        assert items[0]["cargo"] == "Analista Legislativo"
        assert items[0]["departamento"] == "DEAPA/CGraf"
        assert items[1]["email"] == "outro@camara.leg.br"
        assert items[1]["cargo"] == ""

    def test_sem_resultados_retorna_lista_vazia(self):
        from services.ews_service import EWSService

        xml = b"""
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages">
  <soap:Body>
    <m:ResolveNamesResponse ResponseClass="Success">
      <m:ResponseCode>NoResultsFound</m:ResponseCode>
    </m:ResolveNamesResponse>
  </soap:Body>
</soap:Envelope>
"""
        svc = EWSService(ews_url="https://example.test/EWS/Exchange.asmx")
        svc._post = MagicMock(return_value=etree.fromstring(xml))

    def test_usa_display_name_quando_mailbox_e_alias_ponto(self):
        from services.ews_service import EWSService

        xml = b"""
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages"
               xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types">
  <soap:Body>
    <m:ResolveNamesResponse xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages"
                             xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types">
      <m:ResponseMessages>
        <m:ResolveNamesResponseMessage ResponseClass="Success">
          <m:ResponseCode>NoError</m:ResponseCode>
          <m:ResolutionSet TotalItemsInView="1" IncludesLastItemInRange="true">
            <t:Resolution>
              <t:Mailbox>
                <t:Name>P_918713</t:Name>
                <t:EmailAddress>pessoa@camara.leg.br</t:EmailAddress>
                <t:RoutingType>SMTP</t:RoutingType>
              </t:Mailbox>
              <t:Contact>
                <t:DisplayName>Joao da Silva</t:DisplayName>
                <t:GivenName>Joao</t:GivenName>
                <t:Surname>da Silva</t:Surname>
                <t:JobTitle>Analista</t:JobTitle>
                <t:Department>DEAPA</t:Department>
              </t:Contact>
            </t:Resolution>
          </m:ResolutionSet>
        </m:ResolveNamesResponseMessage>
      </m:ResponseMessages>
    </m:ResolveNamesResponse>
  </soap:Body>
</soap:Envelope>
"""
        svc = EWSService(ews_url="https://example.test/EWS/Exchange.asmx")
        svc._post = MagicMock(return_value=etree.fromstring(xml))

        items = svc.resolve_names("P_918713")

        assert len(items) == 1
        assert items[0]["name"] == "Joao da Silva"
        assert items[0]["email"] == "pessoa@camara.leg.br"
    def test_resolve_gal_contacts(self, monkeypatch):
        from routers.email_routes import resolve_gal_contacts

        class FakeService:
            def resolve_names(self, query):
                assert query == "P_918713"
                return [{
                    "name": "Joao da Silva",
                    "email": "p_918713@camara.leg.br",
                    "cargo": "Analista",
                    "departamento": "DEAPA",
                }]

        monkeypatch.setattr(
            "routers.email_routes.EWS_AVAILABLE",
            True,
        )
        monkeypatch.setattr(
            "routers.email_routes._resolve_ews_for_ponto",
            lambda _p: (FakeService(), None),
        )

        class FakeSession:
            ponto = "P_000001"

        result = resolve_gal_contacts("P_918713", FakeSession())

        assert len(result.items) == 1
        assert result.items[0].email == "p_918713@camara.leg.br"


class TestSendEmailSavedItemFolder:
    def test_fallback_saves_to_from_mailbox_sentitems(self):
        from services.ews_service import EWSService

        svc = EWSService(ews_url="https://example.test/EWS/Exchange.asmx")
        captured: dict = {}

        def fake_post(envelope: str):
            captured["envelope"] = envelope
            return etree.fromstring(
                b"""<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
                  <soap:Body/>
                </soap:Envelope>"""
            )

        svc._post = fake_post  # type: ignore[method-assign]
        svc.send_email(
            to=["dest@test.local"],
            subject="Assunto",
            html_body="<p>oi</p>",
            from_mailbox="sepim.deapa@camara.leg.br",
        )

        envelope = captured["envelope"]
        assert 'MessageDisposition="SendAndSaveCopy"' in envelope
        assert 'DistinguishedFolderId Id="sentitems"' in envelope
        assert "sepim.deapa@camara.leg.br" in envelope
        assert "<t:FolderId" not in envelope

    def test_explicit_folder_id_takes_precedence(self):
        from services.ews_service import EWSService

        svc = EWSService(ews_url="https://example.test/EWS/Exchange.asmx")
        captured: dict = {}

        def fake_post(envelope: str):
            captured["envelope"] = envelope
            return etree.fromstring(
                b"""<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
                  <soap:Body/>
                </soap:Envelope>"""
            )

        svc._post = fake_post  # type: ignore[method-assign]
        svc.send_email(
            to=["dest@test.local"],
            subject="Assunto",
            html_body="<p>oi</p>",
            from_mailbox="papelaria.deapa@camara.leg.br",
            save_to_folder_id="AAMkFolderId123",
        )

        envelope = captured["envelope"]
        assert 'FolderId Id="AAMkFolderId123"' in envelope
        assert "DistinguishedFolderId" not in envelope
