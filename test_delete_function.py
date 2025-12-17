from database import db
import hashlib

cod_status = "TEST123456-01"
nro = 1234
ano = 2025

def test_delete():
    def transaction_logic(cursor):
        # 1. Inserir um registro de teste
        cursor.execute("""
            INSERT INTO tabAndamento (CodStatus, NroProtocoloLink, AnoProtocoloLink, SituacaoLink, SetorLink, Data, UltimoStatus, Observaçao, Ponto)
            VALUES (%s, %s, %s, 'Teste', 'Setor Teste', NOW(), 0, 'Observação teste', 'N')
        """, (cod_status, nro, ano))
        print(f"✓ Registro inserido: {cod_status}")
        
        # 2. Buscar o registro
        cursor.execute("""
            SELECT SituacaoLink, SetorLink, Data, UltimoStatus, Observaçao, Ponto
            FROM tabAndamento 
            WHERE CodStatus = %s
        """, (cod_status,))
        
        andamento = cursor.fetchone()
        print(f"✓ Andamento encontrado: {andamento is not None}")
        
        if andamento:
            # 3. Calcular hash
            content_fields = [
                str(andamento['SituacaoLink'] if isinstance(andamento, dict) else andamento[0] or ''),
                str(andamento['SetorLink'] if isinstance(andamento, dict) else andamento[1] or ''),
                str(andamento['Data'] if isinstance(andamento, dict) else andamento[2] or ''),
                str(andamento['UltimoStatus'] if isinstance(andamento, dict) else andamento[3] or ''),
                str(andamento['Observaçao'] if isinstance(andamento, dict) else andamento[4] or ''),
                str(andamento['Ponto'] if isinstance(andamento, dict) else andamento[5] or '')
            ]
            content_str = '|'.join(content_fields)
            content_hash = hashlib.sha256(content_str.encode('utf-8')).hexdigest()
            print(f"✓ Hash calculado: {content_hash[:16]}...")
            
            # 4. Inserir em deleted_andamentos
            cursor.execute("""
                INSERT INTO deleted_andamentos (codstatus, nro, ano, content_hash, deleted_at, motivo, origem)
                VALUES (%s, %s, %s, %s, NOW(), 'Teste exclusão', 'API')
                ON DUPLICATE KEY UPDATE deleted_at = NOW(), content_hash = VALUES(content_hash)
            """, (cod_status, nro, ano, content_hash))
            print(f"✓ Hash registrado em deleted_andamentos")
        
        # 5. Excluir
        cursor.execute("DELETE FROM tabAndamento WHERE CodStatus = %s", (cod_status,))
        print(f"✓ Registro excluído")
        
        # 6. Verificar deleted_andamentos
        cursor.execute("SELECT codstatus, LEFT(content_hash, 8) FROM deleted_andamentos WHERE codstatus = %s", (cod_status,))
        deleted = cursor.fetchone()
        if deleted:
            print(f"✓ SUCESSO! Registro em deleted_andamentos: {deleted}")
        else:
            print(f"✗ ERRO! Não encontrado em deleted_andamentos")
        
        return {"status": "ok"}
    
    try:
        db.execute_transaction([transaction_logic])
        print("\n=== TESTE CONCLUÍDO COM SUCESSO ===")
        
        # Limpeza
        conn = db.pool.get_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM deleted_andamentos WHERE codstatus = %s", (cod_status,))
        conn.commit()
        cursor.close()
        db.pool.return_connection(conn)
        print("✓ Limpeza realizada")
        
    except Exception as e:
        print(f"\n✗ ERRO NO TESTE: {e}")
        import traceback
        traceback.print_exc()

test_delete()
