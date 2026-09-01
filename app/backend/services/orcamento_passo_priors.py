"""Priors de etapas e tempos de orçamento (bancada), por família de produto.

Tempos empíricos da análise de andamento (2024–2026). Funções por etapa
seguem o cadastro já usado no chão (quantidade 1); não copia o headcount da folha.
"""
from __future__ import annotations

from typing import Any, Optional

PASSOS_PRIORS_VERSAO = 1

FAMILIA_E = "E"


def _crew(*codigos: str) -> list[dict[str, Any]]:
    return [{"codigo": codigo, "quantidade": 1} for codigo in codigos if codigo]


def _passo(
    ordem: int,
    nome: str,
    setor: str,
    *,
    tipo: str = "produtiva",
    tecnologia: str = "qualquer",
    setup: float = 0,
    un: float = 0,
    pag: float = 0,
    folha: float = 0,
    funcoes: tuple[str, ...] = (),
) -> dict[str, Any]:
    cobra = tipo not in {"espera_cliente", "fim"}
    return {
        "ordem": ordem,
        "nome": nome,
        "setor_link": setor,
        "tipo": tipo,
        "cobra_pessoal": cobra,
        "tecnologia": tecnologia,
        "setup_min": setup,
        "min_por_un": un,
        "min_por_pag": pag,
        "min_por_folha": folha,
        "funcoes": _crew(*funcoes),
    }


def _espera(ordem: int) -> dict[str, Any]:
    return _passo(ordem, "Prova com o cliente", "SEFOC", tipo="espera_cliente")


def _expedicao(ordem: int) -> dict[str, Any]:
    return _passo(ordem, "Expedição", "SEDIR", tipo="fim")


def _refile(ordem: int, *, setup: float = 8, folha: float = 0.05) -> dict[str, Any]:
    return _passo(
        ordem,
        "SEPAC refile",
        "SEPAC",
        setup=setup,
        folha=folha,
        funcoes=("ACAB",),
    )


def _empacote(ordem: int, *, un: float = 0.04) -> dict[str, Any]:
    return _passo(
        ordem,
        "SEPAC empacote",
        "SEPAC",
        setup=5,
        un=un,
        funcoes=("AUX",),
    )


def familia_a(
    *,
    sefoc_pre_pag: float = 0,
    sefoc_pre_crew: tuple[str, ...] = ("PRE",),
    sielt_setup: float = 10,
    sielt_pag: float = 0.004,
    sielt_un: float = 0,
    sielt_crew: tuple[str, ...] = ("DIG",),
    refile_setup: float = 8,
    refile_folha: float = 0.05,
    empacote_un: float = 0.04,
) -> list[dict[str, Any]]:
    """Papelaria digital com prova."""
    return [
        _passo(
            10,
            "SEFOC pré-montagem",
            "SEFOC",
            setup=10,
            pag=sefoc_pre_pag,
            funcoes=sefoc_pre_crew,
        ),
        _espera(20),
        _passo(30, "SEFOC montagem pós-aprovação", "SEFOC", setup=10, funcoes=("PRE",)),
        _passo(
            40,
            "SIELT impressão digital",
            "SIELT",
            tecnologia="digital",
            setup=sielt_setup,
            pag=sielt_pag,
            un=sielt_un,
            funcoes=sielt_crew,
        ),
        _refile(50, setup=refile_setup, folha=refile_folha),
        _empacote(60, un=empacote_un),
        _expedicao(70),
    ]


def familia_a2() -> list[dict[str, Any]]:
    return familia_a(
        sefoc_pre_pag=0.03,
        sefoc_pre_crew=("PRE", "AUX"),
        sielt_pag=0.012,
    )


def familia_a3(*, pasta: bool = False) -> list[dict[str, Any]]:
    return familia_a(
        sielt_setup=12,
        sielt_pag=0.04,
        empacote_un=0.08 if pasta else 0.04,
    )


def familia_a4() -> list[dict[str, Any]]:
    return familia_a(sielt_setup=8, sielt_pag=0, sielt_un=1.0)


