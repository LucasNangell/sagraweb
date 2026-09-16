"""
Detecção e execução segura de exclusão de OS (MDB → MySQL).

MDB é a única autoridade de exclusão. Nunca apaga no Access.
"""
from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timedelta
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

from sync_policy import (
    OS_DELETE_AUDIT_GRACE_SECONDS,
    OS_DELETE_AUTO_LIMIT,
    OS_DELETE_DWELL_SECONDS,
    OS_DELETE_MIN_CONFIRM,
    OS_DELETE_VOLUME_DROP_PCT,
    OS_MIN_YEAR,
    effective_os_delete_policy,
)

logger = logging.getLogger(__name__)

OsKey = Tuple[int, int]


class OsDeletePhaseResult:
    def __init__(self) -> None:
        self.aborted = False
        self.abort_reason: Optional[str] = None
        self.candidates = 0
        self.pending = 0
        self.quarantined = 0
        self.executed = 0
        self.skipped_grace = 0
        self.skipped_present = 0
        self.volume_alert = False

    def as_dict(self) -> Dict[str, Any]:
        return {
            "aborted": self.aborted,
            "abort_reason": self.abort_reason,
            "candidates": self.candidates,
            "pending": self.pending,
            "quarantined": self.quarantined,
            "executed": self.executed,
            "skipped_grace": self.skipped_grace,
            "skipped_present": self.skipped_present,
            "volume_alert": self.volume_alert,
        }


def _os_content_hash(protocolo: Optional[Dict], detalhes: Optional[Dict]) -> str:
    parts = []
    for label, row in (("P", protocolo or {}), ("D", detalhes or {})):
        for k in sorted(row.keys()):
            if k.lower() in ("id", "datasincronizacao", "origemmdb", "hashregistro"):
                continue
            if str(k).startswith("email_pt_"):
                continue
            parts.append(f"{label}.{k}={row.get(k)}")
    return hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()


def _andamento_content_hash(andamento: Dict) -> str:
    content_fields = [
        str(andamento.get("SituacaoLink", "")),
        str(andamento.get("SetorLink", "")),
        str(andamento.get("Data", "")),
        str(andamento.get("UltimoStatus", "")),
        str(andamento.get("Observaçao", "")),
        str(andamento.get("Ponto", "")),
    ]
    return hashlib.sha256("|".join(content_fields).encode("utf-8")).hexdigest()


