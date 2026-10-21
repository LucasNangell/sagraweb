"""
SAGRA Local Folder Opener Service
==================================

Serviço local que permite ao sistema web SAGRA abrir pastas automaticamente
no Windows Explorer quando o usuário clica em "Abrir Pasta" na OS.

SEGURANÇA:
- Aceita apenas conexões de localhost (127.0.0.1)
- Abre pastas no Explorer e arquivos no aplicativo padrão do Windows
- Recusa executáveis/scripts (.exe, .bat, .ps1, etc.)
- Valida existência do caminho antes de abrir

PORTA: 5566 (127.0.0.1:5566)

Impressão (v1.2): GET /printers e POST /print-pdf enviam PDF 102x297 mm
para uma fila do Windows com DEVMODE (o Chrome não consegue forçar o papel).

Para gerar executável (a partir de app/services):
    pyinstaller --onefile --noconsole --name "SAGRA-FolderOpener" ^
      --hidden-import win32print --hidden-import win32ui --hidden-import win32con ^
      --hidden-import win32gui --hidden-import fitz --hidden-import PIL ^
      --hidden-import PIL.ImageWin folder_opener_service.py
    Copiar dist\\SAGRA-FolderOpener.exe para local_services\\dist e C:\\_SAGRA

Autor: Sistema SAGRA
Data: 22/01/2026
Versão: 1.2.0
"""
 
import os
import sys
import subprocess
import time
import ctypes
import base64
from pathlib import Path
from datetime import datetime
from flask import Flask, request, jsonify
from flask_cors import CORS

# Configuração
PORT = 5566
HOST = '127.0.0.1'
VERSION = "1.2.0"
PRINT_MAX_PDF_BYTES = 12 * 1024 * 1024
PRINT_MAX_PAGES = 99
SEPARADOR_FORM_NAME = "SAGRA_102x297"
LOG_FILE = Path.home() / "sagra_folder_opener.log"
_BLOCKED_FILE_EXTENSIONS = frozenset({
    ".exe", ".bat", ".cmd", ".com", ".msi", ".ps1", ".vbs", ".js",
    ".jse", ".wsf", ".wsh", ".scr", ".dll", ".msc",
})

# Criar aplicação Flask
app = Flask(__name__)

# CORS apenas para localhost
# CORS permissivo para facilitar uso em diferentes IPs de servidor
CORS(app, resources={
    r"/open-folder": {
        "origins": "*",
        "methods": ["POST", "OPTIONS"],
        "allow_headers": ["Content-Type"]
    },
    r"/open-file": {
        "origins": "*",
        "methods": ["POST", "OPTIONS"],
        "allow_headers": ["Content-Type"]
    },
    r"/printers": {
        "origins": "*",
        "methods": ["GET", "OPTIONS"],
        "allow_headers": ["Content-Type"]
    },
    r"/print-pdf": {
        "origins": "*",
        "methods": ["POST", "OPTIONS"],
        "allow_headers": ["Content-Type"]
    },
    r"/health": {
        "origins": "*",
        "methods": ["GET", "OPTIONS"],
        "allow_headers": ["Content-Type"]
    },
})

def log(message):
    """Registra mensagem no log local"""
    try:
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(f"[{timestamp}] {message}\n")
    except Exception as e:
        print(f"Erro ao escrever log: {e}")

import re
import unicodedata


def normalize_text_custom(text, is_product=False):
    """
    Normaliza texto para nome de pasta.

    Solicitante: sem acentos, espacos ou pontos.
    Produto: sem acentos, espacos, pontos ou caracteres especiais.
    """
    if not text:
        return ""

    s = str(text).strip()

    # Remover acentos
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")

    if is_product:
        s = re.sub(r"[^A-Za-z0-9]", "", s)
    else:
        s = s.replace(".", "")
        s = re.sub(r"\s+", "", s)

    s = s.title()

    return s

def create_folder_structure(base_path, folder_name):
    """
    Cria estrutura de pastas conforme padrao da CGraf
    """
    try:
        # Criar caminho completo
        main_folder = Path(base_path) / folder_name
        
        # Criar subpastas conforme padrão
        subfolders = [
            main_folder,
            main_folder / "Original",
            main_folder / "Sefoc",
            main_folder / "Sefoc" / "Offset",
            main_folder / "Sefoc" / "Digital",
            main_folder / "Sefoc" / "AdminDocs"
        ]
        
        # Criar todas as pastas
        for folder in subfolders:
            folder.mkdir(parents=True, exist_ok=True)
            log(f"Pasta verificada/criada: {folder}")
        
        return True, str(main_folder), "OK"
        
    except Exception as e:
        error_msg = f"Erro ao criar estrutura de pastas: {str(e)}"
        log(f"❌ {error_msg}")
        return False, None, error_msg

