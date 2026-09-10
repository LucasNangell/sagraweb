from __future__ import annotations

import json
import re
import sqlite3
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from services import tif_graphics_learning_service as svc
from services.tif_graphics_learning_schema import SAMPLES_SQL, FEEDBACK_SQL


@pytest.fixture(autouse=True)
def reset_learning_cache(monkeypatch):
    monkeypatch.setattr(svc, "_db_retry_after", 0.0)
    svc._training_samples.cache_clear()


def features(amount=0.0):
    return [1.15, amount / 10, amount / 2, *([amount] * 256)]


def analysis(digest="a" * 64):
    return {"features": features(), "feature_version": svc.FEATURE_VERSION,
            "content_sha256": digest, "blank_graphics": False,
            "graphics_status": "with_graphics", "detection_source": "heuristic"}


@pytest.fixture
def memory_db(monkeypatch):
    """Exercita constraints, commits e rollback reais sem acessar o MySQL corporativo."""
    connection = sqlite3.connect(":memory:", check_same_thread=False)
    connection.row_factory = sqlite3.Row
    for ddl in (SAMPLES_SQL, FEEDBACK_SQL):
        ddl = re.sub(r"\) ENGINE=.*", ")", ddl, flags=re.S)
        ddl = re.sub(r",\s*KEY [^\n]+", "", ddl)
        ddl = ddl.replace("id BIGINT NOT NULL AUTO_INCREMENT", "id INTEGER PRIMARY KEY AUTOINCREMENT")
        ddl = ddl.replace(",\n  PRIMARY KEY (id)", "")
        ddl = ddl.replace("CURRENT_TIMESTAMP(6)", "CURRENT_TIMESTAMP")
        connection.execute(ddl)

    class Cursor:
        def __init__(self):
            self.cursor = connection.cursor()

        def execute(self, sql, args=()):
            sql = sql.replace("%s", "?").replace(" FOR UPDATE", "")
            sql = sql.replace("CURRENT_TIMESTAMP(6)", "CURRENT_TIMESTAMP")
            sql = sql.replace("ON DUPLICATE KEY UPDATE sample_key=VALUES(sample_key)",
                              "ON CONFLICT(sample_key) DO NOTHING")
            return self.cursor.execute(sql, args)

        def fetchone(self):
            row = self.cursor.fetchone()
            return dict(row) if row else None

        def fetchall(self):
            return [dict(row) for row in self.cursor.fetchall()]

    def query(sql, args=()):
        cursor = Cursor()
        cursor.execute(sql, args)
        return cursor.fetchall()

    def transaction(operations):
        with connection:
            return [operation(Cursor()) for operation in operations]

    database = SimpleNamespace(execute_query=query, execute_transaction=transaction, connection=connection)
    monkeypatch.setattr(svc, "db", database)
    svc._training_samples.cache_clear()
    yield database
    connection.close()
    svc._training_samples.cache_clear()


def test_feedback_persists_context_audit_and_survives_cache_reset(memory_db):
    result = svc.save_feedback(analysis(), "X:/plate (M).tif", " Komori ", True, "1234", 0)
    assert result["blank_graphics"] is True
    assert result["feedback_revision"] == 1
    saved = memory_db.execute_query("SELECT * FROM tab_tif_graphics_sample")[0]
    assert (saved["maquina"], saved["cor"], saved["autor_ponto"]) == ("KOMORI", "M", "1234")
    assert json.loads(saved["features_json"]) == features()
    audit = memory_db.execute_query("SELECT * FROM tab_tif_graphics_feedback")[0]
    assert (audit["detected_blank"], audit["corrected_blank"]) == (0, 1)
    svc._training_samples.cache_clear()
    learned = svc.apply_learning(analysis(), "Y:/moved (M).tif", "KOMORI")
    assert learned["blank_graphics"] is True
    assert learned["detection_source"] == "feedback"
    assert svc.apply_learning(analysis(), "Y:/moved (C).tif", "KOMORI")["blank_graphics"] is False
    assert svc.apply_learning(analysis(), "Y:/moved (M).tif", "SM74")["blank_graphics"] is False
    assert svc.apply_learning(analysis("b" * 64), "Y:/moved (M).tif", "KOMORI")["blank_graphics"] is False


def test_retry_does_not_duplicate_and_relabel_does_not_add_votes(memory_db):
    a = analysis()
    svc.save_feedback(a, "plate (C).tif", "KOMORI", True, "123", 0)
    svc.save_feedback(a, "plate (C).tif", "KOMORI", True, "123", 0)
    assert len(memory_db.execute_query("SELECT * FROM tab_tif_graphics_feedback")) == 1
    with pytest.raises(HTTPException) as conflict:
        svc.save_feedback(a, "plate (C).tif", "KOMORI", False, "456", 0)
    assert conflict.value.status_code == 409
    changed = svc.save_feedback(a, "plate (C).tif", "KOMORI", False, "456", 1)
    assert changed["feedback_revision"] == 2
    assert len(memory_db.execute_query("SELECT * FROM tab_tif_graphics_sample")) == 1
    assert len(memory_db.execute_query("SELECT * FROM tab_tif_graphics_feedback")) == 2


