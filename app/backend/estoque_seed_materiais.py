"""
Seed inicial de materiais do relatório Câmara (estoque.pdf).
Campos ausentes (custo, mínimo, papel_link, descrição) ficam vazios/zero
para o usuário completar depois. Idempotente via codigo MAT-XXX.
"""
from __future__ import annotations

import logging
from typing import Optional

logger = logging.getLogger(__name__)

# (item, nome, unidade_sistema, quantidade_inicial, categoria)
# Unidades: un | folha | litro | chapa | m | g
# Categorias devem existir em tab_estoque_categoria.
_SEED_MATERIAIS: tuple[tuple[int, str, str, float, str], ...] = (
    (1, "Ácido Fosfórico", "litro", 4, "Insumo geral"),
    (2, "Álcool Isopropílico", "un", 0, "Insumo geral"),
    (3, "Almofada Carimbo G", "un", 0, "Insumo geral"),
    (4, "Almofada Carimbo P", "un", 0, "Insumo geral"),
    (5, "Anticorrosivo", "un", 0, "Insumo geral"),
    (6, "Antissecativo", "un", 0, "Insumo geral"),
    (7, "Arame n.18", "un", 0, "Insumo geral"),
    (8, "Arame n.20", "un", 0, "Insumo geral"),
    (9, "Arame n.24", "un", 0, "Insumo geral"),
    (10, "Arame n.26", "un", 0, "Insumo geral"),
    (11, "Bandeja para papéis expediente", "un", 0, "Insumo geral"),
    (12, "Barbante", "un", 0, "Insumo geral"),
    (13, "Blanqueta Komori 670x770mm", "un", 0, "Insumo geral"),
    (14, "Blanqueta PM52 460x535mm", "un", 0, "Insumo geral"),
    (15, "Blanqueta SM74 627x772mm", "un", 0, "Insumo geral"),
    (16, "Borracha para lápis", "un", 0, "Insumo geral"),
    (17, "Borracha para tinta", "un", 0, "Insumo geral"),
    (18, "Canaleta para corte e vinco", "un", 0, "Insumo geral"),
    (19, "Caneta corretora ponta média", "un", 0, "Insumo geral"),
    (20, "Caneta esferográfica azul", "un", 0, "Insumo geral"),
    (21, "Capa PVC Colorida A4", "un", 0, "Insumo geral"),
    (22, "Capa PVC Transparente A4", "un", 0, "Insumo geral"),
    (23, "Cera limpadora", "un", 0, "Insumo geral"),
    (24, "Chapa Komori 760x605mm 50fls", "chapa", 450, "Chapa"),
    (25, "Chapa PM52 459x525mm (cx-100)", "chapa", 0, "Chapa"),
    (26, "Chapa SM74 745x605mm 50fls", "chapa", 0, "Chapa"),
    (27, "Clipe niquelado n.0", "un", 0, "Insumo geral"),
    (28, "Clipe niquelado n.1", "un", 0, "Insumo geral"),
    (29, "Clipe niquelado n.2", "un", 0, "Insumo geral"),
    (30, "Clipe niquelado n.3", "un", 0, "Insumo geral"),
    (31, "Clipe niquelado n.4", "un", 0, "Insumo geral"),
    (32, "Clipe niquelado n.6", "un", 0, "Insumo geral"),
    (33, "Clipe niquelado n.8", "un", 0, "Insumo geral"),
    (34, "Cola Bigode", "un", 0, "Insumo geral"),
    (35, "Cola em bastão", "un", 0, "Insumo geral"),
    (36, "Cola Granulada Hot Melt", "un", 0, "Insumo geral"),
    (37, "Cola para blocagem e encadernação", "un", 0, "Insumo geral"),
    (38, "Cola para envelopadora", "un", 0, "Insumo geral"),
    (39, "Cola plástica", "un", 0, "Insumo geral"),
    (40, "Colchete latonado n.15", "un", 0, "Insumo geral"),
    (41, "Colchete latonado n.8", "un", 0, "Insumo geral"),
    (42, "Composto para limpeza do sist. de água HIDROCLEAN", "litro", 20, "Insumo geral"),
    (43, "Cordão polipropileno branco 2,5mm", "un", 0, "Insumo geral"),
    (44, "Corretivo em fita", "un", 0, "Insumo geral"),
    (45, "Corretor de chapa", "un", 0, "Insumo geral"),
    (46, "Creme para mãos", "un", 0, "Insumo geral"),
    (47, "Elástico", "un", 0, "Insumo geral"),
    (48, "Envelope Kraft 250x353mm", "un", 0, "Insumo geral"),
    (49, "Envelope pardo Grande", "un", 0, "Insumo geral"),
    (50, "Envelope separata branco", "un", 0, "Insumo geral"),
    (51, "Espiral plástica 07mm", "un", 0, "Insumo geral"),
    (52, "Espiral plástica 09mm", "un", 0, "Insumo geral"),
    (53, "Espiral plástica 12mm", "un", 0, "Insumo geral"),
    (54, "Espiral plástica 14mm", "un", 0, "Insumo geral"),
    (55, "Espiral plástica 17mm", "un", 0, "Insumo geral"),
    (56, "Espiral plástica 20mm", "un", 0, "Insumo geral"),
    (57, "Espiral plástica 23mm", "un", 0, "Insumo geral"),
    (58, "Espiral plástica 25mm", "un", 0, "Insumo geral"),
    (59, "Espiral plástica 29mm", "un", 0, "Insumo geral"),
    (60, "Espiral plástica 33mm", "un", 0, "Insumo geral"),
    (61, 'Espiral wire-o 3/8" 3:1 c/46000 anéis BRANCO', "un", 0, "Insumo geral"),
    (62, 'Espiral wire-o 3/8" 3:1 c/46000 anéis PRETO', "un", 0, "Insumo geral"),
    (63, 'Espiral wire-o 5/16" 3:1 c/64000 anéis BRANCO', "un", 0, "Insumo geral"),
    (64, 'Espiral wire-o 5/16" 3:1 c/64000 anéis PRETO', "un", 0, "Insumo geral"),
    (65, 'Espiral wire-o 5/8" 2:1 c/12.500 anéis PRETO', "un", 0, "Insumo geral"),
    (66, 'Espiral wire-o 7/16" 3:1 c/34000 anéis BRANCO', "un", 0, "Insumo geral"),
    (67, 'Espiral wire-o 7/16" 3:1 c/34000 anéis PRETO', "un", 0, "Insumo geral"),
    (68, 'Espiral wire-o 7/8" 2:1 c/6000 anéis BRANCO', "un", 0, "Insumo geral"),
    (69, 'Espiral wire-o 7/8" 2:1 c/6000 anéis PRETO', "un", 0, "Insumo geral"),
    (70, "Estopa Industrial", "g", 0, "Insumo geral"),
    (71, "Etiqueta Adesiva", "un", 0, "Insumo geral"),
    (72, "Filme de BOPP BRILHO 300mm", "un", 0, "Película"),
    (73, "Filme de BOPP BRILHO 350mm", "un", 0, "Película"),
    (74, "Filme de BOPP BRILHO 450mm", "un", 0, "Película"),
    (75, "Filme de BOPP BRILHO 470mm", "un", 0, "Película"),
    (76, "Filme de BOPP BRILHO 520mm", "un", 0, "Película"),
    (77, "Filme de BOPP BRILHO 550mm", "un", 0, "Película"),
    (78, "Filme de BOPP BRILHO 650mm", "un", 0, "Película"),
    (79, "Filme de BOPP BRILHO 750mm", "un", 0, "Película"),
    (80, "Filme de BOPP FOSCO 300mm", "un", 0, "Película"),
    (81, "Filme de BOPP FOSCO 450mm", "un", 0, "Película"),
    (82, "Filme de BOPP FOSCO 470mm", "un", 0, "Película"),
    (83, "Filme de BOPP FOSCO 520mm", "un", 0, "Película"),
    (84, "Filme de BOPP FOSCO 550mm", "un", 0, "Película"),
    (85, "Filme de BOPP FOSCO 650mm", "un", 0, "Película"),
    (86, "Fita Dupla Face", "m", 0, "Insumo geral"),
    (87, "Pano de Limpeza", "un", 0, "Insumo geral"),
    (88, "Papel Autocopiativo", "folha", 0, "Papel"),
    (89, "Papel Cartolina Branca", "folha", 0, "Papel"),
    (90, "Papel Cartolina Colorida", "folha", 0, "Papel"),
    (91, "Papel Color Plus Amarelo", "folha", 0, "Papel"),
    (92, "Papel Color Plus Azul", "folha", 0, "Papel"),
    (93, "Papel Color Plus Verde", "folha", 0, "Papel"),
    (94, "Papel Color Plus Vermelho", "folha", 0, "Papel"),
    (95, "Papel Colorido", "folha", 0, "Papel"),
    (96, "Papel Couchê 115g", "folha", 0, "Papel"),
    (97, "Papel Couchê 115g", "folha", 0, "Papel"),
    (98, "Papel Couchê 150g", "folha", 0, "Papel"),
    (99, "Papel Couchê 150g", "folha", 0, "Papel"),
    (100, "Papel Couchê 170g", "folha", 0, "Papel"),
    (101, "Papel Couchê 170g", "folha", 0, "Papel"),
    (102, "Papel Couchê 250g", "folha", 0, "Papel"),
    (103, "Papel Couchê 300g", "folha", 0, "Papel"),
    (104, "Papel Couchê 90g", "folha", 0, "Papel"),
    (105, "Papel Couchê 90g", "folha", 0, "Papel"),
    (106, "Papel Couchê Adesivo", "folha", 0, "Papel"),
    (107, "Papel Couchê Metalizado", "folha", 0, "Papel"),
    (108, "Papel Couchê Perolado", "folha", 0, "Papel"),
    (109, "Papel Couchê Texturizado", "folha", 0, "Papel"),
    (110, "Papel Duplex 250g", "folha", 0, "Papel"),
    (111, "Papel Fotográfico", "folha", 0, "Papel"),
    (112, "Papel Fotográfico Brilho", "folha", 0, "Papel"),
    (113, "Papel Fotográfico Fosco", "folha", 0, "Papel"),
    (114, "Papel Jornal", "folha", 0, "Papel"),
    (115, "Papel Kraft", "folha", 0, "Papel"),
    (116, "Papel Kraft Branco", "folha", 0, "Papel"),
    (117, "Papel Kraft Natural", "folha", 0, "Papel"),
    (118, "Papel Offset 120g", "folha", 0, "Papel"),
    (119, "Papel Offset 120g", "folha", 0, "Papel"),
    (120, "Papel Offset 63g", "folha", 0, "Papel"),
    (121, "Papel Offset 75g", "folha", 0, "Papel"),
    (122, "Papel Offset 75g", "folha", 0, "Papel"),
    (123, "Papel Offset 90g", "folha", 0, "Papel"),
    (124, "Papel Offset 90g", "folha", 0, "Papel"),
    (125, "Papel Offset Adesivo", "folha", 0, "Papel"),
    (126, "Papel Offset Texturizado", "folha", 0, "Papel"),
    (127, "Papel Reciclado", "folha", 0, "Papel"),
    (128, "Papel Reciclado A3", "folha", 0, "Papel"),
    (129, "Papel Reciclado A4", "folha", 0, "Papel"),
    (130, "Papel Segurança", "folha", 0, "Papel"),
    (131, "Papel Sulfite A3", "folha", 0, "Papel"),
    (132, "Papel Sulfite A3", "folha", 0, "Papel"),
    (133, "Papel Sulfite A4", "folha", 0, "Papel"),
    (134, "Papel Sulfite A5", "folha", 0, "Papel"),
    (135, "Papel Sulfite Carta", "folha", 0, "Papel"),
    (136, "Papel Transfer Inkjet", "folha", 0, "Papel"),
    (137, "Papel Transfer Laser", "folha", 0, "Papel"),
    (138, "Papel Triplex 300g", "folha", 0, "Papel"),
    (139, "Papel Vegetal A3", "folha", 0, "Papel"),
    (140, "Papel Vegetal A4", "folha", 0, "Papel"),
    (144, "Tinta Amarela", "un", 0, "Tinta"),
    (145, "Tinta Ciano", "un", 0, "Tinta"),
    (146, "Tinta Magenta", "un", 0, "Tinta"),
    (147, "Tinta Preta", "un", 0, "Tinta"),
    (148, "Toner Colorido", "un", 0, "Tinta"),
    (149, "Toner Preto", "un", 0, "Tinta"),
    (150, "Verniz UV", "un", 0, "Tinta"),
    (151, "Wire-O Preto", "un", 0, "Insumo geral"),
)


