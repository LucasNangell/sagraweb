from database import db
import logging

logging.basicConfig(level=logging.INFO)

def test_insert(cursor):
    print("Testing INSERT with Cedilla column...")
    try:
        # Dummy Data
        new_cod = "TEST-001"
        id = 99999
        ano = 2025
        situacao = "Teste"
        setor = "Teste"
        obs = "Teste Obs"
        usuario = "12345"

        sql = "INSERT INTO tabAndamento (CodStatus, NroProtocoloLink, AnoProtocoloLink, SituacaoLink, SetorLink, `Data`, UltimoStatus, `Observaçao`, Ponto) VALUES (%(cod)s, %(id)s, %(ano)s, %(situacao)s, %(setor)s, NOW(), 1, %(obs)s, %(usuario)s)"
        params = {'cod': new_cod, 'id': id, 'ano': ano, 'situacao': situacao, 'setor': setor, 'obs': obs, 'usuario': usuario}
        
        cursor.execute(sql, params)
        print("INSERT SUCCESS!")
        
        # Cleanup
        cursor.execute("DELETE FROM tabAndamento WHERE CodStatus = 'TEST-001'")
        print("CLEANUP SUCCESS!")
        return True
    except Exception as e:
        print(f"INSERT FAILED: {e}")
        return False

try:
    db.execute_transaction([test_insert])
except Exception as e:
    print(f"Transaction Error: {e}")
