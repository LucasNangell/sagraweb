"""Testes do módulo Manutenção (regras puras + RBAC das rotas)."""

from datetime import date, datetime
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from routers import manutencao_routes as routes
from services import manutencao_service as svc


def _req(perms):
    request = MagicMock()
    request.state.sagra_permissions = perms
    return request


# ------------------------------------------------------------------- RBAC


def test_view_requires_any_manutencao_permission():
    with pytest.raises(HTTPException) as exc:
        routes._require_view(_req({}))
    assert exc.value.status_code == 403
    routes._require_view(_req({"sb_manutencao_gerencia": True}))
    routes._require_view(_req({"sb_manutencao_operador": True}))


def test_gerencia_and_operador_are_independent():
    operador = _req({"sb_manutencao_operador": True})
    gerencia = _req({"sb_manutencao_gerencia": True})
    with pytest.raises(HTTPException):
        routes._require_gerencia(operador)
    with pytest.raises(HTTPException):
        routes._require_operador(gerencia)
    routes._require_gerencia(gerencia)
    routes._require_operador(operador)


def test_spa_access_accepts_either_permission():
    from security.spa_access import has_screen_access_for_spa_path

    assert has_screen_access_for_spa_path("/manutencao", {"sb_manutencao_operador": True})
    assert has_screen_access_for_spa_path("/manutencao", {"sb_manutencao_gerencia": True})
    assert not has_screen_access_for_spa_path("/manutencao", {"sb_inicio": True})


def test_permission_keys_registered():
    from schemas.permissions import ClientPermissionsResponse
    from security.user_permissions import _PERMISSION_BOOL_KEYS

    for key in ("sb_manutencao_gerencia", "sb_manutencao_operador"):
        assert key in _PERMISSION_BOOL_KEYS
        assert key in ClientPermissionsResponse.model_fields


def test_run_maps_domain_errors():
    with pytest.raises(HTTPException) as exc:
        routes._run(lambda: (_ for _ in ()).throw(svc.ManutencaoConflict("x")))
    assert exc.value.status_code == 409
    with pytest.raises(HTTPException) as exc:
        routes._run(lambda: (_ for _ in ()).throw(svc.ManutencaoNotFound("x")))
    assert exc.value.status_code == 404
    with pytest.raises(HTTPException) as exc:
        routes._run(lambda: (_ for _ in ()).throw(ValueError("x")))
    assert exc.value.status_code == 400


# ------------------------------------------------------------ regras puras


def test_normalize_prioridade():
    assert svc.normalize_prioridade(" ALTA ") == "alta"
    with pytest.raises(ValueError):
        svc.normalize_prioridade("critica")


def test_parse_passos_accepts_json_list_and_dicts():
    assert svc.parse_passos('["  Trocar correia ", "", "Testar"]') == ["Trocar correia", "Testar"]
    assert svc.parse_passos([{"texto": "A"}, "B"]) == ["A", "B"]
    assert svc.parse_passos(None) == []
    assert svc.parse_passos("texto solto") == ["texto solto"]
    assert len(svc.parse_passos(["x"] * 200)) == svc.MAX_PASSOS


@pytest.mark.parametrize(
    "fila,prioridade,esperado",
    [
        ([], "normal", 0),
        ([{"prioridade": "normal"}, {"prioridade": "baixa"}], "urgente", 0),
        ([{"prioridade": "urgente"}, {"prioridade": "normal"}], "alta", 1),
        ([{"prioridade": "alta"}, {"prioridade": "normal"}, {"prioridade": "baixa"}], "normal", 2),
        ([{"prioridade": "alta"}, {"prioridade": "normal"}], "baixa", 2),
        # Fila reordenada manualmente: entra após o último de prioridade >= sua.
        ([{"prioridade": "baixa"}, {"prioridade": "alta"}], "normal", 2),
    ],
)
def test_calcular_posicao_insercao(fila, prioridade, esperado):
    assert svc.calcular_posicao_insercao(fila, prioridade) == esperado


def test_situacao_recorrente():
    hoje = date(2026, 11, 25)
    assert svc._situacao_recorrente(None, 1, None, False, hoje) == (None, None, None)
    assert svc._situacao_recorrente(30, None, None, False, hoje) == (None, None, None)
    assert svc._situacao_recorrente(30, 1, None, True, hoje)[0] == "em_aberto"
    assert svc._situacao_recorrente(30, 1, None, False, hoje)[0] == "sem_historico"
    sit, prox, dias = svc._situacao_recorrente(30, 1, datetime(2026, 10, 1), False, hoje)
    assert (sit, prox, dias) == ("vencida", "2026-10-31", -25)
    assert svc._situacao_recorrente(30, 1, datetime(2026, 11, 1), False, hoje)[0] == "vence_em_breve"
    assert svc._situacao_recorrente(30, 1, datetime(2026, 11, 20), False, hoje)[0] == "em_dia"


