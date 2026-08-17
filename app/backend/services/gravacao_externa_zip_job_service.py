"""
Fila em background para montar o ZIP de Gravação Externa.

Roda dentro do processo da API (ThreadPoolExecutor). A request HTTP só
enfileira / consulta status / serve o arquivo pronto (com Range).
"""
from __future__ import annotations

import logging
import os
import shutil
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
    ZipFileWriteError,
    ZipFilesPrecheckError,
    _fetch_arquivos,
    compute_arquivos_signature,
    get_session_by_id,
    precheck_session_arquivos_zip,
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
_DEFAULT_MIN_FREE_GB = 5.0
_ZIP_ENTRY_OVERHEAD_BYTES = 64 * 1024


class ZipSpaceError(Exception):
    """Espaço insuficiente no volume do cache de ZIP."""

    def __init__(
        self,
        *,
        needed_bytes: int,
        free_bytes: int,
        reserve_bytes: int,
        cache_dir: str,
        volume: str,
    ) -> None:
        self.needed_bytes = int(needed_bytes)
        self.free_bytes = int(free_bytes)
        self.reserve_bytes = int(reserve_bytes)
        self.cache_dir = str(cache_dir)
        self.volume = str(volume)
        super().__init__(
            f"Sem espaço em {volume} ({cache_dir}): necessário {_format_gb(needed_bytes)}, "
            f"livre {_format_gb(free_bytes)}."
        )


def _format_gb(num_bytes: int) -> str:
    gb = max(0, int(num_bytes)) / (1024 ** 3)
    if gb >= 10:
        return f"{gb:.1f} GB"
    if gb >= 1:
        return f"{gb:.2f} GB"
    mb = max(0, int(num_bytes)) / (1024 ** 2)
    if mb >= 1:
        return f"{mb:.0f} MB"
    return f"{max(0, int(num_bytes))} B"


def _min_free_bytes() -> int:
    raw = (os.environ.get("SAGRA_GE_ZIP_MIN_FREE_GB") or "").strip()
    try:
        gb = float(raw) if raw else _DEFAULT_MIN_FREE_GB
    except ValueError:
        gb = _DEFAULT_MIN_FREE_GB
    return int(max(0.5, gb) * (1024 ** 3))


def _volume_label(path: Path) -> str:
    try:
        drive = path.drive
        if drive:
            return drive.upper()
    except OSError:
        pass
    return str(path.anchor or path)


def _disk_stats_for(path: Path) -> dict[str, Any]:
    usage = shutil.disk_usage(str(path))
    return {
        "cache_dir": str(path),
        "volume": _volume_label(path),
        "total_bytes": int(usage.total),
        "free_bytes": int(usage.free),
        "used_bytes": int(usage.total - usage.free),
    }


def estimate_zip_bytes(arquivos: list[dict[str, Any]], session: dict[str, Any] | None = None) -> int:
    total = 0
    for arquivo in arquivos:
        size = int(arquivo.get("tamanho_bytes") or 0)
        if size <= 0 and session is not None:
            try:
                from services.gravacao_externa_service import resolve_arquivo_absolute_path

                path = resolve_arquivo_absolute_path(session, arquivo)
                if os.path.isfile(path):
                    size = int(os.path.getsize(path))
            except Exception:
                size = 0
        total += max(0, size) + _ZIP_ENTRY_OVERHEAD_BYTES
    return max(total, _ZIP_ENTRY_OVERHEAD_BYTES)


def _purge_orphan_parts(cache: Path) -> int:
    removed = 0
    for leftover in cache.glob("*.zip.part"):
        _unlink_quiet(str(leftover))
        removed += 1
    return removed


def _zip_row_file_size(row: dict[str, Any]) -> int:
    path = row.get("arquivo_path")
    size = int(row.get("tamanho_bytes") or 0)
    if path and os.path.isfile(path):
        try:
            size = int(os.path.getsize(path))
        except OSError:
            pass
    return max(0, size)


