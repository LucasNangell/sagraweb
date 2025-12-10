from database import db
import datetime

class ReportGenerator:
    def __init__(self):
        self.base_template = """
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head>
            <meta charset="UTF-8">
            <style>
                body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 20px; }}
                .header {{ border-bottom: 2px solid #00B142; padding-bottom: 10px; margin-bottom: 20px; }}
                .header h1 {{ color: #00B142; margin: 0; }}
                .meta-info {{ background: #f9f9f9; padding: 10px; border-radius: 5px; font-size: 0.9rem; margin-bottom: 20px; }}
                .problem-item {{ border: 1px solid #ddd; border-radius: 5px; margin-bottom: 15px; padding: 15px; background: #fff; }}
                .problem-title {{ font-weight: bold; color: #d32f2f; border-bottom: 1px solid #eee; padding-bottom: 5px; margin-bottom: 10px; }}
                .obs-box {{ background-color: #fff3cd; color: #856404; padding: 8px; border-radius: 4px; margin-top: 10px; font-size: 0.9em; }}
                .footer {{ margin-top: 30px; font-size: 0.8rem; color: #777; text-align: center; border-top: 1px solid #eee; padding-top: 10px; }}
            </style>
        </head>
        <body>
            <div class="header">
                <h1>Relatório de Análise Técnica</h1>
            </div>
            
            <div class="meta-info">
                <strong>OS:</strong> {nro_os}/{ano_os}<br>
                <strong>Componente:</strong> {componente}<br>
                <strong>Versão:</strong> {versao}<br>
                <strong>Analisado por:</strong> {usuario}<br>
                <strong>Data:</strong> {data_fmt}
            </div>

            <div class="content">
                {conteudo_problemas}
            </div>

            <div class="footer">
                Gerado automaticamente pelo Sistema SAGRA
            </div>
        </body>
        </html>
        """

    def generate_final_html(self, nro_os, ano_os, versao, componente, usuario, problemas_selecionados):
        html_parts = []
        
        if not problemas_selecionados:
            html_parts = []
        else:
            # Agrupar por componente
            from collections import defaultdict
            grupos = defaultdict(list)
            for item in problemas_selecionados:
                comp_name = item.get('componente') or 'Geral'
                grupos[comp_name].append(item)

            for nome_grupo, itens_grupo in grupos.items():
                # Título da Seção
                html_parts.append(f"""
                <div style="background-color: #f0f0f0; padding: 8px 15px; border-left: 5px solid #00B142; margin: 30px 0 15px 0;">
                    <h2 style="margin: 0; font-size: 1.2rem; color: #333; text-transform: uppercase;">{nome_grupo}</h2>
                </div>
                """)

                for item in itens_grupo:
                    p_id = item['id_padrao']
                    obs = item.get('obs', '')
                    html_custom = item.get('html_snapshot') 
                    
                    titulo = "Problema Técnico"

                    if html_custom:
                        res = db.execute_query("SELECT TituloPT FROM tabProblemasPadrao WHERE ID = %s", (p_id,))
                        if res: titulo = res[0]['TituloPT']
                        html_body = html_custom
                    else:
                        res = db.execute_query("SELECT TituloPT, ProbTecHTML FROM tabProblemasPadrao WHERE ID = %s", (p_id,))
                        if res:
                            titulo = res[0]['TituloPT']
                            html_body = res[0]['ProbTecHTML']
                        else:
                            html_body = "<p>Conteúdo não disponível.</p>"

                    block = f"""
                    <div class="problem-item">
                        <div class="problem-title">{titulo}</div>
                        <div class="problem-body">{html_body}</div>
                        {'<div class="obs-box"><strong>Observação Técnica:</strong> ' + obs + '</div>' if obs else ''}
                    </div>
                    """
                    html_parts.append(block)

        if not html_parts:
            conteudo_final = """
            <div style="text-align:center; padding: 40px; color: green;">
                <h2><i class="fas fa-check-circle"></i> Aprovado</h2>
                <p>Nenhum problema técnico impeditivo foi detectado.</p>
            </div>
            """
        else:
            conteudo_final = "\n".join(html_parts)

        data_fmt = datetime.datetime.now().strftime("%d/%m/%Y às %H:%M")
        return self.base_template.format(
            nro_os=nro_os, ano_os=ano_os, componente=componente,
            versao=versao, usuario=usuario, data_fmt=data_fmt,
            conteudo_problemas=conteudo_final
        )

    def save_analysis(self, nro_os, ano_os, versao, componente, usuario, problemas_selecionados):
        final_html = self.generate_final_html(nro_os, ano_os, versao, componente, usuario, problemas_selecionados)
        
        def transaction_ops(cursor):
            sql_analise = """
                INSERT INTO tabAnalises (NroProtocolo, AnoProtocolo, Versao, Componente, Usuario, RelatorioHTML)
                VALUES (%s, %s, %s, %s, %s, %s)
            """
            cursor.execute(sql_analise, (nro_os, ano_os, versao, componente, usuario, final_html))
            analise_id = cursor.lastrowid
            
            if problemas_selecionados:
                sql_ocorr = """
                    INSERT INTO tabAnaliseOcorrencias (AnaliseID, ProblemaPadraoID, Observacao)
                    VALUES (%s, %s, %s)
                """
                data_batch = [(analise_id, p['id_padrao'], p.get('obs', '')) for p in problemas_selecionados]
                cursor.executemany(sql_ocorr, data_batch)
            
            return {"id": analise_id}

        return db.execute_transaction([transaction_ops])[0]

report_service = ReportGenerator()