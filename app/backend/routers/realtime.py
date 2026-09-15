import asyncio
import json
import logging
import time
import threading
from typing import List, Dict, Any, Optional, Tuple
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Request, HTTPException
from database import Database, db

router = APIRouter()
logger = logging.getLogger(__name__)

from pydantic import BaseModel, ConfigDict
from services.support_ponto_utils import (
    extract_support_ticket_id,
    normalize_ponto_digits,
    ponto_matches,
)
from services.support_ws_debug import ws_log

_main_event_loop: Optional[asyncio.AbstractEventLoop] = None

# Tipos de mensagem permitidos para conexões de painel (sem sessão)
_PAINEL_WS_TYPES = frozenset({
    "system_update",
    "pcp_queue_update",
    "force_refresh",
    "pong",
})

_SUPPORT_WS_TYPES = frozenset({
    "support_chat_message",
    "support_chat_typing",
    "support_chat_resolved",
})

_BROADCAST_DEDUPE_SEC = 1.0
# Timeout por peer no fanout WS — evita hang do event loop com sockets half-open.
_WS_SEND_TIMEOUT_SEC = 2.0
_broadcast_lock = threading.Lock()
_last_broadcast_at: Dict[str, float] = {}


def bind_main_event_loop(loop: asyncio.AbstractEventLoop) -> None:
    """Registra o loop principal do Uvicorn para broadcasts a partir de threads sync."""
    global _main_event_loop
    _main_event_loop = loop
    logger.info("WebSocket: loop principal registrado para broadcast")


class SocketMessage(BaseModel):
    model_config = ConfigDict(extra="allow")

    type: str
    id: Optional[int] = None
    ano: Optional[int] = None
    action: str = None
    origem: str = None
    target_user: str = None
    target_ponto: str = None
    mensagem: str = None
    notification_id: Optional[int] = None
    overwriteConfig: bool = None
    setor: str = None
    ticket_id: Optional[int] = None
    support_message_id: Optional[int] = None
    message_id: Optional[int] = None
    message: Optional[Dict[str, Any]] = None
    author_role: Optional[str] = None
    owner_ponto: Optional[str] = None
    assigned_ponto: Optional[str] = None
    ticket_status: Optional[str] = None


