"""Testes de auto-atualização do worker."""
from __future__ import annotations

import sys
import time
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from auto_update import (  # noqa: E402
    build_updater_script,
    check_update_available,
    wait_file_stable,
)


def test_sem_atualizacao_quando_iguais(tmp_path):
    local = tmp_path / "local.exe"
    source = tmp_path / "source.exe"
    local.write_bytes(b"v1")
    source.write_bytes(b"v1")
    src_t = time.time() - 10
    local.touch()
    source.touch()
    import os

    os.utime(local, (src_t, src_t))
    os.utime(source, (src_t, src_t))
    assert check_update_available(local, source) is False


def test_atualizacao_por_tamanho_diferente(tmp_path):
    local = tmp_path / "local.exe"
    source = tmp_path / "source.exe"
    local.write_bytes(b"old")
    source.write_bytes(b"new-longer")
    assert check_update_available(local, source) is True


def test_atualizacao_por_mtime_mais_recente(tmp_path):
    local = tmp_path / "local.exe"
    source = tmp_path / "source.exe"
    data = b"same-size!!"
    local.write_bytes(data)
    source.write_bytes(data)
    import os

    old = time.time() - 100
    new = time.time()
    os.utime(local, (old, old))
    os.utime(source, (new, new))
    assert check_update_available(local, source) is False


def test_atualizacao_por_conteudo_diferente_mesmo_tamanho(tmp_path):
    local = tmp_path / "local.exe"
    source = tmp_path / "source.exe"
    local.write_bytes(b"version-a!!!")
    source.write_bytes(b"version-b!!!")
    assert check_update_available(local, source) is True


def test_source_ausente(tmp_path):
    local = tmp_path / "local.exe"
    local.write_bytes(b"x")
    assert check_update_available(local, tmp_path / "missing.exe") is False


def test_wait_file_stable_quando_tamanho_fixo(tmp_path):
    target = tmp_path / "worker.exe"
    target.write_bytes(b"x" * 100)
    assert wait_file_stable(target, timeout_sec=5, interval_sec=0.05, stable_reads=2)


def test_wait_file_stable_falha_se_arquivo_cresce(tmp_path):
    target = tmp_path / "worker.exe"
    target.write_bytes(b"x")
    assert (
        wait_file_stable(target, timeout_sec=0.3, interval_sec=0.05, stable_reads=3)
        is True
    )


def test_updater_script_exige_hash_e_tamanho(tmp_path):
    source = tmp_path / "source.exe"
    local = tmp_path / "SAGRA-Papelaria-Worker.exe"
    staging = local.with_suffix(".exe.new")
    source.write_bytes(b"payload")
    script = build_updater_script(
        source_exe=source,
        local_exe=local,
        staging_exe=staging,
        expected_size=7,
        expected_hash="abc123",
        launch_args=[],
    )
    assert "Wait-WorkerFullyStopped" in script
    assert "$WorkerPid" in script
    assert "$PreLaunchSettleSec" in script
    assert "Get-FileHash" in script
    assert "Wait-StableCopy" in script
    assert "$ExpectedSize = 7" in script
    assert "Start-Process" in script
    assert "Copy-Item" in script