def _categoria_id(cursor, nome: str, cache: dict[str, Optional[int]]) -> Optional[int]:
    if nome in cache:
        return cache[nome]
    cursor.execute(
        "SELECT id FROM tab_estoque_categoria WHERE nome = %s LIMIT 1",
        (nome,),
    )
    row = cursor.fetchone()
    cat_id = int(row["id"]) if row else None
    cache[nome] = cat_id
    return cat_id


def seed_estoque_materiais_from_relatorio(cursor) -> int:
    """
    Insere SKUs do relatório inicial (INSERT IGNORE por codigo).
    Não sobrescreve SKUs já existentes. Retorna quantidade de novos SKUs.
    """
    cat_cache: dict[str, Optional[int]] = {}
    inserted = 0
    for item, nome, unidade, qtd, categoria in _SEED_MATERIAIS:
        codigo = f"MAT-{item:03d}"
        cat_id = _categoria_id(cursor, categoria, cat_cache)
        cursor.execute(
            """
            INSERT IGNORE INTO tab_estoque_sku (
                codigo, nome, descricao, categoria_id, unidade, papel_link,
                custo_medio, ultimo_custo, moeda, estoque_minimo, ativo, criado_por
            ) VALUES (
                %s, %s, NULL, %s, %s, NULL,
                0, 0, 'BRL', 0, 1, 'seed'
            )
            """,
            (codigo, nome, cat_id, unidade),
        )
        is_new = bool(cursor.rowcount and cursor.rowcount > 0)
        cursor.execute(
            "SELECT id FROM tab_estoque_sku WHERE codigo = %s LIMIT 1",
            (codigo,),
        )
        row = cursor.fetchone()
        if not row:
            continue
        sku_id = int(row["id"])
        if is_new:
            inserted += 1
            cursor.execute(
                """
                INSERT INTO tab_estoque_saldo (sku_id, quantidade, reservado)
                VALUES (%s, %s, 0)
                ON DUPLICATE KEY UPDATE sku_id = sku_id
                """,
                (sku_id, float(qtd)),
            )
            if float(qtd) > 0:
                cursor.execute(
                    """
                    INSERT INTO tab_estoque_movimento (
                        sku_id, tipo, quantidade, custo_unitario, custo_total,
                        saldo_apos, motivo, ponto
                    ) VALUES (%s, 'entrada', %s, 0, 0, %s, %s, 'seed')
                    """,
                    (
                        sku_id,
                        float(qtd),
                        float(qtd),
                        "Saldo inicial — relatório materiais Câmara",
                    ),
                )
        else:
            cursor.execute(
                """
                INSERT IGNORE INTO tab_estoque_saldo (sku_id, quantidade, reservado)
                VALUES (%s, 0, 0)
                """,
                (sku_id,),
            )
    return inserted