class ConnectionManager:
    def __init__(self):
        self.active_connections: List[Dict[str, Any]] = []
        # ticket_id inscrito por ponto (qualquer conexão WS do usuário)
        self._ponto_subscriptions: Dict[str, set[int]] = {}
        # conn_id inscrito por ticket (qualquer socket que fez subscribe)
        self._ticket_conn_subscribers: Dict[int, set[str]] = {}

    @staticmethod
    def _ponto_key(ponto: str | int | None) -> str:
        return normalize_ponto_digits(ponto)

    def _register_ponto_subscription(self, ponto: str | int | None, ticket_id: int) -> None:
        key = self._ponto_key(ponto)
        if not key:
            return
        self._ponto_subscriptions.setdefault(key, set()).add(int(ticket_id))

    def _unregister_ponto_subscription(
        self, ponto: str | int | None, ticket_id: int, websocket: WebSocket
    ) -> None:
        key = self._ponto_key(ponto)
        if not key:
            return
        still_subscribed = any(
            c["ws"] is not websocket
            and int(ticket_id) in (c.get("support_tickets") or set())
            and self._ponto_key(c.get("ponto")) == key
            for c in self.active_connections
        )
        if still_subscribed:
            return
        bucket = self._ponto_subscriptions.get(key)
        if bucket:
            bucket.discard(int(ticket_id))
            if not bucket:
                del self._ponto_subscriptions[key]

    def _is_ponto_subscribed(self, ponto: str | int | None, ticket_id: int) -> bool:
        key = self._ponto_key(ponto)
        if not key:
            return False
        return int(ticket_id) in self._ponto_subscriptions.get(key, set())

    @staticmethod
    def _conn_id(websocket: WebSocket) -> str:
        return format(id(websocket), "x")[-8:]

    def _find_conn(self, websocket: WebSocket) -> Optional[Dict[str, Any]]:
        for conn in self.active_connections:
            if conn["ws"] is websocket:
                return conn
        return None

    async def connect(
        self,
        websocket: WebSocket,
        *,
        ponto: str | None = None,
        scope: str = "authenticated",
        cliente_id: int | None = None,
    ):
        await websocket.accept()
        conn_id = self._conn_id(websocket)
        self.active_connections.append({
            "ws": websocket,
            "conn_id": conn_id,
            "ponto": ponto,
            "scope": scope,
            "cliente_id": cliente_id,
            "support_tickets": set(),
        })

        if ponto and scope == "authenticated":
            try:
                ponto_clean = int("".join(filter(str.isdigit, str(ponto))))
                # Fora do event loop — reconnect em massa no force_refresh
                # não pode bloquear HTTP/WS com UPDATE síncrono no pool.
                await asyncio.to_thread(
                    db.execute_query,
                    "UPDATE tabUsuarios SET UltimoAcesso = NOW() WHERE Ponto = %s",
                    (ponto_clean,),
                )
            except Exception as e:
                logger.error("Erro ao atualizar ultimo acesso no WS: %s", e)

        path = ""
        try:
            path = str(getattr(websocket, "url", "") or "")
        except Exception:
            pass

        logger.info(
            "WebSocket conectado scope=%s ponto=%s total=%s",
            scope,
            ponto,
            len(self.active_connections),
        )
        ws_log(
            "[WS CONNECT] id=%s scope=%s ponto=%s cliente_id=%s path=%s total=%s",
            conn_id,
            scope,
            ponto,
            cliente_id,
            path,
            len(self.active_connections),
        )

    def disconnect(self, websocket: WebSocket):
        conn = self._find_conn(websocket)
        if conn:
            ponto = conn.get("ponto")
            conn_id = conn.get("conn_id")
            for tid in list(conn.get("support_tickets") or set()):
                self._unregister_ponto_subscription(ponto, tid, websocket)
                bucket = self._ticket_conn_subscribers.get(int(tid))
                if bucket and conn_id:
                    bucket.discard(conn_id)
                    if not bucket:
                        del self._ticket_conn_subscribers[int(tid)]
        self.active_connections = [c for c in self.active_connections if c["ws"] != websocket]
        logger.info("WebSocket desconectado. Total: %s", len(self.active_connections))

    def stats(self) -> Dict[str, Any]:
        pontos = {
            str(c.get("ponto") or "")
            for c in self.active_connections
            if c.get("ponto")
        }
        scopes: Dict[str, int] = {}
        for c in self.active_connections:
            scope = str(c.get("scope") or "unknown")
            scopes[scope] = scopes.get(scope, 0) + 1
        return {
            "connections": len(self.active_connections),
            "unique_pontos": len(pontos),
            "scopes": scopes,
        }

    def get_active_clients(self):
        clients = []
        for conn in self.active_connections:
            ws = conn["ws"]
            try:
                if ws.client:
                    clients.append(ws.client.host)
            except Exception:
                pass
        return list(set(clients))

    def get_online_users(self):
        """Retorna lista de Pontos conectados (somente sessão autenticada)."""
        return [
            c["ponto"]
            for c in self.active_connections
            if c.get("ponto") and c.get("scope") == "authenticated"
        ]

    def _should_deliver(self, conn: Dict[str, Any], message: Dict[str, Any]) -> bool:
        scope = conn.get("scope") or "authenticated"
        msg_type = message.get("type")

        if scope == "painel":
            if msg_type not in _PAINEL_WS_TYPES:
                return False

        # Notificações pessoais: entrega a qualquer sessão autenticada;
        # o cliente filtra por target_ponto/target_user.
        if msg_type == "notification_new":
            return scope == "authenticated"

        if msg_type in _SUPPORT_WS_TYPES:
            ticket_id = message.get("ticket_id")
            if ticket_id is None:
                return False
            try:
                ticket_key = int(ticket_id)
            except (TypeError, ValueError):
                return False
            subscribed_local = ticket_key in (conn.get("support_tickets") or set())
            conn_id = conn.get("conn_id")
            subscribed_ticket = bool(
                conn_id
                and conn_id in self._ticket_conn_subscribers.get(ticket_key, set())
            )
            subscribed_global = (
                scope == "authenticated"
                and conn.get("ponto")
                and self._is_ponto_subscribed(conn.get("ponto"), ticket_key)
            )
            if subscribed_local or subscribed_ticket or subscribed_global:
                return True
            if scope == "cliente":
                msg_cliente = message.get("cliente_id")
                conn_cliente = conn.get("cliente_id")
                if (
                    msg_cliente is not None
                    and conn_cliente is not None
                    and int(msg_cliente) == int(conn_cliente)
                ):
                    return True
                return False
            if scope != "authenticated":
                return False
            owner_ponto = message.get("owner_ponto")
            if owner_ponto and conn.get("ponto") and ponto_matches(owner_ponto, conn.get("ponto")):
                return True
            assigned_ponto = message.get("assigned_ponto")
            if (
                assigned_ponto
                and conn.get("ponto")
                and ponto_matches(assigned_ponto, conn.get("ponto"))
            ):
                return True
            return False

        target_user = message.get("target_user")
        if target_user is not None and str(target_user).strip():
            conn_ponto = conn.get("ponto")
            if not conn_ponto:
                return False
            target_digits = "".join(c for c in str(target_user) if c.isdigit())
            conn_digits = "".join(c for c in str(conn_ponto) if c.isdigit())
            if target_digits and conn_digits and target_digits != conn_digits:
                return False

        return True

    def _delivery_flags(
        self, conn: Dict[str, Any], message: Dict[str, Any]
    ) -> Tuple[bool, bool, bool, bool]:
        """Retorna (subscribed, owner_match, assigned_match, subscribed_global) para logs."""
        msg_type = message.get("type")
        if msg_type not in _SUPPORT_WS_TYPES:
            return False, False, False, False
        ticket_id = message.get("ticket_id")
        subscribed_local = False
        subscribed_global = False
        subscribed_ticket = False
        owner_match = False
        assigned_match = False
        if ticket_id is not None:
            try:
                ticket_key = int(ticket_id)
                subscribed_local = ticket_key in (conn.get("support_tickets") or set())
                conn_id = conn.get("conn_id")
                subscribed_ticket = bool(
                    conn_id
                    and conn_id in self._ticket_conn_subscribers.get(ticket_key, set())
                )
                if conn.get("ponto"):
                    subscribed_global = self._is_ponto_subscribed(conn.get("ponto"), ticket_key)
            except (TypeError, ValueError):
                pass
        owner_ponto = message.get("owner_ponto")
        if owner_ponto and conn.get("ponto"):
            owner_match = ponto_matches(owner_ponto, conn.get("ponto"))
        assigned_ponto = message.get("assigned_ponto")
        if assigned_ponto and conn.get("ponto"):
            assigned_match = ponto_matches(assigned_ponto, conn.get("ponto"))
        subscribed = subscribed_local or subscribed_ticket or subscribed_global
        return subscribed, owner_match, assigned_match, subscribed_global

    def _dedupe_key(self, message: Dict[str, Any]) -> Optional[str]:
        msg_type = message.get("type")
        # Mensagens de chat são eventos distintos — nunca deduplicar por ticket/OS.
        if msg_type in ("support_chat_message", "gravacao_externa_message"):
            return None
        if msg_type in _SUPPORT_WS_TYPES:
            subset = {k: message[k] for k in sorted(message) if k in (
                "type", "ticket_id", "owner_ponto",
            )}
            if msg_type == "support_chat_typing":
                subset["typing"] = message.get("typing")
                subset["author_role"] = message.get("author_role")
            return json.dumps(subset, sort_keys=True, default=str)
        subset = {k: message[k] for k in sorted(message) if k in (
            "type", "id", "ano", "action", "target_user", "setor", "origem",
            "overwriteConfig",
            "gravacao_message_id", "message_id",
            "os_ano", "os_nro", "gravacao_externa_id",
        )}
        return json.dumps(subset, sort_keys=True, default=str)

    async def broadcast(self, message: Dict[str, Any]):
        key = self._dedupe_key(message)
        if key is not None:
            now = time.monotonic()
            with _broadcast_lock:
                last = _last_broadcast_at.get(key)
                if last is not None and (now - last) < _BROADCAST_DEDUPE_SEC:
                    logger.debug("Broadcast WS deduplicado: %s", message.get("type"))
                    ws_log(
                        "[SUPPORT BROADCAST] deduplicated type=%s ticket=%s",
                        message.get("type"),
                        message.get("ticket_id"),
                    )
                    return
                _last_broadcast_at[key] = now

        msg_type = message.get("type")
        if msg_type in _SUPPORT_WS_TYPES:
            msg_obj = message.get("message") or {}
            message_id = msg_obj.get("Id") if isinstance(msg_obj, dict) else None
            ws_log(
                "[SUPPORT BROADCAST] ticket=%s message=%s owner=%s assigned=%s "
                "event=%s candidates=%s",
                message.get("ticket_id"),
                message_id,
                message.get("owner_ponto"),
                message.get("assigned_ponto"),
                msg_type,
                len(self.active_connections),
            )

        if not self.active_connections:
            logger.debug("Broadcast WS sem clientes: %s", message.get("type"))

        targets: List[Dict[str, Any]] = []
        for conn in self.active_connections:
            subscribed, owner_match, assigned_match, subscribed_global = self._delivery_flags(
                conn, message
            )
            should_deliver = self._should_deliver(conn, message)
            if msg_type in _SUPPORT_WS_TYPES:
                reason = "delivered" if should_deliver else "rejected"
                if not should_deliver:
                    if conn.get("scope") != "authenticated" and msg_type in _SUPPORT_WS_TYPES:
                        reason = "scope_mismatch"
                    elif not subscribed and not owner_match and not assigned_match:
                        reason = "no_subscribe_or_ponto_match"
                support_tickets = conn.get("support_tickets") or set()
                ws_log(
                    "[SUPPORT DELIVERY CHECK] conn=%s ponto=%s ticket=%s "
                    "support_tickets=%s subscribed=%s subscribed_global=%s "
                    "owner_ponto=%s owner_match=%s assigned_ponto=%s assigned_match=%s "
                    "delivered=%s reason=%s",
                    conn.get("conn_id"),
                    conn.get("ponto"),
                    message.get("ticket_id"),
                    sorted(support_tickets),
                    subscribed,
                    subscribed_global,
                    message.get("owner_ponto"),
                    owner_match,
                    message.get("assigned_ponto"),
                    assigned_match,
                    should_deliver,
                    reason,
                )
                ws_log(
                    "[SUPPORT DELIVERY] event=%s ticket=%s conn=%s scope=%s ponto=%s "
                    "subscribed=%s owner_match=%s assigned_match=%s delivered=%s reason=%s",
                    msg_type,
                    message.get("ticket_id"),
                    conn.get("conn_id"),
                    conn.get("scope"),
                    conn.get("ponto"),
                    subscribed,
                    owner_match,
                    assigned_match,
                    should_deliver,
                    reason,
                )
            if should_deliver:
                targets.append(conn)

        async def _send_one(conn: Dict[str, Any]) -> Optional[Dict[str, Any]]:
            websocket = conn["ws"]
            try:
                await asyncio.wait_for(
                    websocket.send_json(message),
                    timeout=_WS_SEND_TIMEOUT_SEC,
                )
                return None
            except Exception as exc:
                logger.error(
                    "Erro ao enviar mensagem WS (timeout=%ss): %s",
                    _WS_SEND_TIMEOUT_SEC,
                    exc,
                )
                return conn

        if not targets:
            return

        results = await asyncio.gather(
            *(_send_one(conn) for conn in targets),
            return_exceptions=True,
        )
        to_remove: List[Dict[str, Any]] = []
        for result in results:
            if isinstance(result, Exception):
                logger.error("Erro inesperado no fanout WS: %s", result)
                continue
            if result is not None:
                to_remove.append(result)

        for conn in to_remove:
            self.disconnect(conn["ws"])

    def subscribe_support_ticket(
        self, websocket: WebSocket, ticket_id: int
    ) -> Tuple[set[int], set[int], bool, str]:
        conn = self._find_conn(websocket)
        if conn is None:
            return set(), set(), False, "conn_not_found"
        before = set(conn.get("support_tickets") or set())
        tickets = conn.setdefault("support_tickets", set())
        tickets.add(int(ticket_id))
        after = set(tickets)
        conn_id = conn.get("conn_id")
        if conn_id:
            self._ticket_conn_subscribers.setdefault(int(ticket_id), set()).add(conn_id)
        ponto = conn.get("ponto")
        if ponto:
            self._register_ponto_subscription(ponto, ticket_id)
        return before, after, True, "ok"

    def unsubscribe_support_ticket(
        self, websocket: WebSocket, ticket_id: int
    ) -> Tuple[set[int], set[int], str]:
        conn = self._find_conn(websocket)
        if conn is None:
            return set(), set(), "conn_not_found"
        before = set(conn.get("support_tickets") or set())
        tickets = conn.get("support_tickets")
        if tickets:
            tickets.discard(int(ticket_id))
        after = set(tickets or set())
        conn_id = conn.get("conn_id")
        bucket = self._ticket_conn_subscribers.get(int(ticket_id))
        if bucket and conn_id:
            bucket.discard(conn_id)
            if not bucket:
                del self._ticket_conn_subscribers[int(ticket_id)]
        self._unregister_ponto_subscription(conn.get("ponto"), ticket_id, websocket)
        return before, after, "ok"

    async def relay_support_typing(
        self,
        websocket: WebSocket,
        *,
        ticket_id: int,
        author_role: str,
        author_label: str,
        typing: bool,
        owner_ponto: str,
        assigned_ponto: str | None = None,
        cliente_id: int | None = None,
    ) -> None:
        payload: Dict[str, Any] = {
            "type": "support_chat_typing",
            "ticket_id": int(ticket_id),
            "owner_ponto": normalize_ponto_digits(owner_ponto) or str(owner_ponto).strip(),
            "author_role": author_role,
            "author_label": author_label,
            "typing": bool(typing),
        }
        if assigned_ponto:
            payload["assigned_ponto"] = (
                normalize_ponto_digits(assigned_ponto) or str(assigned_ponto).strip()
            )
        if cliente_id:
            payload["cliente_id"] = int(cliente_id)
        to_remove = []
        delivered: List[str] = []
        for conn in self.active_connections:
            if conn["ws"] is websocket:
                continue
            subscribed, owner_match, assigned_match, _sub_global = self._delivery_flags(
                conn, payload
            )
            if not self._should_deliver(conn, payload):
                ws_log(
                    "[SUPPORT TYPING] skip conn=%s ponto=%s subscribed=%s owner_match=%s",
                    conn.get("conn_id"),
                    conn.get("ponto"),
                    subscribed,
                    owner_match,
                )
                continue
            try:
                await conn["ws"].send_json(payload)
                delivered.append(f"{conn.get('conn_id')}:{conn.get('ponto')}")
            except Exception as exc:
                logger.error("Erro ao enviar typing WS: %s", exc)
                to_remove.append(conn)
        ws_log(
            "[SUPPORT TYPING] ticket=%s author=%s typing=%s delivered_to=%s payload=%s",
            ticket_id,
            author_role,
            typing,
            delivered,
            {"author_label": author_label, "typing": typing},
        )
        for conn in to_remove:
            self.disconnect(conn["ws"])


