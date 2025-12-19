"""Sincronizador de gravação (CTP / Apogee).

Lê os XMLs do PrintQ (Jobs, PrintedJobs e JobTicket por OS), normaliza e
persiste no MySQL nas tabelas ct_gravacao_jobs, ct_gravacao_chapas e
ct_gravacao_eventos. Somente atualiza quando o hash muda.

Pode ser executado junto ao servidor (loop simples a cada POLL_SECONDS).
"""

from __future__ import annotations

import datetime as dt
import hashlib
import logging
import os
import time
import xml.etree.ElementTree as ET
from typing import Any, Dict, List, Optional, Tuple

from database import db

logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


JOBS_XML_PATH = os.getenv(
    "SAGRA_CTP_JOBS_XML",
    r"i:\\Apogee_Files\3- PrintQ\PrintQ Jobs\Tickets.Xml",
)
PRINTED_XML_PATH = os.getenv(
    "SAGRA_CTP_PRINTED_XML",
    r"i:\\Apogee_Files\3- PrintQ\PrintQ PrintedJobs\Tickets.Xml",
)
JOBTICKET_BASE = os.getenv(
    "SAGRA_CTP_JOBTICKET_BASE",
    r"i:\\Apogee_Files\3- PrintQ\PrintQ Jobs",
)

POLL_SECONDS = int(os.getenv("SAGRA_CTP_POLL", "8"))


# --- Helpers ---------------------------------------------------------------


def _detect_namespace(tag: str) -> Optional[str]:
    if tag.startswith("{") and "}" in tag:
        return tag.split("}", 1)[0][1:]
    return None


def _tag(ns: Optional[str], name: str) -> str:
    return f"{{{ns}}}{name}" if ns else name


def _child_text(el: ET.Element, ns: Optional[str], name: str) -> Optional[str]:
    child = el.find(_tag(ns, name))
    if child is not None and child.text:
        return child.text.strip()
    return None


def _parse_timestamp(raw: Optional[str]) -> Optional[dt.datetime]:
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
            return dt.datetime.strptime(value, pattern)
        except ValueError:
            continue
    return None


def _iso(dt_obj: Optional[dt.datetime]) -> Optional[str]:
    if not dt_obj:
        return None
    if dt_obj.tzinfo is None:
        dt_obj = dt_obj.replace(tzinfo=dt.timezone.utc)
    return dt_obj.astimezone(dt.timezone.utc).isoformat()


def _read_xml(path: str) -> ET.Element:
    if not os.path.exists(path):
        raise FileNotFoundError(path)
    with open(path, "rb") as fh:
        data = fh.read()
    return ET.fromstring(data)


def _infer_os(name: Optional[str]) -> Tuple[Optional[int], Optional[int]]:
    if not name:
        return None, None
    import re

    s = name.strip()
    # tenta formas mais comuns: 2024_OS_12345, 2024 os 12345, os12345, sp-12345
    with_year = re.compile(r"(?P<ano>20\d{2})\D*(?:os|sp)?\D*(?P<nr>\d{4,6})", re.IGNORECASE)
    m1 = with_year.search(s)
    if m1:
        return int(m1.group("nr")), int(m1.group("ano"))

    os_prefixed = re.compile(r"(?:os|sp)\D*(?P<nr>\d{4,6})", re.IGNORECASE)
    m2 = os_prefixed.search(s)
    if m2:
        return int(m2.group("nr")), None

    digits_anywhere = re.compile(r"(?P<nr>\d{4,6})")
    m3 = digits_anywhere.search(s)
    if m3:
        return int(m3.group("nr")), None

    return None, None


