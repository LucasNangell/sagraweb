"""
Fila em background para montar o ZIP de Gravação Externa.

Roda dentro do processo da API (ThreadPoolExecutor). A request HTTP só
enfileira / consulta status / serve o arquivo pronto (com Range).
"""
from __future__ import annotations

import logging
import os
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path
from typing import Any, Optional

from fastapi import HTTPException

from config_manager import PROJECT_ROOT
from database import db
from services.gravacao_externa_service import (
    ZipBuildCancelled,
    _fetch_arquivos,
    compute_arquivos_signature,
    get_session_by_id,
    session_zip_filename,
    write_session_arquivos_zip,
)

logger = logging.getLogger(__name__)

ZIP_PENDING = "pendente"
ZIP_GENERATING = "gerando"
ZIP_READY = "pronto"
ZIP_ERROR = "erro"

_DEFAULT_MAX_WORKERS = 1
_PROGRESS_MIN_INTERVAL_S = 0.75
_DEFAULT_TTL_HOURS = 24
_DEFAULT_CACHE_MAX_GB = 20.0


def _max_workers() -> int:
    raw = (os.environ.get("SAGRA_GE_ZIP_WORKERS") or "").strip()
    if not raw:
        return _DEFAULT_MAX_WORKERS
    try:
        return max(1, min(4, int(raw)))
    except ValueError:
        return _DEFAULT_MAX_WORKERS


def zip_ttl_hours() -> int:
    raw = (os.environ.get("SAGRA_GE_ZIP_TTL_HORAS") or "").strip()
    if not raw:
        return _DEFAULT_TTL_HOURS
    try:
        return max(1, int(raw))
    except ValueError:
        return _DEFAULT_TTL_HOURS


def zip_cache_max_bytes() -> int:
    raw = (os.environ.get("SAGRA_GE_ZIP_CACHE_MAX_GB") or "").strip()
    try:
        gb = float(raw) if raw else _DEFAULT_CACHE_MAX_GB
    except ValueError:
        gb = _DEFAULT_CACHE_MAX_GB
    return int(max(1.0, gb) * (1024 ** 3))


def zip_cache_dir() -> Path:
    override = (os.environ.get("SAGRA_GE_ZIP_DIR") or "").strip()
    if override:
        path = Path(override)
    else:
        path = PROJECT_ROOT / "storage" / "gravacao_externa_zips"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _unlink_quiet(path: Optional[str]) -> None:
    if not path:
        return
    try:
        if os.path.isfile(path):
            os.unlink(path)
    except OSError:
        logger.warning("Não foi possível remover ZIP: %s", path)


def _part_path(final_path: str) -> str:
    return f"{final_path}.part"


def zip_dest_path(session_id: int, signature: str) -> Path:
    safe = "".join(ch for ch in signature[:16] if ch.isalnum())
    return zip_cache_dir() / f"{int(session_id)}_{safe}.zip"


def zip_etag(signature: str) -> str:
    return f'"{signature}"'


def _map_zip_row(row: dict[str, Any]) -> dict[str, Any]:
    assinatura = str(row.get("Assinatura") or "")
    return {
        "id": int(row["Id"]),
        "gravacao_externa_id": int(row["GravacaoExternaId"]),
        "assinatura": assinatura,
        "status": str(row.get("Status") or ZIP_PENDING),
        "erro": row.get("Erro"),
        "arquivo_path": row.get("ArquivoPath"),
        "nome_arquivo": row.get("NomeArquivo"),
        "tamanho_bytes": int(row["TamanhoBytes"]) if row.get("TamanhoBytes") is not None else None,
        "total_arquivos": int(row.get("TotalArquivos") or 0),
        "arquivos_prontos": int(row.get("ArquivosProntos") or 0),
        "bytes_prontos": int(row.get("BytesProntos") or 0),
        "criado_em": row.get("CriadoEm"),
        "pronto_em": row.get("ProntoEm"),
        "expira_em": row.get("ExpiraEm"),
        "ultimo_acesso_em": row.get("UltimoAcessoEm"),
        "etag": zip_etag(assinatura) if assinatura else None,
    }


