"""
SAGRA Local Folder Opener Service
==================================

Serviço local que permite ao sistema web SAGRA abrir pastas automaticamente
no Windows Explorer quando o usuário clica em "Abrir Pasta" na OS.

SEGURANÇA:
- Aceita apenas conexões de localhost (127.0.0.1)
- Abre apenas pastas (não executa arquivos)
- Valida existência do caminho antes de abrir

PORTA: 5566 (127.0.0.1:5566)

Para gerar executável:
    pyinstaller --onefile --noconsole --name "SAGRA-FolderOpener" folder_opener_service.py

Autor: Sistema SAGRA
Data: 15/12/2025
Versão: 1.0.0
"""

import os
import sys
from pathlib import Path
from datetime import datetime
from flask import Flask, request, jsonify
from flask_cors import CORS

# Configuração
PORT = 5566
HOST = '127.0.0.1'
LOG_FILE = Path.home() / "sagra_folder_opener.log"

# Criar aplicação Flask
app = Flask(__name__)

# CORS apenas para localhost
CORS(app, resources={
    r"/open-folder": {
        "origins": ["http://localhost:*", "http://127.0.0.1:*", "http://10.120.*"],
        "methods": ["POST"]
    }
})

def log(message):
    """Registra mensagem no log local"""
    try:
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(f"[{timestamp}] {message}\n")
    except Exception as e:
        print(f"Erro ao escrever log: {e}")

def is_valid_folder_path(path):
    """
    Valida se o caminho é uma pasta válida e segura para abrir
    
    Args:
        path: Caminho a ser validado
        
    Returns:
        tuple: (bool, str) - (é_válido, mensagem_erro)
    """
    if not path:
        return False, "Caminho vazio"
    
    # Converter para Path
    try:
        folder_path = Path(path)
    except Exception as e:
        return False, f"Caminho inválido: {e}"
    
    # Verificar se existe
    if not folder_path.exists():
        return False, "Pasta não encontrada"
    
    # Verificar se é diretório
    if not folder_path.is_dir():
        return False, "Caminho não é uma pasta"
    
    # Verificar se não é um caminho perigoso (sistema)
    dangerous_paths = [
        Path(os.environ.get('WINDIR', 'C:\\Windows')),
        Path(os.environ.get('SYSTEMROOT', 'C:\\Windows')),
        Path(os.environ.get('SYSTEMDRIVE', 'C:')) / 'Windows' / 'System32'
    ]
    
    for dangerous in dangerous_paths:
        try:
            if folder_path.resolve() == dangerous.resolve():
                return False, "Não é permitido abrir pastas do sistema"
        except:
            pass
    
    return True, "OK"

@app.route('/open-folder', methods=['POST'])
def open_folder():
    """
    Endpoint para abrir pasta no Windows Explorer
    
    POST /open-folder
    Body: {"path": "C:\\Caminho\\Da\\Pasta"}
    
    Returns:
        JSON com status da operação
    """
    try:
        # Obter dados da requisição
        data = request.get_json()
        
        if not data:
            log("❌ Requisição sem JSON")
            return jsonify({
                "success": False,
                "error": "Requisição inválida - JSON esperado"
            }), 400
        
        # Extrair caminho
        folder_path = data.get('path')
        
        if not folder_path:
            log("❌ Caminho não fornecido")
            return jsonify({
                "success": False,
                "error": "Caminho não fornecido"
            }), 400
        
        log(f"📂 Tentando abrir pasta: {folder_path}")
        
        # Validar caminho
        is_valid, error_msg = is_valid_folder_path(folder_path)
        
        if not is_valid:
            log(f"❌ Validação falhou: {error_msg}")
            return jsonify({
                "success": False,
                "error": error_msg
            }), 400
        
        # Abrir pasta no Explorer
        try:
            os.startfile(folder_path)
            log(f"✅ Pasta aberta com sucesso: {folder_path}")
            
            return jsonify({
                "success": True,
                "message": "Pasta aberta com sucesso",
                "path": folder_path
            }), 200
            
        except Exception as e:
            log(f"❌ Erro ao abrir pasta: {e}")
            return jsonify({
                "success": False,
                "error": f"Erro ao abrir pasta: {str(e)}"
            }), 500
    
    except Exception as e:
        log(f"❌ Erro inesperado: {e}")
        return jsonify({
            "success": False,
            "error": f"Erro inesperado: {str(e)}"
        }), 500

@app.route('/health', methods=['GET'])
def health():
    """Endpoint de verificação de saúde do serviço"""
    return jsonify({
        "status": "running",
        "service": "SAGRA Folder Opener",
        "version": "1.0.0",
        "port": PORT
    }), 200

@app.route('/ping', methods=['GET'])
def ping():
    """Endpoint simples para verificar se o serviço está ativo"""
    return jsonify({"pong": True}), 200

def main():
    """Função principal - inicia o serviço"""
    log("=" * 60)
    log("🚀 SAGRA Folder Opener Service - Iniciando")
    log(f"📍 Porta: {PORT}")
    log(f"🏠 Host: {HOST} (localhost only)")
    log(f"📝 Log: {LOG_FILE}")
    log("=" * 60)
    
    print("=" * 60)
    print("🚀 SAGRA Folder Opener Service")
    print("=" * 60)
    print(f"✅ Serviço iniciado com sucesso!")
    print(f"📍 Rodando em: http://{HOST}:{PORT}")
    print(f"📝 Log: {LOG_FILE}")
    print("")
    print("⚠️  Este serviço DEVE estar rodando para que o SAGRA")
    print("    possa abrir pastas automaticamente.")
    print("")
    print("📌 Para parar o serviço, feche esta janela ou pressione Ctrl+C")
    print("=" * 60)
    
    try:
        # Iniciar servidor
        app.run(
            host=HOST,
            port=PORT,
            debug=False,
            use_reloader=False
        )
    except KeyboardInterrupt:
        log("⏹️  Serviço interrompido pelo usuário")
        print("\n⏹️  Serviço parado.")
    except Exception as e:
        log(f"❌ Erro ao iniciar serviço: {e}")
        print(f"\n❌ Erro: {e}")
        sys.exit(1)

if __name__ == '__main__':
    main()
