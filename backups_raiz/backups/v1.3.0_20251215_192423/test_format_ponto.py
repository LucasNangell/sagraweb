#!/usr/bin/env python3
"""
Teste da função format_ponto
Valida a formatação de pontos no padrão #.#00
"""

from routers.andamento_helpers import format_ponto

# Casos de teste
test_cases = [
    ("918713", "918.713"),
    ("12345", "12.345"),
    ("123", "123"),
    ("1234567", "1.234.567"),
    ("1", "1"),
    ("12", "12"),
    ("1234", "1.234"),
    ("", ""),
    (None, ""),
    ("918.713", "918.713"),  # Já formatado
    ("abc123def456", "123.456"),  # Com caracteres não numéricos
]

print("="*60)
print("TESTE: Formatação de Ponto (#.#00)")
print("="*60 + "\n")

passed = 0
failed = 0

for input_val, expected in test_cases:
    result = format_ponto(input_val)
    status = "✅ PASS" if result == expected else "❌ FAIL"
    
    if result == expected:
        passed += 1
    else:
        failed += 1
    
    print(f"{status} | Input: {str(input_val):20s} | Expected: {expected:15s} | Got: {result}")

print("\n" + "="*60)
print(f"RESUMO: {passed} passed, {failed} failed")
print("="*60)

if failed == 0:
    print("\n✅ Todos os testes passaram!")
else:
    print(f"\n⚠️  {failed} teste(s) falharam")