manager = ConnectionManager()


def broadcast_os_system_update(
    nro: int,
    ano: int,
    action: str,
    *,
    setor: str | None = None,
    situacao: str | None = None,
    sub_os_id: int | None = None,
    scope: str | None = None,
    origem: str = "api",
) -> None:
    """
    Refresh da materializada + WebSocket para a home e painéis.

    Qualquer alteração em tabAndamento deve acabar aqui (via after_andamento_changed).
    """
    if not nro or not ano:
        return

    from services.os_andamento_post_change_service import after_andamento_changed

    after_andamento_changed(
        nro,
        ano,
        action,
        source=origem,
        notify=True,
        setor=setor,
        situacao=situacao,
        sub_os_id=sub_os_id,
        scope=scope,
    )


def schedule_broadcast(message: Dict[str, Any]) -> None:
    """Dispara broadcast a partir de rotas sync (thread pool) ou async."""

    async def _run() -> None:
        await manager.broadcast(message)

    def _log_task_error(task: asyncio.Task) -> None:
        if task.cancelled():
            return
        exc = task.exception()
        if exc is not None:
            logger.error(
                "Broadcast WS falhou: type=%s err=%s",
                message.get("type"),
                exc,
            )

    try:
        loop = asyncio.get_running_loop()
        task = loop.create_task(_run())
        task.add_done_callback(_log_task_error)
        return
    except RuntimeError:
        pass

    main_loop = _main_event_loop
    if main_loop is not None and main_loop.is_running():
        try:
            future = asyncio.run_coroutine_threadsafe(_run(), main_loop)

            def _done(f: "asyncio.Future[None]") -> None:
                try:
                    f.result()
                except Exception as exc:
                    logger.error(
                        "Broadcast WS falhou (async): type=%s err=%s",
                        message.get("type"),
                        exc,
                    )

            future.add_done_callback(_done)
            return
        except Exception as exc:
            logger.error("Erro ao agendar broadcast WS (main loop): %s", exc)
            return

    logger.warning(
        "Broadcast WS ignorado (sem loop): type=%s id=%s",
        message.get("type"),
        message.get("id"),
    )


