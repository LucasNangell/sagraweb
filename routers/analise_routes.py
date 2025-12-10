from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List, Optional
from database import db
from report_service import report_service # Assumindo que você tem esse arquivo
import logging
import os
import datetime

router = APIRouter()
logger = logging.getLogger(__name__)

class ProblemaItem(BaseModel):
    id_padrao: int
    obs: Optional[str] = ""
    html_snapshot: Optional[str] = None
    componente: Optional[str] = None

class AnaliseRequest(BaseModel):
    nro_os: int
    ano_os: int
    versao: str
    componente: str
    usuario: str
    problemas: List[ProblemaItem]

class AnalysisEnsureRequest(BaseModel):
    nro_os: int
    ano_os: int
    usuario: str

class AnaliseItemAddRequest(BaseModel):
    id_analise: int
    id_padrao: int
    componente: Optional[str] = None
    obs: Optional[str] = ""
    html_snapshot: Optional[str] = None

class AnaliseItemUpdateRequest(BaseModel):
    id_item: int
    obs: Optional[str] = None
    html_snapshot: Optional[str] = None

@router.get("/analise/problemas-padrao")
def get_problemas_padrao():
    return db.execute_query("SELECT ID, TituloPT, ProbTecHTML, Categoria FROM tabProblemasPadrao ORDER BY Categoria, TituloPT")

@router.get("/files/list")
def list_files(path: str = Query(..., description="Caminho absoluto da pasta")):
    if not os.path.exists(path): return {"files": []}
    files = []
    for item in os.listdir(path):
        full_path = os.path.join(path, item)
        if os.path.isfile(full_path) and item.lower().endswith(('.pdf', '.jpg', '.png')):
            files.append({"name": item, "path": full_path, "type": "PDF" if item.endswith('.pdf') else "IMAGE"})
    return {"files": sorted(files, key=lambda x: x['name'])}

@router.get("/files/serve")
def serve_file(filepath: str):
    if not os.path.exists(filepath): raise HTTPException(status_code=404)
    return FileResponse(filepath)

@router.post("/analise/save")
def save_analise(req: AnaliseRequest):
    try:
        problemas = [p.dict() for p in req.problemas]
        result = report_service.save_analysis(req.nro_os, req.ano_os, req.versao, req.componente, req.usuario, problemas)
        return {"status": "success", "analise_id": result['id']}
    except Exception as e:
        logger.error(f"Erro salvando analise: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/analise/ensure")
def ensure_analise(req: AnalysisEnsureRequest):
    existing = db.execute_query("SELECT ID FROM tabAnalises WHERE NroProtocolo=%s AND AnoProtocolo=%s", (req.nro_os, req.ano_os))
    if existing: return {"id": existing[0]['ID'], "new": False}
    db.execute_query("INSERT INTO tabAnalises (NroProtocolo, AnoProtocolo, Usuario, Versao, Componente) VALUES (%s, %s, %s, '', '')", (req.nro_os, req.ano_os, req.usuario))
    new_rec = db.execute_query("SELECT ID FROM tabAnalises WHERE NroProtocolo=%s AND AnoProtocolo=%s", (req.nro_os, req.ano_os))
    return {"id": new_rec[0]['ID'], "new": True}

@router.get("/analise/{ano}/{os_id}/full")
def get_full_analysis(ano: int, os_id: int):
    header = db.execute_query("SELECT ID, Versao, Componente FROM tabAnalises WHERE NroProtocolo=%s AND AnoProtocolo=%s", (os_id, ano))
    if not header: return {"exists": False}
    anl_id = header[0]['ID']
    items = db.execute_query("""
        SELECT i.ID as uniqueId, i.ID_ProblemaPadrao as originalId, i.Obs as obs, i.HTML_Snapshot as html, i.Componente as componenteOrigem, p.TituloPT as titulo
        FROM tabAnaliseItens i LEFT JOIN tabProblemasPadrao p ON i.ID_ProblemaPadrao = p.ID WHERE i.ID_Analise = %s
    """, (anl_id,))
    return {"exists": True, "id": anl_id, "versao": header[0]['Versao'], "componente": header[0]['Componente'], "items": items}

@router.post("/analise/item/add")
def add_analise_item(req: AnaliseItemAddRequest):
    db.execute_query("INSERT INTO tabAnaliseItens (ID_Analise, ID_ProblemaPadrao, Componente, Obs, HTML_Snapshot) VALUES (%s, %s, %s, %s, %s)",
                     (req.id_analise, req.id_padrao, req.componente, req.obs, req.html_snapshot))
    last = db.execute_query("SELECT MAX(ID) as ID FROM tabAnaliseItens WHERE ID_Analise=%s", (req.id_analise,))
    return {"id": last[0]['ID']}

@router.post("/analise/item/update")
def update_analise_item(req: AnaliseItemUpdateRequest):
    if req.html_snapshot is not None:
        db.execute_query("UPDATE tabAnaliseItens SET Obs=%s, HTML_Snapshot=%s WHERE ID=%s", (req.obs or "", req.html_snapshot, req.id_item))
    else:
        db.execute_query("UPDATE tabAnaliseItens SET Obs=%s WHERE ID=%s", (req.obs or "", req.id_item))
    return {"status": "success"}

@router.delete("/analise/item/{item_id}")
def delete_analise_item(item_id: int):
    db.execute_query("DELETE FROM tabAnaliseItens WHERE ID=%s", (item_id,))
    return {"status": "success"}

@router.post("/analise/preview")
def preview_analise(req: AnaliseRequest):
    problemas = [p.dict() for p in req.problemas]
    html = report_service.generate_final_html(req.nro_os, req.ano_os, req.versao, req.componente, req.usuario, problemas)
    return {"html": html}

@router.post("/debug/log")
def log_debug(item: dict):
    with open("server_debug.log", "a", encoding="utf-8") as f:
        f.write(f"[{datetime.datetime.now()}] {item.get('message')}\n")
    return {"status": "ok"}