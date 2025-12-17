from database import db
import hashlib

cod_status = "065702025-03"

print(f"=== TESTANDO EXCLUSÃO: {cod_status} ===\n")

def transaction_logic(cursor):
    # 1. Buscar andamento
    cursor.execute("""
        SELECT SituacaoLink, SetorLink, Data, UltimoStatus, Observaçao, Ponto
        FROM tabAndamento 
        WHERE CodStatus = %s
    """, (cod_status,))
    
    andamento = cursor.fetchone()
    print(f"1. Andamento encontrado: {andamento is not None}")
    
    if andamento:
        print(f"   Tipo: {type(andamento)}")
        print(f"   Dados: {andamento}")
        
        # 2. Calcular hash
        content_fields = [
            str(andamento.get('SituacaoLink') or ''),
            str(andamento.get('SetorLink') or ''),
            str(andamento.get('Data') or ''),
            str(andamento.get('UltimoStatus') or ''),
            str(andamento.get('Observaçao') or ''),
            str(andamento.get('Ponto') or '')
        ]
        content_str = '|'.join(content_fields)
        content_hash = hashlib.sha256(content_str.encode('utf-8')).hexdigest()
        print(f"\n2. Hash calculado: {content_hash[:16]}...")
        print(f"   String usada: {content_str[:100]}...")
        
        # 3. Inserir em deleted_andamentos
        cursor.execute("""
            INSERT INTO deleted_andamentos (codstatus, nro, ano, content_hash, deleted_at, motivo, origem)
            VALUES (%s, 6570, 2025, %s, NOW(), 'Exclusão via Frontend', 'API')
            ON DUPLICATE KEY UPDATE deleted_at = NOW(), content_hash = VALUES(content_hash)
        """, (cod_status, content_hash))
        print(f"\n3. ✓ INSERT executado em deleted_andamentos")
        
        # 4. Verificar se foi inserido
        cursor.execute("SELECT codstatus, LEFT(content_hash, 8), motivo FROM deleted_andamentos WHERE codstatus = %s", (cod_status,))
        check = cursor.fetchone()
        if check:
            print(f"\n4. ✓ CONFIRMADO em deleted_andamentos:")
            print(f"   {check}")
        else:
            print(f"\n4. ✗ NÃO ENCONTRADO em deleted_andamentos!")
    
    return {"status": "ok"}

try:
    print("Executando transação...\n")
    db.execute_transaction([transaction_logic])
    print("\n=== TRANSAÇÃO CONCLUÍDA COM SUCESSO ===")
    
    # Verificar fora da transação
    conn = db.pool.get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT codstatus, LEFT(content_hash, 8), motivo, deleted_at FROM deleted_andamentos WHERE codstatus = %s", (cod_status,))
    final_check = cursor.fetchone()
    cursor.close()
    db.pool.return_connection(conn)
    
    if final_check:
        print(f"\n✅ VERIFICAÇÃO FINAL: Registro persistido!")
        print(f"   {final_check}")
    else:
        print(f"\n❌ VERIFICAÇÃO FINAL: Registro NÃO persistido!")
    
except Exception as e:
    print(f"\n❌ ERRO: {e}")
    import traceback
    traceback.print_exc()
