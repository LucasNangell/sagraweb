import datetime
import logging
import os
import xml.etree.ElementTree as ET
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse
from database import db

router = APIRouter()
logger = logging.getLogger(__name__)

JOBS_XML_PATH = os.getenv(
    "SAGRA_CTP_JOBS_XML",
    r"\\redecamara\dfsdata\cgraf\Apogee_Files\3- PrintQ\PrintQ Jobs\Tickets.Xml",
)
PRINTED_XML_PATH = os.getenv(
    "SAGRA_CTP_PRINTED_XML",
    r"\\redecamara\dfsdata\cgraf\Apogee_Files\3- PrintQ\PrintQ PrintedJobs\Tickets.Xml",
)

JOBTICKET_BASE = os.getenv(
    "SAGRA_CTP_JOBTICKET_BASE",
    r"\\redecamara\dfsdata\cgraf\Apogee_Files\3- PrintQ\PrintQ Jobs",
)

_PRINTED_STATUS = {"printed", "done", "completed", "sucesso", "success"}


def _ensure_tables():
    """Garante que as tabelas existem para evitar 500 por tabela ausente."""
    try:
        db.execute_query(
            """
            CREATE TABLE IF NOT EXISTS ct_gravacao_jobs (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                os_ano INT NULL,
                os_numero INT NOT NULL,
                nome_original VARCHAR(255) NOT NULL,
                solicitante VARCHAR(120),
                produto VARCHAR(180),
                template VARCHAR(180),
                status_gravacao VARCHAR(50),
                prioridade INT,
                created_at DATETIME,
                printed_at DATETIME NULL,
                media_name VARCHAR(100),
                media_width INT,
                media_height INT,
                machine_serial VARCHAR(50),
                origem ENUM('JOBS','PRINTED') NOT NULL,
                hash_estado CHAR(64) NOT NULL,
                last_sync TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uk_os (os_ano, os_numero)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            """
        )
        # Garantir colunas novas em bases já existentes (ignora erro se já existir ou se IF NOT EXISTS não for suportado)
        try:
            db.execute_query("ALTER TABLE ct_gravacao_jobs ADD COLUMN IF NOT EXISTS template VARCHAR(180) AFTER produto")
        except Exception:
            try:
                db.execute_query("ALTER TABLE ct_gravacao_jobs ADD COLUMN template VARCHAR(180) AFTER produto")
            except Exception:
                pass
        try:
            db.execute_query("ALTER TABLE ct_gravacao_jobs MODIFY COLUMN produto VARCHAR(180)")
        except Exception:
            pass

        db.execute_query(
            """
            CREATE TABLE IF NOT EXISTS ct_gravacao_chapas (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                job_id BIGINT NOT NULL,
                caderno VARCHAR(20),
                cor CHAR(1),
                status_chapa VARCHAR(30),
                printed_at DATETIME NULL,
                hotplate_id VARCHAR(50),
                hash_estado CHAR(64) NOT NULL,
                last_sync TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uk_chapa (job_id, caderno, cor),
                FOREIGN KEY (job_id) REFERENCES ct_gravacao_jobs(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            """
        )

        db.execute_query(
            """
            CREATE TABLE IF NOT EXISTS ct_gravacao_eventos (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                job_id BIGINT NOT NULL,
                chapa_identificador VARCHAR(255),
                event_time DATETIME,
                event_type VARCHAR(50),
                event_text TEXT,
                hash_evento CHAR(64),
                UNIQUE KEY uk_evento (job_id, event_time, hash_evento),
                FOREIGN KEY (job_id) REFERENCES ct_gravacao_jobs(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            """
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("Erro garantindo tabelas de gravacao: %s", exc)
        raise HTTPException(status_code=500, detail="Falha ao preparar tabelas de gravacao")


def _parse_timestamp(raw: Optional[str]) -> Optional[datetime.datetime]:
    if not raw:
        return None
    value = raw.strip()
    if not value:
        return None

    candidates = [
        "%Y-%m-%dT%H:%M:%S.%f%z",
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%S.%f",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
    ]

    if value.endswith("Z"):
        value = value[:-1] + "+00:00"

    for pattern in candidates:
        try:
            return datetime.datetime.strptime(value, pattern)
        except ValueError:
            continue
    return None


def _iso(dt: Optional[datetime.datetime]) -> Optional[str]:
    if not dt:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=datetime.timezone.utc)
    return dt.astimezone(datetime.timezone.utc).isoformat()


