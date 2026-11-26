"""Horário de trabalho da Manutenção: fora dele o celular não recebe avisos."""

from datetime import datetime
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from routers import manutencao_routes as routes
from services import manutencao_horario_service as horario
from services import manutencao_service as svc

COMERCIAL = {"ativo": True, "dias": [1, 2, 3, 4, 5], "inicio": "07:00", "fim": "16:00", "urgentes_fora": False}
# 2026-11-23 é segunda-feira.
SEG = datetime(2026, 11, 23)


def _em(dia_offset: int, hhmm: str) -> datetime:
    h, m = map(int, hhmm.split(":"))
    return SEG.replace(day=SEG.day + dia_offset, hour=h, minute=m)


@pytest.mark.parametrize(
    ("quando", "esperado"),
    [
        (_em(0, "06:59"), False),
        (_em(0, "07:00"), True),
        (_em(2, "12:30"), True),
        (_em(4, "15:59"), True),
        (_em(4, "16:00"), False),  # fim é exclusivo
        (_em(5, "10:00"), False),  # sábado
        (_em(6, "10:00"), False),  # domingo
    ],
)
def test_horario_comercial(quando, esperado):
    assert horario.dentro_do_horario(COMERCIAL, quando) is esperado


def test_sem_horario_ou_desativado_sempre_avisa():
    assert horario.dentro_do_horario(None, _em(6, "03:00"))
    assert horario.dentro_do_horario({**COMERCIAL, "ativo": False}, _em(6, "03:00"))


def test_turno_da_noite_atravessa_a_meia_noite():
    noite = {**COMERCIAL, "dias": [1], "inicio": "22:00", "fim": "06:00"}
    assert horario.dentro_do_horario(noite, _em(0, "23:30"))  # segunda à noite
    assert horario.dentro_do_horario(noite, _em(1, "05:59"))  # madrugada de terça
    assert not horario.dentro_do_horario(noite, _em(1, "06:00"))
    assert not horario.dentro_do_horario(noite, _em(1, "23:00"))  # terça não é dia marcado
    assert not horario.dentro_do_horario(noite, _em(0, "05:00"))  # madrugada de segunda (domingo não marcado)


def test_inicio_igual_ao_fim_vale_o_dia_inteiro():
    cfg = {**COMERCIAL, "inicio": "00:00", "fim": "00:00"}
    assert horario.dentro_do_horario(cfg, _em(0, "23:59"))
    assert not horario.dentro_do_horario(cfg, _em(5, "12:00"))


def test_urgentes_furam_o_horario_so_se_configurado():
    sabado = _em(5, "10:00")
    assert not horario.deve_avisar(COMERCIAL, urgente=True, agora=sabado)
    assert horario.deve_avisar({**COMERCIAL, "urgentes_fora": True}, urgente=True, agora=sabado)
    assert not horario.deve_avisar({**COMERCIAL, "urgentes_fora": True}, urgente=False, agora=sabado)


def test_filtrar_separa_quem_esta_fora_do_horario():
    with patch.object(horario, "horarios_por_ponto", return_value={"222": COMERCIAL}):
        avisar, fora = horario.filtrar_por_horario(["111", "222"], urgente=False, agora=_em(5, "10:00"))
    assert avisar == ["111"]
    assert fora == ["222"]


def test_salvar_valida_dias_e_horas():
    with pytest.raises(horario.HorarioInvalido):
        horario.salvar_horario("918", ativo=True, dias=[], inicio="07:00", fim="16:00")
    with pytest.raises(horario.HorarioInvalido):
        horario.salvar_horario("918", ativo=True, dias=[1], inicio="25:00", fim="16:00")
    with pytest.raises(horario.HorarioInvalido):
        horario.salvar_horario("0", ativo=False, dias=[1], inicio="07:00", fim="16:00")