def public_zip_status(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "status": row["status"],
        "assinatura": row["assinatura"],
        "nome_arquivo": row.get("nome_arquivo"),
        "tamanho_bytes": row.get("tamanho_bytes"),
        "total_arquivos": row.get("total_arquivos") or 0,
        "arquivos_prontos": row.get("arquivos_prontos") or 0,
        "bytes_prontos": row.get("bytes_prontos") or 0,
        "erro": row.get("erro"),
        "etag": row.get("etag") if row.get("status") == ZIP_READY else None,
    }


def get_zip_row(session_id: int) -> Optional[dict[str, Any]]:
    rows = db.execute_query(
        """
        SELECT * FROM tab_os_gravacao_externa_zip
        WHERE GravacaoExternaId = %s
        LIMIT 1
        """,
        (int(session_id),),
    )
    if not rows:
        return None
    return _map_zip_row(rows[0])


def list_zip_jobs(*, statuses: Optional[list[str]] = None) -> list[dict[str, Any]]:
    if statuses:
        placeholders = ", ".join(["%s"] * len(statuses))
        rows = db.execute_query(
            f"""
            SELECT * FROM tab_os_gravacao_externa_zip
            WHERE Status IN ({placeholders})
            """,
            tuple(statuses),
        )
    else:
        rows = db.execute_query("SELECT * FROM tab_os_gravacao_externa_zip")
    return [_map_zip_row(r) for r in (rows or [])]


def _upsert_pending(session_id: int, signature: str, filename: str, total_arquivos: int) -> None:
    def _op(cursor) -> None:
        cursor.execute(
            """
            INSERT INTO tab_os_gravacao_externa_zip (
              GravacaoExternaId, Assinatura, Status, Erro, ArquivoPath, NomeArquivo,
              TamanhoBytes, TotalArquivos, ArquivosProntos, BytesProntos,
              CriadoEm, ProntoEm, ExpiraEm, UltimoAcessoEm
            ) VALUES (
              %s, %s, %s, NULL, NULL, %s,
              NULL, %s, 0, 0,
              NOW(), NULL, NULL, NOW()
            )
            ON DUPLICATE KEY UPDATE
              Assinatura = VALUES(Assinatura),
              Status = VALUES(Status),
              Erro = NULL,
              ArquivoPath = NULL,
              NomeArquivo = VALUES(NomeArquivo),
              TamanhoBytes = NULL,
              TotalArquivos = VALUES(TotalArquivos),
              ArquivosProntos = 0,
              BytesProntos = 0,
              CriadoEm = NOW(),
              ProntoEm = NULL,
              ExpiraEm = NULL,
              UltimoAcessoEm = NOW()
            """,
            (int(session_id), signature, ZIP_PENDING, filename, int(total_arquivos)),
        )

    db.execute_transaction([_op])


def _claim_zip_job(session_id: int, signature: str) -> bool:
    claimed = {"ok": False}

    def _op(cursor) -> None:
        cursor.execute(
            """
            UPDATE tab_os_gravacao_externa_zip
            SET Status = %s, Erro = NULL
            WHERE GravacaoExternaId = %s
              AND Assinatura = %s
              AND Status = %s
            """,
            (ZIP_GENERATING, int(session_id), signature, ZIP_PENDING),
        )
        claimed["ok"] = int(cursor.rowcount or 0) == 1

    db.execute_transaction([_op])
    return bool(claimed["ok"])


def _update_progress(
    session_id: int,
    signature: str,
    arquivos_prontos: int,
    bytes_prontos: int,
) -> None:
    db.execute_query(
        """
        UPDATE tab_os_gravacao_externa_zip
        SET ArquivosProntos = %s, BytesProntos = %s
        WHERE GravacaoExternaId = %s
          AND Assinatura = %s
          AND Status = %s
        """,
        (int(arquivos_prontos), int(bytes_prontos), int(session_id), signature, ZIP_GENERATING),
    )


