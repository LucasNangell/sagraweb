import pymysql
import pymysql.cursors
import pymysql.err
from contextlib import contextmanager
import logging
import os
from queue import Queue, Empty

logger = logging.getLogger(__name__)


class DatabasePoolExhausted(Exception):
    """Pool de conexões esgotado — cliente deve aguardar e tentar de novo."""


class DatabaseConnectionError(Exception):
    """Falha ao conectar ou executar no MySQL."""


def _db_connect_timeout() -> int:
    try:
        return max(3, int(os.getenv("SAGRA_DB_CONNECT_TIMEOUT", "10")))
    except (TypeError, ValueError):
        return 10


def _db_read_timeout() -> int:
    try:
        return max(10, int(os.getenv("SAGRA_DB_READ_TIMEOUT", "60")))
    except (TypeError, ValueError):
        return 60


def _db_pool_size() -> int:
    try:
        return max(2, int(os.getenv("SAGRA_DB_POOL_SIZE", "10")))
    except (TypeError, ValueError):
        return 10


def _query_preview(query: str | None) -> str:
    if not query:
        return "<empty>"
    normalized = " ".join(str(query).split())
    return normalized[:120] + ("…" if len(normalized) > 120 else "")


class ConnectionPool:
    def __init__(self, max_connections=10, **db_config):
        self.pool = Queue(maxsize=max_connections)
        self.max_connections = max_connections
        self.db_config = db_config
        self.created_connections = 0
        self._in_use = 0

        for _ in range(max_connections):
            self.pool.put(None)

    def _log_pool_pressure(self) -> None:
        threshold = max(1, int(self.max_connections * 0.8))
        if self._in_use >= threshold:
            logger.warning(
                "Pool MySQL em uso elevado: %s/%s conexões ativas",
                self._in_use,
                self.max_connections,
            )

    def get_connection(self):
        try:
            conn = self.pool.get(block=True, timeout=5)

            if conn is None:
                conn = self._create_new_connection()
            else:
                try:
                    conn.ping(reconnect=True)
                except Exception:
                    logger.warning("Conexão morta no pool — recriando.")
                    try:
                        conn.close()
                    except Exception as e_close:
                        logger.warning("Erro ao fechar conexão morta do pool: %s", e_close)
                    conn = self._create_new_connection()

            self._in_use += 1
            self._log_pool_pressure()
            return conn

        except Empty as exc:
            logger.error("Pool MySQL esgotado (max=%s)", self.max_connections)
            raise DatabasePoolExhausted(
                f"Pool de conexões MySQL esgotado (max={self.max_connections})"
            ) from exc

    def _create_new_connection(self):
        import time

        retries = 3
        for attempt in range(retries):
            try:
                conn = pymysql.connect(**self.db_config)
                return conn
            except pymysql.MySQLError as e:
                if attempt < retries - 1:
                    logger.warning(
                        "MySQL connect falhou (tentativa %s/%s): %s",
                        attempt + 1,
                        retries,
                        e,
                    )
                    time.sleep(1)
                else:
                    logger.error("MySQL connect falhou após %s tentativas: %s", retries, e)
                    self.pool.put(None)
                    raise DatabaseConnectionError(str(e)) from e

    def return_connection(self, conn):
        if self._in_use > 0:
            self._in_use -= 1
        if conn is None:
            return
        try:
            self.pool.put(conn, block=False)
        except Exception:
            logger.warning("Pool cheio — fechando conexão devolvida")
            try:
                conn.close()
            except Exception as e_ret:
                logger.warning("Erro ao fechar conexão devolvida ao pool: %s", e_ret)


from config_manager import config_manager


class Database:
    def __init__(self):
        self.host = config_manager.get("db_host", "10.1.1.73")
        self.port = int(config_manager.get("db_port", 3306))
        self.user = config_manager.get("db_user", "usr_sagraweb")
        self.password = config_manager.get("db_password") or ""
        if not self.password:
            logger.error("Senha MySQL não configurada. Defina SAGRA_DB_PASSWORD.")
        self.db = config_manager.get("db_name", "sagrafulldb")

        self.pool = ConnectionPool(
            max_connections=_db_pool_size(),
            host=self.host,
            port=self.port,
            user=self.user,
            password=self.password,
            database=self.db,
            cursorclass=pymysql.cursors.DictCursor,
            autocommit=True,
            charset="utf8mb4",
            connect_timeout=_db_connect_timeout(),
            read_timeout=_db_read_timeout(),
            write_timeout=_db_read_timeout(),
        )

    @contextmanager
    def cursor(self):
        conn = None
        try:
            conn = self.pool.get_connection()
            cursor = conn.cursor()
            try:
                yield cursor
            finally:
                cursor.close()
        finally:
            if conn is not None:
                self.pool.return_connection(conn)

    def execute_query(self, query, params=None):
        try:
            with self.cursor() as cursor:
                cursor.execute(query, params)
                return cursor.fetchall()
        except DatabasePoolExhausted:
            raise
        except pymysql.MySQLError as exc:
            logger.error(
                "MySQL query falhou [%s]: %s",
                _query_preview(query),
                exc,
            )
            raise DatabaseConnectionError(str(exc)) from exc
        except Exception as exc:
            logger.exception("Erro inesperado em query [%s]", _query_preview(query))
            raise

    def execute_transaction(self, operations):
        conn = None
        try:
            conn = self.pool.get_connection()
            conn.begin()
            results = []
            with conn.cursor() as cursor:
                for op in operations:
                    if callable(op):
                        res = op(cursor)
                        results.append(res)
                    else:
                        query, params = op
                        cursor.execute(query, params)
                        results.append(cursor.fetchall())
            conn.commit()
            return results
        except DatabasePoolExhausted:
            raise
        except Exception as e:
            if conn is not None:
                try:
                    conn.rollback()
                except Exception as rb_exc:
                    logger.warning("Rollback MySQL falhou: %s", rb_exc)
            logger.error("Transação MySQL falhou: %s", e)
            raise
        finally:
            if conn is not None:
                self.pool.return_connection(conn)


db = Database()
