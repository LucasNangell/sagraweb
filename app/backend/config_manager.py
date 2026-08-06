import json
import logging
import os
import sys
from pathlib import Path

# Resolve paths: app/backend -> project root (Sagra Web)
if getattr(sys, "frozen", False):
    PROJECT_ROOT = Path(os.path.dirname(sys.executable))
else:
    PROJECT_ROOT = Path(__file__).resolve().parents[2]

CONFIG_FILE = PROJECT_ROOT / "config" / "config.json"
ENV_FILE = PROJECT_ROOT / "config" / ".env"
FRONTEND_DIR = PROJECT_ROOT / "app" / "frontend"

# Defaults sem segredos — credenciais vêm de .env / variáveis de ambiente
DEFAULT_CONFIG = {
    "env": "production",
    "mysql_only": False,
    "mdb_sync_async_enabled": True,
    "sync_andamentos_enabled": False,
    "server_host": "10.1.1.73",
    "server_port": 8050,
    "api_external_url": "http://127.0.0.1:8050",
    "allowed_ips": {
        "master": "10.120.1.14",
        "local_network": "10.1.1.73",
    },
    "db_host": "10.1.1.73",
    "db_port": 3306,
    "db_user": "usr_sagraweb",
    "db_password": "",
    "db_name": "sagrafulldb",
    "mdb_os_atual_path": r"\\redecamara\DfsData\CGraf\ControleDeTrabalhos\BaseDeDados - SAGRA2\Sagra Base - OS Atual.mdb",
    "mdb_papelaria_path": r"\\redecamara\DfsData\CGraf\ControleDeTrabalhos\BaseDeDados - SAGRA2\Sagra Base - Papelaria Atual.mdb",
    "mdb_os_antiga_path": r"\\redecamara\DfsData\CGraf\ControleDeTrabalhos\BaseDeDados - SAGRA2\Sagra Base - OS AntigaCore.mdb",
    "mdb_papelaria_antiga_path": r"\\redecamara\DfsData\CGraf\ControleDeTrabalhos\BaseDeDados - SAGRA2\Sagra Base - Papelaria Antiga.mdb",
    "mdb_backup_dir": r"\\redecamara\DfsData\CGraf\ControleDeTrabalhos\BaseDeDados - SAGRA old\Backup 72h",
    "mysql_backup_dir": r"\\redecamara\DfsData\CGraf\ControleDeTrabalhos\BaseDeDados - SAGRA2\BackupMySQL",
    "mdb_drive_unc_roots": {
        "I": r"\\redecamara\DfsData\CGraf",
    },
    "network_paths": {
        "dfs_deputados": r"\\redecamara\DfsData\CGraf\Sefoc\Deputados",
        "dfs_deputados_papelaria": r"\\redecamara\DfsData\CGraf\Sefoc\Deputados",
        "apogee_files": r"\\cgrafsysvm\ApogeeFiles",
    },
    "credenciais_depol": {
        "jpg_dir": r"\\redecamara\DfsData\CGraf\Sefoc\Deputados\_Temp\2025\Credenciais Depol\JPG",
        "svg_dir": r"\\redecamara\DfsData\CGraf\Sefoc\Deputados\_Temp\2025\Credenciais Depol",
        "auto_criar_os": False,
        "os_template_nro": 20,
        "os_template_ano": 2026,
    },
}

# Mapeamento config_key -> variável de ambiente (legado SAGRA_*)
ENV_OVERRIDES = {
    "db_password": "SAGRA_DB_PASSWORD",
    "db_user": "SAGRA_DB_USER",
    "db_host": "SAGRA_DB_HOST",
    "db_port": "SAGRA_DB_PORT",
    "db_name": "SAGRA_DB_NAME",
    "server_host": "SAGRA_SERVER_HOST",
    "server_port": "SAGRA_SERVER_PORT",
    "env": "ENV",
}

# Variáveis do arquivo .env de desenvolvimento (nomes curtos)
DOTENV_KEYS = {
    "db_host": "DB_HOST",
    "db_user": "DB_USER",
    "db_password": "DB_PASSWORD",
    "db_name": "DB_NAME",
    "server_port": "PORT",
    "env": "ENV",
    "mdb_retry_max_attempts": "MDB_RETRY_MAX_ATTEMPTS",
    "mdb_retry_base_wait_seconds": "MDB_RETRY_BASE_WAIT_SECONDS",
}

