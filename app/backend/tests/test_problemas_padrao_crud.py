"""Testes CRUD biblioteca tabProblemasPadrao (update/delete)."""
from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi import HTTPException


class TestUpdateProblemaPadrao:
    def test_404_quando_inexistente(self):
        from routers.analise_routes import (
            LibraryItemUpdateRequest,
            update_problema_padrao,
        )

        with patch("routers.analise_routes.db") as mock_db:
            mock_db.execute_query.return_value = []
            with pytest.raises(HTTPException) as exc:
                update_problema_padrao(
                    99,
                    LibraryItemUpdateRequest(
                        titulo="X", html_snapshot="<p>a</p>", categoria="Geral"
                    ),
                )
            assert exc.value.status_code == 404

    def test_atualiza_campos(self):
        from routers.analise_routes import (
            LibraryItemUpdateRequest,
            update_problema_padrao,
        )

        with patch("routers.analise_routes.db") as mock_db, patch(
            "routers.analise_routes.sanitize_html_snapshot",
            return_value="<p>safe</p>",
        ):
            mock_db.execute_query.side_effect = [
                [{"ID": 7}],
                None,
            ]
            result = update_problema_padrao(
                7,
                LibraryItemUpdateRequest(
                    titulo="  Novo  ",
                    html_snapshot="<p>raw</p>",
                    categoria="Lab",
                ),
            )
            assert result["id"] == 7
            assert result["titulo"] == "Novo"
            update_call = mock_db.execute_query.call_args_list[1]
            assert "UPDATE tabProblemasPadrao" in update_call.args[0]
            assert update_call.args[1][0] == "Novo"
            assert update_call.args[1][1] == "<p>safe</p>"


class TestDeleteProblemaPadrao:
    def test_404_quando_inexistente(self):
        from routers.analise_routes import delete_problema_padrao

        with patch("routers.analise_routes.db") as mock_db:
            mock_db.execute_query.return_value = []
            with pytest.raises(HTTPException) as exc:
                delete_problema_padrao(3)
            assert exc.value.status_code == 404

    def test_desvincula_e_exclui(self):
        from routers.analise_routes import delete_problema_padrao

        with patch("routers.analise_routes.db") as mock_db:
            mock_db.execute_query.side_effect = [
                [{"ID": 3, "TituloPT": "T"}],
                None,  # lab unlink
                None,  # classic unlink
                None,  # delete
            ]
            result = delete_problema_padrao(3)
            assert result == {"status": "success", "id": 3}
            sqls = [str(c.args[0]) for c in mock_db.execute_query.call_args_list]
            assert any("DELETE FROM tabProblemasPadrao" in s for s in sqls)
            assert any("tabAnaliseLabItem" in s for s in sqls)