def _extract_solic_prod(name: Optional[str]) -> Tuple[Optional[str], Optional[str]]:
    """Heurística para derivar solicitante e produto a partir do Name."""
    if not name:
        return None, None
    import re

    m = re.search(r"(?:20\d{2}\D*)?(?:os|sp)?\D*(\d{4,6})(?P<rest>.*)", name, re.IGNORECASE)
    if not m:
        return None, None
    rest = m.group("rest") or ""
    rest = rest.lstrip(" _-:")
    if not rest:
        return None, None

    # separa por hifen; remove tokens vazios
    tokens = [t.strip() for t in re.split(r"-+", rest) if t.strip()]
    # remove extensao do ultimo token
    if tokens:
        tokens[-1] = re.sub(r"\.[A-Za-z0-9]+$", "", tokens[-1])

    # ignora códigos curtos e números repetidos
    skip_codes = {"K", "H", "C", "M", "Y", "P", "SM", "PM", "SM74", "PM52"}
    cleaned = []
    for tok in tokens:
        tok_up = tok.upper()
        if tok_up in skip_codes:
            continue
        if tok.isdigit():
            continue
        cleaned.append(tok)

    if not cleaned:
        # se nada sobrou, tenta usar último token original como produto
        return None, tokens[-1] if tokens else None

    if len(cleaned) == 1:
        return None, cleaned[0]

    solicitante = cleaned[0]
    produto = "-".join(cleaned[1:])
    return solicitante, produto


def _sha256_from(items: List[Any]) -> str:
    buf = "|".join(["" if v is None else str(v) for v in items]).encode("utf-8")
    return hashlib.sha256(buf).hexdigest()


def _safe_join(base: str, *parts: str) -> str:
    path = os.path.abspath(os.path.join(base, *parts))
    base_abs = os.path.abspath(base)
    if not path.startswith(base_abs):
        raise ValueError("Path traversal detectado")
    return path


# --- Parsing --------------------------------------------------------------