def test_format_codigo_maquina():
    from manutencao_schema import SEED_MAQUINAS, format_codigo_maquina

    assert format_codigo_maquina(7) == "MAQ-0007"
    assert len(SEED_MAQUINAS) == 21
    assert len({n for n, _ in SEED_MAQUINAS}) == 21


# ------------------------------------------------------------ validações


def test_criar_pedido_exige_maquina():
    with patch.object(svc, "_ensure"):
        with pytest.raises(ValueError, match="máquina"):
            svc.criar_pedido({"titulo": "x"}, "1")


def test_criar_pedido_rejeita_maquina_inativa():
    with patch.object(svc, "_ensure"), patch.object(
        svc, "get_maquina", return_value={"id": 1, "ativo": False}
    ):
        with pytest.raises(ValueError, match="inativa"):
            svc.criar_pedido({"maquina_id": 1, "titulo": "x"}, "1")


def test_concluir_exige_conclusao_e_passos():
    with pytest.raises(ValueError, match="conclusão"):
        svc.concluir_pedido(1, conclusao=" ", diagnostico=None, passos=None, ponto="1")
    with patch.object(svc, "get_pedido", return_value={"solucao_passos": []}):
        with pytest.raises(ValueError, match="passo"):
            svc.concluir_pedido(1, conclusao="ok", diagnostico=None, passos=[], ponto="1")


def test_pausar_e_cancelar_exigem_motivo():
    with pytest.raises(ValueError, match="motivo"):
        svc.pausar_pedido(1, "", "1")
    with pytest.raises(ValueError, match="motivo"):
        svc.cancelar_pedido(1, None, "1")


def test_iniciar_conflito_quando_ja_em_execucao():
    with patch.object(svc, "get_pedido", return_value={"status": "em_execucao"}):
        with pytest.raises(svc.ManutencaoConflict):
            svc.iniciar_pedido(1, "1")


def test_iniciar_conflito_quando_outro_operador_assumiu():
    cursor = MagicMock()
    cursor.rowcount = 0

    def fake_tx(ops):
        return [op(cursor) for op in ops]

    with patch.object(svc, "get_pedido", return_value={"status": "fila"}), patch.object(
        svc.db, "execute_transaction", side_effect=fake_tx
    ):
        with pytest.raises(svc.ManutencaoConflict, match="outro operador"):
            svc.iniciar_pedido(1, "1")


def test_validate_codigo_rejeita_duplicado():
    with patch.object(svc.db, "execute_query", return_value=[{"id": 5}]):
        with pytest.raises(ValueError, match="Já existe"):
            svc._validate_codigo("maq-0001", exclude_id=2)
        assert svc._validate_codigo("maq-0001", exclude_id=5) == "MAQ-0001"
    with pytest.raises(ValueError, match="Código inválido"):
        svc._validate_codigo("com espaço")


def test_next_codigo_usa_maior_sequencia():
    rows = [{"codigo": "MAQ-0003"}, {"codigo": "CUSTOM"}, {"codigo": "MAQ-0010"}]
    with patch.object(svc.db, "execute_query", return_value=rows):
        assert svc._next_codigo() == "MAQ-0011"


# ------------------------------------------------- histórico e semelhantes


def _concluido(pid, titulo, maquina_id=1, descricao="", diagnostico="", passos=None, recorrente_id=None):
    return {
        "id": pid,
        "maquina_id": maquina_id,
        "titulo": titulo,
        "descricao": descricao,
        "diagnostico": diagnostico,
        "solucao_passos": passos or [],
        "conclusao": "",
        "recorrente_id": recorrente_id,
        "concluido_em": "2026-11-01T10:00:00",
    }


def test_tokenizar_remove_acentos_stopwords_e_plural():
    toks = svc.tokenizar("Troca das correias da Máquina — rolamentos e blanquetas")
    assert {"troca", "correia", "rolamento", "blanqueta"} <= toks
    assert "das" not in toks and "maquina" not in toks
    assert svc.tokenizar("Ajuste das pressões") >= {"ajuste", "pressao"}


def test_ranquear_semelhantes_prioriza_mesma_maquina_e_ignora_diferentes():
    alvo = {"id": 99, "maquina_id": 1, "titulo": "Correia da dobradeira patinando", "descricao": ""}
    candidatos = [
        _concluido(1, "Correia patinando na dobra", maquina_id=2),
        _concluido(2, "Correia patinando", maquina_id=1, passos=["Trocar correia"]),
        _concluido(3, "Troca de lâmina da guilhotina", maquina_id=1),
    ]
    res = svc.ranquear_semelhantes(alvo, candidatos)
    assert [r["id"] for r in res] == [2, 1]
    assert res[0]["mesma_maquina"] is True
    assert "correia" in res[0]["termos"]


