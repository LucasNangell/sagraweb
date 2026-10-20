#!/usr/bin/env python3
"""Preflight de runtime de uma release SAGRA no Python de producao.

Verifica:
  1) Dependencias de requirements.txt instaladas (site-packages + python_pkgs)
  2) Sintaxe compilavel (compileall) no interpretador atual (deve ser 3.10 em prod)
  3) Import smoke de routers.api em subprocesso

Uso:
  set PYTHONNOUSERSITE=1
  set PYTHONPATH=<release>\\python_pkgs;<release>\\app\\backend;<release>\\app\\services
  python check_release_runtime.py --release-root <release>
"""
from __future__ import annotations

import argparse
import importlib.metadata
import os
import py_compile
import re
import subprocess
import sys
from pathlib import Path


def _parse_requirement_line(line: str) -> str | None:
    raw = line.strip()
    if not raw or raw.startswith("#"):
        return None
    if raw.startswith("-"):
        return None
    # Remove environment markers / extras for presence check; packaging.Requirement
    # handles full PEP 508 when available.
    return raw


def _version_from_dist_path(dist: importlib.metadata.Distribution) -> str:
    """Recupera versao do nome da pasta *.dist-info quando METADATA esta corrompido."""
    try:
        # PathDistribution._path aponta para a pasta .dist-info; locate_file('') e site-packages.
        raw = getattr(dist, "_path", None)
        if raw is None:
            return ""
        base = Path(str(raw))
        name = base.name
        if name.endswith(".dist-info"):
            body = name[: -len(".dist-info")]
            parts = body.rsplit("-", 1)
            if len(parts) == 2 and parts[1] and parts[1][0].isdigit():
                return parts[1]
        if name.endswith(".egg-info"):
            body = name[: -len(".egg-info")]
            parts = body.rsplit("-", 1)
            if len(parts) == 2 and parts[1] and parts[1][0].isdigit():
                return parts[1]
    except Exception:  # noqa: BLE001
        return ""
    return ""


def _resolve_installed_version(name: str) -> str | None:
    """None = pacote ausente; '' = presente sem versao recuperavel."""
    try:
        version = importlib.metadata.version(name)
        if version:
            return str(version)
    except importlib.metadata.PackageNotFoundError:
        return None
    except Exception:
        pass
    try:
        dist = importlib.metadata.distribution(name)
    except importlib.metadata.PackageNotFoundError:
        return None
    except Exception:
        return None
    version = getattr(dist, "version", None) or ""
    if version:
        return str(version)
    recovered = _version_from_dist_path(dist)
    return recovered if recovered else ""


def _check_requirements(req_path: Path) -> list[str]:
    if not req_path.is_file():
        return [f"requirements.txt ausente: {req_path}"]
    try:
        from packaging.requirements import Requirement
        from packaging.version import Version
    except ImportError:
        return [
            "pacote 'packaging' ausente (deve estar em python_pkgs). "
            "Rode o empacotamento novamente."
        ]

    missing: list[str] = []
    for line in req_path.read_text(encoding="utf-8").splitlines():
        spec = _parse_requirement_line(line)
        if not spec:
            continue
        try:
            req = Requirement(spec)
        except Exception as exc:  # noqa: BLE001 — report parse issues
            missing.append(f"especificador invalido '{spec}': {exc}")
            continue
        name = req.name
        version = _resolve_installed_version(name)
        if version is None:
            missing.append(spec)
            continue
        if not version:
            missing.append(
                f"{spec} (instalado sem versao — reinstalle: "
                f'python -m pip install --force-reinstall "{spec}")'
            )
            continue
        if req.specifier:
            try:
                ok = req.specifier.contains(str(version), prereleases=True)
            except Exception:
                try:
                    ok = req.specifier.contains(Version(str(version)), prereleases=True)
                except Exception:
                    missing.append(f"{spec} (instalado: {version!r}, versao invalida)")
                    continue
            if not ok:
                missing.append(f"{spec} (instalado: {version})")
    return missing


_SKIP_COMPILE_DIR_NAMES = {
    "__pycache__",
    ".git",
    "python_pkgs",
    "wheels",
    "sync_tables",  # legado com arquivos quebrados; nao e carregado pela API
    "legacy_or_unused",
}


def _should_skip_py(py: Path, release_root: Path) -> bool:
    try:
        rel_parts = py.relative_to(release_root).parts
    except ValueError:
        rel_parts = py.parts
    if any(part in _SKIP_COMPILE_DIR_NAMES for part in rel_parts):
        return True
    name = py.name.lower()
    if " copy" in name or name.endswith(" - copia.py") or " - copia." in name:
        return True
    return False