def parse_ticket_el(ticket_el: ET.Element, ns: Optional[str], origin: str, now: dt.datetime) -> Dict[str, Any]:
    attr = ticket_el.attrib
    name = _child_text(ticket_el, ns, "Name") or attr.get("Name")
    nr_os, ano = _infer_os(name)
    solicitante, produto = _extract_solic_prod(name)
    template = (
        _child_text(ticket_el, ns, "Template")
        or _child_text(ticket_el, ns, "TemplateName")
        or _child_text(ticket_el, ns, "TicketTemplate")
        or attr.get("Template")
        or attr.get("TemplateName")
        or attr.get("TicketTemplate")
    )

    created_dt = _parse_timestamp(_child_text(ticket_el, ns, "Created") or attr.get("Created"))
    printed_dt = _parse_timestamp(_child_text(ticket_el, ns, "Printed") or attr.get("Printed"))

    paths = []
    for p in ticket_el.findall(f".//{_tag(ns, 'Path')}"):
        raw = dict(p.attrib)
        status = raw.get("Status") or raw.get("State") or _child_text(p, ns, "Status") or _child_text(p, ns, "State")
        colour = raw.get("Colour") or _child_text(p, ns, "Colour")
        printed_at = _parse_timestamp(
            raw.get("Printed")
            or raw.get("PrintedTime")
            or raw.get("Time")
            or raw.get("PrintedAt")
            or _child_text(p, ns, "Printed")
            or _child_text(p, ns, "PrintedTime")
            or _child_text(p, ns, "Time")
            or _child_text(p, ns, "PrintedAt")
        )
        caderno = None
        tiff = raw.get("TiffName") or raw.get("TIFFName") or raw.get("File") or _child_text(p, ns, "TiffName") or _child_text(p, ns, "File") or ""
        import re
        m_cad = re.search(r"\(\s*Cad\s*([^\)]+)\)", tiff, re.IGNORECASE)
        if m_cad:
            caderno = m_cad.group(1).strip()
        if not colour:
            m_col = re.search(r"\((C|M|Y|K)\)", tiff, re.IGNORECASE) or re.search(r"[_-](C|M|Y|K)(?:\.|$)", tiff, re.IGNORECASE)
            if m_col:
                colour = m_col.group(1).upper()

        path_hash = _sha256_from([
            caderno,
            colour,
            status,
            _iso(printed_at),
            raw.get("HotPlateId") or raw.get("HotPlateID"),
        ])

        paths.append(
            {
                "caderno": caderno,
                "cor": colour,
                "status": status,
                "printed_at": printed_at,
                "hotplate_id": raw.get("HotPlateId") or raw.get("HotPlateID"),
                "hash": path_hash,
            }
        )

    history = []
    for ev in ticket_el.findall(f"{_tag(ns, 'History')}/{_tag(ns, 'Event')}"):
        ev_time = ev.attrib.get("Time") or ev.attrib.get("Timestamp") or ev.attrib.get("When")
        dt_ev = _parse_timestamp(ev_time)
        history.append(
            {
                "code": ev.attrib.get("Code") or ev.attrib.get("Status") or ev.attrib.get("Event") or ev.attrib.get("Name"),
                "time": dt_ev,
                "text": (ev.text or "").strip() or ev.attrib.get("Description"),
            }
        )

    job_hash = _sha256_from([
        name,
        _child_text(ticket_el, ns, "Status") or attr.get("Status"),
        _child_text(ticket_el, ns, "Priority") or attr.get("Priority"),
        _iso(created_dt),
        _iso(printed_dt),
        _child_text(ticket_el, ns, "MediaName") or attr.get("MediaName"),
        _child_text(ticket_el, ns, "MediaWidth") or attr.get("MediaWidth"),
        _child_text(ticket_el, ns, "MediaHeight") or attr.get("MediaHeight"),
        _child_text(ticket_el, ns, "MachineSerialNumber") or attr.get("MachineSerialNumber"),
        origin,
    ])

    return {
        "name": name,
        "nr_os": nr_os,
        "ano_os": ano,
        "solicitante": solicitante,
        "produto": produto,
        "template": template,
        "status": _child_text(ticket_el, ns, "Status") or attr.get("Status"),
        "priority": _child_text(ticket_el, ns, "Priority") or attr.get("Priority"),
        "created_at": created_dt,
        "printed_at": printed_dt,
        "media_name": _child_text(ticket_el, ns, "MediaName") or attr.get("MediaName"),
        "media_width": _child_text(ticket_el, ns, "MediaWidth") or attr.get("MediaWidth"),
        "media_height": _child_text(ticket_el, ns, "MediaHeight") or attr.get("MediaHeight"),
        "machine_serial": _child_text(ticket_el, ns, "MachineSerialNumber") or attr.get("MachineSerialNumber"),
        "origin": origin,
        "hash": job_hash,
        "paths": paths,
        "history": history,
    }


def parse_tickets_file(path: str, origin: str) -> List[Dict[str, Any]]:
    root = _read_xml(path)
    ns = _detect_namespace(root.tag)
    tag_ticket = _tag(ns, "XPoseTicket")
    now = dt.datetime.now(dt.timezone.utc)
    tickets: List[Dict[str, Any]] = []
    for ticket_el in root.findall(tag_ticket):
        try:
            tickets.append(parse_ticket_el(ticket_el, ns, origin, now))
        except Exception as exc:
            logger.error("Ticket malformado em %s: %s", origin, exc)
            continue
    return tickets


