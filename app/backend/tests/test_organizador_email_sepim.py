"""Testes do organizador da caixa sepim.deapa (sem Exchange real)."""
from __future__ import annotations

import logging
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

import pytest

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import organizador_email_sepim_service as org  # noqa: E402
from services.ews_service import (  # noqa: E402
    EWSOperationError,
    EWSService,
    MailboxFolderTarget,
)
from lxml import etree  # noqa: E402

MAILBOX = "sepim.deapa@camara.leg.br"

PASTA_IDS = {
    org.PASTA_ENTRADA_PT: "id-entrada-pt",
    org.PASTA_ENTRADA_PROVAS: "id-entrada-provas",
    org.PASTA_SAIDA_PT: "id-saida-pt",
    org.PASTA_SAIDA_PROVAS: "id-saida-provas",
}


class TestClassificar:
    @pytest.mark.parametrize(
        "assunto,origem,esperado",
        [
            ("Problemas Técnicos - OS 1234/2026", "entrada", org.PASTA_ENTRADA_PT),
            ("PROBLEMAS TECNICOS os 55", "entrada", org.PASTA_ENTRADA_PT),
            ("RES: problemas  técnicos", "saida", org.PASTA_SAIDA_PT),
            ("Prova - OS 1234", "entrada", org.PASTA_ENTRADA_PROVAS),
            ("ENC: Provas da OS 99", "saida", org.PASTA_SAIDA_PROVAS),
            ("prova", "saida", org.PASTA_SAIDA_PROVAS),
            ("Aprovação do layout", "entrada", None),
            ("Provavelmente amanhã", "entrada", None),
            ("Reunião de equipe", "saida", None),
            ("", "entrada", None),
        ],
    )
    def test_regras(self, assunto, origem, esperado):
        assert org.classificar(assunto, origem) == esperado

    def test_problemas_tecnicos_tem_prioridade(self):
        assert org.classificar("Prova com Problemas Técnicos", "entrada") == org.PASTA_ENTRADA_PT
        assert org.classificar("Prova com Problemas Técnicos", "saida") == org.PASTA_SAIDA_PT

    def test_origem_invalida(self):
        with pytest.raises(ValueError):
            org.classificar("Prova", "lixeira")


class FakeEws:
    ews_url = "https://fake/EWS"

    def __init__(
        self,
        itens: Dict[str, List[Dict[str, Any]]],
        pastas: Optional[Dict[str, str]] = None,
        falhar_ids: Optional[Dict[str, Exception]] = None,
    ):
        self.itens = itens
        self.pastas = dict(PASTA_IDS if pastas is None else pastas)
        self.falhar_ids = falhar_ids or {}
        self.moves: List[tuple] = []

    def find_folder_id(self, parent: MailboxFolderTarget, nome: str) -> Optional[str]:
        return self.pastas.get(nome)

    def list_child_folders(self, parent: MailboxFolderTarget, *, deep: bool = False):
        return []

    def find_items_by_subject_terms(self, target: MailboxFolderTarget, terms: List[str]):
        assert target.mailbox == MAILBOX
        return list(self.itens.get(target.folder_type, []))

    def move_item(self, item_id: str, to_folder_id: str) -> Optional[str]:
        if item_id in self.falhar_ids:
            raise self.falhar_ids[item_id]
        self.moves.append((item_id, to_folder_id))
        return f"novo-{item_id}"


def _item(item_id: str, subject: str) -> Dict[str, Any]:
    return {
        "item_id": item_id,
        "subject": subject,
        "date_received": "2026-10-14T10:00:00Z",
        "date_sent": "2026-10-14T09:59:00Z",
        "from_name": "Fulano",
        "from_email": "fulano@camara.leg.br",
        "display_to": "Cliente",
        "internet_message_id": f"<{item_id}@camara>",
    }


def _loop(ews: FakeEws, tmp_path: Path, **kwargs) -> org.OrganizadorLoop:
    return org.OrganizadorLoop(
        ews, MAILBOX, logging.getLogger("test_org"), org.MovimentoLog(str(tmp_path)), **kwargs
    )


