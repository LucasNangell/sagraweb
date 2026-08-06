"""Testes unitários dos modelos de dobra compartilhados."""
from __future__ import annotations

import json
from typing import Any, Dict, List

import pytest

from services import prova_web_fold_model_service as svc


def test_normalize_fold_model_config_frac() -> None:
    cfg = svc.normalize_fold_model_config(
        {
            "creases": [
                {"id": "c1", "axis": "vertical", "positionFrac": 0.5},
            ],
            "operations": [
                {
                    "id": "o1",
                    "creaseId": "c1",
                    "order": 1,
                    "movingSide": "positive",
                    "towards": "front",
                    "targetAngleDeg": 180,
                }
            ],
        }
    )
    assert cfg["version"] == 1
    assert cfg["creases"][0]["positionFrac"] == pytest.approx(0.5)
    assert cfg["operations"][0]["creaseId"] == "c1"


def test_normalize_from_mm_with_ref() -> None:
    cfg = svc.normalize_fold_model_config(
        {
            "refWidthMm": 210,
            "refHeightMm": 297,
            "creases": [
                {"id": "c1", "axis": "vertical", "positionMm": 70},
                {"id": "c2", "axis": "vertical", "positionMm": 140},
            ],
            "operations": [
                {
                    "id": "o1",
                    "creaseId": "c1",
                    "order": 1,
                    "movingSide": "negative",
                    "towards": "front",
                },
                {
                    "id": "o2",
                    "creaseId": "c2",
                    "order": 2,
                    "movingSide": "positive",
                    "towards": "back",
                },
            ],
        }
    )
    assert cfg["creases"][0]["positionFrac"] == pytest.approx(70 / 210, abs=1e-5)
    assert cfg["creases"][1]["positionFrac"] == pytest.approx(140 / 210, abs=1e-5)


def test_normalize_rejects_orphan_operation() -> None:
    with pytest.raises(ValueError, match="creaseId inexistente"):
        svc.normalize_fold_model_config(
            {
                "creases": [
                    {"id": "c1", "axis": "vertical", "positionFrac": 0.5},
                ],
                "operations": [
                    {
                        "id": "o1",
                        "creaseId": "c99",
                        "order": 1,
                        "movingSide": "negative",
                        "towards": "front",
                    }
                ],
            }
        )


def test_create_list_update_delete(monkeypatch: pytest.MonkeyPatch) -> None:
    store: Dict[int, Dict[str, Any]] = {}
    seq = {"n": 0}

    def fake_ensure() -> None:
        return None

    def fake_execute(query: str, params: Any = None) -> List[Dict[str, Any]]:
        q = " ".join(query.split()).upper()
        if q.startswith("INSERT INTO TABPROVAWEBFOLDMODEL"):
            seq["n"] += 1
            mid = seq["n"]
            nome, hint, ordem, config_json, ponto = params
            store[mid] = {
                "Id": mid,
                "Nome": nome,
                "Hint": hint,
                "Ativo": 1,
                "Ordem": ordem,
                "ConfigJson": config_json,
                "UpdatedByPonto": ponto,
                "CreatedAt": None,
                "UpdatedAt": None,
            }
            return []
        if "SELECT MAX(ID)" in q:
            return [{"mid": max(store) if store else 0}]
        if q.startswith("SELECT * FROM TABPROVAWEBFOLDMODEL WHERE ID"):
            mid = int(params[0])
            row = store.get(mid)
            return [row] if row else []
        if q.startswith("SELECT * FROM TABPROVAWEBFOLDMODEL"):
            rows = list(store.values())
            rows.sort(key=lambda r: (r["Ordem"], r["Nome"], r["Id"]))
            return rows
        if q.startswith("UPDATE TABPROVAWEBFOLDMODEL"):
            (
                nome,
                hint,
                ativo,
                ordem,
                config_json,
                ponto,
                mid,
            ) = params
            mid = int(mid)
            store[mid] = {
                **store[mid],
                "Nome": nome,
                "Hint": hint,
                "Ativo": ativo,
                "Ordem": ordem,
                "ConfigJson": config_json,
                "UpdatedByPonto": ponto,
            }
            return []
        if q.startswith("DELETE FROM TABPROVAWEBFOLDMODEL"):
            mid = int(params[0])
            store.pop(mid, None)
            return []
        raise AssertionError(f"Query inesperada: {query}")

    monkeypatch.setattr(svc, "ensure_prova_web_fold_model_schema", fake_ensure)
    monkeypatch.setattr(svc.db, "execute_query", fake_execute)

    created = svc.create_fold_model(
        nome="Carteira custom",
        hint="Abas iguais",
        config={
            "creases": [
                {"id": "c1", "axis": "vertical", "positionFrac": 1 / 3},
                {"id": "c2", "axis": "vertical", "positionFrac": 2 / 3},
            ],
            "operations": [
                {
                    "id": "o1",
                    "creaseId": "c2",
                    "order": 1,
                    "movingSide": "positive",
                    "towards": "front",
                },
                {
                    "id": "o2",
                    "creaseId": "c1",
                    "order": 2,
                    "movingSide": "negative",
                    "towards": "front",
                },
            ],
            "pageFrente": 0,
            "pageVerso": 1,
            "backArtworkTransform": {
                "mirrorX": True,
                "mirrorY": False,
                "rotationDeg": 0,
            },
        },
        updated_by_ponto="123",
    )
    assert created["id"] == 1
    assert created["nome"] == "Carteira custom"
    assert len(created["config"]["creases"]) == 2
    assert created["config"]["pageFrente"] == 0
    assert created["config"]["pageVerso"] == 1
    assert created["config"]["operations"][0]["movingSide"] == "positive"

    listed = svc.list_fold_models()
    assert len(listed) == 1

    updated = svc.update_fold_model(1, nome="Carteira v2", hint="rev")
    assert updated["nome"] == "Carteira v2"
    assert updated["hint"] == "rev"

    assert svc.delete_fold_model(1) is True
    assert svc.list_fold_models() == []
    assert svc.delete_fold_model(1) is False


def test_normalize_start_after_prev_open01():
    from services.prova_web_fold_model_service import normalize_fold_model_config

    cfg = normalize_fold_model_config(
        {
            "creases": [
                {"id": "c1", "axis": "vertical", "positionFrac": 0.5},
            ],
            "operations": [
                {
                    "id": "o1",
                    "creaseId": "c1",
                    "order": 1,
                    "movingSide": "positive",
                    "towards": "front",
                    "startAfterPrevOpen01": 0.2,
                },
            ],
        }
    )
    assert cfg["operations"][0]["startAfterPrevOpen01"] == pytest.approx(0.2)

    cfg_omit = normalize_fold_model_config(
        {
            "creases": [
                {"id": "c1", "axis": "vertical", "positionFrac": 0.5},
            ],
            "operations": [
                {
                    "id": "o1",
                    "creaseId": "c1",
                    "order": 1,
                    "movingSide": "positive",
                    "towards": "front",
                    "startAfterPrevOpen01": 1.0,
                },
            ],
        }
    )
    assert "startAfterPrevOpen01" not in cfg_omit["operations"][0]