def _detect_namespace(tag: str) -> Optional[str]:
    if tag.startswith("{") and "}" in tag:
        return tag.split("}", 1)[0][1:]
    return None


def _tag(ns: Optional[str], name: str) -> str:
    return f"{{{ns}}}{name}" if ns else name


def _infer_os(name: Optional[str]) -> Dict[str, Optional[str]]:
    if not name:
        return {"nr_os": None, "ano": None, "raw": None}

    import re

    clean = name.replace("_", " ")
    patterns = [
        r"(?P<ano>20\d{2}).{0,3}os\s*(?P<nr>\d{4,5})",
        r"(?P<ano>20\d{2}).{0,3}(?P<nr>\d{4,5})",
        r"os\s*(?P<nr>\d{4,5})",
        r"(?<!\d)(?P<nr>\d{4,5})(?!\d)",
    ]

    for pattern in patterns:
        match = re.search(pattern, clean, re.IGNORECASE)
        if match:
            nr = match.groupdict().get("nr")
            ano = match.groupdict().get("ano")
            return {"nr_os": nr, "ano": ano, "raw": name}

    return {"nr_os": None, "ano": None, "raw": name}


def _read_xml(path: str) -> ET.Element:
    if not os.path.exists(path):
        raise FileNotFoundError(f"Arquivo XML não encontrado: {path}")

    last_err: Optional[Exception] = None
    for _ in range(2):
        try:
            with open(path, "rb") as fh:
                data = fh.read()
            return ET.fromstring(data)
        except Exception as exc:  # noqa: BLE001
            last_err = exc
    raise last_err if last_err else RuntimeError("Erro desconhecido lendo XML")


def _parse_history(ticket_el: ET.Element, ns: Optional[str]) -> List[Dict[str, Any]]:
    events: List[Dict[str, Any]] = []
    for event_el in ticket_el.findall(f"{_tag(ns, 'History')}/{_tag(ns, 'Event')}"):
        raw_time = (
            event_el.attrib.get("Time")
            or event_el.attrib.get("Timestamp")
            or event_el.attrib.get("DateTime")
            or event_el.attrib.get("When")
        )
        dt = _parse_timestamp(raw_time)
        events.append(
            {
                "code": event_el.attrib.get("Code")
                or event_el.attrib.get("Status")
                or event_el.attrib.get("Event")
                or event_el.attrib.get("Name"),
                "detail": event_el.attrib.get("Description") or (event_el.text or "").strip() or None,
                "time": _iso(dt),
                "raw_time": raw_time,
                "raw": dict(event_el.attrib),
            }
        )

    events.sort(key=lambda e: e["time"] or "")
    return events


def _parse_paths(ticket_el: ET.Element, ns: Optional[str]) -> List[Dict[str, Any]]:
    paths: List[Dict[str, Any]] = []
    for path_el in ticket_el.findall(f".//{_tag(ns, 'Path')}"):
        raw_printed = (
            path_el.attrib.get("Printed")
            or path_el.attrib.get("PrintedTime")
            or path_el.attrib.get("Time")
            or path_el.attrib.get("PrintedAt")
        )
        raw_start = path_el.attrib.get("Start") or path_el.attrib.get("Started") or path_el.attrib.get("StartTime")
        paths.append(
            {
                "colour": path_el.attrib.get("Colour"),
                "status": path_el.attrib.get("Status") or path_el.attrib.get("State"),
                "printed_at": _iso(_parse_timestamp(raw_printed)),
                "printed_at_raw": raw_printed,
                "start_at": _iso(_parse_timestamp(raw_start)),
                "start_at_raw": raw_start,
                "hot_plate_id": path_el.attrib.get("HotPlateId") or path_el.attrib.get("HotPlateID"),
                "tiff": path_el.attrib.get("TiffName")
                or path_el.attrib.get("TIFFName")
                or path_el.attrib.get("Tiff")
                or path_el.attrib.get("File"),
                "raw": dict(path_el.attrib),
            }
        )
    return paths