def _movimentos(tmp_path: Path) -> str:
    return "".join(p.read_text(encoding="utf-8") for p in tmp_path.glob("movimentos_*.log"))


ITENS_PADRAO = {
    "distinguished_inbox": [
        _item("in-pt", "Problemas Técnicos OS 10"),
        _item("in-prova", "Prova OS 11"),
        _item("in-aprov", "Aprovação OS 12"),
    ],
    "distinguished_sentitems": [
        _item("out-pt", "RES: Problemas Tecnicos OS 10"),
        _item("out-prova", "Envio de Provas OS 11"),
    ],
}


class TestOrganizadorLoop:
    def test_move_para_pastas_corretas(self, tmp_path):
        ews = FakeEws(ITENS_PADRAO)
        contagem = _loop(ews, tmp_path).run_once()
        assert sorted(ews.moves) == sorted(
            [
                ("in-pt", "id-entrada-pt"),
                ("in-prova", "id-entrada-provas"),
                ("out-pt", "id-saida-pt"),
                ("out-prova", "id-saida-provas"),
            ]
        )
        assert sum(contagem.values()) == 4
        log = _movimentos(tmp_path)
        assert log.count("| MOVIDO |") == 4
        assert "Caixa de Entrada -> Entrada de Prob. Tec." in log
        assert "Itens Enviados -> Saida de Provas" in log
        assert "<in-pt@camara>" in log
        assert "RESUMO DO CICLO" in log
        assert "in-aprov" not in log

    def test_simulacao_nao_move(self, tmp_path):
        ews = FakeEws(ITENS_PADRAO)
        loop = _loop(ews, tmp_path, simular=True)
        loop.run_once()
        loop.run_once()
        assert ews.moves == []
        assert _movimentos(tmp_path).count("| SIMULACAO |") == 4

    def test_erro_em_um_item_nao_interrompe_os_demais(self, tmp_path):
        ews = FakeEws(
            ITENS_PADRAO,
            falhar_ids={"in-pt": EWSOperationError("MoveItem", "ErrorItemNotFound", "sumiu")},
        )
        _loop(ews, tmp_path).run_once()
        assert ("in-pt", "id-entrada-pt") not in ews.moves
        assert len(ews.moves) == 3
        log = _movimentos(tmp_path)
        assert "| ERRO |" in log and "ErrorItemNotFound" in log

    def test_item_com_falhas_repetidas_e_ignorado(self, tmp_path):
        ews = FakeEws(
            {"distinguished_inbox": [_item("x", "Prova")]},
            falhar_ids={"x": EWSOperationError("MoveItem", "ErrorAccessDenied")},
        )
        loop = _loop(ews, tmp_path, max_falhas_item=2)
        for _ in range(5):
            loop.run_once()
        assert _movimentos(tmp_path).count("| ERRO |") == 2

    def test_pasta_destino_ausente_nao_move(self, tmp_path):
        pastas = dict(PASTA_IDS)
        del pastas[org.PASTA_ENTRADA_PROVAS]
        ews = FakeEws(ITENS_PADRAO, pastas=pastas)
        _loop(ews, tmp_path).run_once()
        assert all(item_id != "in-prova" for item_id, _ in ews.moves)
        assert len(ews.moves) == 3

    def test_uma_vez_retorna_erro_quando_ciclo_falha(self, tmp_path):
        class Quebrado(FakeEws):
            def find_items_by_subject_terms(self, target, terms):
                raise RuntimeError("boom")

        assert _loop(Quebrado({}), tmp_path).run(uma_vez=True) == 1
        assert _loop(FakeEws({}), tmp_path).run(uma_vez=True) == 0


NS_M = "http://schemas.microsoft.com/exchange/services/2006/messages"
NS_T = "http://schemas.microsoft.com/exchange/services/2006/types"


def _resp(inner: str) -> etree._Element:
    return etree.fromstring(
        f'<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" '
        f'xmlns:m="{NS_M}" xmlns:t="{NS_T}"><s:Body>{inner}</s:Body></s:Envelope>'.encode()
    )