@router.post("/api/realtime/notify")
async def send_notification(request: Request):
    """
    Endpoint para scripts externos (sync/monitor) ou MASTER dispararem WebSocket.
    Exige X-Sagra-Notify-Secret, IP privilegiado (legado) ou sessão MASTER.
    """
    from security.notify_auth import is_notify_authorized

    if not is_notify_authorized(request):
        raise HTTPException(status_code=403, detail="Notificação não autorizada.")
    try:
        body = await request.json()
        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail="Payload inválido.")
        from services.admin_reload_state import (
            is_admin_force_reload,
            record_admin_reload,
        )

        if is_admin_force_reload(body):
            # Só epoch/poll — fanout WS no mesmo event loop congela a API
            # com sockets half-open (wait_for não interrompe send_json bloqueante).
            record_admin_reload(
                overwrite_config=bool(body.get("overwriteConfig")),
            )
            return {
                "status": "queued",
                "listeners": len(manager.active_connections),
                "delivery": "poll",
            }
        schedule_broadcast(body)
        return {"status": "queued", "listeners": len(manager.active_connections)}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Erro no notify: %s", e)
        return {"status": "error", "detail": "Erro ao enfileirar notificação."}


@router.get("/api/realtime/admin-reload")
def get_admin_reload_command():
    """Epoch do último Atualizar Clients — fallback HTTP quando o WS falha."""
    from services.admin_reload_state import get_admin_reload_state

    return get_admin_reload_state()


