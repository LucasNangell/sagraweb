"""Seed tabCoefA4Produto (uso manual em DEV)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from coef_a4_produto_schema import ensure_coef_a4_produto_schema
from services.coef_a4_produto_service import (
    listar_coef_a4_produtos,
    seed_coef_a4_produto_from_protocolos,
)

if __name__ == "__main__":
    ensure_coef_a4_produto_schema()
    n = seed_coef_a4_produto_from_protocolos(force=True)
    print(f"Inseridos/atualizados: {n}")
    for item in listar_coef_a4_produtos():
        print(
            f"  {item['produto']:40} coef={item['coeficiente']:8.4f} n={item['amostras']}"
        )
