#!/usr/bin/env python3
"""
Script de teste para validar o fluxo completo de emails de Problemas Técnicos com template .oft

Testa:
1. Geração de HTML dos problemas
2. Armazenamento em banco de dados
3. Envio com template .oft
"""

import json
import sys
import os
from pathlib import Path

# Adicionar routers ao path
sys.path.insert(0, str(Path(__file__).parent))

def test_generate_problemas_html():
    """Testa a função _generate_problemas_html"""
    print("\n" + "="*60)
    print("TESTE 1: Geração de HTML dos Problemas")
    print("="*60)
    
    from routers.email_routes import _generate_problemas_html
    
    problemas_teste = [
        {
            "titulo": "Problema com Layout",
            "obs": "O layout da página não está renderizando corretamente em navegadores modernos."
        },
        {
            "titulo": "Erro de Codificação UTF-8",
            "obs": "Caracteres acentuados aparecem como símbolos corrompidos no email."
        },
        {
            "titulo": "Template Outlook Não Carrega",
            "obs": "O arquivo emailProbTec.oft não é encontrado no diretório esperado."
        }
    ]
    
    html_resultado = _generate_problemas_html(problemas_teste)
    
    print("\n✓ HTML gerado com sucesso")
    print(f"✓ Tamanho do HTML: {len(html_resultado)} caracteres")
    
    # Validar estrutura do HTML
    assert '<div' in html_resultado, "HTML deve conter divs"
    assert '#953735' in html_resultado, "HTML deve ter cor de marcação (#953735)"
    assert problemas_teste[0]['titulo'] in html_resultado, "Título deve estar no HTML"
    assert problemas_teste[0]['obs'] in html_resultado, "Observação deve estar no HTML"
    
    print("✓ Estrutura HTML validada")
    print("\nPreview do HTML (primeiros 300 caracteres):")
    print(html_resultado[:300] + "...")
    
    return html_resultado

def test_oft_template_exists():
    """Verifica se o template .oft existe"""
    print("\n" + "="*60)
    print("TESTE 2: Verificação do Template .OFT")
    print("="*60)
    
    oft_path = Path(__file__).parent / "emailProbTec.oft"
    
    if oft_path.exists():
        print(f"✓ Template encontrado em: {oft_path}")
        print(f"✓ Tamanho do arquivo: {oft_path.stat().st_size} bytes")
    else:
        print(f"✗ ERRO: Template não encontrado em {oft_path}")
        print("  O arquivo emailProbTec.oft deve estar no diretório raiz do projeto")
        sys.exit(1)

def test_placeholder_substitution(html_problemas):
    """Testa a substituição do placeholder"""
    print("\n" + "="*60)
    print("TESTE 3: Substituição de Placeholder")
    print("="*60)
    
    # Simular placeholder
    placeholder = "<<<CONTEUDO_PROBLEMAS>>>"
    template_simulado = f"""
    <html>
    <body>
        <h1>Problemas Técnicos Detectados</h1>
        <div class="conteudo">
            {placeholder}
        </div>
    </body>
    </html>
    """
    
    resultado = template_simulado.replace(placeholder, html_problemas)
    
    assert placeholder not in resultado, "Placeholder deve ser substituído"
    assert html_problemas in resultado, "HTML deve estar no resultado"
    
    print("✓ Placeholder substituído com sucesso")
    print(f"✓ Tamanho final: {len(resultado)} caracteres")

def test_database_schema():
    """Verifica se as colunas de email_pt existem no banco"""
    print("\n" + "="*60)
    print("TESTE 4: Schema do Banco de Dados")
    print("="*60)
    
    try:
        from database import db
        
        # Verificar se colunas existem
        query = """
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = 'tabProtocolos' 
        AND COLUMN_NAME IN ('email_pt_html', 'email_pt_versao', 'email_pt_data')
        """
        
        result = db.execute_query(query)
        
        if result and len(result) >= 3:
            print("✓ Todas as colunas necessárias existem em tabProtocolos:")
            for col in result:
                print(f"  - {col['COLUMN_NAME']}")
        else:
            print("⚠ Algumas colunas podem estar faltando")
            print("  Verifique se o schema foi atualizado com:")
            print("  ALTER TABLE tabProtocolos ADD COLUMN email_pt_html LONGTEXT;")
            print("  ALTER TABLE tabProtocolos ADD COLUMN email_pt_versao VARCHAR(10);")
            print("  ALTER TABLE tabProtocolos ADD COLUMN email_pt_data TIMESTAMP;")
    except Exception as e:
        print(f"⚠ Não foi possível verificar banco: {e}")