def _normalize_ticket(ticket_el: ET.Element, ns: Optional[str], now: datetime.datetime) -> Dict[str, Any]:
    attr = ticket_el.attrib

    created_dt = _parse_timestamp(attr.get("Created"))
    printed_dt = _parse_timestamp(attr.get("Printed"))

    paths = _parse_paths(ticket_el, ns)
    history = _parse_history(ticket_el, ns)

    colours = []
    for path in paths:
        colour = path.get("colour")
        if colour and colour not in colours:
            colours.append(colour)

    printed_count = 0
    for path in paths:
        status = (path.get("status") or "").lower()
        if status in _PRINTED_STATUS or path.get("printed_at"):
            printed_count += 1

    total = len(paths) if paths else None

    elapsed_seconds = None
    if created_dt:
        base = created_dt if created_dt.tzinfo else created_dt.replace(tzinfo=datetime.timezone.utc)
        elapsed_seconds = int((now - base).total_seconds())

    duration_seconds = None
    if created_dt and printed_dt:
        c = created_dt if created_dt.tzinfo else created_dt.replace(tzinfo=datetime.timezone.utc)
        p = printed_dt if printed_dt.tzinfo else printed_dt.replace(tzinfo=datetime.timezone.utc)
        duration_seconds = max(0, int((p - c).total_seconds()))

    return {
        "name": attr.get("Name"),
        "template": attr.get("Template"),
        "priority": attr.get("Priority"),
        "status": attr.get("Status"),
        "created_at": _iso(created_dt),
        "created_at_raw": attr.get("Created"),
        "printed_at": _iso(printed_dt),
        "printed_at_raw": attr.get("Printed"),
        "media": {
            "name": attr.get("MediaName"),
            "width": attr.get("MediaWidth"),
            "height": attr.get("MediaHeight"),
        },
        "machine_serial_number": attr.get("MachineSerialNumber"),
        "paths": paths,
        "history": history,
        "colours": colours,
        "inferred_os": _infer_os(attr.get("Name")),
        "metrics": {
            "plates_total": total,
            "plates_printed": printed_count,
            "progress_pct": int((printed_count / total) * 100) if total else None,
            "elapsed_seconds": elapsed_seconds,
            "duration_seconds": duration_seconds,
        },
        "raw": dict(attr),
    }


def _parse_tickets(path: str, limit: Optional[int] = None) -> List[Dict[str, Any]]:
    root = _read_xml(path)
    ns = _detect_namespace(root.tag)
    tag_ticket = _tag(ns, "XPoseTicket")

    tickets: List[Dict[str, Any]] = []
    now = datetime.datetime.now(datetime.timezone.utc)

    for ticket_el in root.findall(tag_ticket):
        try:
            normalized = _normalize_ticket(ticket_el, ns, now)
            tickets.append(normalized)
        except Exception as exc:  # noqa: BLE001
            logger.error("Falha ao normalizar ticket: %s", exc)

    if limit and len(tickets) > limit:
        tickets = tickets[-limit:]
    return tickets


def _safe_join(base: str, *parts: str) -> str:
    # Minimal join that avoids going outside base unintentionally
    path = os.path.abspath(os.path.join(base, *parts))
    base_abs = os.path.abspath(base)
    if not path.startswith(base_abs):
        raise ValueError("Invalid path traversal")
    return path


def _parse_jobticket_events(path: str) -> List[Dict[str, Any]]:
    root = _read_xml(path)
    ns = _detect_namespace(root.tag)
    tag_ticket = _tag(ns, "XPoseTicket")
    tag_history = _tag(ns, "History")
    tag_event = _tag(ns, "Event")

    events: List[Dict[str, Any]] = []

    ticket_el = root.find(tag_ticket)
    if ticket_el is None:
        return events

    history_el = ticket_el.find(tag_history)
    if history_el is None:
        return events

    for ev in history_el.findall(tag_event):
        ev_type = ev.findtext(_tag(ns, "Type")) or ev.attrib.get("Type")
        ev_time = ev.findtext(_tag(ns, "Time")) or ev.attrib.get("Time")
        ev_text = ev.findtext(_tag(ns, "Text")) or ev.attrib.get("Text") or (ev.text or "").strip()
        dt = _parse_timestamp(ev_time)
        events.append(
            {
                "type": ev_type,
                "time": _iso(dt),
                "time_raw": ev_time,
                "text": ev_text,
                "raw": dict(ev.attrib),
            }
        )

    events.sort(key=lambda e: e["time"] or "")
    return events