def ensure_space_for(
    needed_bytes: int,
    *,
    session_id: int | None = None,
    aggressive: bool = False,
) -> None:
    """Garante espaço livre no volume do cache (reserva + ZIP estimado)."""
    cache = zip_cache_dir()
    reserve = _min_free_bytes()
    target_free = int(needed_bytes) + reserve

    def _free_now() -> int:
        return int(shutil.disk_usage(str(cache)).free)

    free = _free_now()
    if free >= target_free:
        return

    purge_expired_zips()
    _purge_orphan_parts(cache)
    free = _free_now()
    if free >= target_free:
        return

    ready = list_zip_jobs(statuses=[ZIP_READY])
    sized: list[tuple[dict[str, Any], int]] = []
    for row in ready:
        if session_id is not None and int(row["gravacao_externa_id"]) == int(session_id):
            continue
        sized.append((row, _zip_row_file_size(row)))
    sized.sort(key=lambda item: str(item[0].get("ultimo_acesso_em") or ""))

    for row, size in sized:
        if free >= target_free:
            break
        _purge_row(row)
        free += size

    if free >= target_free:
        return

    if aggressive:
        for row, size in sized:
            if free >= target_free:
                break
            if int(row["gravacao_externa_id"]) == int(session_id or -1):
                continue
            _purge_row(row)
            free += size

    if free >= target_free:
        return

    stats = _disk_stats_for(cache)
    raise ZipSpaceError(
        needed_bytes=int(needed_bytes),
        free_bytes=int(free),
        reserve_bytes=int(reserve),
        cache_dir=str(stats["cache_dir"]),
        volume=str(stats["volume"]),
    )


def _describe_zip_failure(
    exc: BaseException,
    *,
    session_id: int | None = None,
    cache_dir: str | None = None,
) -> tuple[str, str, str]:
    cache_path = Path(cache_dir or str(zip_cache_dir()))
    stats = _disk_stats_for(cache_path)
    volume = str(stats["volume"])
    folder = str(stats["cache_dir"])

    if isinstance(exc, ZipSpaceError):
        msg = (
            f"[SEM_ESPACO] Sem espaço no volume {exc.volume} para montar o ZIP "
            f"(pasta {exc.cache_dir}). Necessário {_format_gb(exc.needed_bytes + exc.reserve_bytes)}, "
            f"livre {_format_gb(exc.free_bytes)}."
        )
        detail = (
            f"needed_bytes={exc.needed_bytes};reserve_bytes={exc.reserve_bytes};"
            f"free_bytes={exc.free_bytes};cache_dir={exc.cache_dir};volume={exc.volume}"
        )
        return "SEM_ESPACO", msg, detail

    if isinstance(exc, ZipFilesPrecheckError):
        parts: list[str] = []
        for nome, path in exc.missing:
            parts.append(f'"{nome}" em {path}')
        for nome, path, reason in exc.inaccessible:
            loc = f" ({path})" if path else ""
            parts.append(f'"{nome}"{loc}: {reason}')
        joined = "; ".join(parts[:5])
        extra = ""
        total_issues = len(exc.missing) + len(exc.inaccessible)
        if total_issues > 5:
            extra = f" (+{total_issues - 5} outros)"
        msg = (
            f"[ARQUIVO_AUSENTE] {total_issues} arquivo(s) indisponível(is) de {exc.total} "
            f"antes de montar o ZIP: {joined}{extra}."
        )
        detail = f"missing={len(exc.missing)};inaccessible={len(exc.inaccessible)};total={exc.total}"
        return "ARQUIVO_AUSENTE", msg, detail

    if isinstance(exc, ZipFileWriteError):
        inner = exc.original
        code, base_msg, inner_detail = _describe_zip_failure(inner, session_id=session_id, cache_dir=folder)
        msg = (
            f"{base_msg} Falhou no arquivo {exc.index}/{exc.total} "
            f'"{exc.nome}" ({exc.caminho}).'
        )
        detail = (
            f"file_index={exc.index};file_total={exc.total};file_name={exc.nome};"
            f"file_path={exc.caminho};{inner_detail}"
        )
        return code, msg, detail

    if isinstance(exc, HTTPException):
        detail_text = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
        lower = detail_text.lower()
        if "não encontrado" in lower or "nao encontrado" in lower:
            return "ARQUIVO_AUSENTE", f"[ARQUIVO_AUSENTE] {detail_text}", detail_text
        if "acesso negado" in lower or "permiss" in lower:
            return "ACESSO_NEGADO", f"[ACESSO_NEGADO] {detail_text}", detail_text
        return "CAMINHO_INVALIDO", f"[CAMINHO_INVALIDO] {detail_text}", detail_text

    winerr = getattr(exc, "winerror", None)
    errno = getattr(exc, "errno", None)
    if errno == 28 or winerr == 112:
        msg = (
            f"[SEM_ESPACO] Sem espaço no volume {volume} para montar o ZIP (pasta {folder}). "
            f"Livre {_format_gb(int(stats['free_bytes']))}."
        )
        return "SEM_ESPACO", msg, f"errno={errno};winerror={winerr};free_bytes={stats['free_bytes']}"

    if winerr == 5 or errno == 13:
        msg = f"[ACESSO_NEGADO] Permissão negada ao gravar o ZIP em {folder}."
        return "ACESSO_NEGADO", msg, str(exc)

    if winerr in (53, 59, 64, 1231) or errno in (53, 54, 111):
        msg = f"[FALHA_REDE_ARQUIVO] Falha de rede ao ler arquivo de origem: {exc}"
        return "FALHA_REDE_ARQUIVO", msg, str(exc)

    exc_name = type(exc).__name__.lower()
    if "operationalerror" in exc_name or "database" in exc_name:
        return "BANCO_INDISPONIVEL", f"[BANCO_INDISPONIVEL] Falha ao consultar o banco: {exc}", str(exc)

    if isinstance(exc, PermissionError):
        msg = f"[PASTA_ZIP_INVALIDA] Sem permissão de escrita em {folder}."
        return "PASTA_ZIP_INVALIDA", msg, str(exc)

    if isinstance(exc, OSError) and "No space left on device" in str(exc):
        msg = (
            f"[SEM_ESPACO] Sem espaço no volume {volume} para montar o ZIP (pasta {folder}). "
            f"Livre {_format_gb(int(stats['free_bytes']))}."
        )
        return "SEM_ESPACO", msg, str(exc)

    msg = f"[ERRO_INESPERADO] Falha ao gerar o ZIP dos arquivos: {exc}"
    sid = f";session_id={session_id}" if session_id is not None else ""
    return "ERRO_INESPERADO", msg, f"{type(exc).__name__}: {exc}{sid}"