def parse_jobticket_events(template: str, name: str) -> List[Dict[str, Any]]:
    try:
        path = _safe_join(JOBTICKET_BASE, template, name, "JobTicket.xml")
        root = _read_xml(path)
    except FileNotFoundError:
        return []

    ns = _detect_namespace(root.tag)
    tag_ticket = _tag(ns, "XPoseTicket")
    tag_history = _tag(ns, "History")
    tag_event = _tag(ns, "Event")

    ticket_el = root.find(tag_ticket)
    if ticket_el is None:
        return []
    hist_el = ticket_el.find(tag_history)
    if hist_el is None:
        return []

    events: List[Dict[str, Any]] = []
    for ev in hist_el.findall(tag_event):
        ev_type = ev.findtext(_tag(ns, "Type")) or ev.attrib.get("Type")
        ev_time_raw = ev.findtext(_tag(ns, "Time")) or ev.attrib.get("Time")
        ev_text = ev.findtext(_tag(ns, "Text")) or ev.attrib.get("Text") or (ev.text or "").strip()
        ev_time_dt = _parse_timestamp(ev_time_raw)
        ev_hash = _sha256_from([ev_time_raw, ev_text, ev_type])
        events.append(
            {
                "event_time": ev_time_dt,
                "event_type": ev_type,
                "event_text": ev_text,
                "hash": ev_hash,
            }
        )
    events.sort(key=lambda e: e["event_time"] or dt.datetime.min)
    return events


# --- DB ops ---------------------------------------------------------------


def ensure_tables():
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


def upsert_job(job: Dict[str, Any]) -> Tuple[int, bool, bool]:
    """Upsert job e retorna (job_id, houve_alteracao, is_new)."""
    nr = job.get("nr_os")
    if nr is None:
        raise ValueError("OS sem número")
    ano = job.get("ano_os")
    nome = job.get("name") or ""

    existing = db.execute_query(
        "SELECT id, hash_estado FROM ct_gravacao_jobs WHERE os_numero=%s AND (os_ano=%s OR (os_ano IS NULL AND %s IS NULL)) LIMIT 1",
        (nr, ano, ano),
    )

    fields = (
        job.get("status"),
        job.get("priority"),
        job.get("created_at"),
        job.get("printed_at"),
        job.get("media_name"),
        job.get("media_width"),
        job.get("media_height"),
        job.get("machine_serial"),
        job.get("origin"),
        job.get("solicitante"),
        job.get("produto"),
        job.get("template"),
    )
    hash_estado = _sha256_from([nome, *fields])

    if existing:
        row = existing[0]
        if row.get("hash_estado") == hash_estado:
            return row.get("id"), False, False
        db.execute_query(
            """
            UPDATE ct_gravacao_jobs
               SET nome_original=%s,
                   solicitante=%s,
                   produto=%s,
                   template=%s,
                   status_gravacao=%s,
                   prioridade=%s,
                   created_at=%s,
                   printed_at=%s,
                   media_name=%s,
                   media_width=%s,
                   media_height=%s,
                   machine_serial=%s,
                   origem=%s,
                   hash_estado=%s
             WHERE id=%s
            """,
            (
                nome,
                job.get("solicitante"),
                job.get("produto"),
                job.get("template"),
                job.get("status"),
                job.get("priority"),
                job.get("created_at"),
                job.get("printed_at"),
                job.get("media_name"),
                job.get("media_width"),
                job.get("media_height"),
                job.get("machine_serial"),
                job.get("origin"),
                hash_estado,
                row.get("id"),
            ),
        )
        return row.get("id"), True, False

    def _insert(cur):
        cur.execute(
            """
            INSERT INTO ct_gravacao_jobs (
                os_ano, os_numero, nome_original, solicitante, produto, template, status_gravacao, prioridade, created_at, printed_at,
                media_name, media_width, media_height, machine_serial, origem, hash_estado
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """,
            (
                ano,
                nr,
                nome,
                job.get("solicitante"),
                job.get("produto"),
                job.get("template"),
                job.get("status"),
                job.get("priority"),
                job.get("created_at"),
                job.get("printed_at"),
                job.get("media_name"),
                job.get("media_width"),
                job.get("media_height"),
                job.get("machine_serial"),
                job.get("origin"),
                hash_estado,
            ),
        )
        return cur.lastrowid

    new_id = db.execute_transaction([_insert])[0]
    return new_id, True, True