def _ews_com_respostas(respostas: List[etree._Element]) -> tuple:
    svc = EWSService.__new__(EWSService)
    svc.exchange_version = "Exchange2010_SP2"
    enviados: List[str] = []

    def fake_post(xml: str):
        enviados.append(xml)
        return respostas.pop(0)

    svc._post = fake_post  # type: ignore[assignment]
    return svc, enviados


class TestEwsXml:
    def test_move_item_usa_moveitem_e_nunca_delete(self):
        svc, enviados = _ews_com_respostas([
            _resp(
                '<m:MoveItemResponse><m:ResponseMessages>'
                '<m:MoveItemResponseMessage ResponseClass="Success"><m:ResponseCode>NoError</m:ResponseCode>'
                '<m:Items><t:Message><t:ItemId Id="NOVO" ChangeKey="ck"/></t:Message></m:Items>'
                '</m:MoveItemResponseMessage></m:ResponseMessages></m:MoveItemResponse>'
            )
        ])
        assert svc.move_item("ANTIGO", "PASTA") == "NOVO"
        xml = enviados[0]
        assert "<m:MoveItem>" in xml
        assert 'FolderId Id="PASTA"' in xml
        assert "DeleteItem" not in xml
        assert "deleteditems" not in xml.lower()

    def test_move_item_erro_lanca_operation_error(self):
        svc, _ = _ews_com_respostas([
            _resp(
                '<m:MoveItemResponse><m:ResponseMessages>'
                '<m:MoveItemResponseMessage ResponseClass="Error">'
                '<m:MessageText>nao achou</m:MessageText><m:ResponseCode>ErrorItemNotFound</m:ResponseCode>'
                '</m:MoveItemResponseMessage></m:ResponseMessages></m:MoveItemResponse>'
            )
        ])
        with pytest.raises(EWSOperationError) as exc:
            svc.move_item("X", "PASTA")
        assert exc.value.response_code == "ErrorItemNotFound"

    def test_find_items_pagina_e_filtra_por_assunto(self):
        def pagina(ids: List[str], ultimo: bool, prox: int) -> etree._Element:
            msgs = "".join(
                f'<t:Message><t:ItemId Id="{i}" ChangeKey="c"/><t:Subject>Prova {i}</t:Subject>'
                f'<t:DisplayTo>Cliente</t:DisplayTo>'
                f'<t:From><t:Mailbox><t:Name>F</t:Name><t:EmailAddress>f@x</t:EmailAddress></t:Mailbox></t:From>'
                f'<t:InternetMessageId>&lt;{i}@x&gt;</t:InternetMessageId></t:Message>'
                for i in ids
            )
            return _resp(
                '<m:FindItemResponse><m:ResponseMessages>'
                '<m:FindItemResponseMessage ResponseClass="Success"><m:ResponseCode>NoError</m:ResponseCode>'
                f'<m:RootFolder IndexedPagingOffset="{prox}" TotalItemsInView="3" '
                f'IncludesLastItemInRange="{"true" if ultimo else "false"}"><t:Items>{msgs}</t:Items></m:RootFolder>'
                '</m:FindItemResponseMessage></m:ResponseMessages></m:FindItemResponse>'
            )

        svc, enviados = _ews_com_respostas([pagina(["a", "b"], False, 2), pagina(["c"], True, 3)])
        target = MailboxFolderTarget(MAILBOX, "distinguished_sentitems", "Itens Enviados")
        itens = svc.find_items_by_subject_terms(target, ["Problemas T", "Prova"], page_size=2)
        assert [i["item_id"] for i in itens] == ["a", "b", "c"]
        assert itens[0]["internet_message_id"] == "<a@x>"
        assert itens[0]["from_email"] == "f@x"
        assert 'Offset="0"' in enviados[0] and 'Offset="2"' in enviados[1]
        assert "<t:Or>" in enviados[0]
        assert 'DistinguishedFolderId Id="sentitems"' in enviados[0]
        assert 'Traversal="Shallow"' in enviados[0]
        assert all("DeleteItem" not in x for x in enviados)
