"""
Testes da pré-condição de dados da OS no ciclo rápido de tabAndamento
(sync_andamentos_service.sync_os_data_from_mdb / _ensure_related_precondition).

Verificam que, ao chegar um andamento de OS ainda inexistente no MySQL, o
serviço insere tabProtocolos E tabDetalhesServico (INSERT-only), sem fazer
UPDATE quando a linha já existe, respeitando tombstone, allowlist e a flag
SYNC_RELATED_PRECONDITION_DETALHES. Não usa MySQL/MDB reais.
"""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import sync_andamentos_service as svc  # noqa: E402


# ---------------------------------------------------------------------------
# Fakes mínimos de conexão
# ---------------------------------------------------------------------------


class _FakeMdbCursor:
    """Responde a SELECT * FROM <tabela> conforme rows_by_table."""

    def __init__(self, rows_by_table):
        self.rows_by_table = rows_by_table
        self.description = None
        self._row = None

    def execute(self, sql, params=None):
        self.description = None
        self._row = None
        for table, (cols, row) in self.rows_by_table.items():
            if f"FROM {table} WHERE" in sql:
                self.description = [(c,) for c in cols]
                self._row = row
                return

    def fetchone(self):
        return self._row

    def close(self):
        pass


class _FakeMysqlDictCursor:
    def __init__(self, existing: bool):
        self.existing = existing
        self.executed = []

    def execute(self, sql, params=None):
        self.executed.append((sql, params))

    def fetchone(self):
        # Só a checagem de presença (SELECT 1) chama fetchone.
        return {"ok": 1} if self.existing else None

    def close(self):
        pass


class _FakeMysqlConn:
    def __init__(self, existing: bool):
        self.existing = existing
        self.dict_cursors = []
        self.plain_cursors = []
        self.committed = 0
        self.rolled_back = 0

    def cursor(self, dictionary: bool = False):
        if dictionary:
            cur = _FakeMysqlDictCursor(self.existing)
            self.dict_cursors.append(cur)
            return cur
        cur = MagicMock()
        self.plain_cursors.append(cur)
        return cur

    def commit(self):
        self.committed += 1

    def rollback(self):
        self.rolled_back += 1


_PROTOCOL_ROW = (
    ["NroProtocolo", "AnoProtocolo", "NomeUsuario", "email_pt_html"],
    (84, 2026, "Fulano", "<somente-web>"),
)
_DETALHES_ROW = (
    ["NroProtocoloLinkDet", "AnoProtocoloLinkDet", "Titulo", "Tiragem", "ID"],
    (84, 2026, "Oficio", 100, 7),
)


def _make_sync(*, existing: bool = False, os_deleted: bool = False):
    sync = svc.ResilientSynchronizer.__new__(svc.ResilientSynchronizer)
    sync._svc_log = MagicMock()
    sync.is_os_deleted = MagicMock(return_value=os_deleted)

    mdb_conn = MagicMock()
    mdb_conn.cursor.side_effect = lambda: _FakeMdbCursor(
        {
            "tabProtocolos": _PROTOCOL_ROW,
            "tabDetalhesServico": _DETALHES_ROW,
        }
    )
    mysql_conn = _FakeMysqlConn(existing)

    conn_mgr = MagicMock()
    conn_mgr.get_mdb_by_nro.return_value = mdb_conn
    conn_mgr.get_mysql.return_value = mysql_conn
    sync.conn_mgr = conn_mgr
    sync._mysql_conn = mysql_conn
    return sync


def _inserts(mysql_conn, table: str):
    out = []
    for cur in mysql_conn.dict_cursors:
        for sql, params in cur.executed:
            if sql.strip().startswith(f"INSERT INTO `{table}`"):
                out.append((sql, params))
    return out


def _baseline_inserts(mysql_conn):
    out = []
    for cur in mysql_conn.plain_cursors:
        for call in cur.execute.call_args_list:
            if call.args and "sync_related_baseline" in str(call.args[0]):
                out.append(call)
    return out