class OsDeleteManager:
    """
    Fase de exclusão de OS no ciclo do sync.

    sync: objeto com conn_mgr, logger (SyncLogger), e opcionalmente _svc_log.
    """

    def __init__(self, sync: Any) -> None:
        self.sync = sync
        self.log = getattr(sync, "_svc_log", None) or logger

    def _mysql(self):
        mgr = self.sync.conn_mgr
        try:
            conn = mgr.get_mysql()
            # Detecta conexão corrompida por uso concorrente (BG_SYNC vs ciclo)
            if hasattr(conn, "ping"):
                conn.ping(reconnect=True, attempts=1, delay=0)
            elif hasattr(conn, "is_connected") and not conn.is_connected():
                raise RuntimeError("mysql disconnected")
            return conn
        except Exception:
            invalidate = getattr(mgr, "invalidate_mysql", None)
            if callable(invalidate):
                invalidate()
            return mgr.get_mysql()

    def _log_info(self, msg: str, *args) -> None:
        try:
            self.log.info(msg, *args)
        except TypeError:
            self.log.info(msg % args if args else msg)

    def _log_warning(self, msg: str, *args) -> None:
        try:
            self.log.warning(msg, *args)
        except TypeError:
            self.log.warning(msg % args if args else msg)

    def _log_error(self, msg: str, *args) -> None:
        try:
            self.log.error(msg, *args)
        except TypeError:
            self.log.error(msg % args if args else msg)

    # ------------------------------------------------------------------
    # Leitura MDB
    # ------------------------------------------------------------------

    def read_mdb_os_keys(self) -> Optional[Dict[OsKey, str]]:
        """
        Lê (nro, ano) → origem dos dois MDBs (ano >= OS_MIN_YEAR).
        Retorna None em qualquer falha ODBC (fail-closed).
        """
        result: Dict[OsKey, str] = {}
        sources = (
            ("OS_Atual", self.sync.conn_mgr.get_mdb_os, True),
            ("Papelaria", self.sync.conn_mgr.get_mdb_pap, False),
        )
        for origem, getter, is_os in sources:
            try:
                conn = getter()
                cur = conn.cursor()
                if is_os:
                    cur.execute(
                        f"SELECT NroProtocolo, AnoProtocolo FROM tabProtocolos "
                        f"WHERE AnoProtocolo >= {OS_MIN_YEAR} AND NroProtocolo < 5000"
                    )
                else:
                    cur.execute(
                        f"SELECT NroProtocolo, AnoProtocolo FROM tabProtocolos "
                        f"WHERE AnoProtocolo >= {OS_MIN_YEAR} AND NroProtocolo >= 5000"
                    )
                for row in cur.fetchall():
                    nro, ano = int(row[0]), int(row[1])
                    result[(nro, ano)] = origem
                cur.close()
            except Exception as e:
                self._log_error("[OS_DEL] falha lendo MDB %s: %s", origem, e)
                return None
        return result

    def verify_os_absent_both_mdbs(self, nro: int, ano: int) -> Optional[bool]:
        """
        True = ausente nos dois MDBs.
        False = presente em algum.
        None = erro de leitura (fail-closed: não apagar).
        """
        for label, getter in (
            ("OS_Atual", self.sync.conn_mgr.get_mdb_os),
            ("Papelaria", self.sync.conn_mgr.get_mdb_pap),
        ):
            try:
                conn = getter()
                cur = conn.cursor()
                cur.execute(
                    "SELECT COUNT(*) FROM tabProtocolos "
                    "WHERE NroProtocolo = ? AND AnoProtocolo = ?",
                    (nro, ano),
                )
                row = cur.fetchone()
                count = int(row[0]) if row else 0
                cur.close()
                if count > 0:
                    return False
            except Exception as e:
                self._log_error(
                    "[OS_DEL] falha verify OS %s/%s em %s: %s", nro, ano, label, e
                )
                return None
        return True

    # ------------------------------------------------------------------
    # Cache incremental
    # ------------------------------------------------------------------

    def upsert_cache(self, present: Dict[OsKey, str]) -> None:
        if not present:
            return
        conn = self._mysql()
        cur = conn.cursor(buffered=True)
        try:
            for (nro, ano), origem in present.items():
                cur.execute(
                    """
                    INSERT INTO cache_os_mdb (nro, ano, origem, last_seen_at)
                    VALUES (%s, %s, %s, NOW())
                    ON DUPLICATE KEY UPDATE
                        origem = VALUES(origem),
                        last_seen_at = NOW()
                    """,
                    (nro, ano, origem),
                )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            cur.close()

    def load_cache(self) -> Dict[OsKey, str]:
        conn = self._mysql()
        cur = conn.cursor(buffered=True)
        try:
            cur.execute(
                f"SELECT nro, ano, origem FROM cache_os_mdb WHERE ano >= {OS_MIN_YEAR}"
            )
            rows = cur.fetchall()
            return {(int(r[0]), int(r[1])): r[2] for r in rows}
        finally:
            cur.close()

    def recent_web_write(self, nro: int, ano: int) -> bool:
        conn = self._mysql()
        cur = conn.cursor(buffered=True)
        try:
            cur.execute(
                """
                SELECT COUNT(*) FROM tab_os_audit_log
                WHERE nro_protocolo = %s AND ano_protocolo = %s
                  AND evento_em >= (NOW() - INTERVAL %s SECOND)
                """,
                (nro, ano, OS_DELETE_AUDIT_GRACE_SECONDS),
            )
            row = cur.fetchone()
            return bool(row and row[0] > 0)
        except Exception:
            # Tabela pode não existir — fail-open para grace (não apaga por segurança?
            # Fail closed for delete: if we can't check, treat as recent write)
            return True
        finally:
            cur.close()

    # ------------------------------------------------------------------
    # Fila / dwell
    # ------------------------------------------------------------------

    def _get_pending(self, nro: int, ano: int) -> Optional[Dict[str, Any]]:
        conn = self._mysql()
        cur = conn.cursor(dictionary=True, buffered=True)
        try:
            cur.execute(
                "SELECT * FROM sync_os_pending_delete WHERE nro = %s AND ano = %s",
                (nro, ano),
            )
            return cur.fetchone()
        finally:
            cur.close()

    def _upsert_pending(
        self,
        nro: int,
        ano: int,
        origem: str,
        *,
        status: str = "pending",
        andamentos_count: int = 0,
        payload_hash: Optional[str] = None,
        motivo: Optional[str] = None,
        bump_confirm: bool = True,
    ) -> Dict[str, Any]:
        # Lê pending ANTES de abrir o cursor de escrita (evita 2 cursors na mesma conn)
        existing = self._get_pending(nro, ano)
        conn = self._mysql()
        cur = conn.cursor(dictionary=True, buffered=True)
        if existing and existing.get("status") in ("rejected", "executed"):
            # reinicia se voltou a sumir após rejeição
            if existing.get("status") == "executed":
                cur.close()
                return existing
        try:
            if existing and existing.get("status") in ("pending", "blocked", "approved"):
                confirm = int(existing.get("confirm_count") or 1)
                if bump_confirm and existing.get("status") == "pending":
                    confirm += 1
                cur.execute(
                    """
                    UPDATE sync_os_pending_delete
                    SET confirm_count = %s,
                        last_check_at = NOW(),
                        origem = %s,
                        andamentos_count = %s,
                        payload_hash = COALESCE(%s, payload_hash),
                        motivo = COALESCE(%s, motivo),
                        status = %s
                    WHERE nro = %s AND ano = %s
                    """,
                    (
                        confirm,
                        origem,
                        andamentos_count,
                        payload_hash,
                        motivo,
                        status if status != "pending" else existing["status"],
                        nro,
                        ano,
                    ),
                )
            else:
                cur.execute(
                    """
                    INSERT INTO sync_os_pending_delete
                    (nro, ano, origem, first_missing_at, confirm_count, last_check_at,
                     status, payload_hash, andamentos_count, motivo)
                    VALUES (%s, %s, %s, NOW(), 1, NOW(), %s, %s, %s, %s)
                    ON DUPLICATE KEY UPDATE
                        last_check_at = NOW(),
                        confirm_count = IF(status IN ('pending','blocked'),
                                           confirm_count + 1, confirm_count),
                        origem = VALUES(origem),
                        andamentos_count = VALUES(andamentos_count),
                        payload_hash = COALESCE(VALUES(payload_hash), payload_hash),
                        motivo = COALESCE(VALUES(motivo), motivo),
                        status = IF(status = 'rejected', 'pending', status),
                        first_missing_at = IF(status = 'rejected', NOW(), first_missing_at)
                    """,
                    (
                        nro,
                        ano,
                        origem,
                        status,
                        payload_hash,
                        andamentos_count,
                        motivo,
                    ),
                )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            cur.close()
        return self._get_pending(nro, ano) or {}

    def _clear_pending_if_present(self, nro: int, ano: int) -> None:
        conn = self._mysql()
        cur = conn.cursor(buffered=True)
        try:
            cur.execute(
                """
                DELETE FROM sync_os_pending_delete
                WHERE nro = %s AND ano = %s AND status IN ('pending', 'blocked')
                """,
                (nro, ano),
            )
            conn.commit()
        except Exception:
            conn.rollback()
        finally:
            cur.close()

    def _count_andamentos(self, nro: int, ano: int) -> int:
        conn = self._mysql()
        cur = conn.cursor(buffered=True)
        try:
            cur.execute(
                """
                SELECT COUNT(*) FROM tabandamento
                WHERE NroProtocoloLink = %s AND AnoProtocoloLink = %s
                """,
                (nro, ano),
            )
            row = cur.fetchone()
            return int(row[0]) if row else 0
        finally:
            cur.close()

    def _dwell_ready(self, pending: Dict[str, Any]) -> bool:
        if not pending:
            return False
        if pending.get("status") == "approved":
            return True
        if int(pending.get("confirm_count") or 0) < OS_DELETE_MIN_CONFIRM:
            return False
        first = pending.get("first_missing_at")
        if not first:
            return False
        if isinstance(first, str):
            try:
                first = datetime.fromisoformat(first)
            except ValueError:
                return False
        age = (datetime.now() - first).total_seconds()
        return age >= OS_DELETE_DWELL_SECONDS

    # ------------------------------------------------------------------
    # Executor
    # ------------------------------------------------------------------

    def execute_delete(
        self,
        nro: int,
        ano: int,
        *,
        origem: str = "MDB",
        motivo: str = "Exclusao confirmada no MDB",
        decided_by: Optional[str] = None,
    ) -> bool:
        """
        Transação atômica: backup → tombstones → DELETE andamentos/detalhes/protocolo.
        """
        # Reverificação imediata antes de apagar
        absent = self.verify_os_absent_both_mdbs(nro, ano)
        if absent is not True:
            self._log_warning(
                "[OS_DEL] abort execute %s/%s: ainda presente ou erro verify", nro, ano
            )
            return False

        conn = self._mysql()
        cur = conn.cursor(dictionary=True, buffered=True)
        try:
            cur.execute(
                "SELECT * FROM tabProtocolos WHERE NroProtocolo = %s AND AnoProtocolo = %s",
                (nro, ano),
            )
            protocolo = cur.fetchone()
            cur.execute(
                "SELECT * FROM tabDetalhesServico "
                "WHERE NroProtocoloLinkDet = %s AND AnoProtocoloLinkDet = %s",
                (nro, ano),
            )
            detalhes = cur.fetchone()
            cur.execute(
                "SELECT * FROM tabandamento "
                "WHERE NroProtocoloLink = %s AND AnoProtocoloLink = %s",
                (nro, ano),
            )
            andamentos = list(cur.fetchall() or [])

            if not protocolo and not detalhes and not andamentos:
                # Já limpo no MySQL — só marca tombstone/executed
                content_hash = _os_content_hash(None, None)
            else:
                content_hash = _os_content_hash(protocolo, detalhes)

            snapshot = {
                "protocolo": protocolo,
                "detalhes": detalhes,
                "andamentos": andamentos,
            }
            cur.execute(
                """
                INSERT INTO backup_os (nro, ano, origem, dados_json)
                VALUES (%s, %s, %s, %s)
                """,
                (nro, ano, origem, json.dumps(snapshot, ensure_ascii=False, default=str)),
            )

            cur.execute(
                """
                INSERT INTO deleted_os (nro, ano, content_hash, motivo, origem)
                VALUES (%s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                    content_hash = VALUES(content_hash),
                    deleted_at = CURRENT_TIMESTAMP,
                    motivo = VALUES(motivo),
                    origem = VALUES(origem)
                """,
                (nro, ano, content_hash, motivo, origem),
            )

            for and_ in andamentos:
                cod = and_.get("CodStatus")
                if not cod:
                    continue
                ahash = _andamento_content_hash(and_)
                cur.execute(
                    """
                    INSERT INTO deleted_andamentos
                    (codstatus, nro, ano, origem, content_hash, motivo)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON DUPLICATE KEY UPDATE
                        content_hash = VALUES(content_hash),
                        deleted_at = CURRENT_TIMESTAMP,
                        motivo = VALUES(motivo)
                    """,
                    (
                        cod,
                        nro,
                        ano,
                        origem,
                        ahash,
                        f"OS {nro}/{ano} excluida no MDB",
                    ),
                )

            cur.execute(
                "DELETE FROM tabandamento "
                "WHERE NroProtocoloLink = %s AND AnoProtocoloLink = %s",
                (nro, ano),
            )
            cur.execute(
                "DELETE FROM tabDetalhesServico "
                "WHERE NroProtocoloLinkDet = %s AND AnoProtocoloLinkDet = %s",
                (nro, ano),
            )
            cur.execute(
                "DELETE FROM tabProtocolos WHERE NroProtocolo = %s AND AnoProtocolo = %s",
                (nro, ano),
            )
            cur.execute(
                "DELETE FROM cache_os_mdb WHERE nro = %s AND ano = %s", (nro, ano)
            )
            for and_ in andamentos:
                cod = and_.get("CodStatus")
                if cod:
                    try:
                        cur.execute(
                            "DELETE FROM sync_andamento_baseline WHERE CodStatus = %s",
                            (cod,),
                        )
                    except Exception:
                        pass

            cur.execute(
                "DELETE FROM sync_os_baseline WHERE nro = %s AND ano = %s",
                (nro, ano),
            )
            cur.execute(
                """
                UPDATE sync_os_pending_delete
                SET status = 'executed',
                    decided_at = NOW(),
                    decided_by = COALESCE(%s, decided_by),
                    last_check_at = NOW(),
                    motivo = COALESCE(%s, motivo)
                WHERE nro = %s AND ano = %s
                """,
                (decided_by, motivo, nro, ano),
            )
            # Se não havia pending, cria executed
            if cur.rowcount == 0:
                cur.execute(
                    """
                    INSERT INTO sync_os_pending_delete
                    (nro, ano, origem, first_missing_at, confirm_count, last_check_at,
                     status, andamentos_count, motivo, decided_by, decided_at)
                    VALUES (%s, %s, %s, NOW(), %s, NOW(), 'executed', %s, %s, %s, NOW())
                    ON DUPLICATE KEY UPDATE status = 'executed', decided_at = NOW()
                    """,
                    (
                        nro,
                        ano,
                        origem,
                        OS_DELETE_MIN_CONFIRM,
                        len(andamentos),
                        motivo,
                        decided_by,
                    ),
                )

            conn.commit()

            try:
                self.sync.logger.log(
                    "DELETE_OS",
                    "MDB",
                    "MySQL",
                    f"OS:{nro}/{ano}",
                    nro,
                    ano,
                    f"OS excluida; {len(andamentos)} andamentos; tombstone duravel",
                )
            except Exception:
                pass

            self._log_info(
                "[OS_DEL] executed OS %s/%s andamentos=%s by=%s",
                nro,
                ano,
                len(andamentos),
                decided_by or "auto",
            )
            return True
        except Exception as e:
            conn.rollback()
            self._log_error("[OS_DEL] execute falhou OS %s/%s: %s", nro, ano, e)
            return False
        finally:
            cur.close()

    # ------------------------------------------------------------------
    # Fase principal
    # ------------------------------------------------------------------

    def run_phase(self, policies: Dict[str, Dict[str, Any]]) -> OsDeletePhaseResult:
        result = OsDeletePhaseResult()
        delete_policy = effective_os_delete_policy(policies)
        if delete_policy == "off":
            self._log_info("[OS_DEL] policy=off — fase ignorada")
            return result

        present = self.read_mdb_os_keys()
        if present is None:
            result.aborted = True
            result.abort_reason = "mdb_read_failed"
            return result

        cache = self.load_cache()
        if cache:
            drop_pct = (
                (len(cache) - len(present)) / max(len(cache), 1)
            ) * 100.0
            if drop_pct > OS_DELETE_VOLUME_DROP_PCT and (len(cache) - len(present)) > 5:
                result.aborted = True
                result.abort_reason = f"volume_drop_{drop_pct:.1f}pct"
                result.volume_alert = True
                self._log_error(
                    "[OS_DEL] SAFETY volume drop %.1f%% (cache=%s present=%s) — abort",
                    drop_pct,
                    len(cache),
                    len(present),
                )
                return result

        # Atualiza cache com o que está presente (incremental)
        self.upsert_cache(present)

        missing: List[Tuple[OsKey, str]] = []
        for key, origem in cache.items():
            if key not in present:
                missing.append((key, origem))

        result.candidates = len(missing)
        ready_to_exec: List[Tuple[int, int, str, Dict[str, Any]]] = []

        for (nro, ano), origem in missing:
            absent = self.verify_os_absent_both_mdbs(nro, ano)
            if absent is None:
                result.skipped_present += 1
                continue
            if absent is False:
                self._clear_pending_if_present(nro, ano)
                result.skipped_present += 1
                continue
            if self.recent_web_write(nro, ano):
                result.skipped_grace += 1
                self._log_info(
                    "[OS_DEL] skip OS %s/%s motivo=audit_grace", nro, ano
                )
                continue

            count_and = self._count_andamentos(nro, ano)
            pending = self._upsert_pending(
                nro,
                ano,
                origem,
                andamentos_count=count_and,
                motivo="Ausente no MDB (confirmado)",
            )
            result.pending += 1

            if pending.get("status") == "approved" or self._dwell_ready(pending):
                ready_to_exec.append((nro, ano, origem, pending))

        # Também processa aprovados que talvez não estejam em missing deste ciclo
        # (já confirmados antes)
        conn = self._mysql()
        cur = conn.cursor(dictionary=True, buffered=True)
        try:
            cur.execute(
                "SELECT * FROM sync_os_pending_delete WHERE status = 'approved'"
            )
            for row in cur.fetchall() or []:
                key = (int(row["nro"]), int(row["ano"]))
                if any(k == key for k, _, _, _ in ready_to_exec):
                    continue
                ready_to_exec.append(
                    (key[0], key[1], row.get("origem") or "MDB", row)
                )
        finally:
            cur.close()

        if delete_policy == "dryrun":
            for nro, ano, origem, pending in ready_to_exec:
                self._upsert_pending(
                    nro,
                    ano,
                    origem,
                    status="blocked",
                    andamentos_count=int(pending.get("andamentos_count") or 0),
                    motivo="dryrun: aguardando policy=on ou aprovacao",
                    bump_confirm=False,
                )
                result.quarantined += 1
            self._log_info(
                "[OS_DEL] dryrun ready=%s quarantined=%s",
                len(ready_to_exec),
                result.quarantined,
            )
            return result

        # policy=on — híbrido
        auto_batch = [
            x for x in ready_to_exec if x[3].get("status") == "approved"
        ]
        auto_candidates = [
            x for x in ready_to_exec if x[3].get("status") != "approved"
        ]

        if len(auto_candidates) > OS_DELETE_AUTO_LIMIT:
            for nro, ano, origem, pending in auto_candidates:
                self._upsert_pending(
                    nro,
                    ano,
                    origem,
                    status="blocked",
                    andamentos_count=int(pending.get("andamentos_count") or 0),
                    motivo=f"lote>{OS_DELETE_AUTO_LIMIT}: quarentena",
                    bump_confirm=False,
                )
                result.quarantined += 1
            self._log_warning(
                "[OS_DEL] lote=%s > limite=%s — quarentena",
                len(auto_candidates),
                OS_DELETE_AUTO_LIMIT,
            )
            auto_candidates = []

        for nro, ano, origem, pending in auto_batch + auto_candidates:
            ok = self.execute_delete(
                nro,
                ano,
                origem=origem or "MDB",
                decided_by="admin" if pending.get("status") == "approved" else "auto",
            )
            if ok:
                result.executed += 1

        return result