def upsert_chapas(job_id: int, paths: List[Dict[str, Any]]):
    for p in paths:
        existing = db.execute_query(
            "SELECT id, hash_estado FROM ct_gravacao_chapas WHERE job_id=%s AND caderno=%s AND cor=%s LIMIT 1",
            (job_id, p.get("caderno"), p.get("cor")),
        )
        if existing and existing[0].get("hash_estado") == p.get("hash"):
            continue
        if existing:
            db.execute_query(
                """
                UPDATE ct_gravacao_chapas
                   SET status_chapa=%s, printed_at=%s, hotplate_id=%s, hash_estado=%s
                 WHERE id=%s
                """,
                (
                    p.get("status"),
                    p.get("printed_at"),
                    p.get("hotplate_id"),
                    p.get("hash"),
                    existing[0].get("id"),
                ),
            )
        else:
            db.execute_query(
                """
                INSERT INTO ct_gravacao_chapas (job_id, caderno, cor, status_chapa, printed_at, hotplate_id, hash_estado)
                VALUES (%s,%s,%s,%s,%s,%s,%s)
                """,
                (
                    job_id,
                    p.get("caderno"),
                    p.get("cor"),
                    p.get("status"),
                    p.get("printed_at"),
                    p.get("hotplate_id"),
                    p.get("hash"),
                ),
            )


def upsert_eventos(job_id: int, eventos: List[Dict[str, Any]]):
    for ev in eventos:
        db.execute_query(
            """
            INSERT INTO ct_gravacao_eventos (job_id, chapa_identificador, event_time, event_type, event_text, hash_evento)
            VALUES (%s,%s,%s,%s,%s,%s)
            ON DUPLICATE KEY UPDATE event_text=VALUES(event_text)
            """,
            (
                job_id,
                None,
                ev.get("event_time"),
                ev.get("event_type"),
                ev.get("event_text"),
                ev.get("hash"),
            ),
        )


# --- Main loop -----------------------------------------------------------


def sync_once():
    ensure_tables()

    jobs_all: List[Dict[str, Any]] = []
    try:
        jobs_all.extend(parse_tickets_file(JOBS_XML_PATH, "JOBS"))
    except Exception as exc:
        logger.error("Erro lendo Jobs XML: %s", exc)
    try:
        jobs_all.extend(parse_tickets_file(PRINTED_XML_PATH, "PRINTED"))
    except Exception as exc:
        logger.error("Erro lendo PrintedJobs XML: %s", exc)

    inserted = updated = skipped = 0
    event_candidates: List[Tuple[int, Dict[str, Any]]] = []

    for job in jobs_all:
        if job.get("nr_os") is None:
            logger.warning("Ignorando ticket sem OS: %s", job.get("name"))
            continue
        try:
            job_id, changed, is_new = upsert_job(job)
            if is_new:
                inserted += 1
            elif changed:
                updated += 1
            else:
                skipped += 1

            upsert_chapas(job_id, job.get("paths") or [])

            if job.get("origin") == "JOBS" and job.get("name") and job.get("template"):
                event_candidates.append((job_id, job))
        except Exception as exc:
            logger.error("Erro processando job %s: %s", job.get("name"), exc)
            continue

    for job_id, job in event_candidates:
        try:
            ticket_path = _safe_join(JOBTICKET_BASE, job.get("template"), job.get("name"), "JobTicket.xml")
        except Exception as exc:
            logger.error("Caminho de JobTicket invalido para %s: %s", job.get("name"), exc)
            continue

        if not os.path.exists(ticket_path):
            logger.info("Sem JobTicket.xml para OS %s (%s)", job.get("nr_os"), job.get("name"))
            continue

        try:
            eventos = parse_jobticket_events(job.get("template"), job.get("name"))
            if eventos:
                upsert_eventos(job_id, eventos)
        except Exception as exc:
            logger.error("Erro processando eventos de %s: %s", job.get("name"), exc)

    logger.info("Sync tick: %s jobs (inserted=%s, updated=%s, skipped=%s)", len(jobs_all), inserted, updated, skipped)


def main():
    while True:
        sync_once()
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()