def _finalize_ready(
    session_id: int,
    signature: str,
    arquivo_path: str,
    filename: str,
    tamanho_bytes: int,
    arquivos_prontos: int,
    bytes_prontos: int,
) -> bool:
    updated = {"ok": False}
    ttl = zip_ttl_hours()

    def _op(cursor) -> None:
        cursor.execute(
            """
            UPDATE tab_os_gravacao_externa_zip
            SET Status = %s,
                Erro = NULL,
                ArquivoPath = %s,
                NomeArquivo = %s,
                TamanhoBytes = %s,
                ArquivosProntos = %s,
                BytesProntos = %s,
                ProntoEm = NOW(),
                ExpiraEm = DATE_ADD(NOW(), INTERVAL %s HOUR),
                UltimoAcessoEm = NOW()
            WHERE GravacaoExternaId = %s
              AND Assinatura = %s
              AND Status = %s
            """,
            (
                ZIP_READY,
                arquivo_path,
                filename,
                int(tamanho_bytes),
                int(arquivos_prontos),
                int(bytes_prontos),
                int(ttl),
                int(session_id),
                signature,
                ZIP_GENERATING,
            ),
        )
        updated["ok"] = int(cursor.rowcount or 0) == 1

    db.execute_transaction([_op])
    return bool(updated["ok"])


def _finalize_error(session_id: int, signature: str, message: str) -> None:
    db.execute_query(
        """
        UPDATE tab_os_gravacao_externa_zip
        SET Status = %s, Erro = %s
        WHERE GravacaoExternaId = %s
          AND Assinatura = %s
          AND Status IN (%s, %s)
        """,
        (ZIP_ERROR, (message or "Falha ao gerar o ZIP.")[:512], int(session_id), signature, ZIP_GENERATING, ZIP_PENDING),
    )


def _reset_generating_to_pending() -> int:
    def _op(cursor) -> None:
        cursor.execute(
            """
            UPDATE tab_os_gravacao_externa_zip
            SET Status = %s
            WHERE Status = %s
            """,
            (ZIP_PENDING, ZIP_GENERATING),
        )
        reset["n"] = int(cursor.rowcount or 0)

    reset = {"n": 0}
    db.execute_transaction([_op])
    return int(reset["n"])


def touch_zip_last_access(session_id: int) -> None:
    db.execute_query(
        """
        UPDATE tab_os_gravacao_externa_zip
        SET UltimoAcessoEm = NOW()
        WHERE GravacaoExternaId = %s
        """,
        (int(session_id),),
    )


def mark_zip_downloaded(session_id: int) -> None:
    """Renova o TTL a partir do download real (não de consulta de status)."""
    ttl = zip_ttl_hours()
    db.execute_query(
        """
        UPDATE tab_os_gravacao_externa_zip
        SET UltimoAcessoEm = NOW(),
            ExpiraEm = DATE_ADD(NOW(), INTERVAL %s HOUR)
        WHERE GravacaoExternaId = %s
          AND Status = %s
        """,
        (int(ttl), int(session_id), ZIP_READY),
    )


def _delete_zip_row(session_id: int) -> None:
    db.execute_query(
        "DELETE FROM tab_os_gravacao_externa_zip WHERE GravacaoExternaId = %s",
        (int(session_id),),
    )


def _purge_row(row: dict[str, Any]) -> None:
    _unlink_quiet(row.get("arquivo_path"))
    if row.get("arquivo_path"):
        _unlink_quiet(_part_path(str(row["arquivo_path"])))
    _delete_zip_row(int(row["gravacao_externa_id"]))


def purge_expired_zips() -> dict[str, int]:
    """Remove ZIPs expirados e aplica teto LRU por UltimoAcessoEm."""
    expired = 0
    evicted = 0
    ttl = zip_ttl_hours()
    try:
        rows = db.execute_query(
            """
            SELECT * FROM tab_os_gravacao_externa_zip
            WHERE Status IN (%s, %s)
              AND (
                (ExpiraEm IS NOT NULL AND ExpiraEm < NOW())
                OR (Status = %s AND CriadoEm < DATE_SUB(NOW(), INTERVAL %s HOUR))
              )
            """,
            (ZIP_READY, ZIP_ERROR, ZIP_ERROR, ttl),
        )
        for raw in rows or []:
            _purge_row(_map_zip_row(raw))
            expired += 1
    except Exception as exc:
        logger.warning("Purga TTL de ZIP Gravação Externa falhou: %s", exc)

    try:
        ready = list_zip_jobs(statuses=[ZIP_READY])
        total_bytes = 0
        sized: list[tuple[dict[str, Any], int]] = []
        for row in ready:
            path = row.get("arquivo_path")
            size = int(row.get("tamanho_bytes") or 0)
            if path and os.path.isfile(path):
                try:
                    size = int(os.path.getsize(path))
                except OSError:
                    pass
            total_bytes += size
            sized.append((row, size))
        limit = zip_cache_max_bytes()
        if total_bytes > limit:
            sized.sort(key=lambda item: str(item[0].get("ultimo_acesso_em") or ""))
            for row, size in sized:
                if total_bytes <= limit:
                    break
                _purge_row(row)
                total_bytes -= size
                evicted += 1
    except Exception as exc:
        logger.warning("Purga LRU de ZIP Gravação Externa falhou: %s", exc)

    return {"expired": expired, "evicted": evicted}