@router.get("/gravacao/xpose/status")
def gravacao_xpose_status():
    """Retorna dados de gravação a partir das tabelas xpose_tickets e xpose_paths (monitorXML)."""
    try:
        # Ler tickets do banco xpose
        tickets_rows = db.execute_query("""
            SELECT id, name, nros, anoos, status, created, priority, machine, source_file, inicio, fim, last_updated
            FROM xpose_tickets
            ORDER BY last_updated DESC
            LIMIT 100
        """)
        
        # Ler paths do banco xpose
        paths_rows = db.execute_query("""
            SELECT id, ticket_name, path_name, status, colour, inicio, fim, last_updated
            FROM xpose_paths
            ORDER BY last_updated DESC
            LIMIT 500
        """)
        
        # Normalizar tickets
        tickets = []
        if tickets_rows:
            for row in tickets_rows:
                ticket = {
                    "id": row.get("id"),
                    "name": row.get("name"),
                    "nros": row.get("nros"),
                    "anoos": row.get("anoos"),
                    "nr_os": row.get("nros"),
                    "ano": row.get("anoos"),
                    "status": row.get("status"),
                    "created": row.get("created").isoformat() if row.get("created") else None,
                    "created_at": row.get("created").isoformat() if row.get("created") else None,
                    "priority": row.get("priority"),
                    "machine": row.get("machine"),
                    "source_file": row.get("source_file"),
                    "inicio": row.get("inicio").isoformat() if row.get("inicio") else None,
                    "fim": row.get("fim").isoformat() if row.get("fim") else None,
                    "last_updated": row.get("last_updated").isoformat() if row.get("last_updated") else None,
                }
                tickets.append(ticket)
        
        # Normalizar paths
        paths = []
        if paths_rows:
            for row in paths_rows:
                path = {
                    "id": row.get("id"),
                    "ticket_name": row.get("ticket_name"),
                    "path_name": row.get("path_name"),
                    "status": row.get("status"),
                    "colour": row.get("colour"),
                    "start_at": row.get("inicio").isoformat() if row.get("inicio") else None,
                    "printed_at": row.get("fim").isoformat() if row.get("fim") else None,
                    "inicio": row.get("inicio").isoformat() if row.get("inicio") else None,
                    "fim": row.get("fim").isoformat() if row.get("fim") else None,
                    "last_updated": row.get("last_updated").isoformat() if row.get("last_updated") else None,
                }
                paths.append(path)
        
        response = {
            "tickets": tickets,
            "paths": paths,
            "meta": {
                "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "source_paths": {
                    "tickets": "xpose_tickets",
                    "paths": "xpose_paths",
                },
                "errors": [],
            },
        }
        
        logger.debug(f"xpose/status: {len(tickets)} tickets, {len(paths)} paths")
        return response
    except Exception as exc:
        logger.error("Erro no endpoint xpose/status: %s", exc, exc_info=True)
        # Retornar resposta vazia ao invés de erro 500
        return {
            "tickets": [],
            "paths": [],
            "meta": {
                "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "source_paths": {
                    "tickets": "xpose_tickets",
                    "paths": "xpose_paths",
                },
                "errors": [str(exc)],
            },
        }