def _resolve_mysql(conn_or_mgr: Any):
    """Aceita ConnectionManager (.get_mysql) ou conexão mysql.connector direta."""
    if conn_or_mgr is None:
        raise ValueError("conexao MySQL ausente")
    getter = getattr(conn_or_mgr, "get_mysql", None)
    if callable(getter):
        return getter()
    return conn_or_mgr


def is_os_deleted(conn_or_mgr: Any, nro: int, ano: int) -> bool:
    try:
        conn = _resolve_mysql(conn_or_mgr)
        cur = conn.cursor(buffered=True)
        try:
            cur.execute(
                "SELECT COUNT(*) FROM deleted_os WHERE nro = %s AND ano = %s",
                (nro, ano),
            )
            row = cur.fetchone()
            return bool(row and row[0] > 0)
        finally:
            cur.close()
    except Exception:
        return False


def os_keys_pending_or_deleted(conn_or_mgr: Any) -> Set[OsKey]:
    """Conjunto (nro, ano) em deleted_os ou pending/blocked/approved — para safety lock."""
    keys: Set[OsKey] = set()
    try:
        conn = _resolve_mysql(conn_or_mgr)
        cur = conn.cursor(buffered=True)
        try:
            cur.execute("SELECT nro, ano FROM deleted_os")
            for r in cur.fetchall() or []:
                keys.add((int(r[0]), int(r[1])))
            cur.execute(
                """
                SELECT nro, ano FROM sync_os_pending_delete
                WHERE status IN ('pending', 'blocked', 'approved')
                """
            )
            for r in cur.fetchall() or []:
                keys.add((int(r[0]), int(r[1])))
        finally:
            cur.close()
    except Exception:
        pass
    return keys
