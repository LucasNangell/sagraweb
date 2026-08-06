"""
Histórico de duração das verificações de pré-análise para estimativa de tempo restante.

- Amostras por lote (tab_pre_analise_timing) e por arquivo (tab_pre_analise_timing_file).
- Estimativa = soma por arquivo (páginas × formato × check), com mediana e ms/página.
- Falhas de banco não interrompem a análise.
"""
from __future__ import annotations

import logging
import statistics
import time
from typing import Any, Dict, List, Optional, Tuple

from services.pre_analise.pdf_utils import max_page_dimensions_mm

logger = logging.getLogger(__name__)

_table_ready = False
_insert_counter = 0

_DEFAULT_CHECK_FRACTION = 0.42
_DEFAULT_SETUP_BASE_SEC = 1.8
_DEFAULT_SETUP_PER_PDF_SEC = 0.35
_DEFAULT_SETUP_PER_PAGE_SEC = 0.04

_RETENTION_BATCH_ROWS = 2500
_RETENTION_FILE_ROWS = 8000
_PRUNE_EVERY_INSERTS = 6

# Peso histórico vs ritmo da execução atual (por check_id)
_CHECK_BLEND_HIST: Dict[str, float] = {
    "formato": 0.55,
    "sangria_bleed": 0.48,
    "cores_colorcheck": 0.5,
    "imagens_baixa_resolucao": 0.5,
    "raster_parcial": 0.38,
}


def ensure_timing_table() -> None:
    global _table_ready
    if _table_ready:
        return
    try:
        from database import db

        db.execute_query(
            """
            CREATE TABLE IF NOT EXISTS tab_pre_analise_timing (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                check_id VARCHAR(64) NOT NULL,
                pdf_count INT NOT NULL DEFAULT 0,
                total_pages INT NOT NULL DEFAULT 0,
                formato_bucket VARCHAR(32) NOT NULL DEFAULT 'unknown',
                duration_ms INT NOT NULL,
                phase VARCHAR(16) NOT NULL DEFAULT 'check',
                sampled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_timing_lookup (
                    check_id, formato_bucket, pdf_count, total_pages, sampled_at
                ),
                INDEX idx_timing_setup (phase, formato_bucket, pdf_count, sampled_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            """
        )
        db.execute_query(
            """
            CREATE TABLE IF NOT EXISTS tab_pre_analise_timing_file (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                check_id VARCHAR(64) NOT NULL,
                pdf_name VARCHAR(255) NOT NULL,
                page_count INT NOT NULL,
                formato_bucket VARCHAR(32) NOT NULL DEFAULT 'unknown',
                duration_ms INT NOT NULL,
                ms_per_page INT NOT NULL DEFAULT 0,
                sampled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_file_timing (
                    check_id, formato_bucket, page_count, sampled_at
                ),
                INDEX idx_file_name (check_id, pdf_name(64), page_count)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            """
        )
        _table_ready = True
        logger.info("Tabelas tab_pre_analise_timing* verificadas/criadas")
    except Exception as exc:
        logger.warning("Não foi possível garantir tabelas de timing: %s", exc)


def _bucket_single(altura_mm: float, largura_mm: float) -> str:
    short, long = sorted([float(altura_mm), float(largura_mm)])
    if short <= 155 and long <= 220:
        return "A5"
    if short <= 215 and long <= 300:
        return "A4"
    if short <= 300 and long <= 430:
        return "A3"
    if long > 450:
        return "large"
    return "custom"


def formato_bucket_from_info(info: Dict[str, Any]) -> str:
    if info.get("error"):
        return "unknown"
    dims = max_page_dimensions_mm([info])
    if dims:
        return _bucket_single(dims[0], dims[1])
    return "unknown"


