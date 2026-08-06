import datetime
import logging
import os
import shutil
import subprocess
import time
from pathlib import Path

from config_manager import config_manager

# Configuracoes gerais
mysql_cfg = config_manager.get_mysql_config()
MYSQL_USER = mysql_cfg["user"]
MYSQL_PASSWORD = mysql_cfg["password"]
MYSQL_DATABASE = mysql_cfg["database"]
MYSQL_HOST = mysql_cfg["host"]
MYSQL_PORT = int(mysql_cfg["port"])
BACKUP_DIR = Path(
    config_manager.get(
        "mysql_backup_dir",
        r"I:\ControleDeTrabalhos\BaseDeDados - SAGRA2\BackupMySQL",
    )
)
LOG_FILE = BACKUP_DIR / "backup_log.txt"
SCHEDULE_TIMES = {"06:00", "10:00", "14:00", "18:00", "22:00"}
POLL_SECONDS = 60


def setup_logging() -> None:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=[
            logging.FileHandler(LOG_FILE, encoding="utf-8"),
            logging.StreamHandler(),
        ],
    )


def resolve_mysqldump() -> str:
    # Prefer PATH first
    dump_bin = shutil.which("mysqldump")
    if dump_bin:
        return dump_bin

    # Common Windows MySQL installation path (without XAMPP)
    candidates = [
        r"C:\Program Files\MySQL\MySQL Server 9.7\bin\mysqldump.exe",
        r"C:\Program Files\MySQL\MySQL Server 9.6\bin\mysqldump.exe",
        r"C:\Program Files\MySQL\MySQL Server 9.5\bin\mysqldump.exe",
        r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqldump.exe",
        r"C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqldump.exe",
    ]
    for candidate in candidates:
        if os.path.exists(candidate):
            return candidate

    raise FileNotFoundError(
        "mysqldump nao encontrado no PATH nem em caminhos comuns de instalacao MySQL."
    )


def is_business_day(dt: datetime.datetime) -> bool:
    # 0=segunda, 4=sexta
    return dt.weekday() < 5


def subtract_business_hours(dt: datetime.datetime, hours: int) -> datetime.datetime:
    # Retrocede considerando apenas horas em dias uteis
    current = dt
    remaining = hours
    while remaining > 0:
        current -= datetime.timedelta(hours=1)
        if is_business_day(current):
            remaining -= 1
    return current


def run_backup(mysqldump_path: str, now: datetime.datetime) -> Path:
    filename = f"{MYSQL_DATABASE}_{now.strftime('%Y%m%d_%H%M%S')}.sql"
    backup_path = BACKUP_DIR / filename

    cmd = [
        mysqldump_path,
        "-h",
        MYSQL_HOST,
        "-P",
        str(MYSQL_PORT),
        "-u",
        MYSQL_USER,
        f"--password={MYSQL_PASSWORD}",
        "--single-transaction",
        "--routines",
        "--triggers",
        "--events",
        MYSQL_DATABASE,
    ]

    logging.info("Iniciando backup: %s", backup_path)
    with open(backup_path, "wb") as out:
        subprocess.run(cmd, stdout=out, stderr=subprocess.PIPE, check=True)
    logging.info("Backup concluido: %s", backup_path)
    return backup_path


def parse_backup_timestamp(path: Path) -> datetime.datetime | None:
    # Padrao esperado: sagrafulldb_YYYYMMDD_HHMMSS.sql
    stem = path.stem
    parts = stem.rsplit("_", 2)
    if len(parts) < 3:
        return None
    date_str = parts[-2]
    time_str = parts[-1]
    try:
        return datetime.datetime.strptime(f"{date_str}_{time_str}", "%Y%m%d_%H%M%S")
    except ValueError:
        return None


def cleanup_old_backups(now: datetime.datetime) -> None:
    cutoff = subtract_business_hours(now, 48)
    removed = 0
    for file_path in BACKUP_DIR.glob(f"{MYSQL_DATABASE}_*.sql"):
        stamp = parse_backup_timestamp(file_path)
        if stamp is None:
            continue
        if stamp < cutoff:
            try:
                file_path.unlink()
                removed += 1
            except Exception as exc:
                logging.warning("Falha ao excluir backup antigo %s: %s", file_path, exc)
    if removed:
        logging.info("Limpeza concluida: %s backup(s) removido(s)", removed)


def should_run_now(now: datetime.datetime, already_ran_keys: set[str]) -> tuple[bool, str]:
    if not is_business_day(now):
        return False, ""
    current_slot = now.strftime("%H:%M")
    if current_slot not in SCHEDULE_TIMES:
        return False, ""
    run_key = now.strftime("%Y-%m-%d %H:%M")
    if run_key in already_ran_keys:
        return False, ""
    return True, run_key


def main() -> None:
    setup_logging()
    mysqldump_path = resolve_mysqldump()
    logging.info("mysqldump em uso: %s", mysqldump_path)
    logging.info(
        "Agendamento ativo (dias uteis): %s",
        ", ".join(sorted(SCHEDULE_TIMES)),
    )
    already_ran_keys: set[str] = set()

    while True:
        now = datetime.datetime.now()
        should_run, run_key = should_run_now(now, already_ran_keys)
        if should_run:
            try:
                run_backup(mysqldump_path, now)
                cleanup_old_backups(now)
                already_ran_keys.add(run_key)
            except subprocess.CalledProcessError as exc:
                logging.error("Erro no mysqldump (code=%s): %s", exc.returncode, exc.stderr)
            except Exception as exc:
                logging.exception("Erro ao executar backup: %s", exc)

        # Remove memoria de execucoes muito antigas
        if len(already_ran_keys) > 200:
            today_minus_7 = now - datetime.timedelta(days=7)
            already_ran_keys = {
                key
                for key in already_ran_keys
                if datetime.datetime.strptime(key, "%Y-%m-%d %H:%M") >= today_minus_7
            }

        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
