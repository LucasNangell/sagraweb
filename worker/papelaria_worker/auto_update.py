"""Auto-atualização do executável a partir de cópia central na rede."""
from __future__ import annotations

import hashlib
import logging
import os
import subprocess
import sys
import time
from pathlib import Path

from power import allow_sleep

logger = logging.getLogger(__name__)

CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)
_HASH_CHUNK = 1024 * 1024
_COPY_MAX_WAIT_SEC = 600
_COPY_STABLE_CHECKS = 2
_POST_EXIT_SETTLE_SEC = 8
_PRE_LAUNCH_SETTLE_SEC = 5
_SOURCE_STABLE_TIMEOUT_SEC = 90
_SOURCE_STABLE_INTERVAL_SEC = 1.0
_SOURCE_STABLE_READS = 3


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(_HASH_CHUNK):
            digest.update(chunk)
    return digest.hexdigest()


def _ps_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def wait_file_stable(
    path: Path,
    *,
    timeout_sec: float = _SOURCE_STABLE_TIMEOUT_SEC,
    interval_sec: float = _SOURCE_STABLE_INTERVAL_SEC,
    stable_reads: int = _SOURCE_STABLE_READS,
) -> bool:
    """True quando o arquivo existe e mantém o mesmo tamanho por N leituras."""
    deadline = time.monotonic() + timeout_sec
    last_size: int | None = None
    stable = 0
    while time.monotonic() < deadline:
        try:
            size = path.stat().st_size
        except OSError:
            last_size = None
            stable = 0
            time.sleep(interval_sec)
            continue
        if size > 0 and size == last_size:
            stable += 1
            if stable >= stable_reads:
                return True
        else:
            stable = 1 if size > 0 else 0
        last_size = size
        time.sleep(interval_sec)
    return False


def build_updater_script(
    *,
    source_exe: Path,
    local_exe: Path,
    staging_exe: Path,
    expected_size: int,
    expected_hash: str,
    launch_args: list[str],
    worker_pid: int = 0,
    max_wait_sec: int = _COPY_MAX_WAIT_SEC,
    stable_checks: int = _COPY_STABLE_CHECKS,
    post_exit_settle_sec: int = _POST_EXIT_SETTLE_SEC,
    pre_launch_settle_sec: int = _PRE_LAUNCH_SETTLE_SEC,
) -> str:
    """Script PowerShell: aguarda encerramento, copia com verificação e só então reinicia."""
    work_dir = str(local_exe.parent)
    proc_name = local_exe.stem
    args_ps = "@()" if not launch_args else "@(" + ",".join(_ps_literal(a) for a in launch_args) + ")"

    return f"""$ErrorActionPreference = 'Stop'
$Source = {_ps_literal(str(source_exe))}
$Local = {_ps_literal(str(local_exe))}
$Staging = {_ps_literal(str(staging_exe))}
$WorkDir = {_ps_literal(work_dir)}
$ExpectedSize = {expected_size}
$ExpectedHash = {_ps_literal(expected_hash.lower())}
$MaxWaitSec = {max_wait_sec}
$StableChecks = {stable_checks}
$ProcName = {_ps_literal(proc_name)}
$WorkerPid = {worker_pid}
$PostExitSettleSec = {post_exit_settle_sec}
$PreLaunchSettleSec = {pre_launch_settle_sec}

function Test-TargetFile([string]$Path) {{
  if (-not (Test-Path -LiteralPath $Path)) {{ return $false }}
  $item = Get-Item -LiteralPath $Path
  if ($item.Length -ne $ExpectedSize) {{ return $false }}
  $hash = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLower()
  return ($hash -eq $ExpectedHash)
}}

function Wait-StableCopy([string]$Path) {{
  $stable = 0
  while ($stable -lt $StableChecks) {{
    if (-not (Test-TargetFile $Path)) {{
      $stable = 0
      return $false
    }}
    $stable++
    if ($stable -lt $StableChecks) {{ Start-Sleep -Seconds 1 }}
  }}
  return $true
}}

function Wait-WorkerFullyStopped() {{
  if ($WorkerPid -gt 0) {{
    $proc = Get-Process -Id $WorkerPid -ErrorAction SilentlyContinue
    if ($proc) {{
      Wait-Process -Id $WorkerPid -Timeout 120 -ErrorAction SilentlyContinue
    }}
  }}
  $deadline = (Get-Date).AddSeconds(120)
  while ((Get-Date) -lt $deadline) {{
    $running = @(Get-Process -Name $ProcName -ErrorAction SilentlyContinue)
    if ($running.Count -eq 0) {{ break }}
    $running | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
  }}
  # PyInstaller onefile libera _MEIPASS/python310.dll após encerramento completo.
  Start-Sleep -Seconds $PostExitSettleSec
}}

Wait-WorkerFullyStopped

if (Test-Path -LiteralPath $Staging) {{
  Remove-Item -LiteralPath $Staging -Force -ErrorAction SilentlyContinue
}}

$deadline = (Get-Date).AddSeconds($MaxWaitSec)
$copyOk = $false
while ((Get-Date) -lt $deadline) {{
  try {{
    Copy-Item -LiteralPath $Source -Destination $Staging -Force
  }} catch {{
    Start-Sleep -Seconds 2
    continue
  }}
  if (Wait-StableCopy $Staging) {{
    $copyOk = $true
    break
  }}
  Start-Sleep -Seconds 2
}}

if (-not $copyOk) {{ exit 1 }}

Move-Item -LiteralPath $Staging -Destination $Local -Force
Start-Sleep -Seconds 1
if (-not (Wait-StableCopy $Local)) {{ exit 1 }}

Start-Sleep -Seconds $PreLaunchSettleSec

$argList = {args_ps}
if ($argList.Count -gt 0) {{
  Start-Process -FilePath $Local -WorkingDirectory $WorkDir -ArgumentList $argList
}} else {{
  Start-Process -FilePath $Local -WorkingDirectory $WorkDir
}}

Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue
exit 0
"""


