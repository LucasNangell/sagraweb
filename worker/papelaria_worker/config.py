"""Carregamento de configuração YAML do worker Papelaria."""

from __future__ import annotations



import os
import re
import socket
from dataclasses import dataclass

from pathlib import Path

from typing import Any

from urllib.parse import urlsplit, urlunsplit



import yaml



_PROFILE_KEYS = frozenset({"api_base_url", "ssl_verify"})
_AUTO_WORKER_ID = frozenset({"", "auto", "automatic"})
_WORKER_ID_MAX_LEN = 64


def _sanitize_worker_id(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9._-]+", "-", value.strip())
    cleaned = re.sub(r"-+", "-", cleaned).strip("-._")
    if not cleaned:
        cleaned = "corel-unknown"
    return cleaned[:_WORKER_ID_MAX_LEN]


def default_worker_id_from_hostname() -> str:
    host = (socket.gethostname() or os.environ.get("COMPUTERNAME") or "unknown").strip()
    return _sanitize_worker_id(f"corel-{host}")


def resolve_worker_id(value: str) -> str:
    env_id = os.environ.get("SAGRA_PAPELARIA_WORKER_ID", "").strip()
    if env_id:
        return _sanitize_worker_id(env_id)
    raw = (value or "").strip()
    if raw.lower() in _AUTO_WORKER_ID:
        return default_worker_id_from_hostname()
    return _sanitize_worker_id(raw)





@dataclass

class WorkerConfig:

    api_base_url: str

    worker_secret: str

    worker_id: str

    ssl_verify: bool | str = True

    api_profile: str = ""

    poll_interval_sec: int = 8

    models_dir: str = ""

    temp_dir: str = r"C:\SAGRA-Papelaria-Worker\temp"

    logs_dir: str = r"C:\SAGRA-Papelaria-Worker\logs"

    corel_visible: bool = False

    job_timeout_sec: int = 300

    max_retries: int = 3

    kill_corel_on_timeout: bool = False

    load_balance_enabled: bool = True

    max_cpu_percent: float = 75.0

    max_memory_percent: float = 80.0

    prevent_sleep: bool = True

    auto_update_enabled: bool = True

    auto_update_source: str = r"I:\Transferencia\_Temp1\SAGRA-Papelaria-Worker.exe"

    auto_update_check_sec: int = 300



    @classmethod

    def from_dict(cls, data: dict[str, Any], *, profile: str = "") -> "WorkerConfig":

        ssl_raw = data.get("ssl_verify", True)

        if isinstance(ssl_raw, str) and ssl_raw.strip().lower() in ("false", "0", "no"):

            ssl_verify: bool | str = False

        elif isinstance(ssl_raw, str) and ssl_raw.strip().lower() in ("true", "1", "yes"):

            ssl_verify = True

        else:

            ssl_verify = ssl_raw if isinstance(ssl_raw, (bool, str)) else bool(ssl_raw)



        return cls(

            api_base_url=normalize_api_base_url(str(data.get("api_base_url", ""))),

            worker_secret=str(data.get("worker_secret", "")).strip(),

            worker_id=resolve_worker_id(str(data.get("worker_id", "auto"))),

            ssl_verify=ssl_verify,

            api_profile=profile,

            poll_interval_sec=int(data.get("poll_interval_sec", 8)),

            models_dir=str(data.get("models_dir", "")).strip(),

            temp_dir=str(data.get("temp_dir", r"C:\SAGRA-Papelaria-Worker\temp")),

            logs_dir=str(data.get("logs_dir", r"C:\SAGRA-Papelaria-Worker\logs")),

            corel_visible=bool(data.get("corel_visible", False)),

            job_timeout_sec=int(data.get("job_timeout_sec", 300)),

            max_retries=int(data.get("max_retries", 3)),

            kill_corel_on_timeout=bool(data.get("kill_corel_on_timeout", False)),

            load_balance_enabled=bool(data.get("load_balance_enabled", True)),

            max_cpu_percent=float(data.get("max_cpu_percent", 75)),

            max_memory_percent=float(data.get("max_memory_percent", 80)),

            prevent_sleep=bool(data.get("prevent_sleep", True)),

            auto_update_enabled=bool(data.get("auto_update_enabled", True)),

            auto_update_source=str(
                data.get(
                    "auto_update_source",
                    r"I:\Transferencia\_Temp1\SAGRA-Papelaria-Worker.exe",
                )
            ).strip(),

            auto_update_check_sec=max(
                60, int(data.get("auto_update_check_sec", 300))
            ),

        )



    def validate(self) -> None:

        missing = []

        if not self.api_base_url:

            missing.append("api_base_url")

        if not self.worker_secret:

            missing.append("worker_secret")

        if not self.worker_id:

            missing.append("worker_id")

        if not self.models_dir:

            missing.append("models_dir")

        if missing:

            raise ValueError(f"Config incompleta: {', '.join(missing)}")