def formato_bucket_from_pdf_infos(pdf_infos: List[Dict[str, Any]]) -> str:
    dims_list: List[Tuple[float, float]] = []
    for info in pdf_infos or []:
        if info.get("error"):
            continue
        one = max_page_dimensions_mm([info])
        if one:
            dims_list.append(one)

    if not dims_list:
        return "unknown"

    if len(dims_list) > 1:
        buckets = {_bucket_single(d[0], d[1]) for d in dims_list}
        if len(buckets) > 1:
            return "mixed"

    return _bucket_single(dims_list[0][0], dims_list[0][1])


def file_workloads_from_pdf_infos(
    pdf_infos: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    files: List[Dict[str, Any]] = []
    for info in pdf_infos or []:
        name = str(info.get("name") or "")
        if info.get("error"):
            pages = 1
        else:
            pages = max(1, int(info.get("page_count") or 1))
        files.append(
            {
                "name": name,
                "page_count": pages,
                "formato_bucket": formato_bucket_from_info(info),
            }
        )
    return files


def workload_from_pdf_infos(pdf_infos: List[Dict[str, Any]]) -> Dict[str, Any]:
    files = file_workloads_from_pdf_infos(pdf_infos)
    ok_files = [f for f in files if f.get("name")]
    pdf_count = len([i for i in (pdf_infos or []) if not i.get("error")])
    if pdf_count == 0:
        pdf_count = len(pdf_infos or []) or len(files)
    total_pages = sum(int(i.get("page_count") or 0) for i in (pdf_infos or []))
    if total_pages <= 0 and files:
        total_pages = sum(f["page_count"] for f in files)
    return {
        "pdf_count": max(pdf_count, 1),
        "total_pages": max(total_pages, 1),
        "formato_bucket": formato_bucket_from_pdf_infos(pdf_infos),
        "files": files if files else [{"name": "", "page_count": 1, "formato_bucket": "unknown"}],
    }


def _page_band(total_pages: int) -> Tuple[int, int]:
    tp = max(1, int(total_pages))
    low = max(1, int(tp * 0.65))
    high = max(low, int(tp * 1.35) + 1)
    return low, high


def _page_band_file(pages: int) -> Tuple[int, int]:
    p = max(1, int(pages))
    low = max(1, int(p * 0.75))
    high = max(low, int(p * 1.25) + 1)
    return low, high


def _pdf_band(pdf_count: int) -> Tuple[int, int]:
    pc = max(1, int(pdf_count))
    return max(1, pc - 1), pc + 1


def _median_ms(samples: List[int]) -> Optional[float]:
    if not samples:
        return None
    if len(samples) == 1:
        return float(samples[0])
    return float(statistics.median(samples))


def _median_ms_per_page(rows: List[Dict[str, Any]]) -> Optional[float]:
    rates: List[float] = []
    for r in rows:
        ms = int(r.get("duration_ms") or 0)
        pages = max(1, int(r.get("page_count") or 1))
        if ms > 0:
            rates.append(ms / pages)
    if not rates:
        return None
    return float(statistics.median(rates))


def _fetch_duration_ms(
    check_id: Optional[str],
    phase: str,
    workload: Dict[str, Any],
    limit: int = 40,
) -> Optional[float]:
    ensure_timing_table()
    try:
        from database import db

        pdf_lo, pdf_hi = _pdf_band(workload["pdf_count"])
        page_lo, page_hi = _page_band(workload["total_pages"])
        bucket = workload["formato_bucket"]

        if phase == "setup":
            rows = db.execute_query(
                """
                SELECT duration_ms FROM tab_pre_analise_timing
                WHERE phase = 'setup'
                  AND formato_bucket = %(bucket)s
                  AND pdf_count BETWEEN %(pdf_lo)s AND %(pdf_hi)s
                  AND total_pages BETWEEN %(page_lo)s AND %(page_hi)s
                ORDER BY sampled_at DESC
                LIMIT %(lim)s
                """,
                {
                    "bucket": bucket,
                    "pdf_lo": pdf_lo,
                    "pdf_hi": pdf_hi,
                    "page_lo": page_lo,
                    "page_hi": page_hi,
                    "lim": limit,
                },
            )
        else:
            rows = db.execute_query(
                """
                SELECT duration_ms FROM tab_pre_analise_timing
                WHERE phase = 'check'
                  AND check_id = %(check_id)s
                  AND formato_bucket = %(bucket)s
                  AND pdf_count BETWEEN %(pdf_lo)s AND %(pdf_hi)s
                  AND total_pages BETWEEN %(page_lo)s AND %(page_hi)s
                ORDER BY sampled_at DESC
                LIMIT %(lim)s
                """,
                {
                    "check_id": check_id,
                    "bucket": bucket,
                    "pdf_lo": pdf_lo,
                    "pdf_hi": pdf_hi,
                    "page_lo": page_lo,
                    "page_hi": page_hi,
                    "lim": limit,
                },
            )

        samples = [int(r["duration_ms"]) for r in (rows or []) if r.get("duration_ms")]
        med = _median_ms(samples)
        if med is not None:
            return med

        if phase == "check":
            rows = db.execute_query(
                """
                SELECT duration_ms FROM tab_pre_analise_timing
                WHERE phase = 'check' AND check_id = %(check_id)s
                  AND pdf_count BETWEEN %(pdf_lo)s AND %(pdf_hi)s
                  AND total_pages BETWEEN %(page_lo)s AND %(page_hi)s
                ORDER BY sampled_at DESC
                LIMIT %(lim)s
                """,
                {
                    "check_id": check_id,
                    "pdf_lo": pdf_lo,
                    "pdf_hi": pdf_hi,
                    "page_lo": page_lo,
                    "page_hi": page_hi,
                    "lim": limit,
                },
            )
            samples = [int(r["duration_ms"]) for r in (rows or []) if r.get("duration_ms")]
            return _median_ms(samples)
        return None
    except Exception as exc:
        logger.debug("Consulta timing lote falhou: %s", exc)
        return None


def _fetch_file_duration_ms(
    check_id: str, file_wl: Dict[str, Any], limit: int = 35
) -> Optional[float]:
    ensure_timing_table()
    try:
        from database import db

        page_lo, page_hi = _page_band_file(file_wl["page_count"])
        bucket = file_wl["formato_bucket"]

        rows = db.execute_query(
            """
            SELECT duration_ms, page_count FROM tab_pre_analise_timing_file
            WHERE check_id = %(check_id)s
              AND formato_bucket = %(bucket)s
              AND page_count BETWEEN %(page_lo)s AND %(page_hi)s
            ORDER BY sampled_at DESC
            LIMIT %(lim)s
            """,
            {
                "check_id": check_id,
                "bucket": bucket,
                "page_lo": page_lo,
                "page_hi": page_hi,
                "lim": limit,
            },
        )
        samples = [int(r["duration_ms"]) for r in (rows or []) if r.get("duration_ms")]
        med = _median_ms(samples)
        if med is not None:
            return med

        rate = _median_ms_per_page(rows or [])
        if rate is not None:
            return rate * file_wl["page_count"]

        rows = db.execute_query(
            """
            SELECT duration_ms, page_count FROM tab_pre_analise_timing_file
            WHERE check_id = %(check_id)s
              AND page_count BETWEEN %(page_lo)s AND %(page_hi)s
            ORDER BY sampled_at DESC
            LIMIT %(lim)s
            """,
            {
                "check_id": check_id,
                "page_lo": page_lo,
                "page_hi": page_hi,
                "lim": limit,
            },
        )
        samples = [int(r["duration_ms"]) for r in (rows or []) if r.get("duration_ms")]
        med = _median_ms(samples)
        if med is not None:
            return med
        rate = _median_ms_per_page(rows or [])
        if rate is not None:
            return rate * file_wl["page_count"]
        return None
    except Exception as exc:
        logger.debug("Consulta timing arquivo falhou: %s", exc)
        return None


def count_similar_samples(
    check_ids: List[str], workload: Dict[str, Any]
) -> int:
    """Quantidade de amostras por-arquivo usadas na estimativa."""
    ensure_timing_table()
    total = 0
    try:
        from database import db

        for cid in check_ids:
            for file_wl in workload.get("files") or []:
                page_lo, page_hi = _page_band_file(file_wl["page_count"])
                rows = db.execute_query(
                    """
                    SELECT COUNT(*) AS c FROM tab_pre_analise_timing_file
                    WHERE check_id = %(check_id)s
                      AND formato_bucket = %(bucket)s
                      AND page_count BETWEEN %(page_lo)s AND %(page_hi)s
                    """,
                    {
                        "check_id": cid,
                        "bucket": file_wl["formato_bucket"],
                        "page_lo": page_lo,
                        "page_hi": page_hi,
                    },
                )
                total += int((rows or [{}])[0].get("c") or 0)
        return total
    except Exception:
        return 0


def _default_check_sec(check_id: str) -> float:
    from services.pre_analise.registry import CHECKS

    meta = CHECKS.get(check_id) or {}
    timeout = float(meta.get("timeout_sec") or 8.0)
    return max(2.0, timeout * _DEFAULT_CHECK_FRACTION)


def _default_file_sec(check_id: str, file_wl: Dict[str, Any], workload: Dict[str, Any]) -> float:
    total_pages = max(1, int(workload.get("total_pages") or 1))
    share = file_wl["page_count"] / total_pages
    return max(0.35, _default_check_sec(check_id) * share)


def estimate_file_check_seconds(
    check_id: str, file_wl: Dict[str, Any], workload: Dict[str, Any]
) -> float:
    med_ms = _fetch_file_duration_ms(check_id, file_wl)
    if med_ms is not None and med_ms > 0:
        return max(0.25, med_ms / 1000.0)

    batch_ms = _fetch_duration_ms(check_id, "check", workload, limit=15)
    if batch_ms and workload.get("total_pages"):
        share = file_wl["page_count"] / max(1, workload["total_pages"])
        return max(0.25, (batch_ms / 1000.0) * share)

    return _default_file_sec(check_id, file_wl, workload)


def estimate_check_seconds(check_id: str, workload: Dict[str, Any]) -> float:
    files = workload.get("files") or []
    if not files:
        med_ms = _fetch_duration_ms(check_id, "check", workload)
        if med_ms is not None and med_ms > 0:
            return med_ms / 1000.0
        return _default_check_sec(check_id)

    total = sum(
        estimate_file_check_seconds(check_id, f, workload) for f in files
    )
    return max(0.5, total)


def estimate_setup_seconds(workload: Dict[str, Any]) -> float:
    med_ms = _fetch_duration_ms(None, "setup", workload)
    if med_ms is not None and med_ms > 0:
        return med_ms / 1000.0
    return (
        _DEFAULT_SETUP_BASE_SEC
        + workload["pdf_count"] * _DEFAULT_SETUP_PER_PDF_SEC
        + workload["total_pages"] * _DEFAULT_SETUP_PER_PAGE_SEC
    )


def build_estimate_payload(
    check_ids: List[str], workload: Dict[str, Any]
) -> Dict[str, Any]:
    setup_sec = estimate_setup_seconds(workload)
    per_check: List[Dict[str, Any]] = []
    per_file: List[Dict[str, Any]] = []
    total = setup_sec
    has_history = False

    for cid in check_ids:
        check_sec = 0.0
        for f in workload.get("files") or []:
            if _fetch_file_duration_ms(cid, f, limit=3):
                has_history = True
            fsec = estimate_file_check_seconds(cid, f, workload)
            check_sec += fsec
            if f.get("name"):
                per_file.append(
                    {
                        "check_id": cid,
                        "name": f["name"],
                        "estimate_sec": round(fsec, 2),
                        "page_count": f["page_count"],
                        "formato_bucket": f["formato_bucket"],
                    }
                )
        if check_sec <= 0:
            check_sec = estimate_check_seconds(cid, workload)
        per_check.append({"check_id": cid, "estimate_sec": round(check_sec, 2)})
        total += check_sec

    sample_count = count_similar_samples(check_ids, workload)
    if sample_count > 0:
        has_history = True

    return {
        "total_sec": round(total, 1),
        "setup_sec": round(setup_sec, 1),
        "per_check": per_check,
        "per_file": per_file,
        "workload": workload,
        "has_history": has_history,
        "sample_count": sample_count,
    }


def _maybe_prune() -> None:
    global _insert_counter
    _insert_counter += 1
    if _insert_counter % _PRUNE_EVERY_INSERTS != 0:
        return
    try:
        from database import db

        for table, cap in (
            ("tab_pre_analise_timing", _RETENTION_BATCH_ROWS),
            ("tab_pre_analise_timing_file", _RETENTION_FILE_ROWS),
        ):
            db.execute_query(
                f"""
                DELETE FROM {table}
                WHERE sampled_at < DATE_SUB(NOW(), INTERVAL 150 DAY)
                """
            )
            rows = db.execute_query(f"SELECT COUNT(*) AS c FROM {table}")
            count = int((rows or [{}])[0].get("c") or 0)
            if count > cap:
                cutoff_rows = db.execute_query(
                    f"""
                    SELECT COALESCE(MIN(id), 0) AS min_keep FROM (
                        SELECT id FROM {table}
                        ORDER BY sampled_at DESC
                        LIMIT %(cap)s
                    ) recent
                    """,
                    {"cap": cap},
                )
                min_keep = int((cutoff_rows or [{}])[0].get("min_keep") or 0)
                if min_keep > 0:
                    db.execute_query(
                        f"DELETE FROM {table} WHERE id < %(min_keep)s",
                        {"min_keep": min_keep},
                    )
    except Exception as exc:
        logger.debug("Prune timing ignorado: %s", exc)


def record_timing_sample(
    check_id: Optional[str],
    phase: str,
    workload: Dict[str, Any],
    duration_sec: float,
) -> None:
    if duration_sec <= 0:
        return
    ensure_timing_table()
    try:
        from database import db

        db.execute_query(
            """
            INSERT INTO tab_pre_analise_timing (
                check_id, pdf_count, total_pages, formato_bucket,
                duration_ms, phase
            ) VALUES (
                %(check_id)s, %(pdf_count)s, %(total_pages)s, %(bucket)s,
                %(duration_ms)s, %(phase)s
            )
            """,
            {
                "check_id": check_id or "",
                "pdf_count": int(workload.get("pdf_count") or 1),
                "total_pages": int(workload.get("total_pages") or 1),
                "bucket": str(workload.get("formato_bucket") or "unknown"),
                "duration_ms": int(round(duration_sec * 1000)),
                "phase": phase,
            },
        )
        _maybe_prune()
    except Exception as exc:
        logger.warning("Falha ao gravar timing pré-análise: %s", exc)


def record_file_sample(
    check_id: str,
    file_wl: Dict[str, Any],
    duration_sec: float,
) -> None:
    if duration_sec <= 0 or not file_wl.get("name"):
        return
    ensure_timing_table()
    pages = max(1, int(file_wl.get("page_count") or 1))
    try:
        from database import db

        db.execute_query(
            """
            INSERT INTO tab_pre_analise_timing_file (
                check_id, pdf_name, page_count, formato_bucket,
                duration_ms, ms_per_page
            ) VALUES (
                %(check_id)s, %(pdf_name)s, %(page_count)s, %(bucket)s,
                %(duration_ms)s, %(ms_per_page)s
            )
            """,
            {
                "check_id": check_id,
                "pdf_name": str(file_wl["name"])[:255],
                "page_count": pages,
                "bucket": str(file_wl.get("formato_bucket") or "unknown"),
                "duration_ms": int(round(duration_sec * 1000)),
                "ms_per_page": int(round(duration_sec * 1000 / pages)),
            },
        )
    except Exception as exc:
        logger.warning("Falha ao gravar timing por arquivo: %s", exc)


def record_check_sample(
    check_id: str, workload: Dict[str, Any], duration_sec: float
) -> None:
    record_timing_sample(check_id, "check", workload, duration_sec)
    files = workload.get("files") or []
    if not files:
        return
    total_pages = sum(max(1, int(f.get("page_count") or 1)) for f in files)
    for f in files:
        share = duration_sec * (max(1, int(f.get("page_count") or 1)) / total_pages)
        record_file_sample(check_id, f, share)


def record_setup_sample(workload: Dict[str, Any], duration_sec: float) -> None:
    record_timing_sample(None, "setup", workload, duration_sec)


class RunTimer:
    """Cronometragem com ETA por arquivo e refinamento durante o check atual."""

    def __init__(
        self,
        check_ids: List[str],
        workload: Dict[str, Any],
    ) -> None:
        self.check_ids = list(check_ids)
        self.workload = workload
        self.estimate = build_estimate_payload(check_ids, workload)
        self._started = time.perf_counter()
        self._check_actuals: List[float] = []
        self._setup_recorded = False
        self._pace_ratio = 1.0
        self._current_check_id: Optional[str] = None
        self._current_check_started: Optional[float] = None
        self._current_check_estimate: float = 0.0

    def mark_setup_done(self, setup_sec: float) -> None:
        if not self._setup_recorded and setup_sec > 0:
            record_setup_sample(self.workload, setup_sec)
            self._setup_recorded = True

    def mark_check_start(self, check_id: str) -> None:
        self._current_check_id = check_id
        self._current_check_started = time.perf_counter()
        self._current_check_estimate = estimate_check_seconds(
            check_id, self.workload
        )

    def mark_check_done(self, check_id: str, duration_sec: float) -> None:
        est = self._current_check_estimate
        self._current_check_id = None
        self._current_check_started = None
        if duration_sec > 0:
            record_check_sample(check_id, self.workload, duration_sec)
            self._check_actuals.append(duration_sec)
            if est > 0.2:
                observed = duration_sec / est
                self._pace_ratio = 0.65 * self._pace_ratio + 0.35 * min(
                    max(observed, 0.5), 2.5
                )

    def elapsed_sec(self) -> float:
        return max(0.0, time.perf_counter() - self._started)

    def _estimate_pending_checks_sec(self) -> float:
        done = len(self._check_actuals)
        pending = self.check_ids[done:]
        if self._current_check_id and pending and pending[0] == self._current_check_id:
            pending = pending[1:]

        total = 0.0
        for cid in pending:
            hist = estimate_check_seconds(cid, self.workload)
            w = _CHECK_BLEND_HIST.get(cid, 0.5)
            est = hist * w + hist * self._pace_ratio * (1.0 - w)
            total += est
        return total

    def remaining_sec(self) -> float:
        pending = self._estimate_pending_checks_sec()

        if self._current_check_id and self._current_check_started is not None:
            est = self._current_check_estimate * self._pace_ratio
            elapsed = time.perf_counter() - self._current_check_started
            # Progresso linear com piso para checks longos (ex.: raster)
            if est > 0 and elapsed < est:
                current_left = est - elapsed
            elif elapsed < est * 1.15:
                current_left = max(0.5, est * 1.15 - elapsed)
            else:
                current_left = 1.0
            pending += current_left
        elif not self._setup_recorded:
            pending += estimate_setup_seconds(self.workload) * 0.35

        return max(0.0, round(pending, 1))

    def timing_fields(self) -> Dict[str, Any]:
        return {
            "estimate_total_sec": self.estimate.get("total_sec"),
            "elapsed_sec": round(self.elapsed_sec(), 1),
            "remaining_sec": self.remaining_sec(),
            "has_timing_history": bool(self.estimate.get("has_history")),
            "timing_sample_count": int(self.estimate.get("sample_count") or 0),
        }
