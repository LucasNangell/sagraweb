import pymysql
import pymysql.cursors
from contextlib import contextmanager
import logging
from queue import Queue, Empty

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class ConnectionPool:
    def __init__(self, max_connections=10, **db_config):
        self.pool = Queue(maxsize=max_connections)
        self.max_connections = max_connections
        self.db_config = db_config
        self.created_connections = 0
        
        # Pre-fill tokens
        for _ in range(max_connections):
            self.pool.put(None)

    def get_connection(self):
        try:
            conn = self.pool.get(block=True, timeout=5)
            
            if conn is None:
                return self._create_new_connection()
            
            try:
                conn.ping(reconnect=True)
                return conn
            except Exception:
                logger.warning("Connection in pool was dead, creating new one.")
                try:
                    conn.close()
                except:
                    pass
                return self._create_new_connection()
                
        except Empty:
            raise Exception("Connection pool exhausted")

    def _create_new_connection(self):
        import time
        retries = 3
        for attempt in range(retries):
            try:
                conn = pymysql.connect(**self.db_config)
                return conn
            except pymysql.MySQLError as e:
                if attempt < retries - 1:
                    logger.warning(f"Error connecting (attempt {attempt+1}/{retries}): {e}. Retrying...")
                    time.sleep(1)
                else:
                    logger.error(f"Error connecting after {retries} attempts: {e}")
                    self.pool.put(None)
                    raise

    def return_connection(self, conn):
        try:
            self.pool.put(conn, block=False)
        except Exception:
            logger.warning("Pool full, closing returned connection")
            try:
                conn.close()
            except:
                pass

from config_manager import config_manager

class Database:
    def __init__(self):
        # Load from config or use defaults
        self.host = config_manager.get("db_host", "10.120.1.125")
        self.port = int(config_manager.get("db_port", 3306))
        self.user = config_manager.get("db_user", "usr_sefoc")
        self.password = config_manager.get("db_password", "sefoc_2018")
        self.db = config_manager.get("db_name", "sagrafulldb")
        
        self.pool = ConnectionPool(
            max_connections=10,
            host=self.host,
            port=self.port,
            user=self.user,
            password=self.password,
            database=self.db,
            cursorclass=pymysql.cursors.DictCursor,
            autocommit=True,
            charset='utf8mb4' # [IMPORTANTE] Garante que acentos funcionem nos filtros
        )

    @contextmanager
    def cursor(self):
        conn = self.pool.get_connection()
        try:
            cursor = conn.cursor()
            try:
                yield cursor
            finally:
                cursor.close()
        finally:
            self.pool.return_connection(conn)

    def execute_query(self, query, params=None):
        with self.cursor() as cursor:
            cursor.execute(query, params)
            return cursor.fetchall()

    def execute_transaction(self, operations):
        conn = self.pool.get_connection()
        conn.begin()
        try:
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
        except Exception as e:
            conn.rollback()
            logger.error(f"Transaction failed: {e}")
            raise e
        finally:
            self.pool.return_connection(conn)

db = Database()