async def _handle_websocket(websocket: WebSocket) -> None:
    from security.session_auth import get_websocket_session, is_cliente_session

    session = get_websocket_session(websocket)
    if session is not None and is_cliente_session(session):
        scope = "cliente"
        ponto = None
        cliente_id = int(session.cliente_id or 0) or None
    elif session is not None:
        scope = "authenticated"
        ponto = str(session.ponto)
        cliente_id = None
    else:
        scope = "painel"
        ponto = None
        cliente_id = None

    await manager.connect(
        websocket,
        ponto=ponto,
        scope=scope,
        cliente_id=cliente_id,
    )
    try:
        while True:
            try:
                raw = await websocket.receive_text()
            except WebSocketDisconnect:
                raise
            except Exception as recv_exc:
                logger.warning("WebSocket receive erro: %s", recv_exc)
                break
            if not raw:
                continue
            try:
                payload = json.loads(raw)
            except Exception:
                payload = None
            if not isinstance(payload, dict):
                continue
            msg_type = payload.get("type")
            if msg_type == "ping":
                await websocket.send_json({"type": "pong"})
                continue
            if msg_type == "support_subscribe":
                ticket_id = extract_support_ticket_id(payload)
                conn = manager._find_conn(websocket)
                conn_id = conn.get("conn_id") if conn else "?"
                conn_ponto = conn.get("ponto") if conn else ponto
                meta = None
                accepted = False
                reason = "invalid_ticket_id"
                before: set[int] = set()
                after: set[int] = set()
                if ticket_id is not None:
                    before, after, accepted, reason = manager.subscribe_support_ticket(
                        websocket, ticket_id
                    )
                    try:
                        from services.support_realtime_service import get_ticket_ws_meta

                        meta = get_ticket_ws_meta(ticket_id)
                    except Exception as meta_exc:
                        logger.warning(
                            "Meta WS ticket %s indisponível: %s", ticket_id, meta_exc
                        )
                        meta = None
                    if accepted:
                        reason = "ok"
                ws_log(
                    "[SUPPORT SUBSCRIBE RECEIVED] conn=%s ponto=%s raw=%s ticket_id=%s "
                    "before_support_tickets=%s after_support_tickets=%s accepted=%s reason=%s "
                    "exists=%s owner=%s assigned=%s cliente_id=%s",
                    conn_id,
                    conn_ponto,
                    payload,
                    ticket_id,
                    sorted(before),
                    sorted(after),
                    accepted,
                    reason,
                    meta is not None,
                    meta.get("owner_ponto") if meta else None,
                    meta.get("assigned_ponto") if meta else None,
                    meta.get("cliente_id") if meta else None,
                )
                continue
            if msg_type == "support_unsubscribe":
                ticket_id = extract_support_ticket_id(payload)
                conn = manager._find_conn(websocket)
                conn_id = conn.get("conn_id") if conn else "?"
                conn_ponto = conn.get("ponto") if conn else ponto
                reason = "invalid_ticket_id"
                before = set()
                after = set()
                if ticket_id is not None:
                    before, after, reason = manager.unsubscribe_support_ticket(
                        websocket, ticket_id
                    )
                ws_log(
                    "[SUPPORT UNSUBSCRIBE RECEIVED] conn=%s ponto=%s raw=%s ticket_id=%s "
                    "before_support_tickets=%s after_support_tickets=%s reason=%s",
                    conn_id,
                    conn_ponto,
                    payload,
                    ticket_id,
                    sorted(before),
                    sorted(after),
                    reason,
                )
                continue
            if msg_type in ("support_typing", "support_typing_stop"):
                ticket_id = payload.get("ticket_id")
                if ticket_id is None:
                    continue
                ws_log(
                    "[SUPPORT TYPING RX] conn=%s ponto=%s ticket=%s type=%s author=%s",
                    manager._find_conn(websocket).get("conn_id")
                    if manager._find_conn(websocket)
                    else "?",
                    ponto,
                    ticket_id,
                    msg_type,
                    payload.get("author_role"),
                )
                from services.support_realtime_service import get_ticket_ws_meta

                meta = get_ticket_ws_meta(int(ticket_id))
                if not meta:
                    continue
                await manager.relay_support_typing(
                    websocket,
                    ticket_id=int(ticket_id),
                    author_role=str(payload.get("author_role") or "usuario"),
                    author_label=str(payload.get("author_label") or ""),
                    typing=msg_type == "support_typing",
                    owner_ponto=str(meta.get("owner_ponto") or ""),
                    assigned_ponto=str(meta.get("assigned_ponto") or "") or None,
                    cliente_id=meta.get("cliente_id"),
                )
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.error("Erro inesperado no WebSocket: %s", exc)
    finally:
        manager.disconnect(websocket)


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await _handle_websocket(websocket)


