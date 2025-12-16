import sys
import os

sys.path.append(os.getcwd())

try:
    print("Tentando importar database...")
    from database import db
    print("OK: database importado.")
    print("Tentando importar routers.api...")
    from routers import api
    print("OK: routers.api importado.")
    
    print("Tentando importar routers.os_routes...")
    from routers import os_routes
    print("OK: routers.os_routes importado.")
    
    print("Tentando importar routers.analise_routes...")
    from routers import analise_routes
    print("OK: routers.analise_routes importado.")
    
    print("Tentando importar routers.email_routes...")
    from routers import email_routes
    print("OK: routers.email_routes importado.")
    
    print("Tentando importar routers.auxiliar_routes...")
    from routers import auxiliar_routes
    print("OK: routers.auxiliar_routes importado.")
    
    print("Tentando importar routers.papelaria_routes...")
    from routers import papelaria_routes
    print("OK: routers.papelaria_routes importado.")

    print("TODOS OS IMPORTS FUNCIONARAM!")

except Exception as e:
    print(f"ERRO DE IMPORTAÇÃO: {e}")