def _compile_tree(root: Path, paths: list[Path]) -> list[str]:
    errors: list[str] = []
    for path in paths:
        if not path.exists():
            errors.append(f"caminho ausente para compile: {path}")
            continue
        if path.is_file() and path.suffix == ".py":
            if _should_skip_py(path, root):
                continue
            try:
                py_compile.compile(str(path), doraise=True)
            except py_compile.PyCompileError as exc:
                errors.append(str(exc))
            continue
        for py in path.rglob("*.py"):
            if _should_skip_py(py, root):
                continue
            try:
                py_compile.compile(str(py), doraise=True)
            except py_compile.PyCompileError as exc:
                errors.append(str(exc))
    return errors


def _smoke_import_api(release_root: Path, timeout: int) -> list[str]:
    backend = release_root / "app" / "backend"
    services = release_root / "app" / "services"
    pkgs = release_root / "python_pkgs"
    env = os.environ.copy()
    env["PYTHONNOUSERSITE"] = "1"
    env["PYTHONUTF8"] = "1"
    pp = [
        str(pkgs) if pkgs.is_dir() else "",
        str(backend),
        str(services),
    ]
    env["PYTHONPATH"] = ";".join(p for p in pp if p)
    # Evita side-effects pesados: so importa o modulo.
    code = (
        "import importlib; "
        "m = importlib.import_module('routers.api'); "
        "assert hasattr(m, 'app'), 'routers.api sem app'; "
        "print('import_ok')"
    )
    try:
        proc = subprocess.run(
            [sys.executable, "-c", code],
            cwd=str(backend),
            env=env,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return [f"import smoke de routers.api excedeu {timeout}s"]
    if proc.returncode != 0 or "import_ok" not in (proc.stdout or ""):
        detail = (proc.stderr or proc.stdout or "").strip()
        detail = re.sub(r"\s+", " ", detail)[:800]
        return [f"import smoke de routers.api falhou (exit={proc.returncode}): {detail}"]
    return []


def main() -> int:
    parser = argparse.ArgumentParser(description="Preflight runtime da release SAGRA")
    parser.add_argument("--release-root", required=True, help="Pasta da release")
    parser.add_argument("--skip-import", action="store_true")
    parser.add_argument("--import-timeout", type=int, default=60)
    args = parser.parse_args()

    release = Path(args.release_root).resolve()
    if not release.is_dir():
        print(f"ERRO: release-root invalido: {release}", file=sys.stderr)
        return 2

    print(f"Python: {sys.version.split()[0]} ({sys.executable})")
    print(f"Release: {release}")
    print(f"PYTHONNOUSERSITE={os.environ.get('PYTHONNOUSERSITE', '')}")

    errors: list[str] = []

    req = release / "requirements.txt"
    print("==> Dependencias (requirements.txt)")
    missing = _check_requirements(req)
    if missing:
        print("  FALTANDO / incompatível:")
        for m in missing:
            print(f"    - {m}")
        py = sys.executable
        specs = " ".join(f'"{m.split(" (instalado")[0]}"' for m in missing if not m.startswith("especificador"))
        if specs.strip():
            print(f"  Instale no Python de producao:\n    \"{py}\" -m pip install {specs}")
        errors.extend(f"dep: {m}" for m in missing)
    else:
        print("  OK")

    print("==> Sintaxe (compileall)")
    compile_targets = [
        release / "app" / "backend",
        release / "app" / "services",
    ]
    for name in (
        "system_watchdog_service.py",
        "sync_andamentos_service.py",
        "sync_andamentos_v2_Old.py",
        "sync_policy.py",
        "sync_os_deletes.py",
        "monitor_sync_andamentos_service.py",
        "organizador_email_sepim_service.py",
        "check_release_runtime.py",
        "check_tiff_runtime.py",
    ):
        p = release / name
        if p.is_file():
            compile_targets.append(p)
    compile_errors = _compile_tree(release, compile_targets)
    if compile_errors:
        for e in compile_errors[:40]:
            print(f"  ERRO: {e}")
        errors.extend(compile_errors)
    else:
        print("  OK")

    if not args.skip_import:
        print("==> Import smoke (routers.api)")
        smoke = _smoke_import_api(release, args.import_timeout)
        if smoke:
            for e in smoke:
                print(f"  ERRO: {e}")
            errors.extend(smoke)
        else:
            print("  OK")
    else:
        print("==> Import smoke ignorado (--skip-import)")

    if errors:
        print(f"\nFALHA: {len(errors)} problema(s) no preflight de runtime.", file=sys.stderr)
        return 1
    print("\nPreflight runtime OK.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