# Flags booleanas (.env): true/false/1/0/yes/no
DOTENV_BOOL_KEYS = {
    "mysql_only": "MYSQL_ONLY",
    "sync_andamentos_enabled": "SYNC_ANDAMENTOS_ENABLED",
    "mdb_sync_async_enabled": "MDB_SYNC_ASYNC_ENABLED",
}


def _parse_bool(value, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in ("1", "true", "yes", "on", "sim")


def _is_loopback_host(host: str) -> bool:
    if not host:
        return True
    h = host.strip().lower()
    return h in ("127.0.0.1", "localhost", "::1")


def _is_loopback_url(url: str) -> bool:
    from urllib.parse import urlparse

    try:
        parsed = urlparse(url)
    except Exception:
        return "127.0.0.1" in url or "localhost" in url.lower()
    return _is_loopback_host(parsed.hostname or "")


def _api_url_to_public_web_base(url: str) -> str:
    """Converte api_external_url em URL base para páginas HTML (sem /api)."""
    base = (url or "").strip().rstrip("/")
    if not base:
        return base
    if base.endswith("/api"):
        trimmed = base[:-4].rstrip("/")
        return trimmed or base
    return base


def _load_dotenv_file() -> None:
    """Carrega config/.env antes de qualquer leitura de configuração."""
    if not ENV_FILE.exists():
        return
    try:
        from dotenv import load_dotenv

        load_dotenv(ENV_FILE, override=True)
        logging.getLogger(__name__).debug("Arquivo .env carregado: %s", ENV_FILE)
    except ImportError:
        logging.warning(
            "python-dotenv não instalado. Execute: pip install python-dotenv"
        )
        _load_dotenv_manual()
    except Exception as exc:
        logging.error("Falha ao carregar .env com dotenv: %s", exc)
        _load_dotenv_manual()


def _load_dotenv_manual() -> None:
    """Fallback simples se python-dotenv não estiver disponível."""
    try:
        for line in ENV_FILE.read_text(encoding="utf-8-sig").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip())
    except Exception as exc:
        logging.error("Falha no fallback de leitura do .env: %s", exc)


_load_dotenv_file()


