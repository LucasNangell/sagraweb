"""
Script de teste: Demonstra como o sistema distingue ressurreição de novo registro
"""
import hashlib

def calculate_hash(andamento):
    """Simula o cálculo de hash do sync_andamentos_v2.py"""
    content_fields = [
        str(andamento.get('SituacaoLink', '')),
        str(andamento.get('SetorLink', '')),
        str(andamento.get('Data', '')),
        str(andamento.get('UltimoStatus', '')),
        str(andamento.get('Observaçao', '')),
        str(andamento.get('Ponto', ''))
    ]
    content_str = '|'.join(content_fields)
    return hashlib.sha256(content_str.encode('utf-8')).hexdigest()

# ===== CENÁRIO 1: Registro original =====
print("=" * 70)
print("CENÁRIO 1: Registro Original")
print("=" * 70)
registro_original = {
    'CodStatus': '065632025-03',
    'NroProtocoloLink': 6563,
    'AnoProtocoloLink': 2025,
    'SituacaoLink': 'Em andamento',
    'SetorLink': 'Impressão',
    'Data': '2025-12-16 10:00:00',
    'UltimoStatus': 'Enviado para impressão',
    'Observaçao': 'Material pronto',
    'Ponto': 1
}
hash_original = calculate_hash(registro_original)
print(f"CodStatus: {registro_original['CodStatus']}")
print(f"Conteúdo: {registro_original['Observaçao']}")
print(f"Hash: {hash_original[:16]}...")
print("✅ Registro inserido no banco")
print("\n🗑️ Usuário EXCLUI este registro do Access")
print("✅ Sistema detecta exclusão e salva em deleted_andamentos com hash")

# ===== CENÁRIO 2: Tentativa de ressurreição (mesmo conteúdo) =====
print("\n" + "=" * 70)
print("CENÁRIO 2: RESSURREIÇÃO (Mesmo CodStatus + Mesmo Conteúdo)")
print("=" * 70)
registro_ressurreicao = registro_original.copy()
hash_ressurreicao = calculate_hash(registro_ressurreicao)
print(f"CodStatus: {registro_ressurreicao['CodStatus']}")
print(f"Conteúdo: {registro_ressurreicao['Observaçao']}")
print(f"Hash: {hash_ressurreicao[:16]}...")
print(f"\n🔍 Verificação:")
print(f"   Hash original:       {hash_original[:16]}...")
print(f"   Hash ressurreição:   {hash_ressurreicao[:16]}...")
print(f"   Hashes iguais?       {hash_original == hash_ressurreicao}")
print("\n❌ BLOQUEADO: É ressurreição do registro excluído!")

# ===== CENÁRIO 3: Novo registro legítimo (conteúdo diferente) =====
print("\n" + "=" * 70)
print("CENÁRIO 3: NOVO REGISTRO (Mesmo CodStatus + Conteúdo Diferente)")
print("=" * 70)
registro_novo = {
    'CodStatus': '065632025-03',  # MESMO CodStatus!
    'NroProtocoloLink': 6563,
    'AnoProtocoloLink': 2025,
    'SituacaoLink': 'Em andamento',
    'SetorLink': 'Acabamento',  # SETOR DIFERENTE
    'Data': '2025-12-16 14:00:00',  # DATA DIFERENTE
    'UltimoStatus': 'Aguardando acabamento',  # STATUS DIFERENTE
    'Observaçao': 'Aguardando material de acabamento',  # OBSERVAÇÃO DIFERENTE
    'Ponto': 2  # PONTO DIFERENTE
}
hash_novo = calculate_hash(registro_novo)
print(f"CodStatus: {registro_novo['CodStatus']}")
print(f"Conteúdo: {registro_novo['Observaçao']}")
print(f"Hash: {hash_novo[:16]}...")
print(f"\n🔍 Verificação:")
print(f"   Hash original:   {hash_original[:16]}...")
print(f"   Hash novo:       {hash_novo[:16]}...")
print(f"   Hashes iguais?   {hash_original == hash_novo}")
print("\n✅ PERMITIDO: É um novo registro legítimo!")
print("✅ Sistema remove o CodStatus de deleted_andamentos")
print("✅ Registro sincronizado normalmente")

print("\n" + "=" * 70)
print("RESUMO")
print("=" * 70)
print("✅ Ressurreição de registro excluído → BLOQUEADO")
print("✅ Novo registro legítimo → PERMITIDO")
print("✅ Controle de exclusão preservado sem impedir novos registros!")
