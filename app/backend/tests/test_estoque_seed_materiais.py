"""Testes do seed de materiais do relatório estoque.pdf."""

from estoque_seed_materiais import _SEED_MATERIAIS


def test_seed_materiais_tem_itens_do_relatorio():
    codigos = {item for item, *_ in _SEED_MATERIAIS}
    assert 1 in codigos
    assert 24 in codigos  # Chapa Komori com saldo 450
    assert 42 in codigos  # HIDROCLEAN
    assert 151 in codigos
    # Itens de teste do PDF não entram no seed
    assert 141 not in codigos
    assert 142 not in codigos
    assert 143 not in codigos


def test_seed_materiais_quantidade_chapa_komori():
    chapa = next(t for t in _SEED_MATERIAIS if t[0] == 24)
    assert chapa[2] == "chapa"
    assert chapa[3] == 450
    assert chapa[4] == "Chapa"


def test_seed_materiais_campos_opcionais_nao_forcam_custo():
    # Apenas nome/unidade/categoria/qtd — resto fica para o usuário
    for item, nome, unidade, qtd, categoria in _SEED_MATERIAIS:
        assert nome.strip()
        assert unidade in {"un", "folha", "litro", "chapa", "m", "g"}
        assert categoria in {"Papel", "Película", "Tinta", "Chapa", "Insumo geral"}
        assert qtd >= 0
