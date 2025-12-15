from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List, Optional
from database import db
from report_service import report_service 
import logging
import os
import datetime
import secrets
import string
from fastapi import UploadFile, File, Form
import shutil
import json
import glob
from fastapi.templating import Jinja2Templates
from fastapi.responses import StreamingResponse
from fpdf import FPDF
import io

# Removed HTMLPDF class
templates = Jinja2Templates(directory="templates")

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

class ToggleResolucaoObrigatoriaRequest(BaseModel):
    id_item: int
    resolucao_obrigatoria: bool

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
    existing = db.execute_query("SELECT ID FROM tabAnalises WHERE OS=%s AND Ano=%s", (req.nro_os, req.ano_os))
    if existing: return {"id": existing[0]['ID'], "new": False}
    db.execute_query("INSERT INTO tabAnalises (OS, Ano, Usuario, Versao, Componente) VALUES (%s, %s, %s, '', '')", (req.nro_os, req.ano_os, req.usuario))
    new_rec = db.execute_query("SELECT ID FROM tabAnalises WHERE OS=%s AND Ano=%s", (req.nro_os, req.ano_os))
    return {"id": new_rec[0]['ID'], "new": True}

@router.get("/analise/{ano}/{os_id}/full")
def get_full_analysis(ano: int, os_id: int):
    header = db.execute_query("SELECT ID, Versao, Componente FROM tabAnalises WHERE OS=%s AND Ano=%s", (os_id, ano))
    if not header: return {"exists": False}
    anl_id = header[0]['ID']
    items = db.execute_query("""
        SELECT i.ID as uniqueId, i.ID_ProblemaPadrao as originalId, i.Obs as obs, i.HTML_Snapshot as html, i.Componente as componenteOrigem, 
               i.ResolucaoObrigatoria as resolucaoObrigatoria, p.TituloPT as titulo
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

@router.post("/analise/item/toggle-resolucao-obrigatoria")
def toggle_resolucao_obrigatoria(req: ToggleResolucaoObrigatoriaRequest):
    """Toggle do campo ResolucaoObrigatoria de um item de análise"""
    try:
        logger.info(f"Toggle resolução obrigatória - ID: {req.id_item}, Valor: {req.resolucao_obrigatoria}")
        
        # Verificar se o item existe
        item_check = db.execute_query("SELECT ID FROM tabAnaliseItens WHERE ID=%s", (req.id_item,))
        if not item_check:
            raise HTTPException(status_code=404, detail="Item não encontrado")
        
        # Atualizar
        db.execute_query(
            "UPDATE tabAnaliseItens SET ResolucaoObrigatoria=%s WHERE ID=%s",
            (1 if req.resolucao_obrigatoria else 0, req.id_item)
        )
        
        logger.info(f"Resolução obrigatória atualizada com sucesso para item {req.id_item}")
        return {"status": "success", "resolucao_obrigatoria": req.resolucao_obrigatoria}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erro ao atualizar resolução obrigatória: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro ao atualizar: {str(e)}")

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

@router.post("/analise/{ano}/{os_id}/generate-link")
def generate_client_link(ano: int, os_id: int, request: Request):
    # 1. Obter ID da Análise
    analise = db.execute_query("SELECT ID, Versao, Componente FROM tabAnalises WHERE OS=%s AND Ano=%s", (os_id, ano))
    if not analise:
        raise HTTPException(status_code=404, detail="Análise não encontrada. Salve-a antes de gerar o link.")
    
    id_analise = analise[0]['ID']

    # 2. Verificar se já existe token
    existing = db.execute_query("SELECT Token FROM tabClientTokens WHERE ID_Analise=%s AND NroProtocolo=%s AND AnoProtocolo=%s", (id_analise, os_id, ano))
    
    if existing:
        token = existing[0]['Token']
    else:
        # 3. Gerar novo token seguro
        token = secrets.token_urlsafe(48) # Gera aprox 64 caracteres
        db.execute_query("INSERT INTO tabClientTokens (ID_Analise, NroProtocolo, AnoProtocolo, Token) VALUES (%s, %s, %s, %s)",
                         (id_analise, os_id, ano, token))

    # 4. Construir URL baseada no referer (onde o usuário está)
    host_url = "http://localhost:8001" # Fallback padrão
    if request.headers.get("referer"):
        from urllib.parse import urlparse
        parsed = urlparse(request.headers.get("referer"))
        host_url = f"{parsed.scheme}://{parsed.netloc}"
        
    final_url = f"{host_url}/client_pt.html?os={os_id}&ano={ano}&token={token}"
    
    return {"url": final_url}

@router.get("/analise/client/{ano}/{os_id}")
def validate_client_token(ano: int, os_id: int, token: str = Query(...)):
    # 1. Validar Token
    token_rec = db.execute_query("SELECT ID_Analise, DataExpiracao FROM tabClientTokens WHERE NroProtocolo=%s AND AnoProtocolo=%s AND Token=%s", (os_id, ano, token))
    
    if not token_rec:
         raise HTTPException(status_code=403, detail="Acesso negado. Token inválido ou expirado.")

    if token_rec[0]['DataExpiracao']:
         raise HTTPException(status_code=403, detail="Acesso negado. Link expirado (arquivos já enviados).")

    id_analise = token_rec[0]['ID_Analise']

    # 2. Buscar Dados da Análise
    header = db.execute_query("SELECT ID, Versao, Componente FROM tabAnalises WHERE ID=%s", (id_analise,))
    if not header:
        raise HTTPException(status_code=404, detail="Análise não encontrada.")

    # 3. Buscar Itens
    items = db.execute_query("""
        SELECT i.ID as uniqueId, i.ID_ProblemaPadrao as originalId, i.Obs as obs, i.HTML_Snapshot as html, 
               i.Componente as componenteOrigem, p.TituloPT as titulo, i.Desconsiderado as desconsiderado,
               i.Resolver as resolver, i.ResolucaoObrigatoria as resolucaoObrigatoria
        FROM tabAnaliseItens i LEFT JOIN tabProblemasPadrao p ON i.ID_ProblemaPadrao = p.ID WHERE i.ID_Analise = %s
    """, (id_analise,))
    
    return {
        "exists": True,
        "items": items,
        "componente": header[0]['Componente'],
        "titulo": f"OS {os_id}/{ano}"
    }

# --- HELPER DE ANDAMENTO ---
def add_movement_internal(cursor, os_id, ano, situacao, setor, ponto, obs):
    cursor.execute("UPDATE tabAndamento SET UltimoStatus = 0 WHERE NroProtocoloLink = %s AND AnoProtocoloLink = %s", (os_id, ano))
    cursor.execute("SELECT COUNT(*) as count FROM tabAndamento WHERE NroProtocoloLink = %s AND AnoProtocoloLink = %s", (os_id, ano))
    res = cursor.fetchone()
    count = res['count'] if res else 0
    new_cod = f"{os_id:05d}{ano}-{count + 1:02d}"
    
    cursor.execute("""
        INSERT INTO tabAndamento (CodStatus, NroProtocoloLink, AnoProtocoloLink, SituacaoLink, SetorLink, Data, UltimoStatus, Observaçao, Ponto) 
        VALUES (%s, %s, %s, %s, %s, NOW(), 1, %s, %s)
    """, (new_cod, os_id, ano, situacao, setor, obs, ponto))

# --- CLIENT PORTAL ENDPOINTS ---

@router.get("/client/report/{ano}/{os_id}")
def generate_client_report_pdf(ano: int, os_id: int, request: Request, token: str = Query(...)):
    # 1. Validar e Buscar Dados (Reutilizando logica)
    data = validate_client_token(ano, os_id, token)
    
    
    # 3. Gerar PDF com FPDF2
    try:
        pdf = FPDF()
        pdf.set_auto_page_break(auto=True, margin=15)
        pdf.add_page()
        
        # Cabeçalho
        pdf.set_font("Arial", "B", 16)
        pdf.cell(0, 10, f"Relatório Técnico - OS {os_id}/{ano}", ln=True, align="C")
        pdf.set_font("Arial", "", 12)
        pdf.cell(0, 10, data['titulo'], ln=True, align="C")
        pdf.line(10, 30, 200, 30)
        pdf.ln(10)
        
        # Itens
        for idx, item in enumerate(data['items'], start=1):
            # Título
            pdf.set_font("Arial", "B", 14)
            status_txt = ""
            if item.get('desconsiderado'):
                pdf.set_text_color(192, 57, 43)
                status_txt = " (DESCONSIDERADO)"
            elif item.get('resolver'):
                pdf.set_text_color(39, 174, 96)
                status_txt = " (RESOLVIDO)"
            else:
                pdf.set_text_color(0, 0, 0)
                
            pdf.cell(0, 10, f"{idx}. {item['titulo']}{status_txt}", ln=True)
            pdf.set_text_color(0, 0, 0)
            
            # Componente
            pdf.set_font("Arial", "I", 10)
            pdf.set_text_color(100, 100, 100)
            pdf.cell(0, 8, f"Componente: {item.get('componenteOrigem') or 'Geral'}", ln=True)
            pdf.set_text_color(0, 0, 0)
            
            # HTML Evidence (Fallback Seguro - Text Only)
            if item.get('html') and len(item['html'].strip()) > 0:
                # Remove tags basicas para nao poluir
                import re
                clean_text = re.sub('<[^<]+?>', '', item['html'])
                pdf.set_font("Courier", "", 9)
                pdf.multi_cell(0, 5, f"Evidencia (Texto):\n{clean_text[:2000]}") # Limit length
            else:
                pdf.set_font("Arial", "I", 10)
                pdf.cell(0, 10, "(Sem evidência visual)", ln=True)
                
            pdf.ln(5)
            
            # Observação
            pdf.set_font("Arial", "B", 10)
            pdf.cell(0, 6, "Observação Técnica:", ln=True)
            pdf.set_font("Arial", "", 10)
            pdf.multi_cell(0, 5, item.get('obs') or "(Sem observações)")
            
            pdf.ln(5)
            pdf.set_draw_color(200, 200, 200)
            pdf.line(10, pdf.get_y(), 200, pdf.get_y())
            pdf.set_draw_color(0, 0, 0)
            pdf.ln(5)
            
        # Output
        buffer = io.BytesIO()
        pdf.output(buffer)
        buffer.seek(0)
        
        return StreamingResponse(
            buffer, 
            media_type="application/pdf", 
            headers={"Content-Disposition": f"attachment; filename=Relatorio_OS_{os_id}_{ano}.pdf"}
        )
    except Exception as e:
        logger.error(f"Erro gerando PDF (FPDF): {e}")
        # Fallback de erro visível
        return StreamingResponse(
            io.BytesIO(f"Erro ao gerar PDF: {str(e)}".encode('utf-8')),
            media_type="text/plain"
        )

@router.post("/client/upload-files")
def client_upload_files(
    os_id: int = Form(...), 
    ano: int = Form(...), 
    ponto: str = Form(...),
    files: List[UploadFile] = File(...),
    componentes: str = Form(...),
    token: str = Form(...)
):
    try:
        comp_map = json.loads(componentes) 
        
        # 1. Determinar Caminho da OS (Rede ou Local)
        base_path_network = fr"\\redecamara\DfsData\CGraf\Sefoc\Deputados\{ano}\Deputados_{ano}"
        os_pattern = os.path.join(base_path_network, f"{os_id:05d}*")
        found_folders = glob.glob(os_pattern)
        
        target_os_dir = None
        if found_folders and os.path.isdir(found_folders[0]):
            target_os_dir = found_folders[0]
        else:
            # Fallback local
            target_os_dir = f"storage_client_uploads/{ano}/{os_id}"
            os.makedirs(target_os_dir, exist_ok=True)
            
        # 2. Determinar Próxima Versão "Original vX"
        next_ver = 1
        if os.path.exists(target_os_dir):
            subitems = os.listdir(target_os_dir)
            versions = []
            for item in subitems:
                if os.path.isdir(os.path.join(target_os_dir, item)) and "original" in item.lower():
                    # Tentar extrair numero: "Original v3..." -> 3
                    try:
                        # Extrai parte apos 'v'
                        parts = item.lower().split('v') 
                        if len(parts) > 1:
                            # Pega caracteres numericos iniciais da segunda parte
                            ver_str = ""
                            for char in parts[-1]:
                                if char.isdigit(): ver_str += char
                                else: break
                            if ver_str: versions.append(int(ver_str))
                    except: pass
            
            if versions:
                next_ver = max(versions) + 1
        
        new_folder_name = f"Original v{next_ver} (Portal)"
        final_dir = os.path.join(target_os_dir, new_folder_name)
        os.makedirs(final_dir, exist_ok=True)
        
        saved_files = []
        
        for file in files:
            file_path = os.path.join(final_dir, file.filename)
            with open(file_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)
            saved_files.append(file.filename)
            
        def transaction(cursor):
            obs = f"Arquivos enviados pelo cliente via Portal (Salvos em {new_folder_name}): {', '.join(saved_files)}"
            add_movement_internal(cursor, os_id, ano, "Aguard. Análise", "SEFOC", ponto, obs)
            
            # Invalidar Token
            cursor.execute("UPDATE tabClientTokens SET DataExpiracao = NOW() WHERE Token = %s", (token,))
            
        db.execute_transaction([transaction])
        
        return {"status": "success", "files": saved_files, "folder": new_folder_name}
    except Exception as e:
        logger.error(f"Upload error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

class DisregardRequest(BaseModel):
    id_item: int
    nome_cliente: str
    ponto: str
    os_id: int
    ano: int

@router.post("/client/desconsiderar-item")
def client_disregard_item(req: DisregardRequest):
    # Verificar se o item tem resolução obrigatória
    item_check = db.execute_query(
        "SELECT ResolucaoObrigatoria FROM tabAnaliseItens WHERE ID = %s", 
        (req.id_item,)
    )
    
    if not item_check:
        raise HTTPException(status_code=404, detail="Item não encontrado")
    
    if item_check[0]['ResolucaoObrigatoria'] == 1:
        raise HTTPException(
            status_code=403, 
            detail="Este item possui resolução obrigatória e não pode ser desconsiderado"
        )
    
    def transaction(cursor):
        cursor.execute("""
            UPDATE tabAnaliseItens 
            SET Desconsiderado = 1, ClienteNome = %s, ClientePonto = %s, DataDesconsiderado = NOW()
            WHERE ID = %s
        """, (req.nome_cliente, req.ponto, req.id_item))
        
        cursor.execute("SELECT ID_Analise FROM tabAnaliseItens WHERE ID = %s", (req.id_item,))
        anl = cursor.fetchone()
        if not anl: return {"moved": False}
        
        id_analise = anl['ID_Analise']
        
        cursor.execute("SELECT COUNT(*) as ativos FROM tabAnaliseItens WHERE ID_Analise = %s AND Desconsiderado = 0", (id_analise,))
        res = cursor.fetchone()
        
        if res['ativos'] == 0:
            add_movement_internal(cursor, req.os_id, req.ano, "Em Execução", "SEFOC", req.ponto, "Todos os itens técnicos foram desconsiderados pelo cliente.")
            return {"moved": True}
        
        return {"moved": False}

    try:
        res = db.execute_transaction([transaction])
        return res[0]
    except Exception as e:
        logger.error(f"Disregard error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

class ResolverRequest(BaseModel):
    id_item: int

@router.post("/client/resolver-item")
def client_resolve_item(req: ResolverRequest):
    def transaction(cursor):
        cursor.execute("""
            UPDATE tabAnaliseItens 
            SET Resolver = 1, Desconsiderado = 0, DataResolver = NOW()
            WHERE ID = %s
        """, (req.id_item,))
        return {"status": "success"}

    try:
        return db.execute_transaction([transaction])[0]
    except Exception as e:
        logger.error(f"Resolve error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

class LinkMovementRequest(BaseModel):

    os_id: int
    ano: int
    usuario: str
    link: str
    versao: str

@router.post("/analise/client/register-link-movement")
def register_link_movement(req: LinkMovementRequest):
    def transaction(cursor):
        # Limpeza da string de versão para formatar como PTVx
        ver_clean = req.versao.lower().replace("original", "").replace("v", "").replace("(", "").replace(")", "").strip()
        obs_ver = f"PTV{ver_clean}" if ver_clean else "PTV?"
        
        obs = f"PTV {obs_ver} Registrado. Link para envio: {req.link}"
        add_movement_internal(cursor, req.os_id, req.ano, "Problemas Técnicos", "SEFOC", req.usuario, obs)
        return {"status": "success"}

    try:
        return db.execute_transaction([transaction])[0]
    except Exception as e:
        logger.error(f"Link Register error: {e}")
@router.get("/os/{ano}/{id}/ultimo-andamento")
def get_last_movement(ano: int, id: int):
    try:
        query = """
            SELECT SituacaoLink as situacao, SetorLink as setor, Ponto as ponto, Observaçao as obs, Data as data, Ponto as usuario
            FROM tabAndamento 
            WHERE NroProtocoloLink = %s AND AnoProtocoloLink = %s 
            ORDER BY Data DESC, CodStatus DESC 
            LIMIT 1
        """
        res = db.execute_query(query, (id, ano))
        if res:
            return res[0]
        return {"situacao": None}
    except Exception as e:
        logger.error(f"Error getting last movement: {e}")
        raise HTTPException(status_code=500, detail=str(e))

class StartAnalysisRequest(BaseModel):
    os_id: int
    ano: int
    ponto: str
    usuario: str

@router.post("/analise/start")
def start_analysis_mark(req: StartAnalysisRequest):
    def transaction(cursor):
        add_movement_internal(cursor, req.os_id, req.ano, "Recebido", "SEFOC", req.ponto, "Em análise")
        return {"status": "started"}

    try:
        return db.execute_transaction([transaction])[0]
    except Exception as e:
        logger.error(f"Start analysis error: {e}")
        raise HTTPException(status_code=500, detail=str(e))