class _ZipJobRuntime:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._executor: Optional[ThreadPoolExecutor] = None
        self._gen: dict[int, int] = {}
        self._inflight: dict[int, Future] = {}
        self._started = False

    def start(self) -> None:
        with self._lock:
            if self._executor is None:
                workers = _max_workers()
                self._executor = ThreadPoolExecutor(
                    max_workers=workers,
                    thread_name_prefix="ge-zip",
                )
                logger.info("Gravação Externa ZIP worker iniciado (max_workers=%s)", workers)
            self._started = True

    def _ensure_executor(self) -> ThreadPoolExecutor:
        with self._lock:
            if self._executor is None:
                self.start()
            assert self._executor is not None
            return self._executor

    def _bump_gen(self, session_id: int) -> int:
        nxt = self._gen.get(session_id, 0) + 1
        self._gen[session_id] = nxt
        return nxt

    def is_stale(self, session_id: int, job_gen: int) -> bool:
        with self._lock:
            return self._gen.get(session_id, 0) != int(job_gen)

    def enqueue(self, session_id: int, signature: str) -> bool:
        executor = self._ensure_executor()
        with self._lock:
            job_gen = self._bump_gen(session_id)
            future = executor.submit(self._run_job, int(session_id), signature, job_gen)
            self._inflight[session_id] = future

            def _cleanup(fut: Future, sid: int = session_id) -> None:
                with self._lock:
                    cur = self._inflight.get(sid)
                    if cur is fut:
                        self._inflight.pop(sid, None)

            future.add_done_callback(_cleanup)
        return True

    def _run_job(self, session_id: int, signature: str, job_gen: int) -> None:
        if self.is_stale(session_id, job_gen):
            return
        if not _claim_zip_job(session_id, signature):
            return
        if self.is_stale(session_id, job_gen):
            return

        dest = zip_dest_path(session_id, signature)
        part = Path(_part_path(str(dest)))
        _unlink_quiet(str(part))

        def _abort() -> bool:
            return self.is_stale(session_id, job_gen)

        last_progress_at = 0.0

        def _on_progress(done: int, total: int, bytes_prontos: int) -> None:
            nonlocal last_progress_at
            if _abort():
                return
            now = time.monotonic()
            if done < total and (now - last_progress_at) < _PROGRESS_MIN_INTERVAL_S:
                return
            last_progress_at = now
            try:
                _update_progress(session_id, signature, done, bytes_prontos)
            except Exception as exc:
                logger.debug("ZIP GE: falha ao gravar progresso sessão %s: %s", session_id, exc)

        try:
            row = get_zip_row(session_id)
            if not row or row.get("assinatura") != signature:
                return
            session = get_session_by_id(session_id)
            if not session:
                _finalize_error(session_id, signature, "Sessão não encontrada.")
                return

            result = write_session_arquivos_zip(
                session,
                str(part),
                on_progress=_on_progress,
                should_abort=_abort,
            )
            if _abort():
                _unlink_quiet(str(part))
                return
            os.replace(str(part), str(dest))
            ok = _finalize_ready(
                session_id,
                signature,
                str(dest),
                str(result["filename"]),
                int(result["tamanho_bytes"]),
                int(result["total_arquivos"]),
                int(result.get("bytes_prontos") or result["tamanho_bytes"]),
            )
            if not ok:
                _unlink_quiet(str(dest))
                logger.info("ZIP GE: job obsoleto descartado sessão %s", session_id)
            else:
                logger.info("ZIP GE: pronto sessão %s (%s bytes)", session_id, result["tamanho_bytes"])
                try:
                    purge_expired_zips()
                except Exception:
                    pass
        except ZipBuildCancelled:
            _unlink_quiet(str(part))
            logger.info("ZIP GE: montagem cancelada sessão %s", session_id)
        except HTTPException as exc:
            _unlink_quiet(str(part))
            if _abort():
                return
            detail = exc.detail if isinstance(exc.detail, str) else "Falha ao gerar o ZIP."
            _finalize_error(session_id, signature, detail)
        except Exception as exc:
            _unlink_quiet(str(part))
            logger.exception("ZIP GE: falha no job sessão %s: %s", session_id, exc)
            if _abort():
                return
            _finalize_error(session_id, signature, "Falha ao gerar o ZIP dos arquivos.")