def test_semelhanca_por_texto_da_solucao_exige_dois_termos():
    alvo = {"id": 9, "maquina_id": 1, "titulo": "Barulho no rolamento do eixo", "descricao": ""}
    so_um = _concluido(1, "Revisão geral", maquina_id=3, diagnostico="rolamento gasto")
    dois = _concluido(2, "Revisão geral", maquina_id=3, diagnostico="rolamento do eixo com barulho")
    assert svc.pontuar_semelhanca(alvo, so_um)[0] == 0.0
    assert svc.pontuar_semelhanca(alvo, dois)[0] >= svc.SIMILAR_MIN_SCORE


def test_mesma_recorrente_eh_semelhante():
    alvo = {"id": 9, "maquina_id": 1, "titulo": "Lubrificação mensal", "recorrente_id": 7}
    cand = _concluido(1, "Lubrificação mensal", maquina_id=1, recorrente_id=7)
    score, _ = svc.pontuar_semelhanca(alvo, cand)
    assert score > 1.0


def test_buscar_historico_por_prefixo_em_passos():
    cands = [
        _concluido(1, "Máquina travando", passos=["Lubrificação do eixo principal"]),
        _concluido(2, "Troca de lâmina"),
    ]
    with patch.object(svc, "_ensure"), patch.object(
        svc, "_candidatos_concluidos", return_value=cands
    ), patch.object(svc, "_nomes_por_ponto", return_value={}):
        res = svc.buscar_historico("lubrif eixo")
    assert [r["id"] for r in res] == [1]
    assert res[0]["solucao_passos"] == ["Lubrificação do eixo principal"]


def test_contar_similares_so_para_abertos():
    pedidos = [
        {"id": 10, "status": "fila", "maquina_id": 1, "titulo": "Correia patinando"},
        {"id": 11, "status": "concluido", "maquina_id": 1, "titulo": "Correia patinando"},
    ]
    with patch.object(
        svc, "_candidatos_concluidos", return_value=[_concluido(5, "Correia patinando")]
    ):
        assert svc.contar_similares(pedidos) == {10: 1}


# ------------------------------------------------- chamado público (QR Code)

from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers import manutencao_publico_routes as pub


@pytest.fixture()
def pub_client():
    pub.rate_limiter.reset()
    app = FastAPI()
    app.include_router(pub.router, prefix="/api")
    return TestClient(app)


_MAQ = {"id": 4, "codigo": "MAQ-0004", "nome": "Komori", "setor": "Impressão", "ativo": True, "parada": False}


def test_rotas_publicas_liberadas_sem_sessao():
    from security.api_auth import _is_public_api
    from security.cloudflare_access import is_cloudflare_public_path
    from security.spa_access import is_public_spa_path

    assert _is_public_api("/api/manutencao/publico/chamados", "POST")
    assert _is_public_api("/api/manutencao/publico/maquinas/MAQ-0001", "GET")
    assert not _is_public_api("/api/manutencao/pedidos", "GET")
    assert is_cloudflare_public_path("/api/manutencao/publico/ponto/123", "GET")
    assert is_public_spa_path("/chamado/MAQ-0001")


def test_chamado_publico_ponto_cadastrado(pub_client):
    criado = {"id": 77, "posicao_fila": 2, "maquina_nome": "Komori"}
    with patch.object(svc, "get_maquina_por_codigo", return_value=_MAQ), patch.object(
        pub, "buscar_nome_ponto", return_value="Fulano"
    ), patch.object(pub, "cadastrar_nome_se_ausente") as cad, patch.object(
        svc, "criar_pedido", return_value=criado
    ) as criar:
        r = pub_client.post(
            "/api/manutencao/publico/chamados",
            json={"codigo": "MAQ-0004", "titulo": "Folha enroscando", "ponto": "1234"},
        )
    assert r.status_code == 200, r.text
    assert r.json()["solicitante_nome"] == "Fulano"
    cad.assert_not_called()
    args, kwargs = criar.call_args
    assert args[0]["maquina_id"] == 4 and args[1] == "1234"
    assert kwargs["origem"] == "QR Code"


def test_chamado_publico_ponto_novo_exige_e_cadastra_nome(pub_client):
    with patch.object(svc, "get_maquina_por_codigo", return_value=_MAQ), patch.object(
        pub, "buscar_nome_ponto", return_value=None
    ), patch.object(pub, "cadastrar_nome_se_ausente") as cad, patch.object(
        svc, "criar_pedido", return_value={"id": 1}
    ):
        sem_nome = pub_client.post(
            "/api/manutencao/publico/chamados",
            json={"codigo": "MAQ-0004", "titulo": "x", "ponto": "999"},
        )
        assert sem_nome.status_code == 400
        ok = pub_client.post(
            "/api/manutencao/publico/chamados",
            json={"codigo": "MAQ-0004", "titulo": "x", "ponto": "999", "nome": "  Maria   Silva "},
        )
    assert ok.status_code == 200
    cad.assert_called_once_with("999", "Maria Silva")