@router.get("/gravacao/status")
def gravacao_status(limit_printed: int = Query(120, ge=1, le=500)):
    """Retorna dados a partir do banco (ct_gravacao_*)."""
    _ensure_tables()
    try:
        jobs_rows = db.execute_query("SELECT * FROM ct_gravacao_jobs")
    except Exception as exc:
        logger.error("Erro lendo ct_gravacao_jobs: %s", exc)
        raise HTTPException(status_code=500, detail=f"Erro lendo dados de gravacao: {exc}")

    queue: List[Dict[str, Any]] = []
    printed: List[Dict[str, Any]] = []

    job_ids: List[Any] = []
    for row in jobs_rows:
        jid = row.get("id") or row.get("id_job")
        if jid is not None:
            job_ids.append(jid)
    chapas_map: Dict[int, List[Dict[str, Any]]] = {}
    if job_ids:
        try:
            chapas_rows = db.execute_query("SELECT * FROM ct_gravacao_chapas")
            allowed = set(job_ids)
            for c in chapas_rows:
                jid = c.get("job_id") or c.get("id_job")
                if jid is None or jid not in allowed:
                    continue
                chapas_map.setdefault(jid, []).append(
                    {
                        "colour": c.get("cor") or c.get("Colour"),
                        "status": c.get("status_chapa") or c.get("status"),
                        "printed_at": c.get("printed_at").isoformat() if hasattr(c.get("printed_at"), "isoformat") else c.get("printed_at") or c.get("data_gravacao"),
                        "hot_plate_id": c.get("hotplate_id"),
                        "caderno": c.get("caderno") or c.get("nome_chapa") or c.get("nome"),
                        "raw": {},
                    }
                )
        except Exception as exc:
            logger.error("Erro lendo chapas: %s", exc)

    for row in jobs_rows:
        jid = row.get("id") or row.get("id_job")
        created_val = row.get("created_at") or row.get("data_criacao")
        printed_val = row.get("printed_at") or row.get("data_gravacao")
        media_name = row.get("media_name") or row.get("media")
        media_width = row.get("media_width")
        media_height = row.get("media_height")
        item = {
            "name": row.get("nome_original") or row.get("arquivo_origem") or row.get("name"),
            "template": row.get("template"),
            "priority": row.get("prioridade"),
            "status": row.get("status_gravacao") or row.get("status"),
            "created_at": created_val.isoformat() if hasattr(created_val, "isoformat") else created_val,
            "printed_at": printed_val.isoformat() if hasattr(printed_val, "isoformat") else printed_val,
            "media": {
                "name": media_name,
                "width": media_width,
                "height": media_height,
            },
            "machine_serial_number": row.get("machine_serial") or row.get("maquina"),
            "paths": chapas_map.get(jid, []),
            "history": [],
            "inferred_os": {"nr_os": row.get("os_numero") or row.get("os"), "ano": row.get("os_ano") or row.get("ano_os"), "raw": row.get("nome_original")},
            "solicitante": row.get("solicitante"),
            "produto": row.get("produto") or row.get("descricao"),
            "metrics": {
                "plates_total": len(chapas_map.get(jid, [])),
                "plates_printed": len([p for p in chapas_map.get(jid, []) if (p.get("status") or "").lower() == "printed" or p.get("printed_at")]),
                "progress_pct": None,
                "elapsed_seconds": None,
                "duration_seconds": None,
            },
            "raw": {},
        }

        total = item["metrics"]["plates_total"] or 0
        printed_ct = item["metrics"]["plates_printed"] or 0
        if total:
            item["metrics"]["progress_pct"] = int((printed_ct / total) * 100)

        # elapsed / duration
        try:
            if item["created_at"]:
                created_dt = datetime.datetime.fromisoformat(item["created_at"])
                item["metrics"]["elapsed_seconds"] = int((datetime.datetime.now(datetime.timezone.utc) - created_dt).total_seconds())
            if item["created_at"] and item["printed_at"]:
                c = datetime.datetime.fromisoformat(item["created_at"])
                p = datetime.datetime.fromisoformat(item["printed_at"])
                item["metrics"]["duration_seconds"] = max(0, int((p - c).total_seconds()))
        except Exception:
            pass

        origem = (row.get("origem") or "").upper()
        if origem == "PRINTED":
            printed.append(item)
        else:
            queue.append(item)

    # ordenação em memória
    queue.sort(key=lambda j: (j.get("created_at") or ""), reverse=True)
    printed.sort(key=lambda j: (j.get("printed_at") or j.get("created_at") or ""), reverse=True)

    response = {
        "queue": queue,
        "printed": printed[:limit_printed],
        "meta": {
            "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "source_paths": {
                "queue": "ct_gravacao_jobs",
                "printed": "ct_gravacao_jobs",
            },
            "errors": [],
        },
    }

    return response


@router.get("/gravacao/jobticket")
def gravacao_jobticket(template: str = Query(None), name: str = Query(..., min_length=1)):
    """Retorna eventos do banco (ct_gravacao_eventos) para a OS."""
    _ensure_tables()
    try:
        job_rows = db.execute_query(
            "SELECT id FROM ct_gravacao_jobs WHERE nome_original = %s LIMIT 1",
            (name,),
        )
        if not job_rows:
            return JSONResponse(status_code=404, content={"events": [], "error": "Job não encontrado."})
        job_id = job_rows[0].get("id")
        events = db.execute_query(
            "SELECT event_time, event_type, event_text FROM ct_gravacao_eventos WHERE job_id=%s ORDER BY event_time ASC",
            (job_id,),
        )
        data = [
            {
                "time": e.get("event_time").isoformat() if e.get("event_time") else None,
                "time_raw": e.get("event_time").isoformat() if e.get("event_time") else None,
                "text": e.get("event_text"),
                "type": e.get("event_type"),
            }
            for e in events
        ]
        return {"events": data}
    except Exception as exc:  # noqa: BLE001
        logger.error("Erro lendo eventos: %s", exc)
        raise HTTPException(status_code=500, detail="Erro ao ler eventos")