def is_valid_folder_path(path):
    """
    Valida se o caminho é uma pasta válida e segura para abrir
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

def _print_capabilities():
    win32print = None
    fitz = None
    Image = None
    try:
        import win32print as _win32print
        win32print = _win32print
    except Exception:
        win32print = None
    try:
        import fitz as _fitz
        fitz = _fitz
    except Exception:
        fitz = None
    try:
        from PIL import Image as _Image
        Image = _Image
    except Exception:
        Image = None
    return win32print, fitz, Image


def list_windows_printers():
    win32print, _, _ = _print_capabilities()
    if not win32print:
        return [], None, "pywin32 nao instalado no servico local"
    flags = win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS
    names = []
    for item in win32print.EnumPrinters(flags, None, 1):
        name = str(item[2] or "").strip()
        if name:
            names.append(name)
    names = sorted(set(names), key=str.lower)
    default_name = None
    try:
        default_name = win32print.GetDefaultPrinter()
    except Exception:
        default_name = names[0] if names else None
    return names, default_name, None


def _ensure_custom_form(win32print, handle, width_mm, height_mm):
    size = (int(round(width_mm * 1000)), int(round(height_mm * 1000)))
    form = {
        "Flags": 0,
        "Name": SEPARADOR_FORM_NAME,
        "Size": size,
        "ImageableArea": (0, 0, size[0], size[1]),
    }
    try:
        win32print.AddForm(handle, 1, form)
        log(f"Formulario de papel criado: {SEPARADOR_FORM_NAME}")
    except Exception as exc:
        log(f"Formulario {SEPARADOR_FORM_NAME} ja existe ou nao pode ser criado: {exc}")


def _apply_page_devmode(devmode, width_mm, height_mm):
    import win32con
    width_tenths = int(round(width_mm * 10))
    height_tenths = int(round(height_mm * 10))
    try:
        # DMPAPER_USER = 256: o driver deve usar PaperWidth/PaperLength (0,1 mm)
        devmode.PaperSize = 256
        devmode.PaperWidth = width_tenths
        devmode.PaperLength = height_tenths
        devmode.Orientation = 1
        devmode.FormName = SEPARADOR_FORM_NAME
        fields = int(getattr(devmode, "Fields", 0) or 0)
        fields |= (
            win32con.DM_PAPERSIZE
            | win32con.DM_PAPERWIDTH
            | win32con.DM_PAPERLENGTH
            | win32con.DM_ORIENTATION
        )
        if hasattr(win32con, "DM_FORMNAME"):
            fields |= win32con.DM_FORMNAME
        devmode.Fields = fields
    except Exception as exc:
        log(f"Nao foi possivel ajustar DEVMODE: {exc}")
    return devmode


def decode_print_pdf_payload(data):
    printer = str((data or {}).get("printer") or "").strip()
    if not printer or len(printer) > 256:
        return None, "Impressora invalida"
    raw_b64 = (data or {}).get("pdf_base64")
    if not isinstance(raw_b64, str) or not raw_b64.strip():
        return None, "PDF ausente"
    if len(raw_b64) > PRINT_MAX_PDF_BYTES * 2:
        return None, "PDF muito grande"
    try:
        pdf_bytes = base64.b64decode(raw_b64, validate=True)
    except Exception:
        return None, "PDF invalido"
    if len(pdf_bytes) > PRINT_MAX_PDF_BYTES:
        return None, "PDF muito grande"
    if not pdf_bytes.startswith(b"%PDF"):
        return None, "Arquivo nao e PDF"
    try:
        width_mm = float((data or {}).get("width_mm", 102))
        height_mm = float((data or {}).get("height_mm", 297))
    except (TypeError, ValueError):
        return None, "Tamanho de papel invalido"
    if abs(width_mm - 102.0) > 0.51 or abs(height_mm - 297.0) > 0.51:
        return None, "Somente papel 102 x 297 mm"
    return {
        "printer": printer,
        "pdf_bytes": pdf_bytes,
        "width_mm": 102.0,
        "height_mm": 297.0,
    }, None


def _create_printer_dc(printer_name, devmode):
    import win32gui
    import win32ui
    handle = win32gui.CreateDC("WINSPOOL", printer_name, devmode)
    return win32ui.CreateDCFromHandle(handle)


def print_pdf_bytes(printer_name, pdf_bytes, width_mm=102.0, height_mm=297.0):
    win32print, fitz, Image = _print_capabilities()
    if not win32print:
        return False, "pywin32 nao instalado no servico local"
    if not fitz:
        return False, "pymupdf nao instalado no servico local"
    if not Image:
        return False, "Pillow nao instalado no servico local"

    names, _, _ = list_windows_printers()
    if printer_name not in names:
        return False, "Impressora nao encontrada neste computador"

    try:
        import win32con
        from PIL import ImageWin
    except Exception as exc:
        return False, f"Dependencia de impressao ausente: {exc}"

    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception as exc:
        return False, f"PDF ilegivel: {exc}"
    hdc = None
    handle = None
    try:
        if doc.page_count < 1:
            return False, "PDF vazio"
        if doc.page_count > PRINT_MAX_PAGES:
            return False, f"PDF excede {PRINT_MAX_PAGES} paginas"
        handle = win32print.OpenPrinter(printer_name)
        _ensure_custom_form(win32print, handle, width_mm, height_mm)
        info = win32print.GetPrinter(handle, 2)
        devmode = info.get("pDevMode")
        if devmode is None:
            return False, "Nao foi possivel ler a configuracao da impressora"
        devmode = _apply_page_devmode(devmode, width_mm, height_mm)
        try:
            win32print.DocumentProperties(
                0,
                handle,
                printer_name,
                devmode,
                devmode,
                win32con.DM_IN_BUFFER | win32con.DM_OUT_BUFFER,
            )
            devmode = _apply_page_devmode(devmode, width_mm, height_mm)
        except Exception as exc:
            log(f"DocumentProperties nao aplicou o papel customizado: {exc}")

        hdc = _create_printer_dc(printer_name, devmode)
        dpi_x = hdc.GetDeviceCaps(win32con.LOGPIXELSX) or 300
        dpi_y = hdc.GetDeviceCaps(win32con.LOGPIXELSY) or 300
        dest_w = max(1, int(round(width_mm / 25.4 * dpi_x)))
        dest_h = max(1, int(round(height_mm / 25.4 * dpi_y)))
        resample = getattr(getattr(Image, "Resampling", Image), "LANCZOS", Image.LANCZOS)

        hdc.StartDoc("SAGRA Separador")
        try:
            for page in doc:
                pix = page.get_pixmap(dpi=min(int(dpi_x), 300), alpha=False)
                img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
                img = img.resize((dest_w, dest_h), resample)
                hdc.StartPage()
                dib = ImageWin.Dib(img)
                dib.draw(hdc.GetHandleOutput(), (0, 0, dest_w, dest_h))
                hdc.EndPage()
        finally:
            hdc.EndDoc()
        return True, "OK"
    except Exception as exc:
        log(f"Erro ao imprimir PDF: {exc}")
        return False, str(exc)
    finally:
        if hdc is not None:
            try:
                hdc.DeleteDC()
            except Exception:
                pass
        if handle is not None:
            try:
                win32print.ClosePrinter(handle)
            except Exception:
                pass
        doc.close()


def is_valid_file_path(path):
    """
    Valida se o caminho é um arquivo existente e seguro para abrir com o app padrão.
    """
    if not path:
        return False, "Caminho vazio"
    try:
        file_path = Path(path)
    except Exception as e:
        return False, f"Caminho inválido: {e}"
    if not file_path.exists():
        return False, "Arquivo não encontrado"
    if not file_path.is_file():
        return False, "Caminho não é um arquivo"
    if file_path.suffix.lower() in _BLOCKED_FILE_EXTENSIONS:
        return False, "Tipo de arquivo não permitido"
    return True, "OK"

@app.route('/open-folder', methods=['POST'])
def open_folder():
    """
    Endpoint para abrir pasta no Windows Explorer
    """
    try:
        # Obter dados da requisição
        data = request.get_json()
        
        if not data:
            log("Requisicao sem JSON")
            return jsonify({
                "success": False,
                "error": "Requisição inválida - JSON esperado"
            }), 400
        
        # Extrair caminho e flags
        folder_path = data.get('path')
        create_missing = data.get('create_missing', False) # Flag explícita para criar
        
        # Se o caminho for invalido ou vazio, mas temos flag de criacao e dados, tentamos criar
        should_try_create = False
        
        if not folder_path or not os.path.exists(folder_path):
             if create_missing:
                 should_try_create = True
             elif not folder_path:
                 log("Caminho não fornecido e create_missing=False")
                 return jsonify({"success": False, "error": "Caminho não fornecido"}), 400
        
        # Lógica de Criação (apenas se solicitado OU se path original falhou e temos permissão)
        created_path = None
        
        nr_os = data.get('nr_os')
        solicitante = data.get('solicitante')
        produto = data.get('produto')
        titulo = data.get('titulo')
        ano_os = data.get('ano_os')
        
        if should_try_create:
            if nr_os and solicitante and produto and ano_os:
                log(f"Solicitação de criação de pasta para OS {nr_os}")
                
                # Normalizar valores
                
                # OS: 5 digitos
                try:
                    nr_os_val = int(nr_os)
                except:
                    nr_os_val = 0
                
                nr_os_norm = f"{nr_os_val:05d}"
                
                # Solicitante (Sigla ou Nome)
                # Formato: Iniciais maiusculas, sem acento, sem espaco
                solicitante_norm = normalize_text_custom(solicitante, is_product=False)
                
                # Produto
                # Formato: Iniciais maiusculas, sem acento, sem espaco, sem chars especiais
                produto_norm = normalize_text_custom(produto, is_product=True)

                # Ano (4 digitos)
                try:
                    ano_val = int(ano_os)
                    if ano_val < 100: ano_val += 2000 # 25 -> 2025
                    ano_str = str(ano_val)
                except:
                    ano_str = str(datetime.now().year)

                # Montar nome da pasta: 00000-Solicitante-Produto_Titul
                folder_name = f"{nr_os_norm}-{solicitante_norm}-{produto_norm}"
                titulo_snip = normalize_text_custom(titulo or "", is_product=False)[:5]
                if titulo_snip:
                    folder_name = f"{folder_name}_{titulo_snip}"
                
                # Definir caminho base (Normal vs Papelaria)
                # Regra: >= 5000 é Papelaria
                if nr_os_val >= 5000:
                    base_path = f"\\\\redecamara\\DfsData\\CGraf\\Sefoc\\Deputados\\{ano_str}\\Deputados_Papelaria_{ano_str}\\"
                else:
                    base_path = f"\\\\redecamara\\DfsData\\CGraf\\Sefoc\\Deputados\\{ano_str}\\Deputados_{ano_str}\\"
                
                log(f"Nome pasta calculado: {folder_name}")
                log(f"Base path: {base_path}")
                
                # Criar estrutura
                success, path_res, error_msg = create_folder_structure(base_path, folder_name)
                
                if success:
                    folder_path = path_res # Atualiza o caminho para o novo criado
                    log(f"Pasta pronta para uso: {folder_path}")
                else:
                    log(f"Falha na criação: {error_msg}")
                    # Se falhou ao criar, e não tínhamos path original, é erro fatal
                    if not folder_path:
                         return jsonify({"success": False, "error": f"Falha ao criar pasta: {error_msg}"}), 500
            else:
                log("Dados insuficientes para criar pasta (nr_os, solicitante, produto, ano_os)")
                if not folder_path:
                     return jsonify({"success": False, "error": "Dados insuficientes para criar pasta"}), 400

        log(f"Tentando abrir pasta: {folder_path}")
        
        # Validar caminho
        is_valid, error_msg = is_valid_folder_path(folder_path)
        
        if not is_valid:
            log(f"Validacao falhou: {error_msg}")
            return jsonify({
                "success": False,
                "error": error_msg
            }), 400
        
        # Abrir pasta no Explorer
        try:
            # Usar subprocess para abrir a pasta
            subprocess.Popen(['explorer', folder_path], shell=True)
            
            # Aguardar a janela ser criada
            time.sleep(0.7)
            
            # Trazer a janela do Explorer para o primeiro plano
            try:
                def bring_to_front():
                    """Traz a janela do Explorer para o primeiro plano"""
                    EnumWindows = ctypes.windll.user32.EnumWindows
                    SetForegroundWindow = ctypes.windll.user32.SetForegroundWindow
                    ShowWindow = ctypes.windll.user32.ShowWindow
                    
                    hwnd_list = []
                    
                    def enum_callback(hwnd, param):
                        hwnd_list.append(hwnd)
                        return True
                    
                    callback_func = ctypes.CFUNCTYPE(ctypes.c_bool, ctypes.c_int, ctypes.c_int)(enum_callback)
                    EnumWindows(callback_func, 0)
                    
                    # Trazer a última janela para frente (deve ser a do Explorer)
                    if hwnd_list:
                        hwnd = hwnd_list[-1]
                        SetForegroundWindow(hwnd)
                        ShowWindow(hwnd, 5)  # SW_SHOW = 5
                
                bring_to_front()
            except Exception as e:
                log(f"Aviso: Nao foi possivel trazer janela para frente: {e}")
            
            log(f"Pasta aberta com sucesso: {folder_path}")
            
            return jsonify({
                "success": True,
                "message": "Pasta aberta com sucesso",
                "path": folder_path
            }), 200
            
        except Exception as e:
            log(f"Erro ao abrir pasta: {e}")
            return jsonify({
                "success": False,
                "error": f"Erro ao abrir pasta: {str(e)}"
            }), 500
    
    except Exception as e:
        log(f"Erro inesperado: {e}")
        return jsonify({
            "success": False,
            "error": f"Erro inesperado: {str(e)}"
        }), 500

@app.route('/open-file', methods=['POST'])
def open_file():
    """
    Abre arquivo no aplicativo padrão do Windows (ex.: PDF no Acrobat).
    """
    try:
        data = request.get_json()
        if not data:
            return jsonify({"success": False, "error": "Requisição inválida - JSON esperado"}), 400

        file_path = data.get('path')
        if not file_path:
            return jsonify({"success": False, "error": "Caminho não fornecido"}), 400

        log(f"Tentando abrir arquivo: {file_path}")
        is_valid, error_msg = is_valid_file_path(file_path)
        if not is_valid:
            log(f"Validacao arquivo falhou: {error_msg}")
            return jsonify({"success": False, "error": error_msg}), 400

        try:
            os.startfile(file_path)
            log(f"Arquivo aberto com sucesso: {file_path}")
            return jsonify({
                "success": True,
                "message": "Arquivo aberto com sucesso",
                "path": file_path,
            }), 200
        except Exception as e:
            log(f"Erro ao abrir arquivo: {e}")
            return jsonify({"success": False, "error": f"Erro ao abrir arquivo: {str(e)}"}), 500
    except Exception as e:
        log(f"Erro inesperado ao abrir arquivo: {e}")
        return jsonify({"success": False, "error": f"Erro inesperado: {str(e)}"}), 500

@app.route('/printers', methods=['GET'])
def printers():
    names, default_name, err = list_windows_printers()
    if err:
        return jsonify({"success": False, "error": err, "printers": []}), 501
    return jsonify({
        "success": True,
        "printers": names,
        "default": default_name,
    }), 200


@app.route('/print-pdf', methods=['POST'])
def print_pdf():
    try:
        data = request.get_json()
        if not data:
            return jsonify({"success": False, "error": "JSON esperado"}), 400
        payload, err = decode_print_pdf_payload(data)
        if err:
            return jsonify({"success": False, "error": err}), 400
        log(
            f"Imprimindo PDF na fila '{payload['printer']}' "
            f"{payload['width_mm']}x{payload['height_mm']} mm"
        )
        ok, msg = print_pdf_bytes(
            payload["printer"],
            payload["pdf_bytes"],
            payload["width_mm"],
            payload["height_mm"],
        )
        if not ok:
            return jsonify({"success": False, "error": msg}), 500
        return jsonify({"success": True, "message": msg}), 200
    except Exception as exc:
        log(f"Erro inesperado em /print-pdf: {exc}")
        return jsonify({"success": False, "error": str(exc)}), 500


@app.route('/health', methods=['GET'])
def health():
    """Endpoint de verificação de saúde do serviço"""
    win32print, fitz, Image = _print_capabilities()
    return jsonify({
        "status": "running",
        "service": "SAGRA Folder Opener",
        "version": VERSION,
        "port": PORT,
        "print": bool(win32print and fitz and Image),
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