# Alias curto redireciona 301 no Nginx; POST vira GET no redirect → API exige sessão (403).
_CANONICAL_API_HOSTS = {
    "cgrafsysvm": "cgrafsysvm.redecamara.camara.gov.br",
}


def normalize_api_base_url(url: str) -> str:

    """Remove barras duplicadas e espaços; preserva host/porta/esquema."""

    cleaned = url.strip()

    if not cleaned:

        return ""

    parts = urlsplit(cleaned)

    netloc = parts.netloc
    host = (netloc.split(":", 1)[0] if netloc else "").lower()
    canonical = _CANONICAL_API_HOSTS.get(host)
    if canonical:
        port = netloc.split(":", 1)[1] if ":" in netloc else ""
        netloc = f"{canonical}:{port}" if port else canonical

    path = re.sub(r"/+", "/", parts.path or "")

    if path != "/":

        path = path.rstrip("/")

    rebuilt = urlunsplit((parts.scheme, netloc, path, parts.query, parts.fragment))

    return rebuilt.rstrip("/")





def _parse_ssl_verify(value: Any) -> bool | str:

    if isinstance(value, str) and value.strip().lower() in ("false", "0", "no"):

        return False

    if isinstance(value, str) and value.strip().lower() in ("true", "1", "yes"):

        return True

    if isinstance(value, (bool, str)):

        return value

    return bool(value)





def _resolve_profile_name(raw: dict[str, Any], profile: str | None) -> str:

    chosen = (profile or os.environ.get("SAGRA_PAPELARIA_WORKER_PROFILE") or "").strip()

    if not chosen:

        chosen = str(raw.get("active_profile", "")).strip()

    return chosen





def _merge_profile(raw: dict[str, Any], profile_name: str) -> tuple[dict[str, Any], str]:
    """Config plana (api_base_url no topo) ou legado com profiles."""
    if str(raw.get("api_base_url", "")).strip():
        merged = {k: v for k, v in raw.items() if k not in ("profiles", "active_profile")}
        return merged, ""

    profiles = raw.get("profiles")

    if not isinstance(profiles, dict) or not profiles:

        return dict(raw), profile_name



    if not profile_name:

        if len(profiles) == 1:

            profile_name = next(iter(profiles))

        else:

            available = ", ".join(sorted(profiles))

            raise ValueError(

                "Defina active_profile no YAML, use --profile dev|prod "

                f"ou SAGRA_PAPELARIA_WORKER_PROFILE. Perfis: {available}"

            )



    if profile_name not in profiles:

        available = ", ".join(sorted(profiles))

        raise ValueError(f"Perfil '{profile_name}' não encontrado. Opções: {available}")



    merged = {k: v for k, v in raw.items() if k not in ("profiles", "active_profile")}

    profile_data = profiles[profile_name]

    if not isinstance(profile_data, dict):

        raise ValueError(f"Perfil '{profile_name}' inválido no YAML.")



    for key, value in profile_data.items():

        if key in _PROFILE_KEYS or key not in merged:

            merged[key] = value



    return merged, profile_name





def load_config(path: str | Path, profile: str | None = None) -> WorkerConfig:

    config_path = Path(path)

    if not config_path.is_file():

        raise FileNotFoundError(f"Arquivo de config não encontrado: {config_path}")

    raw = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}

    if not isinstance(raw, dict):

        raise ValueError("Config YAML inválida: esperado objeto no topo do arquivo.")



    profile_name = _resolve_profile_name(raw, profile)

    merged, applied_profile = _merge_profile(raw, profile_name)

    cfg = WorkerConfig.from_dict(merged, profile=applied_profile)

    cfg.validate()

    return cfg