# ---------------------------------------------------------------------------
# Testes
# ---------------------------------------------------------------------------


def test_insere_protocolos_e_detalhes_quando_os_ausente(monkeypatch):
    monkeypatch.setattr(svc, "SYNC_RELATED_PRECONDITION_DETALHES", True)
    sync = _make_sync(existing=False)

    sync.sync_os_data_from_mdb(84, 2026, "OS_Atual")

    mysql_conn = sync._mysql_conn
    proto = _inserts(mysql_conn, "tabProtocolos")
    det = _inserts(mysql_conn, "tabDetalhesServico")
    assert len(proto) == 1
    assert len(det) == 1
    # Baseline semeado para ambas as tabelas.
    assert len(_baseline_inserts(mysql_conn)) == 2
    sync._svc_log.error.assert_not_called()


def test_detalhes_respeita_allowlist(monkeypatch):
    monkeypatch.setattr(svc, "SYNC_RELATED_PRECONDITION_DETALHES", True)
    sync = _make_sync(existing=False)

    sync.sync_os_data_from_mdb(84, 2026, "OS_Atual")

    (sql, params) = _inserts(sync._mysql_conn, "tabDetalhesServico")[0]
    assert "`Titulo`" in sql and "`Tiragem`" in sql
    # Coluna protegida (só-MySQL) nunca entra no INSERT vindo do MDB.
    assert "`ID`" not in sql
    assert "<somente-web>" not in params  # nada de coluna protegida de protocolos


def test_nao_faz_update_quando_linha_ja_existe(monkeypatch):
    monkeypatch.setattr(svc, "SYNC_RELATED_PRECONDITION_DETALHES", True)
    sync = _make_sync(existing=True)

    sync.sync_os_data_from_mdb(84, 2026, "OS_Atual")

    mysql_conn = sync._mysql_conn
    assert _inserts(mysql_conn, "tabProtocolos") == []
    assert _inserts(mysql_conn, "tabDetalhesServico") == []
    assert mysql_conn.committed == 0
    # Sem inserção, não semeia baseline.
    assert _baseline_inserts(mysql_conn) == []


def test_tombstone_bloqueia_qualquer_acesso_ao_mdb():
    sync = _make_sync(existing=False, os_deleted=True)

    sync.sync_os_data_from_mdb(84, 2026, "OS_Atual")

    sync.conn_mgr.get_mdb_by_nro.assert_not_called()


def test_flag_desligada_nao_insere_detalhes(monkeypatch):
    monkeypatch.setattr(svc, "SYNC_RELATED_PRECONDITION_DETALHES", False)
    sync = _make_sync(existing=False)

    sync.sync_os_data_from_mdb(84, 2026, "OS_Atual")

    mysql_conn = sync._mysql_conn
    assert len(_inserts(mysql_conn, "tabProtocolos")) == 1
    assert _inserts(mysql_conn, "tabDetalhesServico") == []


def test_mdb_ausente_nao_quebra_ciclo(monkeypatch):
    """Protocolo ausente no MDB não impede a tentativa de detalhes nem levanta."""
    monkeypatch.setattr(svc, "SYNC_RELATED_PRECONDITION_DETALHES", True)
    sync = _make_sync(existing=False)
    # MDB sem a OS em nenhuma tabela.
    sync.conn_mgr.get_mdb_by_nro.return_value.cursor.side_effect = (
        lambda: _FakeMdbCursor({})
    )

    sync.sync_os_data_from_mdb(84, 2026, "OS_Atual")

    mysql_conn = sync._mysql_conn
    assert _inserts(mysql_conn, "tabProtocolos") == []
    assert _inserts(mysql_conn, "tabDetalhesServico") == []
    # Apenas warnings de ausência; nenhum erro fatal.
    sync._svc_log.error.assert_not_called()