def test_salvar_grava_dias_normalizados():
    cursor = MagicMock()
    db = MagicMock()
    db.cursor.return_value.__enter__.return_value = cursor
    with (
        patch.object(horario, "db", db),
        patch.object(horario, "ensure_manutencao_schema"),
        patch.object(horario, "obter_horario", return_value={"ok": True}),
    ):
        horario.salvar_horario("918", ativo=True, dias=[5, 1, 1, 9], inicio="07:30", fim="16:00", urgentes_fora=True)
    params = cursor.execute.call_args.args[1]
    assert params == ("918", 1, "1,5", "07:30", "16:00", 1)


def test_notify_fora_do_horario_so_registra_sem_tocar_o_celular():
    with (
        patch("services.manutencao_horario_service.horarios_por_ponto", return_value={"222": COMERCIAL}),
        patch("services.manutencao_horario_service.datetime") as dt,
        patch("services.notification_push_service.insert_user_notification", side_effect=[1, 2]) as ins,
        patch("services.notification_push_service.push_user_notification") as push,
        patch("services.manutencao_app_service.enfileirar_notificacao") as fila_app,
        patch.object(svc, "_enviar_web_push") as web_push,
    ):
        dt.now.return_value = _em(5, "10:00")  # sábado
        svc._notify(["111", "222"], "Nova manutenção", background=False, pedido_id=5)
    assert ins.call_count == 2  # os dois ficam na central de notificações
    por_ponto = {c.kwargs["target_ponto"]: c.kwargs["browser_notify"] for c in push.call_args_list}
    assert por_ponto == {"111": True, "222": False}
    assert fila_app.call_args.args[0] == ["111"]
    assert web_push.call_args.args[0] == ["111"]


def test_notify_todos_fora_do_horario_nao_enfileira_no_app():
    with (
        patch("services.manutencao_horario_service.horarios_por_ponto", return_value={"222": COMERCIAL}),
        patch("services.manutencao_horario_service.datetime") as dt,
        patch("services.notification_push_service.insert_user_notification", return_value=1),
        patch("services.notification_push_service.push_user_notification"),
        patch("services.manutencao_app_service.enfileirar_notificacao") as fila_app,
        patch.object(svc, "_enviar_web_push") as web_push,
    ):
        dt.now.return_value = _em(6, "10:00")
        svc._notify(["222"], "Nova manutenção", background=False)
    fila_app.assert_not_called()
    web_push.assert_not_called()


def _req(perms):
    request = MagicMock()
    request.state.sagra_permissions = perms
    return request


def test_rotas_de_horario():
    with pytest.raises(HTTPException) as exc:
        routes.get_horario(_req({}))
    assert exc.value.status_code == 403

    op = _req({"sb_manutencao_operador": True})
    with (
        patch.object(routes, "_ponto", return_value="918"),
        patch.object(horario, "obter_horario", return_value={**COMERCIAL, "ponto": "918"}),
    ):
        out = routes.get_horario(op)
    assert out["ponto"] == "918"
    assert isinstance(out["avisando_agora"], bool)

    with patch.object(routes, "_ponto", return_value="918"):
        with pytest.raises(HTTPException) as exc:
            routes.post_horario(routes.HorarioPayload(ativo=True, dias=[]), op)
    assert exc.value.status_code == 422

    with (
        patch.object(routes, "_ponto", return_value="918"),
        patch.object(horario, "salvar_horario", return_value={**COMERCIAL, "ponto": "918"}) as salvar,
    ):
        routes.post_horario(routes.HorarioPayload(ativo=True, dias=[1, 2], inicio="08:00", fim="17:00"), op)
    assert salvar.call_args.kwargs == {
        "ativo": True, "dias": [1, 2], "inicio": "08:00", "fim": "17:00", "urgentes_fora": False,
    }


def test_rota_sem_ponto_401():
    with patch.object(routes, "_ponto", return_value="0"):
        with pytest.raises(HTTPException) as exc:
            routes.get_horario(_req({"sb_manutencao_gerencia": True}))
    assert exc.value.status_code == 401