def _finalize_error_from_exception(
    session_id: int,
    signature: str,
    exc: BaseException,
) -> None:
    codigo, mensagem, detalhe = _describe_zip_failure(exc, session_id=session_id)
    _finalize_error(session_id, signature, mensagem, erro_codigo=codigo, erro_detalhe=detalhe)


def log_zip_cache_startup_info() -> None:
    try:
        cache = zip_cache_dir()
        stats = _disk_stats_for(cache)
        logger.info(
            "ZIP GE: cache em %s (%s) — livre %s / total %s",
            stats["cache_dir"],
            stats["volume"],
            _format_gb(int(stats["free_bytes"])),
            _format_gb(int(stats["total_bytes"])),
        )
        test_file = cache / ".write_test"
        test_file.write_bytes(b"ok")
        test_file.unlink(missing_ok=True)
    except Exception as exc:
        codigo, msg, _detail = _describe_zip_failure(exc)
        logger.error("ZIP GE: pasta de cache inválida (%s): %s", codigo, msg)


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
        "erro_codigo": row.get("ErroCodigo"),
        "erro_detalhe": row.get("ErroDetalhe"),
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
        "erro_codigo": row.get("erro_codigo"),
        "erro_detalhe": row.get("erro_detalhe"),
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
              ErroCodigo = NULL,
              ErroDetalhe = NULL,
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
            SET Status = %s, Erro = NULL, ErroCodigo = NULL, ErroDetalhe = NULL
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
                ErroCodigo = NULL,
                ErroDetalhe = NULL,
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