_runtime = _ZipJobRuntime()


def enqueue_zip_job(session: dict[str, Any]) -> dict[str, Any]:
    """Garante um job para a assinatura atual. Reusa ZIP pronto quando válido."""
    session_id = int(session["id"])
    arquivos = _fetch_arquivos(session_id)
    if not arquivos:
        raise HTTPException(status_code=404, detail="Nenhum arquivo para download.")

    signature = compute_arquivos_signature(arquivos)
    filename = session_zip_filename(session)
    existing = get_zip_row(session_id)

    if existing and existing.get("assinatura") == signature:
        if existing["status"] == ZIP_READY:
            path = existing.get("arquivo_path")
            if path and os.path.isfile(path):
                touch_zip_last_access(session_id)
                return public_zip_status(existing)
            logger.warning("ZIP GE: arquivo ausente no disco, regenerando sessão %s", session_id)
        elif existing["status"] == ZIP_GENERATING:
            return public_zip_status(existing)
        elif existing["status"] == ZIP_PENDING:
            _runtime.enqueue(session_id, signature)
            return public_zip_status(existing)

    if existing and existing.get("arquivo_path"):
        _unlink_quiet(str(existing["arquivo_path"]))
        _unlink_quiet(_part_path(str(existing["arquivo_path"])))

    _upsert_pending(session_id, signature, filename, len(arquivos))
    _runtime.enqueue(session_id, signature)
    row = get_zip_row(session_id)
    if not row:
        raise HTTPException(status_code=500, detail="Falha ao registrar o ZIP.")
    return public_zip_status(row)


def get_zip_job_status(session: dict[str, Any]) -> dict[str, Any]:
    row = get_zip_row(int(session["id"]))
    if not row:
        raise HTTPException(status_code=404, detail="Nenhum ZIP em preparação.")
    if row["status"] == ZIP_READY:
        path = row.get("arquivo_path")
        if not path or not os.path.isfile(path):
            return enqueue_zip_job(session)
        touch_zip_last_access(int(session["id"]))
        row = get_zip_row(int(session["id"])) or row
    return public_zip_status(row)


def resolve_ready_zip(session: dict[str, Any]) -> Optional[dict[str, Any]]:
    row = get_zip_row(int(session["id"]))
    if not row or row["status"] != ZIP_READY:
        return None
    path = row.get("arquivo_path")
    if not path or not os.path.isfile(path):
        return None
    return row


def start_zip_job_runtime() -> None:
    _runtime.start()


def recover_zip_jobs() -> dict[str, Any]:
    """No startup: gerando órfãos → pendente; reenfileira pendente; limpa .part."""
    _runtime.start()
    reset = 0
    enqueued = 0
    try:
        cache = zip_cache_dir()
        for leftover in cache.glob("*.zip.part"):
            _unlink_quiet(str(leftover))
        reset = _reset_generating_to_pending()
        pending = list_zip_jobs(statuses=[ZIP_PENDING])
        for job in pending:
            if _runtime.enqueue(int(job["gravacao_externa_id"]), str(job["assinatura"])):
                enqueued += 1
        purge_expired_zips()
    except Exception as exc:
        logger.error("ZIP GE: falha na recuperação de jobs: %s", exc, exc_info=True)
    return {"resetRunning": reset, "enqueued": enqueued}
