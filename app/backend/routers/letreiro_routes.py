"""Heartbeat, config remota e scripts do letreiro WPF."""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timedelta
from typing import Any, Optional

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field

from database import DatabaseConnectionError, db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/letreiro", tags=["letreiro"])

ADMIN_SAM = "p_918713"
ONLINE_SECONDS = 120
SCRIPT_KINDS = frozenset({"bat", "ps1"})
MAX_SCRIPT_BYTES = 256 * 1024
MAX_OUTPUT_CHARS = 64 * 1024
TIMEOUT_MIN = 5
TIMEOUT_MAX = 300
TIMEOUT_DEFAULT = 60
JOB_STATUS_PENDING = "pending"
JOB_STATUS_RUNNING = "running"
JOB_STATUS_OK = "ok"
JOB_STATUS_FAIL = "fail"
JOB_STATUS_TIMEOUT = "timeout"
COMMAND_POLL_MIN = 1
COMMAND_POLL_MAX = 120
COMMAND_POLL_DEFAULT = 10
COMMAND_VAR_RE = re.compile(r"\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}")


def normalize_windows_sam(windows_user: str | None) -> str:
    raw = (windows_user or "").strip()
    if not raw:
        return ""
    parts = raw.replace("/", "\\").split("\\")
    return parts[-1].strip().lower()


def is_letreiro_admin(windows_user: str | None) -> bool:
    return normalize_windows_sam(windows_user) == ADMIN_SAM


def _require_admin(windows_user: str | None) -> str:
    if not is_letreiro_admin(windows_user):
        raise HTTPException(status_code=403, detail="Acesso restrito ao administrador do letreiro.")
    return (windows_user or "").strip()


def _clip(value: str | None, size: int) -> str:
    return (value or "").strip()[:size]


def _parse_payload(raw: Any) -> Any:
    if raw is None:
        return None
    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode("utf-8")
    if isinstance(raw, str):
        return json.loads(raw)
    return raw