def familia_b(
    *,
    sefoc_pre_pag: float = 0.08,
    sielt_pag: float = 0.003,
    seimp_pag: float = 0.003,
) -> list[dict[str, Any]]:
    """Miolo dual: SIELT (digital) e Gravação+SEIMP (offset) no mesmo cadastro."""
    return [
        _passo(
            10,
            "SEFOC pré-montagem",
            "SEFOC",
            setup=15,
            pag=sefoc_pre_pag,
            funcoes=("PRE",),
        ),
        _espera(20),
        _passo(30, "SEFOC montagem pós-aprovação", "SEFOC", setup=15, funcoes=("PRE",)),
        _passo(
            40,
            "SIELT impressão digital",
            "SIELT",
            tecnologia="digital",
            setup=15,
            pag=sielt_pag,
            funcoes=("DIG", "AUX"),
        ),
        _passo(
            50,
            "Gravação CTP",
            "Gravação",
            tecnologia="offset",
            setup=20,
            funcoes=("GRAV",),
        ),
        _passo(
            60,
            "SEIMP impressão offset",
            "SEIMP",
            tecnologia="offset",
            setup=30,
            pag=seimp_pag,
            funcoes=("IMP_OFF", "AUX_OFF"),
        ),
        _refile(70, setup=10, folha=0.02),
        _empacote(80),
        _expedicao(90),
    ]


def familia_b2() -> list[dict[str, Any]]:
    return familia_b(sefoc_pre_pag=0.6, sielt_pag=0.014, seimp_pag=0.004)


def familia_b3() -> list[dict[str, Any]]:
    return familia_b(sefoc_pre_pag=4, sielt_pag=0.015)


def familia_c() -> list[dict[str, Any]]:
    """Timbrado A4: SEFOC/prova de papelaria + ramos digital e offset."""
    return [
        _passo(10, "SEFOC pré-montagem", "SEFOC", setup=10, funcoes=("PRE",)),
        _espera(20),
        _passo(30, "SEFOC montagem pós-aprovação", "SEFOC", setup=10, funcoes=("PRE",)),
        _passo(
            40,
            "SIELT impressão digital",
            "SIELT",
            tecnologia="digital",
            setup=10,
            pag=0.004,
            funcoes=("DIG",),
        ),
        _passo(
            50,
            "Gravação CTP",
            "Gravação",
            tecnologia="offset",
            setup=20,
            funcoes=("GRAV",),
        ),
        _passo(
            60,
            "SEIMP impressão offset",
            "SEIMP",
            tecnologia="offset",
            setup=30,
            pag=0.002,
            funcoes=("IMP_OFF", "AUX_OFF"),
        ),
        _refile(70),
        _empacote(80),
        _expedicao(90),
    ]


def familia_d() -> list[dict[str, Any]]:
    """Só SEPAC (banner, envelope, caixa, acabamento)."""
    return [
        _passo(
            10,
            "SEPAC produção",
            "SEPAC",
            setup=15,
            un=0.5,
            funcoes=("ACAB",),
        ),
        _empacote(20),
        _expedicao(30),
    ]


_FAMILIA_BUILDERS: dict[str, Any] = {
    "A": familia_a,
    "A2": familia_a2,
    "A3": familia_a3,
    "A3_pasta": lambda: familia_a3(pasta=True),
    "A4": familia_a4,
    "B": familia_b,
    "B2": familia_b2,
    "B3": familia_b3,
    "C": familia_c,
    "D": familia_d,
}

# Rótulos idênticos a TipoPublicacaoLink / tabSystemCatalog.
PRODUTO_FAMILIA: dict[str, str] = {
    "Ct Visita": "A",
    "Ct de Cumprimento": "A",
    "Ct Duplo Paisagem Topo": "A",
    "Ct Duplo Paisagem Lateral": "A",
    "Ct Duplo Retrato Lateral": "A",
    "Ct Gab Simples (Cor)": "A",
    "Ct Gab (Digital)": "A",
    "Ct de Exped (PB)": "A",
    "Cartão": "A",
    "Convite": "A",
    "Aerograma": "A",
    "Marcador de Livros": "A",
    "Filipeta": "A",
    "Etiquetas": "A",
    "Display": "A",
    "Avulso": "A",
    "Timbrado A4 (Digital)": "A",
    "Timbrado A5": "A",
    "Timbrado": "A",
    "Bloco A5": "A2",
    "Blocos Diversos": "A2",
    "Bloco Carbonado": "A2",
    "Folder": "A3",
    "Pasta Avulso c/ Bolso": "A3_pasta",
    "Pasta Avulso s/ Bolso": "A3_pasta",
    "Pastas Diversas": "A3_pasta",
    "Pasta Processo": "A3_pasta",
    "Crachá": "A4",
    "Certificado": "A4",
    "Cartaz": "A4",
    "Livro": "B",
    "Apostila": "B",
    "Catálogo": "B",
    "Jornal A4": "B",
    "Impresso Genérico": "B",
    "Encarte": "B",
    "Revista s/ Capa": "B",
    "Revista": "B",
    "Outros": "B",
    "Livreto c/ Capa": "B2",
    "Livreto s/ Capa": "B2",
    "Revista c/ Capa": "B2",
    "Folheto": "B3",
    "Informativo": "B3",
    "Postal": "B3",
    "Timbrado A4": "C",
    "Banner": "D",
    "Envelope": "D",
    "Caixa": "D",
    "Acabamento": "D",
    "Encadernação/Douração": "D",
    "Corte/Refile": "D",
    "Recortes": "D",
    "Digitalização": FAMILIA_E,
    "Capa de CD": FAMILIA_E,
    "Jornal da Câmara": FAMILIA_E,
    "Jornal A5": FAMILIA_E,
    "DCD": FAMILIA_E,
    "Formulário": FAMILIA_E,
    "Vários": FAMILIA_E,
    "Ignorado": FAMILIA_E,
    "(sem produto)": FAMILIA_E,
}


