import os
import datetime
from jinja2 import Template

def get_db_data(os_id):
    """
    Retrieves data from the database for a given OS ID.
    TODO: Implement actual database connection and query.
    Return a dictionary mapping the jinja2 variables to the DB values.
    """
    # MOCK DATA - Replace with DB calls
    return {
        # Header Data
        "data_atual": datetime.datetime.now().strftime("%d/%m/%Y"),
        "rs_entregue": "Sim", 
        "rs_lancada": "Não",
        "processo": f"PROC-{os_id}/2025",
        "cs": "CS-1234",
        "cota_repro": "200",
        "cota_cartao": "50",
        "debitar_usuario": "Usuario Exemplo",
        "numero_pedido": f"{os_id}/25",
        "modelos_qtd": "1",
        "tiragem_qtd": "1.000",

        # Entidade Solicitante
        "solicitante_categoria": "Orgao",
        "solicitante_cod": "22735",
        "solicitante_nome": "Coord. de Serviços Gráficos - DEAPA",
        "solicitante_sigla": "CGRAF",
        "solicitante_ramal": "6-2700",
        "solicitante_interessado": "ARNALDO JARDIM",
        "solicitante_contato": "Prova para dep. e gab.arnaldo jardim\nEntregar para gab 245",

        # Informações Técnicas
        "servico_tipo": "Ct Visita",
        "maquina_sugerida": "Digital Cor",
        "paginas": "2",
        "frente_verso": "Sim",
        "servico_titulo": "Deputado Vicentinho Junior",
        "servico_formato": "Ct Visita2 50 x 85",
        "servico_cor": "Policromia",
        "obs_cor": "",
        "servico_papel": "Couché Fosco 300gr",
        "obs_papel": "",
        "servico_acabamento": "- Refile",

        # Footer / Other
        "obs_gerais": "Repetição do SP 6554/25, encaminhar P2 conforme solicitado peo usuário, inserindi e-mail arnaldojardimoficial@gmail.com",
        "insumos": "",
        "material_entregue": "- Original Impresso",
        "resp_grafica": "",
        "prazo_entrega": "Normal",
        "forma_entrega": "Entreg. na SEDIR IV",
        "data_entrega": "",
        "aviso_1": "",
        "aviso_2": "",
        "aviso_3": "",
        "timestamp_impressao": datetime.datetime.now().strftime("%d/%m/%Y %H:%M:%S")
    }

def generate_html(os_id, output_path=None):
    """
    Generates the HTML file for a given OS ID using the template.
    """
    if output_path is None:
        output_path = f"requisicao_{os_id}.html"

    # Load Template
    template_path = os.path.join(os.path.dirname(__file__), 'requisicao.html')
    if not os.path.exists(template_path):
        raise FileNotFoundError(f"Template not found at: {template_path}")

    with open(template_path, 'r', encoding='utf-8') as f:
        template_content = f.read()

    # Get Data
    data = get_db_data(os_id)

    # Render
    template = Template(template_content)
    rendered_html = template.render(data)

    # Save
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(rendered_html)
    
    print(f"Requisition generated successfully at: {output_path}")
    return output_path

if __name__ == "__main__":
    # Example usage
    generate_html("02561")