def _as_datetime(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    text = str(value)
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(text[:19], fmt)
        except ValueError:
            continue
    return None


class HeartbeatBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    host_name: str = Field(alias="hostName")
    windows_user: str = Field(alias="windowsUser")
    version: str = ""
    ponto: str = ""


class LetreiroConfigPut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    windows_user: str = Field(alias="windowsUser")
    host_name: Optional[str] = Field(default=None, alias="hostName")
    target_user: Optional[str] = Field(default=None, alias="targetUser")
    apply_to_all: bool = Field(default=False, alias="applyToAll")
    payload: dict[str, Any]


class LetreiroCommandBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    windows_user: str = Field(alias="windowsUser")
    name: str
    kind: str
    content: str
    timeout_sec: int = Field(default=TIMEOUT_DEFAULT, alias="timeoutSec")


class JobTarget(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    host_name: str = Field(alias="hostName")
    windows_user: str = Field(alias="windowsUser")


class CommandRunBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    windows_user: str = Field(alias="windowsUser")
    targets: list[JobTarget] = Field(default_factory=list)
    all_online: bool = Field(default=False, alias="allOnline")
    variables: dict[str, str] = Field(default_factory=dict)


class AdhocRunBody(CommandRunBody):
    name: str = "terminal"
    kind: str = "bat"
    content: str = ""
    timeout_sec: int = Field(default=TIMEOUT_DEFAULT, alias="timeoutSec")


class JobResultBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    host_name: str = Field(alias="hostName")
    windows_user: str = Field(alias="windowsUser")
    exit_code: Optional[int] = Field(default=None, alias="exitCode")
    stdout: str = ""
    stderr: str = ""
    timed_out: bool = Field(default=False, alias="timedOut")


class InstanceProfilePut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    windows_user: str = Field(alias="windowsUser")
    host_name: str = Field(alias="hostName")
    target_user: str = Field(alias="targetUser")
    nome: str = ""
    setor: str = ""


class LetreiroSettingsPut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    windows_user: str = Field(alias="windowsUser")
    command_poll_interval_sec: int = Field(alias="commandPollIntervalSec")


def _normalize_kind(kind: str | None) -> str:
    raw = (kind or "").strip().lower().lstrip(".")
    if raw not in SCRIPT_KINDS:
        raise HTTPException(status_code=400, detail="Tipo deve ser bat ou ps1.")
    return raw


def _clamp_timeout(value: int | None) -> int:
    if value is None:
        return TIMEOUT_DEFAULT
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Timeout inválido.") from exc
    return max(TIMEOUT_MIN, min(TIMEOUT_MAX, parsed))


def _validate_name(name: str | None) -> str:
    cleaned = _clip(name, 128)
    if not cleaned:
        raise HTTPException(status_code=400, detail="Nome do comando é obrigatório.")
    return cleaned


def extract_command_vars(content: str | None) -> list[str]:
    seen: list[str] = []
    for match in COMMAND_VAR_RE.finditer(content or ""):
        name = match.group(1)
        if name not in seen:
            seen.append(name)
    return seen


def _sanitize_var_value(raw: str | None) -> str:
    return (raw or "").replace("\0", "").replace("\r\n", " ").replace("\r", " ").replace("\n", " ")


def render_command_content(
    content: str | None,
    values: dict[str, str] | None = None,
) -> tuple[str, list[str]]:
    names = extract_command_vars(content)
    clean = {
        (key or "").strip(): _sanitize_var_value(value).strip()
        for key, value in (values or {}).items()
    }
    missing = [name for name in names if not clean.get(name)]
    if missing:
        return content or "", missing
    rendered = COMMAND_VAR_RE.sub(lambda match: clean.get(match.group(1), ""), content or "")
    return rendered, []


def _validate_content(content: str | None) -> str:
    text = content if isinstance(content, str) else ""
    if not text.strip():
        raise HTTPException(status_code=400, detail="Conteúdo do script vazio.")
    if len(text.encode("utf-8")) > MAX_SCRIPT_BYTES:
        raise HTTPException(status_code=400, detail="Script maior que 256 KB.")
    return text


def _clamp_command_poll(value: Any) -> int:
    if value is None or value == "":
        return COMMAND_POLL_DEFAULT
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Intervalo de comandos inválido.") from exc
    if parsed <= 0:
        parsed = COMMAND_POLL_DEFAULT
    return max(COMMAND_POLL_MIN, min(COMMAND_POLL_MAX, parsed))


def _command_poll_interval() -> int:
    rows = db.execute_query(
        "SELECT CommandPollIntervalSec FROM tabLetreiroAjuste WHERE Id = 1 LIMIT 1"
    )
    if not rows:
        return COMMAND_POLL_DEFAULT
    return _clamp_command_poll(rows[0].get("CommandPollIntervalSec"))


def _clip_output(text: str | None) -> str:
    raw = text or ""
    if len(raw) > MAX_OUTPUT_CHARS:
        return raw[:MAX_OUTPUT_CHARS] + "\n…[truncado]"
    return raw


def _is_duplicate_name(exc: BaseException) -> bool:
    message = str(exc).lower()
    return "duplicate" in message or "uk_letreiro_comando_nome" in message


def _row_int(row: dict[str, Any], key: str) -> Optional[int]:
    value = row.get(key)
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _serialize_command(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": _row_int(row, "Id"),
        "name": row.get("Nome") or "",
        "kind": row.get("Tipo") or "",
        "content": row.get("Conteudo") or "",
        "timeoutSec": _row_int(row, "TimeoutSec") or TIMEOUT_DEFAULT,
        "createdBy": row.get("CreatedBy") or "",
        "updatedBy": row.get("UpdatedBy") or "",
        "createdAt": row.get("CreatedAt"),
        "updatedAt": row.get("UpdatedAt"),
    }


def _serialize_job(row: dict[str, Any], include_content: bool = False) -> dict[str, Any]:
    payload = {
        "id": _row_int(row, "Id"),
        "commandId": _row_int(row, "ComandoId"),
        "name": row.get("Nome") or "",
        "kind": row.get("Tipo") or "",
        "timeoutSec": _row_int(row, "TimeoutSec") or TIMEOUT_DEFAULT,
        "hostName": row.get("HostName") or "",
        "windowsUser": row.get("WindowsUser") or "",
        "status": row.get("Status") or "",
        "exitCode": _row_int(row, "ExitCode"),
        "stdout": row.get("Stdout") or "",
        "stderr": row.get("Stderr") or "",
        "createdBy": row.get("CreatedBy") or "",
        "createdAt": row.get("CreatedAt"),
        "startedAt": row.get("StartedAt"),
        "finishedAt": row.get("FinishedAt"),
    }
    if include_content:
        payload["content"] = row.get("Conteudo") or ""
    return payload


def _load_command(command_id: int) -> dict[str, Any]:
    rows = db.execute_query(
        """
        SELECT Id, Nome, Tipo, Conteudo, TimeoutSec, CreatedBy, UpdatedBy, CreatedAt, UpdatedAt
        FROM tabLetreiroComando
        WHERE Id = %s
        LIMIT 1
        """,
        (command_id,),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Comando não encontrado.")
    return rows[0]


def _insert_returning_id(sql: str, params: tuple[Any, ...]) -> int:
    def op(cursor):
        cursor.execute(sql, params)
        return int(cursor.lastrowid or 0)

    inserted = db.execute_transaction([op])[0]
    if not inserted:
        raise HTTPException(status_code=500, detail="Falha ao gravar o comando.")
    return inserted


def _claim_pending_job(host: str, user: str) -> Optional[dict[str, Any]]:
    def op(cursor):
        cursor.execute(
            """
            SELECT Id, ComandoId, Nome, Tipo, Conteudo, TimeoutSec, HostName, WindowsUser
            FROM tabLetreiroComandoJob
            WHERE HostName = %s AND WindowsUser = %s AND Status = %s
            ORDER BY Id ASC
            LIMIT 1
            FOR UPDATE
            """,
            (host, user, JOB_STATUS_PENDING),
        )
        row = cursor.fetchone()
        if not row:
            return None
        cursor.execute(
            """
            UPDATE tabLetreiroComandoJob
            SET Status = %s, StartedAt = NOW()
            WHERE Id = %s AND Status = %s
            """,
            (JOB_STATUS_RUNNING, row["Id"], JOB_STATUS_PENDING),
        )
        if cursor.rowcount != 1:
            return None
        return row

    return db.execute_transaction([op])[0]


STALE_JOB_GRACE_SEC = 30
STALE_JOB_MESSAGE = "Tempo esgotado: o cliente não enviou o resultado."


def _expire_stale_running_jobs() -> None:
    db.execute_query(
        """
        UPDATE tabLetreiroComandoJob
        SET Status = %s,
            Stderr = CASE
                WHEN Stderr IS NULL OR Stderr = '' THEN %s
                ELSE Stderr
            END,
            FinishedAt = NOW()
        WHERE Status = %s
          AND StartedAt IS NOT NULL
          AND TIMESTAMPDIFF(SECOND, StartedAt, NOW()) > (IFNULL(TimeoutSec, 60) + %s)
        """,
        (JOB_STATUS_TIMEOUT, STALE_JOB_MESSAGE, JOB_STATUS_RUNNING, STALE_JOB_GRACE_SEC),
    )


def _collect_run_targets(body: CommandRunBody) -> list[tuple[str, str]]:
    seen: set[tuple[str, str]] = set()
    targets: list[tuple[str, str]] = []

    def add(host: str | None, user: str | None) -> None:
        host_name = _clip(host, 128)
        windows_user = _clip(user, 128)
        if not host_name or not windows_user:
            return
        key = (host_name.lower(), windows_user.lower())
        if key in seen:
            return
        seen.add(key)
        targets.append((host_name, windows_user))

    for item in body.targets or []:
        add(item.host_name, item.windows_user)

    if body.all_online:
        rows = db.execute_query(
            "SELECT HostName, WindowsUser, LastSeen FROM tabLetreiroInstancia"
        )
        now = datetime.now()
        for row in rows or []:
            seen_at = _as_datetime(row.get("LastSeen"))
            if seen_at and (now - seen_at) <= timedelta(seconds=ONLINE_SECONDS):
                add(row.get("HostName"), row.get("WindowsUser"))

    if not targets:
        raise HTTPException(status_code=400, detail="Nenhum destino.")
    return targets


def _enqueue_jobs(
    *,
    command_id: int | None,
    name: str,
    kind: str,
    content: str,
    timeout: int,
    actor: str,
    targets: list[tuple[str, str]],
) -> int:
    for host, user in targets:
        db.execute_query(
            """
            INSERT INTO tabLetreiroComandoJob
                (ComandoId, Nome, Tipo, Conteudo, TimeoutSec, HostName, WindowsUser,
                 Status, CreatedBy, CreatedAt)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
            """,
            (
                command_id,
                name,
                kind,
                content,
                timeout,
                host,
                user,
                JOB_STATUS_PENDING,
                actor,
            ),
        )
    return len(targets)


@router.post("/heartbeat")
async def post_heartbeat(body: HeartbeatBody):
    host = _clip(body.host_name, 128)
    user = _clip(body.windows_user, 128)
    if not host or not user:
        raise HTTPException(status_code=400, detail="hostName e windowsUser são obrigatórios.")
    db.execute_query(
        """
        INSERT INTO tabLetreiroInstancia (HostName, WindowsUser, Version, Ponto, LastSeen)
        VALUES (%s, %s, %s, %s, NOW())
        ON DUPLICATE KEY UPDATE
            Version = VALUES(Version),
            Ponto = VALUES(Ponto),
            LastSeen = NOW()
        """,
        (host, user, _clip(body.version, 32), _clip(body.ponto, 32)),
    )
    return {"status": "ok"}


def _list_painel_presets() -> list[dict[str, Any]]:
    from services import painel_remote_config_service as painel_svc

    return painel_svc.list_presets()


@router.get("/painel-presets")
def list_painel_presets():
    try:
        return {"presets": _list_painel_presets()}
    except Exception as exc:
        logger.warning("Presets do painel indisponíveis: %s", exc)
        return {"presets": []}


@router.get("/config")
async def get_config(
    host: str = Query(..., min_length=1),
    user: str = Query(..., min_length=1),
):
    host_name = _clip(host, 128)
    windows_user = _clip(user, 128)
    rows = db.execute_query(
        """
        SELECT Payload, UpdatedAt, UpdatedBy
        FROM tabLetreiroConfig
        WHERE HostName = %s AND WindowsUser = %s
        LIMIT 1
        """,
        (host_name, windows_user),
    )
    if not rows:
        return {"payload": None}
    try:
        payload = _parse_payload(rows[0].get("Payload"))
    except Exception as exc:
        logger.warning("Payload letreiro inválido %s/%s: %s", host_name, windows_user, exc)
        raise HTTPException(status_code=500, detail="Config remota inválida.") from exc
    return {
        "payload": payload,
        "updatedAt": rows[0].get("UpdatedAt"),
        "updatedBy": rows[0].get("UpdatedBy") or "",
    }


@router.get("/instances")
async def list_instances(
    x_letreiro_windows_user: Optional[str] = Header(default=None, alias="X-Letreiro-Windows-User"),
    windows_user: Optional[str] = Query(default=None, alias="windowsUser"),
):
    _require_admin(x_letreiro_windows_user or windows_user)
    rows = db.execute_query(
        """
        SELECT i.HostName, i.WindowsUser, i.Nome, i.Setor, i.Version, i.Ponto, i.LastSeen,
               c.HostName AS ConfigHost
        FROM tabLetreiroInstancia i
        LEFT JOIN tabLetreiroConfig c
          ON c.HostName = i.HostName AND c.WindowsUser = i.WindowsUser
        ORDER BY i.LastSeen DESC
        """
    )
    now = datetime.now()
    items = []
    for row in rows or []:
        seen = _as_datetime(row.get("LastSeen"))
        online = bool(seen and (now - seen) <= timedelta(seconds=ONLINE_SECONDS))
        items.append(
            {
                "hostName": row.get("HostName") or "",
                "windowsUser": row.get("WindowsUser") or "",
                "nome": row.get("Nome") or "",
                "setor": row.get("Setor") or "",
                "version": row.get("Version") or "",
                "ponto": row.get("Ponto") or "",
                "lastSeen": row.get("LastSeen"),
                "online": online,
                "hasConfig": bool(row.get("ConfigHost")),
            }
        )
    return {"instances": items}


@router.put("/instances")
async def put_instance_profile(
    body: InstanceProfilePut,
    x_letreiro_windows_user: Optional[str] = Header(default=None, alias="X-Letreiro-Windows-User"),
):
    _require_admin(x_letreiro_windows_user or body.windows_user)
    host = _clip(body.host_name, 128)
    target = _clip(body.target_user, 128)
    if not host or not target:
        raise HTTPException(status_code=400, detail="hostName e targetUser são obrigatórios.")
    rows = db.execute_query(
        """
        SELECT HostName FROM tabLetreiroInstancia
        WHERE HostName = %s AND WindowsUser = %s
        LIMIT 1
        """,
        (host, target),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Instância não encontrada.")
    db.execute_query(
        """
        UPDATE tabLetreiroInstancia
        SET Nome = %s, Setor = %s
        WHERE HostName = %s AND WindowsUser = %s
        """,
        (_clip(body.nome, 128), _clip(body.setor, 128), host, target),
    )
    return {"status": "ok"}


def _upsert_config(host: str, user: str, payload_json: str, updated_by: str) -> None:
    db.execute_query(
        """
        INSERT INTO tabLetreiroConfig (HostName, WindowsUser, Payload, UpdatedAt, UpdatedBy)
        VALUES (%s, %s, %s, NOW(), %s)
        ON DUPLICATE KEY UPDATE
            Payload = VALUES(Payload),
            UpdatedAt = NOW(),
            UpdatedBy = VALUES(UpdatedBy)
        """,
        (host, user, payload_json, updated_by),
    )


@router.put("/config")
async def put_config(
    body: LetreiroConfigPut,
    x_letreiro_windows_user: Optional[str] = Header(default=None, alias="X-Letreiro-Windows-User"),
):
    actor = _require_admin(x_letreiro_windows_user or body.windows_user)
    try:
        payload_json = json.dumps(body.payload)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Payload inválido.") from exc

    if body.apply_to_all:
        rows = db.execute_query("SELECT HostName, WindowsUser FROM tabLetreiroInstancia")
        if not rows:
            raise HTTPException(status_code=400, detail="Nenhuma instância conhecida.")
        for row in rows:
            _upsert_config(
                _clip(row.get("HostName"), 128),
                _clip(row.get("WindowsUser"), 128),
                payload_json,
                actor,
            )
        return {"status": "ok", "updated": len(rows)}

    host = _clip(body.host_name, 128)
    target = _clip(body.target_user, 128)
    if not host or not target:
        raise HTTPException(status_code=400, detail="hostName e targetUser são obrigatórios.")
    _upsert_config(host, target, payload_json, actor)
    return {"status": "ok", "updated": 1}


@router.get("/commands")
async def list_commands(
    x_letreiro_windows_user: Optional[str] = Header(default=None, alias="X-Letreiro-Windows-User"),
    windows_user: Optional[str] = Query(default=None, alias="windowsUser"),
):
    _require_admin(x_letreiro_windows_user or windows_user)
    rows = db.execute_query(
        """
        SELECT Id, Nome, Tipo, Conteudo, TimeoutSec, CreatedBy, UpdatedBy, CreatedAt, UpdatedAt
        FROM tabLetreiroComando
        ORDER BY Nome
        """
    )
    return {"commands": [_serialize_command(row) for row in rows or []]}


@router.post("/commands")
async def create_command(
    body: LetreiroCommandBody,
    x_letreiro_windows_user: Optional[str] = Header(default=None, alias="X-Letreiro-Windows-User"),
):
    actor = _require_admin(x_letreiro_windows_user or body.windows_user)
    nome = _validate_name(body.name)
    kind = _normalize_kind(body.kind)
    content = _validate_content(body.content)
    timeout = _clamp_timeout(body.timeout_sec)
    try:
        command_id = _insert_returning_id(
            """
            INSERT INTO tabLetreiroComando
                (Nome, Tipo, Conteudo, TimeoutSec, CreatedBy, UpdatedBy, CreatedAt, UpdatedAt)
            VALUES (%s, %s, %s, %s, %s, %s, NOW(), NOW())
            """,
            (nome, kind, content, timeout, actor, actor),
        )
    except DatabaseConnectionError as exc:
        if _is_duplicate_name(exc):
            raise HTTPException(status_code=409, detail="Já existe um comando com esse nome.") from exc
        raise
    return {"status": "ok", "id": command_id}


@router.put("/commands/{command_id}")
async def update_command(
    command_id: int,
    body: LetreiroCommandBody,
    x_letreiro_windows_user: Optional[str] = Header(default=None, alias="X-Letreiro-Windows-User"),
):
    actor = _require_admin(x_letreiro_windows_user or body.windows_user)
    _load_command(command_id)
    nome = _validate_name(body.name)
    kind = _normalize_kind(body.kind)
    content = _validate_content(body.content)
    timeout = _clamp_timeout(body.timeout_sec)
    try:
        db.execute_query(
            """
            UPDATE tabLetreiroComando
            SET Nome = %s, Tipo = %s, Conteudo = %s, TimeoutSec = %s, UpdatedBy = %s, UpdatedAt = NOW()
            WHERE Id = %s
            """,
            (nome, kind, content, timeout, actor, command_id),
        )
    except DatabaseConnectionError as exc:
        if _is_duplicate_name(exc):
            raise HTTPException(status_code=409, detail="Já existe um comando com esse nome.") from exc
        raise
    return {"status": "ok"}


@router.delete("/commands/{command_id}")
async def delete_command(
    command_id: int,
    x_letreiro_windows_user: Optional[str] = Header(default=None, alias="X-Letreiro-Windows-User"),
    windows_user: Optional[str] = Query(default=None, alias="windowsUser"),
):
    _require_admin(x_letreiro_windows_user or windows_user)
    _load_command(command_id)
    db.execute_query("DELETE FROM tabLetreiroComando WHERE Id = %s", (command_id,))
    return {"status": "ok"}


@router.post("/commands/{command_id}/run")
async def run_command(
    command_id: int,
    body: CommandRunBody,
    x_letreiro_windows_user: Optional[str] = Header(default=None, alias="X-Letreiro-Windows-User"),
):
    actor = _require_admin(x_letreiro_windows_user or body.windows_user)
    command = _load_command(command_id)
    content, missing = render_command_content(command.get("Conteudo"), body.variables)
    if missing:
        raise HTTPException(
            status_code=400,
            detail="Preencha as variáveis: " + ", ".join(missing),
        )
    queued = _enqueue_jobs(
        command_id=command_id,
        name=command.get("Nome") or "",
        kind=command.get("Tipo") or "",
        content=content,
        timeout=_row_int(command, "TimeoutSec") or TIMEOUT_DEFAULT,
        actor=actor,
        targets=_collect_run_targets(body),
    )
    return {"status": "ok", "queued": queued}


@router.post("/jobs/run")
async def run_adhoc(
    body: AdhocRunBody,
    x_letreiro_windows_user: Optional[str] = Header(default=None, alias="X-Letreiro-Windows-User"),
):
    actor = _require_admin(x_letreiro_windows_user or body.windows_user)
    kind = _normalize_kind(body.kind)
    content = _validate_content(body.content)
    timeout = _clamp_timeout(body.timeout_sec)
    name = _clip(body.name, 128) or "terminal"
    queued = _enqueue_jobs(
        command_id=None,
        name=name,
        kind=kind,
        content=content,
        timeout=timeout,
        actor=actor,
        targets=_collect_run_targets(body),
    )
    return {"status": "ok", "queued": queued}


@router.get("/settings")
async def get_settings():
    return {"commandPollIntervalSec": _command_poll_interval()}


@router.put("/settings")
async def put_settings(
    body: LetreiroSettingsPut,
    x_letreiro_windows_user: Optional[str] = Header(default=None, alias="X-Letreiro-Windows-User"),
):
    actor = _require_admin(x_letreiro_windows_user or body.windows_user)
    interval = _clamp_command_poll(body.command_poll_interval_sec)
    db.execute_query(
        """
        INSERT INTO tabLetreiroAjuste (Id, CommandPollIntervalSec, UpdatedBy, UpdatedAt)
        VALUES (1, %s, %s, NOW())
        ON DUPLICATE KEY UPDATE
            CommandPollIntervalSec = VALUES(CommandPollIntervalSec),
            UpdatedBy = VALUES(UpdatedBy),
            UpdatedAt = NOW()
        """,
        (interval, actor),
    )
    return {"status": "ok", "commandPollIntervalSec": interval}


@router.get("/jobs/pending")
async def pending_job(
    host: str = Query(..., min_length=1),
    user: str = Query(..., min_length=1),
):
    interval = _command_poll_interval()
    _expire_stale_running_jobs()
    job = _claim_pending_job(_clip(host, 128), _clip(user, 128))
    return {
        "job": _serialize_job(job, include_content=True) if job else None,
        "pollIntervalSec": interval,
    }


@router.get("/jobs")
async def list_jobs(
    x_letreiro_windows_user: Optional[str] = Header(default=None, alias="X-Letreiro-Windows-User"),
    windows_user: Optional[str] = Query(default=None, alias="windowsUser"),
    host: Optional[str] = Query(default=None),
    status: Optional[str] = Query(default=None),
):
    _require_admin(x_letreiro_windows_user or windows_user)
    _expire_stale_running_jobs()
    clauses = []
    params: list[Any] = []
    if host:
        clauses.append("HostName = %s")
        params.append(_clip(host, 128))
    if status:
        clauses.append("Status = %s")
        params.append(_clip(status, 16))
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    rows = db.execute_query(
        f"""
        SELECT Id, ComandoId, Nome, Tipo, TimeoutSec, HostName, WindowsUser, Status,
               ExitCode, Stdout, Stderr, CreatedBy, CreatedAt, StartedAt, FinishedAt
        FROM tabLetreiroComandoJob
        {where}
        ORDER BY Id DESC
        LIMIT 200
        """,
        tuple(params) if params else None,
    )
    return {"jobs": [_serialize_job(row) for row in rows or []]}


@router.delete("/jobs")
async def clear_jobs(
    x_letreiro_windows_user: Optional[str] = Header(default=None, alias="X-Letreiro-Windows-User"),
    windows_user: Optional[str] = Query(default=None, alias="windowsUser"),
):
    _require_admin(x_letreiro_windows_user or windows_user)
    db.execute_query("DELETE FROM tabLetreiroComandoJob")
    return {"status": "ok"}


@router.post("/jobs/{job_id}/result")
async def post_job_result(job_id: int, body: JobResultBody):
    host = _clip(body.host_name, 128)
    user = _clip(body.windows_user, 128)
    if not host or not user:
        raise HTTPException(status_code=400, detail="hostName e windowsUser são obrigatórios.")
    rows = db.execute_query(
        """
        SELECT Id, HostName, WindowsUser, Status
        FROM tabLetreiroComandoJob
        WHERE Id = %s
        LIMIT 1
        """,
        (job_id,),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Job não encontrado.")
    row = rows[0]
    if (row.get("HostName") or "") != host or (row.get("WindowsUser") or "") != user:
        raise HTTPException(status_code=403, detail="Job não pertence a esta instância.")
    if (row.get("Status") or "") != JOB_STATUS_RUNNING:
        raise HTTPException(status_code=409, detail="Job não está em execução.")
    status = JOB_STATUS_TIMEOUT if body.timed_out else (
        JOB_STATUS_OK if body.exit_code == 0 else JOB_STATUS_FAIL
    )
    db.execute_query(
        """
        UPDATE tabLetreiroComandoJob
        SET Status = %s, ExitCode = %s, Stdout = %s, Stderr = %s, FinishedAt = NOW()
        WHERE Id = %s AND Status = %s
        """,
        (
            status,
            body.exit_code,
            _clip_output(body.stdout),
            _clip_output(body.stderr),
            job_id,
            JOB_STATUS_RUNNING,
        ),
    )
    return {"status": "ok"}