def test_chamado_publico_valida_ponto_e_maquina_inativa(pub_client):
    inativa = dict(_MAQ, ativo=False)
    with patch.object(svc, "get_maquina_por_codigo", return_value=inativa):
        r = pub_client.post(
            "/api/manutencao/publico/chamados",
            json={"codigo": "MAQ-0004", "titulo": "x", "ponto": "1"},
        )
    assert r.status_code == 404
    with patch.object(svc, "get_maquina_por_codigo", return_value=_MAQ):
        r = pub_client.post(
            "/api/manutencao/publico/chamados",
            json={"codigo": "MAQ-0004", "titulo": "x", "ponto": "12a"},
        )
    assert r.status_code == 400


def test_chamado_publico_rate_limit(pub_client):
    with patch.object(pub, "buscar_nome_ponto", return_value="X"):
        codes = [pub_client.get("/api/manutencao/publico/ponto/5").status_code for _ in range(21)]
    assert codes[:20] == [200] * 20
    assert codes[20] == 429


# ------------------------------------------------------------- web push


def _pedido_fake(**over):
    base = {
        "id": 42,
        "prioridade": "urgente",
        "maquina_nome": "Komori",
        "titulo": "Papel enroscando",
        "maquina_parada": True,
        "solicitado_por": "123",
    }
    base.update(over)
    return base


def test_notificar_operadores_envia_web_push_com_link_do_pedido():
    with (
        patch.object(svc, "_list_operador_pontos", return_value=["111", "222"]),
        patch.object(svc, "_candidatos_concluidos", return_value=[]),
        patch(
            "services.notification_push_service.insert_user_notification",
            side_effect=[901, 902],
        ),
        patch("services.notification_push_service.push_user_notification"),
        patch("services.web_push_service.send_web_push_to_ponto", return_value=1) as send,
        patch.object(svc.threading, "Thread") as thread_cls,
    ):
        svc._notificar_operadores(_pedido_fake(), exclude_ponto="222")
        # Envio ocorre fora da requisição — executa o alvo da thread aqui.
        thread_cls.assert_called_once()
        kwargs = thread_cls.call_args.kwargs
        kwargs["target"](*kwargs["args"], **kwargs["kwargs"])

    send.assert_called_once()
    call = send.call_args.kwargs
    assert call["ponto"] == "111"
    assert "Komori" in call["title"] and "URGENTE" in call["title"]
    assert call["url"].endswith("manutencao?aba=operador&pedido=42")
    assert call["urgent"] is True
    assert call["notification_id"] == 901
    assert call["icon"] == "icons/manutencao-192.png"


def test_notificar_solicitante_aponta_para_gerencia():
    with (
        patch("services.notification_push_service.insert_user_notification", return_value=7),
        patch("services.notification_push_service.push_user_notification"),
        patch("services.web_push_service.send_web_push_to_ponto", return_value=1) as send,
        patch.object(svc.threading, "Thread") as thread_cls,
    ):
        svc._notificar_solicitante(_pedido_fake(prioridade="normal"), ponto="999")
        kwargs = thread_cls.call_args.kwargs
        kwargs["target"](*kwargs["args"], **kwargs["kwargs"])
    assert send.call_args.kwargs["url"].endswith("manutencao?aba=gerencia&pedido=42")
    assert send.call_args.kwargs["ponto"] == "123"


def test_web_push_falho_nao_interrompe_demais_operadores():
    with patch(
        "services.web_push_service.send_web_push_to_ponto",
        side_effect=[RuntimeError("boom"), 2],
    ):
        enviados = svc._enviar_web_push(
            ["1", "2"],
            titulo="t",
            mensagem="m",
            url="/x",
            tag="tag",
            urgent=False,
            notification_ids={},
        )
    assert enviados == 2


def test_push_teste_exige_sessao_e_permissao():
    with pytest.raises(HTTPException) as exc:
        routes.post_push_teste(_req({}))
    assert exc.value.status_code == 403
    with patch.object(routes, "_ponto", return_value="0"), pytest.raises(HTTPException) as exc:
        routes.post_push_teste(_req({"sb_manutencao_operador": True}))
    assert exc.value.status_code == 401
    with (
        patch.object(routes, "_ponto", return_value="555"),
        patch.object(svc, "enviar_push_teste", return_value={"enviados": 1, "inscricoes": 1}) as fn,
    ):
        assert routes.post_push_teste(_req({"sb_manutencao_operador": True}))["enviados"] == 1
    fn.assert_called_once_with("555")
