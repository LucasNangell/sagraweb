#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script para iniciar o servidor e executar teste
"""
import subprocess
import time
import sys
import os

os.chdir("c:/Users/P_918713/Desktop/Antigravity/SagraWeb")

# Iniciar servidor
print("Iniciando servidor...")
server_proc = subprocess.Popen([
    "C:/Users/P_918713/Desktop/Antigravity/SagraWeb/.venv/Scripts/python.exe",
    "server.py"
], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

print("Aguardando inicialização... (5 segundos)")
time.sleep(5)

# Verificar se servidor está rodando
if server_proc.poll() is not None:
    # Processo morreu
    stdout, stderr = server_proc.communicate()
    print("ERRO: Servidor não iniciou!")
    print("STDOUT:", stdout)
    print("STDERR:", stderr)
    sys.exit(1)

print("✓ Servidor rodando!")
print("\nExecutando teste...")
time.sleep(1)

# Executar teste
test_proc = subprocess.run([
    "C:/Users/P_918713/Desktop/Antigravity/SagraWeb/.venv/Scripts/python.exe",
    "teste_finalize_v2.py"
], capture_output=True, text=True)

print(test_proc.stdout)
if test_proc.stderr:
    print("STDERR:", test_proc.stderr)

# Matar servidor
print("\nFinalizando servidor...")
server_proc.terminate()
try:
    server_proc.wait(timeout=5)
except subprocess.TimeoutExpired:
    server_proc.kill()
    
print("Feito!")