def _finalize_error(
    session_id: int,
    signature: str,
    message: str,
    *,
    erro_codigo: str | None = None,
    erro_detalhe: str | None = None,
) -> None:
    db.execute_query(
        """
        UPDATE tab_os_gravacao_externa_zip
        SET Status = %s,
            Erro = %s,
            ErroCodigo = %s,
            ErroDetalhe = %s
        WHERE GravacaoExternaId = %s
          AND Assinatura = %s
          AND Status IN (%s, %s)
        """,
        (
            ZIP_ERROR,
            (message or "Falha ao gerar o ZIP.")[:512],
            (erro_codigo or None),
            (erro_detalhe or None),
            int(session_id),
            signature,
            ZIP_GENERATING,
            ZIP_PENDING,
        ),
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
    parts_removed = 0
    ttl = zip_ttl_hours()
    try:
        parts_removed = _purge_orphan_parts(zip_cache_dir())
    except Exception as exc:
        logger.warning("Purga de .part órfãos ZIP GE falhou: %s", exc)
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

    return {"expired": expired, "evicted": evicted, "parts_removed": parts_removed}


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
                _finalize_error(session_id, signature, "Sessão não encontrada.", erro_codigo="ERRO_INESPERADO")
                return

            arquivos = _fetch_arquivos(session_id)
            needed = estimate_zip_bytes(arquivos, session)
            ensure_space_for(needed, session_id=session_id)
            precheck_session_arquivos_zip(session, arquivos)

            result = write_session_arquivos_zip(
                session,
                str(part),
                on_progress=_on_progress,
                should_abort=_abort,
                skip_precheck=True,
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
            codigo, msg, detalhe = _describe_zip_failure(exc, session_id=session_id)
            _finalize_error(session_id, signature, msg or detail, erro_codigo=codigo, erro_detalhe=detalhe)
        except Exception as exc:
            _unlink_quiet(str(part))
            logger.exception("ZIP GE: falha no job sessão %s: %s", session_id, exc)
            if _abort():
                return
            _finalize_error_from_exception(session_id, signature, exc)


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
        elif existing["status"] == ZIP_ERROR:
            pass

    try:
        needed = estimate_zip_bytes(arquivos, session)
        ensure_space_for(needed, session_id=session_id)
        precheck_session_arquivos_zip(session, arquivos)
    except Exception as exc:
        codigo, msg, detalhe = _describe_zip_failure(exc, session_id=session_id)
        if existing and existing.get("assinatura") == signature:
            _finalize_error(session_id, signature, msg, erro_codigo=codigo, erro_detalhe=detalhe)
            row = get_zip_row(session_id)
            if row:
                return public_zip_status(row)
        raise HTTPException(status_code=507, detail=msg) from exc

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


def get_zip_diagnostics() -> dict[str, Any]:
    cache = zip_cache_dir()
    stats = _disk_stats_for(cache)
    ready = list_zip_jobs(statuses=[ZIP_READY])
    errors = list_zip_jobs(statuses=[ZIP_ERROR])
    cache_bytes = 0
    cache_files = 0
    for row in ready:
        size = _zip_row_file_size(row)
        if row.get("arquivo_path") and os.path.isfile(str(row["arquivo_path"])):
            cache_bytes += size
            cache_files += 1
    for leftover in cache.glob("*.zip.part"):
        cache_files += 1
    return {
        "cache_dir": stats["cache_dir"],
        "volume": stats["volume"],
        "total_bytes": stats["total_bytes"],
        "free_bytes": stats["free_bytes"],
        "used_bytes": stats["used_bytes"],
        "reserve_bytes": _min_free_bytes(),
        "cache_max_bytes": zip_cache_max_bytes(),
        "cache_files": cache_files,
        "cache_bytes": cache_bytes,
        "jobs_ready": len(ready),
        "jobs_error": len(errors),
        "recent_errors": [
            {
                "gravacao_externa_id": row["gravacao_externa_id"],
                "erro": row.get("erro"),
                "erro_codigo": row.get("erro_codigo"),
                "erro_detalhe": row.get("erro_detalhe"),
            }
            for row in errors[:10]
        ],
    }


def start_zip_job_runtime() -> None:
    _runtime.start()
    log_zip_cache_startup_info()


def recover_zip_jobs() -> dict[str, Any]:
    """No startup: gerando órfãos → pendente; reenfileira pendente; limpa .part."""
    _runtime.start()
    log_zip_cache_startup_info()
    reset = 0
    enqueued = 0
    parts_removed = 0
    try:
        cache = zip_cache_dir()
        parts_removed = _purge_orphan_parts(cache)
        reset = _reset_generating_to_pending()
        pending = list_zip_jobs(statuses=[ZIP_PENDING])
        for job in pending:
            if _runtime.enqueue(int(job["gravacao_externa_id"]), str(job["assinatura"])):
                enqueued += 1
        purge_expired_zips()
    except Exception as exc:
        logger.error("ZIP GE: falha na recuperação de jobs: %s", exc, exc_info=True)
    return {"resetRunning": reset, "enqueued": enqueued, "partsRemoved": parts_removed}