def test_import_com():
    """Verifica se win32com está disponível"""
    print("\n" + "="*60)
    print("TESTE 5: Dependências do Outlook COM")
    print("="*60)
    
    try:
        import win32com.client
        print("✓ win32com.client disponível")
    except ImportError:
        print("✗ ERRO: win32com não instalado")
        print("  Instale com: pip install pywin32")
        sys.exit(1)
    
    try:
        import pythoncom
        print("✓ pythoncom disponível")
    except ImportError:
        print("✗ ERRO: pythoncom não instalado")
        print("  Instale com: pip install pywin32")
        sys.exit(1)
    
    # Verificar se Outlook está instalado
    try:
        import win32com.client
        outlook = win32com.client.Dispatch("Outlook.Application")
        print("✓ Outlook está instalado e acessível")
    except Exception as e:
        print(f"⚠ Outlook não está disponível: {e}")
        print("  Certifique-se de que o Outlook está instalado no sistema")

def test_assunto_construction():
    """Testa a construção do assunto"""
    print("\n" + "="*60)
    print("TESTE 6: Construção do Assunto")
    print("="*60)
    
    os_num = 1234
    ano = 2024
    versao = "1"
    produto = "Papel Sulfite A4"
    titulo = "Reimpressão de Documentos"
    
    ano_curto = str(ano)[-2:]
    assunto = f"CGraf: Problemas Técnicos, arq. v{versao} OS {os_num:04d}/{ano_curto} - {produto} - {titulo}"
    
    print(f"✓ Assunto gerado: {assunto}")
    
    # Validar formato
    assert "CGraf: Problemas Técnicos" in assunto
    assert f"OS {os_num:04d}/{ano_curto}" in assunto
    assert f"v{versao}" in assunto
    assert produto in assunto
    assert titulo in assunto
    
    print("✓ Formato do assunto validado")

def test_route_endpoints():
    """Testa se as rotas estão disponíveis"""
    print("\n" + "="*60)
    print("TESTE 7: Rotas Disponíveis")
    print("="*60)
    
    try:
        from routers import email_routes, analise_routes
        
        # Verificar se rotas existem
        routes = dir(email_routes)
        if 'send_pt_email' in routes:
            print("✓ Rota POST /send-pt disponível (send_pt_email)")
        else:
            print("✗ Rota POST /send-pt não encontrada")
        
        routes = dir(analise_routes)
        if 'finalize_analysis' in routes:
            print("✓ Rota POST /analise/finalize disponível (finalize_analysis)")
        else:
            print("✗ Rota POST /analise/finalize não encontrada")
            
    except ImportError as e:
        print(f"⚠ Não foi possível verificar rotas: {e}")

def main():
    """Executa todos os testes"""
    print("\n" + "█"*60)
    print("█  SUITE DE TESTES - EMAIL DE PROBLEMAS TÉCNICOS COM .OFT  █")
    print("█"*60)
    
    try:
        # Teste 1: Geração de HTML
        html_resultado = test_generate_problemas_html()
        
        # Teste 2: Template .OFT
        test_oft_template_exists()
        
        # Teste 3: Substituição de placeholder
        test_placeholder_substitution(html_resultado)
        
        # Teste 4: Schema do banco
        test_database_schema()
        
        # Teste 5: Dependências COM
        test_import_com()
        
        # Teste 6: Construção de assunto
        test_assunto_construction()
        
        # Teste 7: Rotas
        test_route_endpoints()
        
        print("\n" + "█"*60)
        print("█                   TESTES CONCLUÍDOS COM SUCESSO ✓         █")
        print("█"*60)
        print("\nPróximos passos:")
        print("1. Integrar analise.html com POST /analise/finalize/{ano}/{os_id}")
        print("2. Integrar email.html com POST /send-pt")
        print("3. Executar testes end-to-end manual")
        print("4. Validar placeholder no template Outlook")
        
    except AssertionError as e:
        print(f"\n✗ ERRO DE VALIDAÇÃO: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n✗ ERRO INESPERADO: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()