def test_audit_failure_rolls_back_label(memory_db, monkeypatch):
    memory_db.connection.execute("DROP TABLE tab_tif_graphics_feedback")
    with pytest.raises(sqlite3.OperationalError):
        svc.save_feedback(analysis(), "plate (C).tif", "KOMORI", True, "123", 0)
    assert memory_db.execute_query("SELECT * FROM tab_tif_graphics_sample") == []


def test_knn_learns_from_nearby_examples_and_rejects_conflicts_and_distant_files():
    samples = [{"features_json": features(v), "blank_graphics": blank}
               for v, blank in [(0, True), (.005, True), (.008, True),
                                (.4, False), (.5, False), (.6, False)]]
    assert svc.predict_neighbors(features(.006), samples)["blank_graphics"] is True
    assert svc.predict_neighbors(features(.9), samples) is None
    assert svc.predict_neighbors(features(), samples[:3]) is None
    samples.append({"features_json": features(.006), "blank_graphics": False})
    assert svc.predict_neighbors(features(.006), samples) is None
    assert svc.predict_neighbors([float("nan")] * 259, samples) is None


def test_feedback_enables_learning_for_a_new_file_in_same_context(memory_db):
    for i, (v, blank) in enumerate([(0, True), (.005, True), (.008, True),
                                  (.4, False), (.5, False), (.6, False)]):
        a = {**analysis(str(i) * 64), "features": features(v)}
        svc.save_feedback(a, f"{i} (C).tif", "KOMORI", blank, "123", 0)
    unseen = {**analysis("f" * 64), "features": features(.006)}
    result = svc.apply_learning(unseen, "new (C).tif", "KOMORI")
    assert result["detection_source"] == "knn"
    assert result["blank_graphics"] is True
    assert svc.apply_learning(unseen, "new (C).tif", "SM74")["detection_source"] == "heuristic"
    assert svc.apply_learning(unseen, "new (Y).tif", "KOMORI")["detection_source"] == "heuristic"


def test_database_failure_keeps_analysis_and_reports_failed_save(monkeypatch):
    database = Mock()
    database.execute_query.side_effect = svc.DatabaseConnectionError("offline")
    database.execute_transaction.side_effect = svc.DatabaseConnectionError("offline")
    monkeypatch.setattr(svc, "db", database)
    result = svc.apply_learning(analysis(), "plate (C).tif", "KOMORI")
    assert result["blank_graphics"] is False
    assert result["learning_status"] == "unavailable"
    svc.apply_learning(analysis("b" * 64), "other (C).tif", "KOMORI")
    assert database.execute_query.call_count == 1
    with pytest.raises(HTTPException) as failure:
        svc.save_feedback(analysis(), "plate (C).tif", "KOMORI", True, "123", 0)
    assert failure.value.status_code == 503


@pytest.fixture
def feedback_client(monkeypatch):
    from routers import network_files_routes as routes
    app = FastAPI()
    @app.middleware("http")
    async def permissions(request, call_next):
        request.state.sagra_permissions = {"sb_gravacao_pendente": True}
        return await call_next(request)
    app.include_router(routes.router)
    monkeypatch.setattr(routes, "require_session", lambda _: SimpleNamespace(ponto=123))
    monkeypatch.setattr(routes, "resolve_network_file_path", lambda _: "X:/plate (C).tif")
    monkeypatch.setattr(routes, "inspection_token", lambda _: "a" * 64)
    monkeypatch.setattr(routes, "inspect_network_file", lambda *args: {
        **analysis(), "inspection_token": "a" * 64})
    return TestClient(app)


def payload(**changes):
    return {"absolute_path": "X:/plate (C).tif", "maquina": "KOMORI",
            "blank_graphics": True, "inspection_token": "a" * 64,
            "feedback_revision": 0, **changes}


def test_feedback_route_uses_server_features_and_hides_internal_data(feedback_client, memory_db):
    response = feedback_client.post("/files/network-graphics-feedback", json=payload())
    assert response.status_code == 200
    assert response.json()["blank_graphics"] is True
    assert response.json()["cor"] == "C"
    assert "features" not in response.json()
    assert "content_sha256" not in response.json()


@pytest.mark.parametrize("change", [
    {"blank_graphics": "true"}, {"maquina": " "}, {"features": [1]},
    {"feedback_revision": -1}, {"cor": "K"},
])
def test_feedback_rejects_invalid_or_forged_metadata(feedback_client, change):
    response = feedback_client.post("/files/network-graphics-feedback", json=payload(**change))
    assert response.status_code == 422


def test_feedback_rejects_stale_file(feedback_client):
    response = feedback_client.post("/files/network-graphics-feedback",
                                    json=payload(inspection_token="b" * 64))
    assert response.status_code == 409


def test_feedback_requires_permission_and_valid_path(feedback_client, monkeypatch):
    from routers import network_files_routes as routes
    monkeypatch.setattr(routes, "_has_gravacao_access", lambda _: False)
    assert feedback_client.post("/files/network-graphics-feedback", json=payload()).status_code == 403
    monkeypatch.setattr(routes, "_has_gravacao_access", lambda _: True)
    def deny(_):
        raise HTTPException(403, "Fora das raízes permitidas")
    monkeypatch.setattr(routes, "resolve_network_file_path", deny)
    assert feedback_client.post("/files/network-graphics-feedback", json=payload()).status_code == 403