def check_update_available(local_exe: Path, source_exe: Path) -> bool:
    """True se source_exe existir e for diferente do local (tamanho ou conteúdo)."""
    if not source_exe.is_file() or not local_exe.is_file():
        return False
    if not wait_file_stable(source_exe):
        logger.warning(
            "Arquivo central do worker ainda instável (%s) — ignorando atualização.",
            source_exe,
        )
        return False
    try:
        src = source_exe.stat()
        loc = local_exe.stat()
    except OSError as exc:
        logger.warning("Não foi possível comparar versões do worker: %s", exc)
        return False
    if src.st_size != loc.st_size:
        return True
    try:
        return _file_sha256(source_exe) != _file_sha256(local_exe)
    except OSError as exc:
        logger.warning("Não foi possível comparar hash do worker: %s", exc)
        return src.st_mtime > loc.st_mtime + 2


def apply_update_and_exit(
    source_exe: Path,
    local_exe: Path,
    launch_args: list[str],
) -> None:
    """
    Dispara script auxiliar oculto que encerra este processo, copia o .exe
    com verificação de tamanho/hash e reinicia o worker. Não retorna.
    """
    if not wait_file_stable(source_exe):
        logger.warning(
            "Origem da atualização instável (%s) — adiando reinício.",
            source_exe,
        )
        return

    work_dir = local_exe.parent
    work_dir.mkdir(parents=True, exist_ok=True)
    updater = work_dir / "_sagra_worker_update.ps1"
    staging = local_exe.with_suffix(".exe.new")
    expected_size = source_exe.stat().st_size
    expected_hash = _file_sha256(source_exe)
    worker_pid = os.getpid()

    legacy_cmd = work_dir / "_sagra_worker_update.cmd"
    if legacy_cmd.is_file():
        try:
            legacy_cmd.unlink()
        except OSError:
            pass

    updater.write_text(
        build_updater_script(
            source_exe=source_exe.resolve(),
            local_exe=local_exe.resolve(),
            staging_exe=staging.resolve(),
            expected_size=expected_size,
            expected_hash=expected_hash,
            launch_args=launch_args,
            worker_pid=worker_pid,
        ),
        encoding="utf-8",
    )

    subprocess.Popen(
        [
            "powershell.exe",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-WindowStyle",
            "Hidden",
            "-File",
            str(updater),
        ],
        creationflags=CREATE_NO_WINDOW,
        close_fds=True,
        cwd=str(work_dir),
    )
    logger.info(
        "Atualização agendada (pid=%s, %s -> %s, %s bytes) — aguardando cópia completa.",
        worker_pid,
        source_exe,
        local_exe,
        expected_size,
    )
    # sys.exit permite ao PyInstaller onefile liberar _MEIPASS antes do updater reiniciar.
    sys.exit(0)


def try_auto_update(
    local_exe: Path,
    source_path: str,
    launch_args: list[str],
) -> None:
    """Se houver versão nova em source_path, aplica e encerra o processo."""
    source = Path(source_path)
    if not check_update_available(local_exe, source):
        return
    logger.info(
        "Nova versão do worker detectada (%s) — atualizando e reiniciando...",
        source,
    )
    allow_sleep()
    apply_update_and_exit(source, local_exe.resolve(), launch_args)
