"""
SAGRA — Organizador automático da caixa sepim.deapa (EWS)
==========================================================
Varre a raiz da Caixa de Entrada e a raiz dos Itens Enviados da caixa e move
as mensagens pelo assunto:

  Recebidas com "Problemas Técnicos" -> Inbox/Entrada de Prob. Tec.
  Recebidas com "Prova"              -> Inbox/Entrada de Provas
  Enviadas  com "Problemas Técnicos" -> Itens Enviados/Saida de Prob. Tec.
  Enviadas  com "Prova"              -> Itens Enviados/Saida de Provas

A única operação de escrita é MoveItem: nenhuma mensagem é apagada. Cada
movimento é registrado em logs/email_organizer/movimentos_AAAA-MM.log
(arquivos mensais, nunca removidos pelo serviço).

Uso:
  python organizador_email_sepim_service.py                 # serviço (loop)
  python organizador_email_sepim_service.py --simular --uma-vez
"""

from __future__ import annotations

import argparse
import ctypes
import logging
import os
import re
import signal
import sys
import threading
import unicodedata
from datetime import datetime
from logging.handlers import RotatingFileHandler
from typing import Any, Dict, List, Optional, Set

# ---------------------------------------------------------------------------
# Bootstrap de path
# ---------------------------------------------------------------------------
_ROOT_DIR = os.path.abspath(os.path.dirname(__file__))
if _ROOT_DIR not in sys.path:
    sys.path.insert(0, _ROOT_DIR)
_BACKEND_DIR = os.path.join(_ROOT_DIR, "app", "backend")
if os.path.isdir(_BACKEND_DIR) and _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

try:
    import config_manager  # noqa: F401,E402  (carrega config/.env)
except Exception:
    pass

from services.ews_service import (  # noqa: E402
    EWSOperationError,
    EWSService,
    EWSUnavailableError,
    MailboxFolderTarget,
)

# ---------------------------------------------------------------------------
# Configuração via ambiente
# ---------------------------------------------------------------------------
EMAIL_ORG_MAILBOX = os.getenv("EMAIL_ORG_MAILBOX", "sepim.deapa@camara.leg.br").strip()
EMAIL_ORG_INTERVAL_SEC = max(10.0, float(os.getenv("EMAIL_ORG_INTERVAL_SEC", "5")))
EMAIL_ORG_MAX_BACKOFF_SEC = float(os.getenv("EMAIL_ORG_MAX_BACKOFF_SEC", "300"))
EMAIL_ORG_LOG_DIR = os.getenv("EMAIL_ORG_LOG_DIR", "").strip()
EMAIL_ORG_MUTEX_NAME = os.getenv("EMAIL_ORG_MUTEX_NAME", r"Global\SagraOrganizadorEmailSepim")
EMAIL_ORG_MAX_FALHAS_ITEM = int(os.getenv("EMAIL_ORG_MAX_FALHAS_ITEM", "3"))
EWS_URL = os.getenv("EWS_URL", "https://ce.camara.leg.br/EWS/Exchange.asmx").strip()
EWS_VERIFY_SSL = os.getenv("EWS_VERIFY_SSL", "false").strip().lower() in ("1", "true", "yes", "sim")
EWS_TIMEOUT = int(os.getenv("EWS_TIMEOUT", "30"))
LOG_MAX_BYTES = int(os.getenv("EMAIL_ORG_LOG_MAX_BYTES", str(10 * 1024 * 1024)))
LOG_BACKUP_COUNT = int(os.getenv("EMAIL_ORG_LOG_BACKUP_COUNT", "5"))

ORIGEM_ENTRADA = "entrada"
ORIGEM_SAIDA = "saida"

PASTA_ENTRADA_PT = "Entrada de Prob. Tec."
PASTA_ENTRADA_PROVAS = "Entrada de Provas"
PASTA_SAIDA_PT = "Saida de Prob. Tec."
PASTA_SAIDA_PROVAS = "Saida de Provas"

DESTINOS: Dict[str, Dict[str, str]] = {
    ORIGEM_ENTRADA: {"pt": PASTA_ENTRADA_PT, "prova": PASTA_ENTRADA_PROVAS},
    ORIGEM_SAIDA: {"pt": PASTA_SAIDA_PT, "prova": PASTA_SAIDA_PROVAS},
}
ORIGEM_FOLDER_TYPE = {
    ORIGEM_ENTRADA: "distinguished_inbox",
    ORIGEM_SAIDA: "distinguished_sentitems",
}
ORIGEM_LABEL = {
    ORIGEM_ENTRADA: "Caixa de Entrada",
    ORIGEM_SAIDA: "Itens Enviados",
}

