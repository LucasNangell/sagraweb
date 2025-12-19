from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import HTMLResponse
from database import db
from jinja2 import Template
import os
import datetime
import logging

router = APIRouter()
logger = logging.getLogger(__name__)

def format_date(d):
    if not d:
        return ""
    if isinstance(d, str):
        # Try processing string if needed, or return as is
        return d
    try:
        return d.strftime("%d/%m/%Y")
    except:
        return str(d)

def format_bool(val):
    if val is None:
        return "Não"
    if isinstance(val, bool):
        return "Sim" if val else "Não"
    if isinstance(val, int):
        return "Sim" if val == 1 else "Não"
    if isinstance(val, str):
        v = val.lower()
        if v in ['sim', 's', 'true', '1']: return "Sim"
        return "Não"
    return "Não"

@router.get("/reports/requisicao/{ano}/{id}")
def generate_requisicao(ano: int, id: int, ponto: str = Query(None)):
    try:
        query = """
        SELECT
           p.DataEntrada, p.ReqEntregue, p.ReqLançada, p.ProcessoSolicit, p.CSnro, p.CotaRepro, p.CotaCartao, p.DebitarCGRAF,
           p.NroProtocolo, p.AnoProtocolo,
           d.ModelosArq, d.Tiragem,
           p.CategoriaLink, p.CodUsuarioLink, p.NomeUsuario, p.SiglaOrgao, p.RamalUsuario, p.OrgInteressado, p.ContatoTrab,
           d.TipoPublicacaoLink, d.MaquinaLink, d.Pags, d.FrenteVerso, d.Titulo, d.FormatoLink, d.Cores, d.CoresDescricao,
           d.PapelLink, d.PapelDescricao, d.DescAcabamento, d.Observ, d.InsumosFornecidos, d.MaterialFornecido,
           p.ResponsavelGrafLink, p.EntregPrazoLink, p.EntregaFormaLink, p.EntregData
        FROM tabProtocolos p
        LEFT JOIN tabDetalhesServico d ON p.NroProtocolo = d.NroProtocoloLinkDet AND p.AnoProtocolo = d.AnoProtocoloLinkDet
        WHERE p.NroProtocolo = %(id)s AND p.AnoProtocolo = %(ano)s
        """
        
        rows = db.execute_query(query, {'id': id, 'ano': ano})
        if not rows:
            return HTMLResponse(content="<h1>Ordem de Serviço não encontrada</h1>", status_code=404)
        
        row = rows[0]
        
        # Helper to safely get field
        def get(field, default=""):
            val = row.get(field)
            return val if val is not None else default

        # Create Data Dictionary for Jinja2
        data_atual_str = format_date(get('DataEntrada')) or datetime.datetime.now().strftime("%d/%m/%Y")
        
        # Timestamp
        now_str = datetime.datetime.now().strftime("%d/%m/%Y %H:%M:%S")
        user_info = f" por {ponto}" if ponto else ""
        timestamp_str = f"Gerado em {now_str}{user_info}"

        context = {
            # Header
            "data_atual": data_atual_str,
            "rs_entregue": format_bool(get('ReqEntregue')),
            "rs_lancada": format_bool(get('ReqLançada')),
            "processo": get('ProcessoSolicit'),
            "cs": get('CSnro'),
            "cota_repro": get('CotaRepro'),
            "cota_cartao": get('CotaCartao'),
            "debitar_usuario": get('DebitarCGRAF'),
            "numero_pedido": f"{get('NroProtocolo'):05d}/{str(get('AnoProtocolo'))[-2:]}",
            "modelos_qtd": get('ModelosArq'),
            "tiragem_qtd": get('Tiragem'),

            # Solicitante
            "solicitante_categoria": get('CategoriaLink'),
            "solicitante_cod": get('CodUsuarioLink'),
            "solicitante_nome": get('NomeUsuario'),
            "solicitante_sigla": get('SiglaOrgao'),
            "solicitante_ramal": get('RamalUsuario'),
            "solicitante_interessado": get('OrgInteressado'),
            "solicitante_contato": get('ContatoTrab'),

            # Info Tecnica
            "servico_tipo": get('TipoPublicacaoLink'),
            "maquina_sugerida": get('MaquinaLink'),
            "paginas": get('Pags'),
            "frente_verso": format_bool(get('FrenteVerso')),
            "servico_titulo": get('Titulo'),
            "servico_formato": get('FormatoLink'),
            "servico_cor": get('Cores'),
            "obs_cor": get('CoresDescricao'),
            "servico_papel": get('PapelLink'),
            "obs_papel": get('PapelDescricao'),
            "servico_acabamento": get('DescAcabamento'),

            # Footer
            "obs_gerais": get('Observ'),
            "insumos": get('InsumosFornecidos'),
            "material_entregue": get('MaterialFornecido'),
            "resp_grafica": get('ResponsavelGrafLink'),
            "prazo_entrega": get('EntregPrazoLink'),
            "forma_entrega": get('EntregaFormaLink'),
            "data_entrega": format_date(get('EntregData')),
            "aviso_1": "",
            "aviso_2": "",
            "aviso_3": "",
            "timestamp_impressao": timestamp_str
        }

        # Load Template
        # Resolve path relative to this file (routers/requisicao_routes.py) -> goes up one level to root
        base_dir = os.path.dirname(os.path.dirname(__file__))
        template_path = os.path.join(base_dir, "requisicao.html")
        
        if not os.path.exists(template_path):
             # Fallback to current directory if not found (development)
             if os.path.exists("requisicao.html"):
                 template_path = "requisicao.html"
             else:
                 logger.error(f"Template not found at {template_path}")
                 return HTMLResponse(content=f"<h1>Template requisicao.html não encontrado: {template_path}</h1>", status_code=500)
        
        with open(template_path, 'r', encoding='utf-8') as f:
            template_content = f.read()
        
        template = Template(template_content)
        rendered_html = template.render(context)
        
        return HTMLResponse(content=rendered_html)

    except Exception as e:
        logger.error(f"Erro gerando requisicao: {e}")
        return HTMLResponse(content=f"<h1>Erro Interno: {str(e)}</h1>", status_code=500)