class ConfigManager:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(ConfigManager, cls).__new__(cls)
            cls._instance.config = DEFAULT_CONFIG.copy()
            if "allowed_ips" in cls._instance.config:
                cls._instance.config["allowed_ips"] = dict(
                    cls._instance.config["allowed_ips"]
                )
            cls._instance.load_config()
        return cls._instance

    def is_development(self) -> bool:
        env = str(self.get("env", "") or os.getenv("ENV", "")).lower()
        return env in ("development", "dev", "local")

    def is_mysql_only(self) -> bool:
        """True = apenas leitura/gravação MySQL; sem dual-write Access/MDB."""
        return _parse_bool(self.get("mysql_only"), default=True)

    def is_sync_andamentos_enabled(self) -> bool:
        """True = permite iniciar sync_andamentos_v2 via API (desligado por padrão)."""
        if self.is_mysql_only():
            return False
        return _parse_bool(self.get("sync_andamentos_enabled"), default=False)

    def is_mdb_write_enabled(self) -> bool:
        """Dual-write para Access — desligado quando MYSQL_ONLY=true."""
        return not self.is_mysql_only()

    def _apply_dotenv_bool_keys(self) -> None:
        for config_key, env_name in DOTENV_BOOL_KEYS.items():
            raw = os.getenv(env_name)
            if raw is not None and raw != "":
                self.config[config_key] = _parse_bool(raw)

    def _apply_dotenv_keys(self) -> None:
        self._apply_dotenv_bool_keys()
        for config_key, env_name in DOTENV_KEYS.items():
            value = os.getenv(env_name)
            if value is None or value == "":
                continue
            if config_key == "server_port":
                try:
                    self.config[config_key] = int(value)
                except ValueError:
                    logging.warning("PORT inválido: %s", value)
            else:
                self.config[config_key] = value

        master_ip = (os.getenv("MASTER_IP") or "").strip()
        if master_ip and master_ip not in ("127.0.0.1", "::1"):
            if "allowed_ips" not in self.config or not isinstance(
                self.config["allowed_ips"], dict
            ):
                self.config["allowed_ips"] = {}
            # config.json tem precedência; .env só preenche se ausente
            if not self.config["allowed_ips"].get("master"):
                self.config["allowed_ips"]["master"] = master_ip

    def _apply_env_overrides(self) -> None:
        self._apply_dotenv_keys()
        for key, env_name in ENV_OVERRIDES.items():
            value = os.getenv(env_name)
            if value is None or value == "":
                continue
            if key in ("db_port", "server_port"):
                try:
                    self.config[key] = int(value)
                except ValueError:
                    logging.warning("Valor inválido para %s: %s", env_name, value)
            else:
                self.config[key] = value

    def _apply_development_profile(self) -> None:
        """Dev local: Uvicorn em 127.0.0.1:8001, API direta sem Nginx/Cloudflare."""
        if not self.is_development():
            return
        port = int(self.config.get("server_port", 8001))
        vite_port = int(os.getenv("VITE_DEV_PORT") or "5173")
        explicit_public = (os.getenv("SAGRA_PUBLIC_WEB_BASE") or "").strip()
        if explicit_public:
            self.config["public_web_base"] = explicit_public.rstrip("/")
        elif not (self.config.get("public_web_base") or "").strip():
            # Não herdar api_external_url de produção (ex.: 10.1.1.73) para links do portal
            self.config["public_web_base"] = f"http://127.0.0.1:{vite_port}"
        self.config["server_host"] = "127.0.0.1"
        self.config["server_port"] = port
        self.config["api_external_url"] = f"http://127.0.0.1:{port}"
        if "allowed_ips" not in self.config:
            self.config["allowed_ips"] = {}
        self.config["allowed_ips"]["local_network"] = "127.0.0.1"
        master = self.config["allowed_ips"].get("master") or os.getenv("MASTER_IP")
        if master:
            self.config["allowed_ips"]["master"] = master
        public_hint = self.config.get("public_web_base")
        logging.info(
            "Perfil ENV=development: API local em %s (sem Nginx/Cloudflare)%s",
            self.config["api_external_url"],
            f"; links públicos em {public_hint}" if public_hint else "",
        )

    def _log_operational_mode(self) -> None:
        if self.is_mysql_only():
            logging.warning(
                "Modo MYSQL_ONLY: somente consultas/gravações MySQL "
                "(sync_andamentos e MDB desativados neste processo)."
            )
        elif self.is_mdb_write_enabled():
            paths = self.get_mdb_paths()
            async_mode = _parse_bool(self.get("mdb_sync_async_enabled"), default=True)
            logging.info(
                "Dual-write MDB ativo | OS Atual: %s | Papelaria: %s | sync=%s",
                paths.get("os_atual"),
                paths.get("papelaria"),
                "assíncrono" if async_mode else "síncrono",
            )
            for label, p in (("OS Atual", paths.get("os_atual")), ("Papelaria", paths.get("papelaria"))):
                if p and "BackupMySQL" in str(p).replace("/", "\\"):
                    logging.error(
                        "ATENÇÃO: mdb path de %s aponta para BackupMySQL (homologação): %s",
                        label,
                        p,
                    )
        if self.is_sync_andamentos_enabled():
            logging.warning(
                "SYNC_ANDAMENTOS_ENABLED=true: motor sync pode ser iniciado pela API."
            )

    def load_config(self) -> None:
        if CONFIG_FILE.exists():
            try:
                with open(CONFIG_FILE, "r", encoding="utf-8-sig") as f:
                    loaded_config = json.load(f)
                    self.config.update(loaded_config)
                    if "allowed_ips" in loaded_config:
                        self.config["allowed_ips"] = dict(loaded_config["allowed_ips"])
            except Exception as exc:
                logging.error("Error loading config: %s", exc)
        else:
            CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
            self.save_config()

        self._apply_env_overrides()
        self._apply_development_profile()
        self._log_operational_mode()

        if not self.config.get("db_password"):
            pwd = os.getenv("DB_PASSWORD") or os.getenv("SAGRA_DB_PASSWORD")
            if pwd:
                self.config["db_password"] = pwd
            else:
                logging.warning(
                    "db_password não definido. Configure DB_PASSWORD no config/.env"
                )

    def save_config(self, new_config=None) -> None:
        if new_config:
            self.config.update(new_config)
        try:
            with open(CONFIG_FILE, "w", encoding="utf-8") as f:
                json.dump(self.config, f, indent=4)
        except Exception as exc:
            logging.error("Error saving config: %s", exc)

    def get(self, key, default=None):
        if "." in key:
            parts = key.split(".")
            val = self.config
            for part in parts:
                if isinstance(val, dict):
                    val = val.get(part)
                else:
                    return default
            return val if val is not None else default
        return self.config.get(key, default)

    def set(self, key, value) -> None:
        self.config[key] = value

    def get_server_config(self):
        return {
            "host": self.get("server_host", "127.0.0.1"),
            "port": int(self.get("server_port", 8001)),
            "api_external_url": self.get("api_external_url", "http://127.0.0.1:8001"),
        }

    def get_mysql_config(self):
        return {
            "host": self.get("db_host", "10.1.1.73"),
            "port": int(self.get("db_port", 3306)),
            "user": self.get("db_user", "usr_sagraweb"),
            "password": self.get("db_password", ""),
            "database": self.get("db_name", "sagrafulldb"),
        }

    def get_mdb_paths(self):
        return {
            "os_atual": self.get("mdb_os_atual_path"),
            "papelaria": self.get("mdb_papelaria_path"),
            "os_antiga": self.get("mdb_os_antiga_path"),
            "papelaria_antiga": self.get("mdb_papelaria_antiga_path"),
        }

    def get_network_paths(self):
        return self.get("network_paths", {})

    def get_mdb_path_by_nro(self, nro):
        try:
            nro_int = int(nro)
        except Exception:
            nro_int = 0
        paths = self.get_mdb_paths()
        return paths["papelaria"] if nro_int >= 5000 else paths["os_atual"]

    def resolve_mdb_path(self, path: str | None) -> str:
        """
        Resolve caminho MDB para ODBC.

        O driver ODBC do Access não resolve unidades mapeadas (ex.: I:\\) de forma
        confiável — mesmo quando os.path.isfile enxerga o arquivo. Por isso caminhos
        com letra de unidade são convertidos para UNC antes de abrir conexão.
        """
        if not path:
            return ""
        normalized = os.path.normpath(str(path).strip())
        if os.name == "nt" and len(normalized) >= 2 and normalized[1] == ":":
            unc_path = self._drive_path_to_unc(normalized)
            if unc_path:
                return unc_path
        if os.path.isfile(normalized):
            return normalized
        return normalized

    def _configured_unc_for_drive(self, letter: str) -> str | None:
        roots = self.get("mdb_drive_unc_roots") or {}
        if not isinstance(roots, dict):
            return None
        root = roots.get(letter.upper()) or roots.get(letter.lower())
        if not root:
            return None
        return str(root).rstrip("\\/")

    def _drive_path_to_unc(self, drive_path: str) -> str | None:
        letter = drive_path[0].upper()
        unc_root = self._windows_unc_for_drive(letter)
        if not unc_root:
            unc_root = self._configured_unc_for_drive(letter)
        if not unc_root:
            return None
        suffix = drive_path[2:].lstrip("\\/")
        if suffix:
            return os.path.normpath(os.path.join(unc_root, suffix))
        return unc_root

    @staticmethod
    def _windows_unc_for_drive(letter: str) -> str | None:
        import ctypes
        from ctypes import wintypes

        try:
            mpr = ctypes.WinDLL("mpr")
        except OSError:
            return None
        WNetGetConnectionW = mpr.WNetGetConnectionW
        WNetGetConnectionW.argtypes = [
            wintypes.LPCWSTR,
            wintypes.LPWSTR,
            ctypes.POINTER(wintypes.DWORD),
        ]
        WNetGetConnectionW.restype = wintypes.DWORD
        buf = ctypes.create_unicode_buffer(1024)
        size = wintypes.DWORD(1024)
        err = WNetGetConnectionW(f"{letter.upper()}:", buf, ctypes.byref(size))
        if err != 0:
            return None
        return buf.value.rstrip("\\")

    def get_mdb_connection_string(self, path):
        resolved = self.resolve_mdb_path(path)
        return f"DRIVER={{Microsoft Access Driver (*.mdb, *.accdb)}};DBQ={resolved};"

    def uses_nginx_api_path(self) -> bool:
        """True quando clientes devem chamar a API via Nginx (/sagra/api)."""
        if not self.is_development():
            return True
        public = (os.getenv("SAGRA_PUBLIC_WEB_BASE") or self.get("public_web_base") or "").strip()
        return bool(public) and not _is_loopback_url(public)

    def get_api_path_prefix(self) -> str:
        """Prefixo relativo da API para URLs em HTML/JSON (sem host)."""
        if self.uses_nginx_api_path():
            return "/sagra/api"
        return "/api"

    def get_api_ws_path(self) -> str:
        """Path relativo do WebSocket (Nginx: /sagra/api/ws/; dev direto: /api/ws/)."""
        return f"{self.get_api_path_prefix()}/ws"

    def get_api_base(self) -> str:
        """URL base da API para bootstrap JS (config_client.js, /api/config/public)."""
        if self.uses_nginx_api_path():
            # Same-origin via Nginx — evita DNS/SSL extra e funciona em intranet + internet.
            return "/sagra/api"
        port = int(self.get("server_port", 8001))
        return f"http://127.0.0.1:{port}/api"

    def get_api_internal_base(self) -> str:
        """URL direta ao Uvicorn local — nunca passa pelo Nginx."""
        explicit = (os.getenv("SAGRA_API_INTERNAL_BASE") or "").strip()
        if not explicit and not self.is_development():
            explicit = (self.get("api_internal_url") or "").strip()
        if explicit:
            base = explicit.rstrip("/")
            return base if base.endswith("/api") else f"{base}/api"
        port = int(self.get("server_port", 8001))
        return f"http://127.0.0.1:{port}/api"

    def get_public_web_base(self) -> str:
        """URL base para links HTML (portal cliente), sem sufixo /api."""
        if self.is_development():
            for env_name in ("SAGRA_PUBLIC_WEB_BASE", "SAGRA_PUBLIC_DOMAIN"):
                explicit = (os.getenv(env_name) or "").strip()
                if explicit:
                    return explicit.rstrip("/")
            stored = (self.get("public_web_base") or "").strip()
            if stored:
                return stored.rstrip("/")
            port = int(self.get("server_port", 8001))
            return f"http://127.0.0.1:{port}"
        stored = (self.get("public_web_base") or "").strip()
        for env_name in ("SAGRA_PUBLIC_WEB_BASE", "SAGRA_PUBLIC_DOMAIN"):
            explicit = (os.getenv(env_name) or "").strip()
            if explicit:
                return explicit.rstrip("/")
        if stored:
            return stored.rstrip("/")
        base = (self.get("api_external_url") or "").rstrip("/")
        if "/api" in base:
            return base.split("/api")[0].rstrip("/")
        if base.endswith("/sagra"):
            return base[: -len("/sagra")]
        if base.startswith("http://") or base.startswith("https://"):
            return base
        server = self.get_server_config()
        return f"http://{server['host']}:{server['port']}"

    def get_cors_origins(self):
        port = int(self.get("server_port", 8001))
        origins = [
            f"http://127.0.0.1:{port}",
            f"http://localhost:{port}",
        ]
        if self.is_development():
            origins.extend(
                [
                    "http://127.0.0.1:5173",
                    "http://localhost:5173",
                ]
            )
            master = (self.get("allowed_ips") or {}).get("master")
            if master and master not in ("127.0.0.1", "::1"):
                origins.append(f"http://{master}:5173")
        if not self.is_development():
            server = self.get_server_config()
            host = server["host"]
            origins.extend(
                [
                    f"http://{host}:{port}",
                    f"http://localhost:{port}",
                ]
            )
            master = (self.get("allowed_ips") or {}).get("master")
            if master and master not in ("127.0.0.1", "::1"):
                origins.append(f"http://{master}:{port}")
        extra = os.getenv("SAGRA_CORS_ORIGINS", "")
        if extra:
            origins.extend(item.strip() for item in extra.split(",") if item.strip())
        return list(dict.fromkeys(origins))

    def write_client_config_js(self, path=None) -> None:
        server = self.get_server_config()
        api_base = self.get_api_base()
        env_name = self.get("env", "production")

        if path is None:
            path = FRONTEND_DIR / "config_client.js"

        content = (
            "// Auto-gerado pelo config_manager. Nao edite manualmente em producao.\n"
            f'window.SAGRA_ENV = "{env_name}";\n'
            f'window.SAGRA_API_HOST = "{server["host"]}";\n'
            f"window.SAGRA_API_PORT = {server['port']};\n"
            f'window.SAGRA_API_BASE = "{api_base}";\n'
        )
        content += f"window.SAGRA_MYSQL_ONLY = {'true' if self.is_mysql_only() else 'false'};\n"
        content += f"window.SAGRA_SYNC_ENABLED = {'true' if self.is_sync_andamentos_enabled() else 'false'};\n"
        if self.is_development():
            content += (
                "// Modo desenvolvimento: API direta em Uvicorn (sem Nginx /sagra/ nem Cloudflare)\n"
                "window.SAGRA_USE_CLOUDFLARE_GUARD = false;\n"
            )
        else:
            content += "window.SAGRA_USE_CLOUDFLARE_GUARD = true;\n"

        try:
            Path(path).parent.mkdir(parents=True, exist_ok=True)
            Path(path).write_text(content, encoding="utf-8")
            logging.info("config_client.js gerado: SAGRA_API_BASE=%s", api_base)
        except Exception as exc:
            logging.error("Error writing client config JS: %s", exc)


config_manager = ConfigManager()