# Pré-filtro no Exchange (substring, sem caixa/acentos); a decisão é de classificar().
TERMOS_PREFILTRO = ["Problemas T", "Prova"]

_RE_PT = re.compile(r"\bproblemas\s+tecnicos\b")
_RE_PROVA = re.compile(r"\bprovas?\b")


# ===========================================================================
# Classificação (funções puras)
# ===========================================================================


def normalizar_assunto(assunto: str) -> str:
    texto = unicodedata.normalize("NFKD", assunto or "")
    texto = "".join(c for c in texto if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", texto).strip().lower()


def classificar(assunto: str, origem: str) -> Optional[str]:
    """Retorna o nome da pasta destino ou None. Problemas Técnicos tem prioridade."""
    destinos = DESTINOS.get(origem)
    if not destinos:
        raise ValueError(f"origem inválida: {origem}")
    normalizado = normalizar_assunto(assunto)
    if _RE_PT.search(normalizado):
        return destinos["pt"]
    if _RE_PROVA.search(normalizado):
        return destinos["prova"]
    return None


# ===========================================================================
# Logs
# ===========================================================================


def resolve_log_dir() -> str:
    log_dir = (
        os.path.abspath(EMAIL_ORG_LOG_DIR)
        if EMAIL_ORG_LOG_DIR
        else os.path.join(_ROOT_DIR, "logs", "email_organizer")
    )
    os.makedirs(log_dir, exist_ok=True)
    return log_dir


def setup_logging(log_dir: str) -> logging.Logger:
    root = logging.getLogger()
    root.handlers.clear()
    root.setLevel(logging.INFO)
    fmt = logging.Formatter("%(asctime)s - %(levelname)s - %(message)s")
    handler = RotatingFileHandler(
        os.path.join(log_dir, "organizador.log"),
        maxBytes=LOG_MAX_BYTES,
        backupCount=LOG_BACKUP_COUNT,
        encoding="utf-8",
    )
    handler.setFormatter(fmt)
    root.addHandler(handler)
    if sys.stdout is not None and hasattr(sys.stdout, "write"):
        try:
            stream = logging.StreamHandler(sys.stdout)
            stream.setFormatter(fmt)
            root.addHandler(stream)
        except Exception:
            pass
    return logging.getLogger("organizador_email_sepim")


def _campo(valor: Any) -> str:
    return re.sub(r"[\r\n|]+", " ", str(valor or "")).strip()


class MovimentoLog:
    """Log permanente de movimentos: um arquivo por mês, só append."""

    def __init__(self, log_dir: str):
        self.log_dir = log_dir
        self._lock = threading.Lock()

    def _path(self, agora: datetime) -> str:
        return os.path.join(self.log_dir, f"movimentos_{agora:%Y-%m}.log")

    def escrever(self, linha: str) -> None:
        agora = datetime.now()
        with self._lock:
            with open(self._path(agora), "a", encoding="utf-8") as fh:
                fh.write(f"{agora:%Y-%m-%d %H:%M:%S} | {linha}\n")

    def registrar(
        self,
        *,
        caixa: str,
        origem: str,
        destino: str,
        resultado: str,
        item: Dict[str, Any],
        detalhe: str = "",
    ) -> None:
        if origem == ORIGEM_ENTRADA:
            pessoa = "De: " + _campo(
                f"{item.get('from_name') or ''} <{item.get('from_email') or ''}>"
            )
            data_msg = item.get("date_received") or ""
        else:
            pessoa = "Para: " + _campo(item.get("display_to"))
            data_msg = item.get("date_sent") or item.get("date_received") or ""
        partes = [
            _campo(caixa),
            f"{ORIGEM_LABEL.get(origem, origem)} -> {destino}",
            resultado,
            f"Assunto: {_campo(item.get('subject'))}",
            pessoa,
            f"Data: {_campo(data_msg)}",
            f"Message-ID: {_campo(item.get('internet_message_id'))}",
        ]
        if detalhe:
            partes.append(f"Detalhe: {_campo(detalhe)}")
        self.escrever(" | ".join(partes))


# ===========================================================================
# Mutex de instância única
# ===========================================================================


class InstanceMutex:
    ERROR_ALREADY_EXISTS = 183

    def __init__(self, name: str = EMAIL_ORG_MUTEX_NAME):
        self.name = name
        self._handle = None

    def acquire(self) -> bool:
        if sys.platform != "win32":
            return True
        kernel32 = ctypes.windll.kernel32
        handle = kernel32.CreateMutexW(None, False, self.name)
        if not handle:
            return False
        if kernel32.GetLastError() == self.ERROR_ALREADY_EXISTS:
            kernel32.CloseHandle(handle)
            return False
        self._handle = handle
        return True

    def release(self) -> None:
        if self._handle is None:
            return
        try:
            ctypes.windll.kernel32.CloseHandle(self._handle)
        except Exception:
            pass
        self._handle = None


# ===========================================================================
# Loop principal
# ===========================================================================


class OrganizadorLoop:
    def __init__(
        self,
        ews: EWSService,
        mailbox: str,
        log: logging.Logger,
        movimentos: MovimentoLog,
        *,
        simular: bool = False,
        interval_sec: float = EMAIL_ORG_INTERVAL_SEC,
        max_backoff_sec: float = EMAIL_ORG_MAX_BACKOFF_SEC,
        max_falhas_item: int = EMAIL_ORG_MAX_FALHAS_ITEM,
    ):
        self.ews = ews
        self.mailbox = mailbox
        self.log = log
        self.movimentos = movimentos
        self.simular = simular
        self.interval_sec = interval_sec
        self.max_backoff_sec = max_backoff_sec
        self.max_falhas_item = max_falhas_item
        self._stop = threading.Event()
        self._pastas: Optional[Dict[str, Optional[str]]] = None
        self._falhas: Dict[str, int] = {}
        self._ja_simulados: Set[str] = set()

    def request_stop(self) -> None:
        self._stop.set()

    def invalidar_pastas(self) -> None:
        self._pastas = None

    def _target(self, origem: str) -> MailboxFolderTarget:
        return MailboxFolderTarget(
            mailbox=self.mailbox,
            folder_type=ORIGEM_FOLDER_TYPE[origem],
            folder_label=ORIGEM_LABEL[origem],
        )

    def _localizar_pasta(self, origem: str, nome: str) -> Optional[str]:
        parent = self._target(origem)
        folder_id = self.ews.find_folder_id(parent, nome)
        if folder_id:
            return folder_id
        alvo = normalizar_assunto(nome)
        for folder in self.ews.list_child_folders(parent):
            if normalizar_assunto(folder.get("name") or "") == alvo:
                return folder.get("id") or None
        return None

    def resolver_pastas(self) -> Dict[str, Optional[str]]:
        if self._pastas is not None:
            return self._pastas
        pastas: Dict[str, Optional[str]] = {}
        for origem, destinos in DESTINOS.items():
            for nome in destinos.values():
                pastas[nome] = self._localizar_pasta(origem, nome)
                if pastas[nome]:
                    self.log.info("Pasta '%s' localizada em %s", nome, ORIGEM_LABEL[origem])
                else:
                    self.log.error(
                        "Pasta '%s' NAO encontrada em %s de %s — mensagens para ela serao ignoradas",
                        nome, ORIGEM_LABEL[origem], self.mailbox,
                    )
        if all(pastas.values()):
            self._pastas = pastas
        return pastas

    def run_once(self) -> Dict[str, int]:
        pastas = self.resolver_pastas()
        contagem: Dict[str, int] = {}
        erros = 0
        for origem in (ORIGEM_ENTRADA, ORIGEM_SAIDA):
            itens = self.ews.find_items_by_subject_terms(self._target(origem), TERMOS_PREFILTRO)
            sem_pasta: Set[str] = set()
            for item in itens:
                if self._stop.is_set():
                    break
                destino = classificar(item.get("subject") or "", origem)
                if not destino:
                    continue
                item_id = item.get("item_id") or ""
                folder_id = pastas.get(destino)
                if not folder_id:
                    sem_pasta.add(destino)
                    continue
                if self._falhas.get(item_id, 0) >= self.max_falhas_item:
                    continue
                if self.simular:
                    if item_id in self._ja_simulados:
                        continue
                    self._ja_simulados.add(item_id)
                    self.movimentos.registrar(
                        caixa=self.mailbox, origem=origem, destino=destino,
                        resultado="SIMULACAO", item=item,
                    )
                    contagem[destino] = contagem.get(destino, 0) + 1
                    continue
                try:
                    self.ews.move_item(item_id, folder_id)
                except EWSOperationError as exc:
                    erros += 1
                    falhas = self._falhas.get(item_id, 0) + 1
                    self._falhas[item_id] = falhas
                    detalhe = str(exc)
                    if falhas >= self.max_falhas_item:
                        detalhe += f" (ignorado apos {falhas} falhas ate reiniciar o servico)"
                    self.movimentos.registrar(
                        caixa=self.mailbox, origem=origem, destino=destino,
                        resultado="ERRO", item=item, detalhe=detalhe,
                    )
                    self.log.warning("Falha ao mover '%s': %s", item.get("subject"), exc)
                    if "Folder" in (exc.response_code or ""):
                        self.invalidar_pastas()
                    continue
                self._falhas.pop(item_id, None)
                self.movimentos.registrar(
                    caixa=self.mailbox, origem=origem, destino=destino,
                    resultado="MOVIDO", item=item,
                )
                contagem[destino] = contagem.get(destino, 0) + 1
            for destino in sem_pasta:
                self.log.error("Mensagens para '%s' ignoradas: pasta inexistente", destino)
        total = sum(contagem.values())
        if total or erros:
            resumo = ", ".join(f"{nome}: {qtd}" for nome, qtd in sorted(contagem.items())) or "nenhum"
            acao = "simulados" if self.simular else "movidos"
            self.movimentos.escrever(
                f"{self.mailbox} | RESUMO DO CICLO | {total} {acao} ({resumo}) | erros: {erros}"
            )
        self.log.info("Ciclo concluido: %s itens %s, %s erros",
                      total, "simulados" if self.simular else "movidos", erros)
        return contagem

    def run(self, *, uma_vez: bool = False) -> int:
        self.log.info(
            "Organizador iniciado: caixa=%s intervalo=%ss simular=%s ews=%s",
            self.mailbox, self.interval_sec, self.simular, self.ews.ews_url,
        )
        falhas_seguidas = 0
        while not self._stop.is_set():
            try:
                self.run_once()
                falhas_seguidas = 0
            except EWSUnavailableError as exc:
                falhas_seguidas += 1
                self.invalidar_pastas()
                self.log.warning("Exchange indisponivel: %s", exc)
            except Exception as exc:
                falhas_seguidas += 1
                self.invalidar_pastas()
                self.log.exception("Erro no ciclo do organizador: %s", exc)
            if uma_vez:
                return 0 if falhas_seguidas == 0 else 1
            espera = self.interval_sec
            if falhas_seguidas:
                espera = min(self.interval_sec * (2 ** (falhas_seguidas - 1)), self.max_backoff_sec)
                espera = max(espera, self.interval_sec)
            self._stop.wait(espera)
        self.log.info("Organizador encerrado")
        return 0


def _parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Organizador automático da caixa sepim.deapa")
    parser.add_argument("--simular", action="store_true", help="registra o que seria movido, sem mover")
    parser.add_argument("--uma-vez", action="store_true", help="executa um único ciclo e sai")
    parser.add_argument("--caixa", default=EMAIL_ORG_MAILBOX, help="caixa a organizar")
    return parser.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = _parse_args(argv)
    log_dir = resolve_log_dir()
    log = setup_logging(log_dir)

    mutex = InstanceMutex()
    if not args.simular and not mutex.acquire():
        log.error("Outra instancia do organizador ja esta em execucao (%s)", EMAIL_ORG_MUTEX_NAME)
        return 2

    ews = EWSService(EWS_URL, verify_ssl=EWS_VERIFY_SSL, timeout=EWS_TIMEOUT)
    loop = OrganizadorLoop(ews, args.caixa, log, MovimentoLog(log_dir), simular=args.simular)

    def _handle_signal(signum, _frame):
        loop.request_stop()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            signal.signal(sig, _handle_signal)
        except Exception:
            pass
    if hasattr(signal, "SIGBREAK"):
        try:
            signal.signal(signal.SIGBREAK, _handle_signal)  # type: ignore[attr-defined]
        except Exception:
            pass

    try:
        return loop.run(uma_vez=args.uma_vez)
    finally:
        mutex.release()


if __name__ == "__main__":
    raise SystemExit(main())
