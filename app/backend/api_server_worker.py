import sys
import traceback
import uvicorn
from config_manager import config_manager


def main():
    cfg = config_manager.get_server_config()
    host = cfg["host"]
    port = int(cfg["port"])
    uvicorn.run("routers.api:app", host=host, port=port, proxy_headers=True, log_level="info")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
    except Exception:
        traceback.print_exc()
        sys.exit(1)
