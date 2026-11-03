"""Painel ao vivo das Xerox Fiery. Abra http://127.0.0.1:8095"""

from __future__ import annotations

import asyncio
import json
import threading
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
import uvicorn

from fiery_client import consultar_todas

INTERVALO_S = 3.0
PASTA = Path(__file__).resolve().parent
ESTATICO = PASTA / "static"

_estado = {"atualizado_em": None, "totais": {}, "online": 0, "offline": 8, "atencao": 8, "maquinas": []}
_lock = threading.Lock()
_pronto = threading.Event()


def _coletor():
    while True:
        try:
            snapshot = consultar_todas()
            with _lock:
                _estado.clear()
                _estado.update(snapshot)
            _pronto.set()
        except Exception as exc:
            with _lock:
                _estado["erro_coleta"] = str(exc)
            _pronto.set()
        threading.Event().wait(INTERVALO_S)


def snapshot():
    with _lock:
        return json.loads(json.dumps(_estado))


app = FastAPI(title="Painel Fiery")
app.mount("/static", StaticFiles(directory=ESTATICO), name="static")


@app.get("/")
def index():
    return FileResponse(ESTATICO / "index.html")


@app.get("/api/estado")
def api_estado():
    return snapshot()


@app.get("/api/stream")
async def api_stream():
    async def gerar():
        anterior = None
        while True:
            atual = snapshot()
            payload = json.dumps(atual, ensure_ascii=False)
            if payload != anterior:
                yield f"event: estado\ndata: {payload}\n\n"
                anterior = payload
            else:
                yield ": ping\n\n"
            await asyncio.sleep(1.0)

    return StreamingResponse(
        gerar(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


def main():
    threading.Thread(target=_coletor, daemon=True).start()
    uvicorn.run(app, host="0.0.0.0", port=8095, log_level="info")


if __name__ == "__main__":
    main()