@router.websocket("/api/ws")
@router.websocket("/api/ws/")
async def websocket_endpoint_api(websocket: WebSocket):
    """Alias para Nginx (`/sagra/api/ws/` -> backend `/api/ws/`)."""
    await _handle_websocket(websocket)


@router.get("/api/users/online")
def get_online_users_list():
    """Retorna lista de Pontos dos usuários conectados via WebSocket"""
    return manager.get_online_users()


@router.get("/api/admin/active_clients")
async def get_active_clients():
    """
    Retorna lista de clientes conectados via WebSocket com detalhes do banco.
    """
    try:
        active_ips = manager.get_active_clients()

        if not active_ips:
            return []

        db = Database()

        placeholders = ", ".join(["%s"] * len(active_ips))
        query = f"SELECT ip, descricao, grupo, ativo FROM ip_permissions WHERE ip IN ({placeholders})"

        try:
            with db.cursor() as cursor:
                cursor.execute(query, tuple(active_ips))
                db_info = cursor.fetchall()
        except Exception as e:
            logger.error("Erro buscando info de IPs ativos: %s", e)
            db_info = []

        info_map = {row["ip"]: row for row in db_info} if db_info else {}

        result = []
        for ip in active_ips:
            info = info_map.get(ip, {})
            result.append({
                "ip": ip,
                "descricao": info.get("descricao", "Desconhecido (Sem cadastro)"),
                "grupo": info.get("grupo", "Visitante"),
                "ativo_cadastro": info.get("ativo", False),
                "status_realtime": "Online",
            })

        return result
    except Exception as e:
        logger.error("Erro no endpoint active_clients: %s", e)
        return []
