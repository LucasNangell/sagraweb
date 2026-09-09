from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import HTMLResponse
from database import db
from jinja2 import Template
from os_calc_fields import is_papelaria_os
import base64
import datetime
import logging
import os
import re
import unicodedata

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


def _resolve_template_path() -> str:
    backend_dir = os.path.dirname(os.path.dirname(__file__))
    app_dir = os.path.dirname(backend_dir)
    template_candidates = [
        os.path.join(backend_dir, "templates", "requisicao.html"),
        os.path.join(app_dir, "frontend", "requisicao.html"),
        os.path.join(backend_dir, "requisicao.html"),
        "requisicao.html",
    ]
    return next(
        (p for p in template_candidates if os.path.exists(p)),
        template_candidates[0],
    )


def _resolve_carimbo_data_uri(template_path: str, filename: str = "carimbo.png") -> str:
    """Embute PNG do mesmo diretório do template (evita URL na raiz do site)."""
    asset_path = os.path.join(os.path.dirname(template_path), filename)
    if not os.path.isfile(asset_path):
        logger.warning("%s não encontrado em %s", filename, os.path.dirname(template_path))
        return ""
    with open(asset_path, "rb") as asset_file:
        encoded = base64.b64encode(asset_file.read()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def _titulo_indica_camara_nas_redes(titulo: str | None) -> bool:
    normalized = unicodedata.normalize("NFKD", str(titulo or ""))
    ascii_title = "".join(c for c in normalized if not unicodedata.combining(c)).casefold()
    return "camara nas redes" in ascii_title


def _ficha_tem_prioridade(prazo: str | None) -> bool:
    prazo_entrega = str(prazo or "")
    return "Solicitado p/" in prazo_entrega or "Prometido p/" in prazo_entrega


def _ficha_tipo(mode: str | None, nro: int) -> str:
    if mode == "prova_ficha":
        return "Ficha p/ Tramitação de Prova"
    if mode == "prova":
        return "Ficha p/ Tramitação de Prévia"
    if is_papelaria_os(nro):
        return "Ficha do Serviço de Papelaria"
    return "Ficha da Ordem de Serviço"


def _normalize_prova_cor_tipo(value: str | None) -> str | None:
    if not value:
        return None
    normalized = value.strip().lower()
    if normalized in ("policromia", "pb"):
        return normalized
    return None


def _build_prova_ficha_obs_cor(capa: str, miolo: str) -> str:
    labels = {"policromia": "Policromia", "pb": "PB"}
    return f"Capa: {labels[capa]}\nMiolo: {labels[miolo]}"


def _normalize_obs_gerais(text: str | None) -> str:
    """Normaliza observações gerais da OS.
    Remove quebras no início/fim e colapsa 2 ou mais quebras de linha consecutivas
    (linhas em branco) para no máximo uma quebra de linha simples (\\n).
    """
    if not text:
        return ""
    normalized = str(text).replace("\r\n", "\n").replace("\r", "\n").strip()
    return re.sub(r"\n(?:[ \t]*\n)+", "\n", normalized)


@router.get("/reports/requisicao/{ano}/{id}")
def generate_requisicao(
    ano: int,
    id: int,
    ponto: str = Query(None),
    mode: str = Query(None),
    prova_capa: str = Query(None),
    prova_miolo: str = Query(None),
):
    try:
        query = """
        SELECT
           p.DataEntrada, p.ReqEntregue, p.ReqLançada, p.ProcessoSolicit, p.CSnro, p.CotaRepro, p.CotaCartao, p.DebitarCGRAF,
           p.NroProtocolo, p.AnoProtocolo, p.GabSalaUsuario,
           d.ModelosArq, d.Tiragem,
           p.CategoriaLink, p.CodUsuarioLink, p.NomeUsuario, p.SiglaOrgao, p.RamalUsuario, p.OrgInteressado, p.ContatoTrab,
           d.TipoPublicacaoLink, d.MaquinaLink, d.Pags, d.FrenteVerso, d.Titulo, d.FormatoLink, d.Cores, d.CoresDescricao,
           d.PapelLink, d.PapelDescricao, d.DescAcabamento, d.Observ, d.InsumosFornecidos, d.MaterialFornecido,
           p.ResponsavelGrafLink, p.EntregPrazoLink, p.EntregaFormaLink, p.EntregData, p.EntregPeriodo
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
        timestamp_str = f"{now_str}{user_info}"


        context = {
            # Header
            "data_atual": data_atual_str,
            "rs_entregue": format_bool(get('ReqEntregue')),
            "rs_lancada": format_bool(get('ReqLançada')),
            "processo": get('ProcessoSolicit'),
            "cs": get('CSnro'),
            "cota_repro": f"{int(get('CotaRepro')):,}".replace(",", "."),
            "cota_cartao": get('CotaCartao'),
            "debitar_usuario": "Contador CGRAF" if str(get('DebitarCGRAF')) == '1' else "Usuário",
            "numero_pedido": f"{'SP ' if get('NroProtocolo') > 5000 else 'OS '}{get('NroProtocolo'):05d}/{str(get('AnoProtocolo'))[-2:]}",
            "modelos_qtd": get('ModelosArq'),
            "tiragem_qtd": f"{int(get('Tiragem')):,}".replace(",", "."),

            # Solicitante
            "solicitante_categoria": get('CategoriaLink'),
            "solicitante_cod": get('CodUsuarioLink'),
            "solicitante_nome": get('NomeUsuario'),
            "solicitante_sigla": get('SiglaOrgao'),
            "solicitante_ramal": get('RamalUsuario'),
            "solicitante_gabinete": get('GabSalaUsuario'),  # New field added in template but not in DB query
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
            "obs_gerais": _normalize_obs_gerais(get('Observ')),
            "insumos": get('InsumosFornecidos'),
            "material_entregue": get('MaterialFornecido'),
            "resp_grafica": get('ResponsavelGrafLink'),
            "prazo_entrega": get('EntregPrazoLink'),
            "forma_entrega": get('EntregaFormaLink'),
            "data_entrega": format_date(get('EntregData')),
            "turno": get('EntregPeriodo'),
            "aviso_1": "",
            "aviso_2": "",
            "aviso_3": "",
            "timestamp_impressao": timestamp_str
        }

        context["ficha_tipo"] = _ficha_tipo(mode, get("NroProtocolo"))

        if mode in ("prova", "prova_ficha"):
            context["tiragem_qtd"] = "1"
            context["maquina_sugerida"] = "Digital Cor/PB"

        if mode == "prova_ficha":
            os_label = context["numero_pedido"]
            context["servico_acabamento"] = (
                "-- SEM ACABAMENTO --\n\n"
                "- Ajustar p/ A4 se necessário e anotar na Prova\n"
                f"- Impressa: Conferir se o nro de OS impresso nas Pgs está correto e anotar na Capa: Original Sefoc {os_label}."
            )
            capa_tipo = _normalize_prova_cor_tipo(prova_capa)
            miolo_tipo = _normalize_prova_cor_tipo(prova_miolo)
            if capa_tipo and miolo_tipo:
                context["obs_cor"] = _build_prova_ficha_obs_cor(capa_tipo, miolo_tipo)

        template_path = _resolve_template_path()
        if not os.path.exists(template_path):
            logger.error("Template requisicao.html não encontrado: %s", template_path)
            return HTMLResponse(
                content="<h1>Template requisicao.html não encontrado</h1>",
                status_code=500,
            )

        context["carimbo_src"] = _resolve_carimbo_data_uri(template_path)
        prazo_entrega = str(context.get("prazo_entrega") or "")
        context["show_carimbo_prioridade"] = bool(
            context["carimbo_src"] and _ficha_tem_prioridade(prazo_entrega)
        )
        context["show_turno"] = bool(
            _ficha_tem_prioridade(prazo_entrega)
            and str(context.get("data_entrega") or "").strip()
        )

        context["carimbo_entrega_src"] = _resolve_carimbo_data_uri(template_path, "entrega.png")
        context["show_carimbo_entrega"] = bool(
            context["carimbo_entrega_src"]
            and _titulo_indica_camara_nas_redes(context.get("servico_titulo"))
        )

        with open(template_path, "r", encoding="utf-8") as f:
            template_content = f.read()

        template = Template(template_content)
        rendered_html = template.render(context)
        
        return HTMLResponse(content=rendered_html)

    except Exception as e:
        logger.error(f"Erro gerando requisicao: {e}")
        return HTMLResponse(content=f"<h1>Erro Interno: {str(e)}</h1>", status_code=500)
