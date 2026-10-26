"""SAGRA — letreiro compacto sobre a barra de tarefas do Windows."""
from __future__ import annotations

import logging
import os
import sys
import threading
from pathlib import Path

__version__ = "1.1.4"

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from config_store import load_config  # noqa: E402
from overlay import LetreiroOverlay  # noqa: E402
from settings_ui import SettingsWindow  # noqa: E402
from taskbar import enable_dpi_awareness, notify_already_running  # noqa: E402

LOG_DIR = Path(os.environ.get("LOCALAPPDATA") or ROOT) / "SagraLetreiro"
LOCK_NAME = "letreiro.lock"
_lock_fh = None


class _LogWriter:
    """Substitui stdout/stderr nulos do exe sem console — o Tk aborta se printar neles."""

    def __init__(self, logger: logging.Logger) -> None:
        self._logger = logger
        self._busy = False

    def write(self, message: str) -> int:
        text = (message or "").rstrip()
        if text and not self._busy:
            self._busy = True
            try:
                self._logger.error(text)
            finally:
                self._busy = False
        return len(message or "")

    def flush(self) -> None:
        pass

    def isatty(self) -> bool:
        return False


def _setup_logging() -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_path = LOG_DIR / "letreiro.log"
    handlers: list[logging.Handler] = [logging.FileHandler(log_path, encoding="utf-8")]
    if sys.stdout is not None:
        handlers.append(logging.StreamHandler(sys.stdout))
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=handlers,
    )
    log = logging.getLogger("sagra.letreiro")
    sink = _LogWriter(log)
    if sys.stdout is None:
        sys.stdout = sink  # type: ignore[assignment]
    if sys.stderr is None:
        sys.stderr = sink  # type: ignore[assignment]
    sys.excepthook = _excepthook
    threading.excepthook = _thread_excepthook


def _excepthook(exc_type, exc, tb) -> None:
    logging.getLogger("sagra.letreiro").error("Exceção não tratada", exc_info=(exc_type, exc, tb))


def _thread_excepthook(args) -> None:
    logging.getLogger("sagra.letreiro").error(
        "Exceção em thread %s",
        args.thread.name if args.thread else "?",
        exc_info=(args.exc_type, args.exc_value, args.exc_traceback),
    )


def acquire_single_instance_lock():
    global _lock_fh
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    path = LOG_DIR / LOCK_NAME
    fh = open(path, "a+", encoding="utf-8")
    try:
        if os.name == "nt":
            import msvcrt

            fh.seek(0)
            msvcrt.locking(fh.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl

            fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        fh.close()
        return None
    fh.seek(0)
    fh.truncate()
    fh.write(str(os.getpid()))
    fh.flush()
    _lock_fh = fh
    return fh


class LetreiroApp:
    def __init__(self) -> None:
        self.config = load_config()
        self.overlay = LetreiroOverlay(
            self.config,
            on_open_settings=self.open_settings,
            on_quit=self._on_quit,
        )
        self._settings: SettingsWindow | None = None

    def open_settings(self) -> None:
        if self._settings is None:
            self._settings = SettingsWindow(
                self.overlay.root,
                self.overlay.config,
                self.overlay.client,
                on_save=self._on_settings_saved,
            )
        self._settings.open(self.overlay.config)

    def _on_settings_saved(self, config: dict, relogin: bool) -> None:
        self.config = config
        self.overlay.apply_config(config, relogin=relogin)

    def _on_quit(self) -> None:
        logging.getLogger("sagra.letreiro").info("Letreiro encerrado.")

    def run(self) -> None:
        self.overlay.start()


def main() -> int:
    enable_dpi_awareness()
    _setup_logging()
    log = logging.getLogger("sagra.letreiro")
    if acquire_single_instance_lock() is None:
        log.error("Já existe um letreiro em execução.")
        notify_already_running()
        return 1
    log.info("Iniciando SAGRA Letreiro %s", __version__)
    try:
        LetreiroApp().run()
    except Exception:
        log.exception("Letreiro terminou com erro")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
