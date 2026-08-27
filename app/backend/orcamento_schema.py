"""
Schema MySQL-only do módulo de orçamento gráfico.
Tabelas de insumos, parâmetros, formatos, faixas de pessoal e snapshots.
"""
from __future__ import annotations

import json
import logging

from database import Database

logger = logging.getLogger(__name__)

_CREATE_INSUMO_SQL = """
CREATE TABLE IF NOT EXISTS tab_orcamento_insumo (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    codigo VARCHAR(32) NOT NULL,
    categoria VARCHAR(32) NOT NULL,
    especificacao VARCHAR(255) NOT NULL,
    unidade VARCHAR(16) NULL,
    qtd_embalagem DECIMAL(14,4) NOT NULL DEFAULT 1,
    preco_bruto DECIMAL(14,4) NOT NULL DEFAULT 0,
    preco_unitario DECIMAL(14,6) NOT NULL DEFAULT 0,
    rendimento_a4 DECIMAL(8,2) NULL,
    formato_folha VARCHAR(32) NULL,
    aliases_json JSON NULL,
    atualizado_em DATE NULL,
    ativo TINYINT(1) NOT NULL DEFAULT 1,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_por VARCHAR(32) NULL,
    UNIQUE KEY uk_orcamento_insumo_codigo (codigo),
    KEY idx_orcamento_insumo_categoria (categoria, ativo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""

_CREATE_PARAMETRO_SQL = """
CREATE TABLE IF NOT EXISTS tab_orcamento_parametro (
    chave VARCHAR(64) NOT NULL PRIMARY KEY,
    valor TEXT NOT NULL,
    tipo VARCHAR(16) NOT NULL DEFAULT 'number',
    descricao VARCHAR(255) NULL,
    atualizado_em DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
    atualizado_por VARCHAR(32) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""

_CREATE_FORMATO_SQL = """
CREATE TABLE IF NOT EXISTS tab_orcamento_formato (
    id INT AUTO_INCREMENT PRIMARY KEY,
    codigo VARCHAR(8) NOT NULL,
    menor_mm DECIMAL(8,2) NOT NULL,
    maior_mm DECIMAL(8,2) NOT NULL,
    fator_a4 DECIMAL(8,4) NOT NULL,
    ordem INT NOT NULL DEFAULT 0,
    ativo TINYINT(1) NOT NULL DEFAULT 1,
    UNIQUE KEY uk_orcamento_formato_codigo (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""

_CREATE_FAIXA_SQL = """
CREATE TABLE IF NOT EXISTS tab_orcamento_faixa_pessoal (
    id INT AUTO_INCREMENT PRIMARY KEY,
    limite_inf INT NOT NULL,
    limite_sup INT NULL,
    percentual DECIMAL(8,4) NOT NULL,
    ordem INT NOT NULL DEFAULT 0,
    ativo TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""

_CREATE_ORCAMENTO_SQL = """
CREATE TABLE IF NOT EXISTS tab_orcamento (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    numero INT NOT NULL,
    ano INT NOT NULL,
    nro_protocolo INT NOT NULL,
    ano_protocolo INT NOT NULL,
    tecnologia VARCHAR(16) NOT NULL,
    valor_total DECIMAL(14,4) NOT NULL DEFAULT 0,
    valor_unitario DECIMAL(14,6) NOT NULL DEFAULT 0,
    snapshot_json JSON NOT NULL,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    criado_por VARCHAR(32) NULL,
    UNIQUE KEY uk_orcamento_numero_ano (numero, ano),
    KEY idx_orcamento_os (ano_protocolo, nro_protocolo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""

# Preços da planilha Offset atualizada em junho/2026 (folha 66x96 salvo indicação).
_SEED_INSUMOS: tuple[dict, ...] = (
    {"codigo": "p0", "categoria": "papel", "especificacao": "Papel off-set alta alvura AP 75gr (66x96cm)", "unidade": "Rm", "qtd_embalagem": 500, "preco_bruto": 177.47, "rendimento_a4": 8, "formato_folha": "66x96", "atualizado_em": "2026-06-25", "aliases": ["offset 75", "off-set 75", "offset 75g", "ap 75"]},
    {"codigo": "p1", "categoria": "papel", "especificacao": "Papel off-set alta alvura AP 75gr (112x76cm)", "unidade": "Rm", "qtd_embalagem": 500, "preco_bruto": 240, "rendimento_a4": 10, "formato_folha": "76x112", "atualizado_em": "2026-06-25", "aliases": ["offset 75 76x112"]},
    {"codigo": "p2", "categoria": "papel", "especificacao": "Papel off-set alta alvura AP 90gr (66x96cm)", "unidade": "Rm", "qtd_embalagem": 500, "preco_bruto": 215, "rendimento_a4": 8, "formato_folha": "66x96", "atualizado_em": "2026-06-25", "aliases": ["offset 90", "off-set 90", "ap 90"]},
    {"codigo": "p4", "categoria": "papel", "especificacao": "Papel off-set alta alvura AP 120gr (66x96cm)", "unidade": "Rm", "qtd_embalagem": 500, "preco_bruto": 440, "rendimento_a4": 8, "formato_folha": "66x96", "atualizado_em": "2026-06-25", "aliases": ["offset 120"]},
    {"codigo": "p5", "categoria": "papel", "especificacao": "Papel off-set alta alvura AP 150gr (66x96cm)", "unidade": "Rm", "qtd_embalagem": 500, "preco_bruto": 590, "rendimento_a4": 8, "formato_folha": "66x96", "atualizado_em": "2026-06-25", "aliases": ["offset 150"]},
    {"codigo": "p6", "categoria": "papel", "especificacao": "Papel off-set alta alvura AP 180gr (66x96cm)", "unidade": "Rm", "qtd_embalagem": 500, "preco_bruto": 670, "rendimento_a4": 8, "formato_folha": "66x96", "atualizado_em": "2026-06-25", "aliases": ["offset 180"]},
    {"codigo": "p8", "categoria": "papel", "especificacao": "Papel off-set alta alvura AP 240gr (66x96cm)", "unidade": "Rm", "qtd_embalagem": 500, "preco_bruto": 685, "rendimento_a4": 8, "formato_folha": "66x96", "atualizado_em": "2026-06-25", "aliases": ["offset 240"]},
    {"codigo": "p10", "categoria": "papel", "especificacao": "Papel Supremo alta alvura 300gr (66x96cm)", "unidade": "Rm", "qtd_embalagem": 500, "preco_bruto": 1003, "rendimento_a4": 8, "formato_folha": "66x96", "atualizado_em": "2026-06-25", "aliases": ["supremo 300"]},
    {"codigo": "p11", "categoria": "papel", "especificacao": "Papel Supremo alta alvura 350gr (66x96cm)", "unidade": "Rm", "qtd_embalagem": 500, "preco_bruto": 1000, "rendimento_a4": 8, "formato_folha": "66x96", "atualizado_em": "2026-06-25", "aliases": ["supremo 350"]},
    {"codigo": "p15", "categoria": "papel", "especificacao": "Papel Couchê Brilhante 90gr (66x96cm)", "unidade": "Rm", "qtd_embalagem": 500, "preco_bruto": 116, "rendimento_a4": 8, "formato_folha": "66x96", "atualizado_em": "2015-03-18", "aliases": ["couche brilhante 90", "couchê brilhante 90", "cb 90"]},
    {"codigo": "p16", "categoria": "papel", "especificacao": "Papel Couchê Brilhante 115gr (66x96cm)", "unidade": "Rm", "qtd_embalagem": 500, "preco_bruto": 400, "rendimento_a4": 8, "formato_folha": "66x96", "atualizado_em": "2026-06-25", "aliases": ["couche brilhante 115", "couchê brilhante 115", "cb 115"]},
    {"codigo": "p20", "categoria": "papel", "especificacao": "Papel Couchê fosco 90gr (66x96cm)", "unidade": "Rm", "qtd_embalagem": 500, "preco_bruto": 116, "rendimento_a4": 8, "formato_folha": "66x96", "atualizado_em": "2015-03-18", "aliases": ["couche fosco 90", "couchê fosco 90", "cf 90"]},
    {"codigo": "p21", "categoria": "papel", "especificacao": "Papel Couchê fosco 115gr (66x96cm)", "unidade": "Rm", "qtd_embalagem": 500, "preco_bruto": 297, "rendimento_a4": 8, "formato_folha": "66x96", "atualizado_em": "2026-06-25", "aliases": ["couche fosco 115", "couchê fosco 115", "cf 115"]},
    {"codigo": "p23", "categoria": "papel", "especificacao": "Papel Couchê fosco 170gr (66x96cm)", "unidade": "Rm", "qtd_embalagem": 500, "preco_bruto": 495, "rendimento_a4": 8, "formato_folha": "66x96", "atualizado_em": "2026-06-25", "aliases": ["couche fosco 170", "couchê fosco 170", "cf 170"]},
    {"codigo": "p24", "categoria": "papel", "especificacao": "Papel Couchê fosco 230gr (66x96cm)", "unidade": "Rm", "qtd_embalagem": 500, "preco_bruto": 340, "rendimento_a4": 8, "formato_folha": "66x96", "atualizado_em": "2015-03-18", "aliases": ["couche fosco 230", "couchê fosco 230", "cf 230"]},
    {"codigo": "p25", "categoria": "papel", "especificacao": "Papel Couchê fosco 250gr (66x96cm)", "unidade": "Rm", "qtd_embalagem": 500, "preco_bruto": 622, "rendimento_a4": 8, "formato_folha": "66x96", "atualizado_em": "2026-06-25", "aliases": ["couche fosco 250", "couchê fosco 250", "cf 250"]},
    {"codigo": "p26", "categoria": "papel", "especificacao": "Papel Couchê fosco 300gr (66x96cm)", "unidade": "Rm", "qtd_embalagem": 500, "preco_bruto": 747, "rendimento_a4": 8, "formato_folha": "66x96", "atualizado_em": "2023-08-21", "aliases": ["couche fosco 300", "couchê fosco 300", "cf 300", "cf 300g"]},
    {"codigo": "p33", "categoria": "papel", "especificacao": "Papel reciclado 75g (66x96cm)", "unidade": "Rm", "qtd_embalagem": 500, "preco_bruto": 209.95, "rendimento_a4": 8, "formato_folha": "66x96", "atualizado_em": "2022-01-05", "aliases": ["reciclado 75"]},
    {"codigo": "p34", "categoria": "papel", "especificacao": "Papel reciclado 90g (760x1120mm)", "unidade": "Rm", "qtd_embalagem": 500, "preco_bruto": 367.5, "rendimento_a4": 10, "formato_folha": "76x112", "atualizado_em": "2022-01-05", "aliases": ["reciclado 90"]},
    {"codigo": "c4", "categoria": "chapa", "especificacao": "Chapa Heidelberg SM 74 (745x605x0,30mm)", "unidade": "Cx", "qtd_embalagem": 50, "preco_bruto": 1900, "atualizado_em": "2023-06-06", "aliases": ["sm 74", "heidelberg sm74"]},
    {"codigo": "c5", "categoria": "chapa", "especificacao": "Chapa Komori LS429P (760x605x0,30mm)", "unidade": "Cx", "qtd_embalagem": 50, "preco_bruto": 1975, "atualizado_em": "2023-06-06", "aliases": ["komori"]},
    {"codigo": "t1", "categoria": "tinta", "especificacao": "Tinta offset preto europa", "unidade": "kg", "qtd_embalagem": 0.3, "preco_bruto": 49.9, "atualizado_em": "2023-05-16", "unit_mode": "pack"},
    {"codigo": "t5", "categoria": "tinta", "especificacao": "Policromia (1 escala)", "unidade": "Kg", "qtd_embalagem": 1.2, "preco_bruto": 16.28, "atualizado_em": "2014-02-01", "unit_mode": "pack"},
    {"codigo": "b0", "categoria": "bopp", "especificacao": "Preço Bobina BOPP geral para orçamento", "unidade": "BB", "qtd_embalagem": 1, "preco_bruto": 848.5, "atualizado_em": "2016-08-11", "unit_mode": "bruto"},
    {"codigo": "c7", "categoria": "cola", "especificacao": "Cola para blocagem", "unidade": "kg", "qtd_embalagem": 1, "preco_bruto": 19.2, "atualizado_em": "2023-05-16"},
    {"codigo": "c8", "categoria": "cola", "especificacao": "Cola granulada hot melt para encadernação", "unidade": "Kg", "qtd_embalagem": 1, "preco_bruto": 44, "atualizado_em": "2023-05-16"},
    {"codigo": "g1", "categoria": "grampo", "especificacao": "Grampo", "unidade": "kg", "qtd_embalagem": 3000, "preco_bruto": 70, "atualizado_em": "2016-08-11"},
    {"codigo": "c9", "categoria": "capa_pvc", "especificacao": "Capa plástica para encadernação", "unidade": "Par", "qtd_embalagem": 1, "preco_bruto": 0.4, "atualizado_em": "2023-05-16", "unit_mode": "bruto"},
    {"codigo": "e1", "categoria": "espiral", "especificacao": "Espiral de 07 mm", "unidade": "um", "qtd_embalagem": 1, "preco_bruto": 0.06, "atualizado_em": "2016-08-11"},
    {"codigo": "e2", "categoria": "espiral", "especificacao": "Espiral de 09 mm", "unidade": "um", "qtd_embalagem": 1, "preco_bruto": 0.18, "atualizado_em": "2016-08-11"},
    {"codigo": "e3", "categoria": "espiral", "especificacao": "Espiral de 45 mm", "unidade": "um", "qtd_embalagem": 1, "preco_bruto": 0.81, "atualizado_em": "2016-08-11"},
)

_SEED_PARAMETROS: tuple[tuple[str, str, str, str], ...] = (
    ("clique_digital_pb", "0.073", "number", "Custo por clique digital P&B"),
    ("clique_digital_cor", "0.28", "number", "Custo por clique digital colorido"),
    ("acerto_offset_folhas", "50", "number", "Folhas de acerto na impressão Offset"),
    ("cotacao_prova", "5", "number", "Cotação unitária de prova"),
    ("cotacao_fotolito", "16", "number", "Cotação unitária de fotolito"),
    ("aliquota_energia", "0.07", "percent", "Energia elétrica sobre a base direta Offset"),
    ("aliquota_depreciacao", "0.10", "percent", "Depreciação do maquinário"),
    ("aliquota_perdas", "0.03", "percent", "Perdas na produção"),
    ("aliquota_manutencao", "0.05", "percent", "Manutenção de equipamentos"),
    ("aliquota_diagramacao", "0.20", "percent", "Diagramação e editoração (quando aplicável)"),
    ("aplicar_diagramacao", "0", "bool", "Incluir 20% de diagramação nos indiretos Offset"),
    ("aliquota_indiretos_digital", "0.87", "percent", "Indiretos Digital sobre papel + acabamento"),
    ("bopp_metros", "1500", "number", "Comprimento da bobina BOPP (m)"),
    ("cola_kg", "25", "number", "Kg de cola de referência"),
    ("cola_exemplares", "10000", "number", "Exemplares de referência da cola"),
    ("cola_paginas_ref", "180", "number", "Páginas de referência da cola"),
    ("cola_min_paginas", "70", "number", "Mínimo de páginas para cobrar cola"),
    ("grampos_por_exemplar", "2", "number", "Grampos por exemplar"),
    ("grampo_max_paginas", "80", "number", "Máximo de páginas para grampear"),
    ("chapa_codigo_padrao", "c4", "text", "Código da chapa Offset padrão"),
    ("tinta_cor_codigo", "t5", "text", "Código da tinta/policromia"),
    ("tinta_pb_codigo", "t1", "text", "Código da tinta preto"),
    ("bopp_codigo", "b0", "text", "Código da bobina BOPP"),
    ("cola_codigo", "c7", "text", "Código da cola"),
    ("grampo_codigo", "g1", "text", "Código do grampo"),
    ("espiral_codigo", "e1", "text", "Código do espiral padrão"),
    ("capa_pvc_codigo", "c9", "text", "Código da capa PVC"),
    ("validade_dias", "180", "number", "Validade do orçamento em dias"),
    ("prazo_entrega_dias", "7", "number", "Prazo de entrega em dias úteis"),
    ("pdf_signatario", "Jorge Luiz Gusmão da Trindade", "text", "Nome do signatário do ofício"),
    ("pdf_cargo", "Diretor", "text", "Cargo do signatário"),
    ("pdf_endereco", "Via N3, Projeção L, Setor de Garagens Ministeriais Norte.", "text", "Endereço no rodapé"),
    ("pdf_telefone", "3216-2701", "text", "Telefone no rodapé"),
    ("pdf_clausula_validade", "Este orçamento tem validade de {validade_dias} dias.", "text", "Cláusula de validade"),
    ("pdf_clausula_entrega", "Impressão em equipamento {tecnologia}. Entrega em {prazo_entrega_dias} ({prazo_extenso}) dias úteis após a aprovação dos arquivos pela equipe técnica da CGraf.", "text", "Cláusula de prazo/tecnologia"),
)

_SEED_FORMATOS: tuple[tuple[str, float, float, float, int], ...] = (
    ("A6", 115, 160, 4.0, 10),
    ("A5", 160, 235, 2.0, 20),
    ("A4", 235, 325, 1.0, 30),
    ("A3", 325, 475, 0.5, 40),
    ("A2", 480, 660, 0.25, 50),
    ("A1", 520, 730, 0.125, 60),
)

_SEED_FAIXAS: tuple[tuple[int, int | None, float, int], ...] = (
    (1, 999, 0.80, 10),
    (1000, 4999, 0.515, 20),
    (5000, None, 0.22, 30),
)


def _preco_unitario(item: dict) -> float:
    qtd = float(item.get("qtd_embalagem") or 1)
    bruto = float(item.get("preco_bruto") or 0)
    mode = item.get("unit_mode") or "sheet"
    if mode == "pack":
        return bruto * qtd
    if mode == "bruto":
        return bruto
    if qtd <= 0:
        return 0.0
    return bruto / qtd


def ensure_orcamento_schema() -> None:
    """Cria tabelas e faz seed idempotente (não sobrescreve cadastro existente)."""
    db = Database()
    try:
        with db.cursor() as cursor:
            cursor.execute(_CREATE_INSUMO_SQL)
            cursor.execute(_CREATE_PARAMETRO_SQL)
            cursor.execute(_CREATE_FORMATO_SQL)
            cursor.execute(_CREATE_FAIXA_SQL)
            cursor.execute(_CREATE_ORCAMENTO_SQL)

            cursor.execute("SELECT COUNT(*) AS n FROM tab_orcamento_insumo")
            if int((cursor.fetchone() or {}).get("n") or 0) == 0:
                for item in _SEED_INSUMOS:
                    unit = _preco_unitario(item)
                    cursor.execute(
                        """
                        INSERT INTO tab_orcamento_insumo (
                            codigo, categoria, especificacao, unidade, qtd_embalagem,
                            preco_bruto, preco_unitario, rendimento_a4, formato_folha,
                            aliases_json, atualizado_em, ativo
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 1)
                        """,
                        (
                            item["codigo"],
                            item["categoria"],
                            item["especificacao"],
                            item.get("unidade"),
                            item.get("qtd_embalagem") or 1,
                            item.get("preco_bruto") or 0,
                            unit,
                            item.get("rendimento_a4"),
                            item.get("formato_folha"),
                            json.dumps(item.get("aliases") or [], ensure_ascii=False),
                            item.get("atualizado_em"),
                        ),
                    )

            cursor.execute("SELECT COUNT(*) AS n FROM tab_orcamento_parametro")
            if int((cursor.fetchone() or {}).get("n") or 0) == 0:
                for chave, valor, tipo, desc in _SEED_PARAMETROS:
                    cursor.execute(
                        """
                        INSERT INTO tab_orcamento_parametro (chave, valor, tipo, descricao)
                        VALUES (%s, %s, %s, %s)
                        """,
                        (chave, valor, tipo, desc),
                    )

            cursor.execute("SELECT COUNT(*) AS n FROM tab_orcamento_formato")
            if int((cursor.fetchone() or {}).get("n") or 0) == 0:
                for codigo, menor, maior, fator, ordem in _SEED_FORMATOS:
                    cursor.execute(
                        """
                        INSERT INTO tab_orcamento_formato
                            (codigo, menor_mm, maior_mm, fator_a4, ordem, ativo)
                        VALUES (%s, %s, %s, %s, %s, 1)
                        """,
                        (codigo, menor, maior, fator, ordem),
                    )

            cursor.execute("SELECT COUNT(*) AS n FROM tab_orcamento_faixa_pessoal")
            if int((cursor.fetchone() or {}).get("n") or 0) == 0:
                for lim_inf, lim_sup, perc, ordem in _SEED_FAIXAS:
                    cursor.execute(
                        """
                        INSERT INTO tab_orcamento_faixa_pessoal
                            (limite_inf, limite_sup, percentual, ordem, ativo)
                        VALUES (%s, %s, %s, %s, 1)
                        """,
                        (lim_inf, lim_sup, perc, ordem),
                    )
        logger.info("Schema tab_orcamento* garantido")
    except Exception as exc:
        logger.error("Erro ao migrar schema de orçamento: %s", exc)
        raise