def _acabamento(
    nome: str,
    *,
    setup: float = 0,
    un: float = 0,
    pag: float = 0,
    folha: float = 0,
    funcoes: tuple[str, ...] = ("ACAB",),
) -> list[dict[str, Any]]:
    return [
        _passo(
            10,
            nome,
            "SEPAC",
            setup=setup,
            un=un,
            pag=pag,
            folha=folha,
            funcoes=funcoes,
        )
    ]


ACABAMENTO_PASSOS: dict[str, list[dict[str, Any]]] = {
    "Laminação": _acabamento("Laminação", setup=25, folha=0.05),
    "Refile": _acabamento("Refile", setup=8, folha=0.05),
    "Dobra": _acabamento("Dobra", setup=8, un=0.05),
    "Faca": _acabamento("Faca", setup=40, un=0.20),
    "Grampo": _acabamento("Grampo", setup=5, un=0.10),
    "Cola": _acabamento("Cola", setup=30, un=0.50, funcoes=("ACAB", "AUX_INS")),
    "Espiral": _acabamento("Espiral", setup=20, un=2.0, funcoes=("ACAB", "AUX_INS")),
    "Wire-O": _acabamento("Wire-O", setup=20, un=2.0, funcoes=("ACAB", "AUX_INS")),
    "Capa PVC": _acabamento("Capa PVC", setup=10, un=1.0),
    "Costura": _acabamento("Costura", setup=25, un=0.80),
    "Verniz": _acabamento("Verniz", setup=20, folha=0.08),
}


def familia_do_produto(rotulo: str) -> Optional[str]:
    key = (rotulo or "").strip()
    return PRODUTO_FAMILIA.get(key)


def passos_para_produto(rotulo: str) -> Optional[list[dict[str, Any]]]:
    familia = familia_do_produto(rotulo)
    if not familia or familia == FAMILIA_E:
        return None
    builder = _FAMILIA_BUILDERS[familia]
    return builder()


def produtos_com_passos() -> list[str]:
    return [rotulo for rotulo, familia in PRODUTO_FAMILIA.items() if familia != FAMILIA_E]


def passos_para_acabamento(rotulo: str) -> Optional[list[dict[str, Any]]]:
    key = (rotulo or "").strip()
    passos = ACABAMENTO_PASSOS.get(key)
    if passos is None:
        return None
    return [dict(p) for p in passos]


def bind_funcoes(passos: list[dict[str, Any]], codigo_to_id: dict[str, int]) -> list[dict[str, Any]]:
    """Troca codigo de função por funcao_id (payload de replace_passos)."""
    bound: list[dict[str, Any]] = []
    for raw in passos:
        passo = dict(raw)
        crew: list[dict[str, Any]] = []
        seen: set[int] = set()
        for item in raw.get("funcoes") or []:
            codigo = str(item.get("codigo") or "").strip()
            fid = int(codigo_to_id.get(codigo) or 0)
            if fid <= 0 or fid in seen:
                continue
            seen.add(fid)
            crew.append(
                {
                    "funcao_id": fid,
                    "quantidade": item.get("quantidade") or 1,
                }
            )
        passo["funcoes"] = crew
        bound.append(passo)
    return bound
