-- Seed opcional de materiais (mesmo conteúdo de estoque_seed_materiais.py).
-- Preferir o ensure no startup da API; este SQL é referência/manual.
-- Códigos MAT-001…; custo/mínimo/descrição/papel_link ficam vazios (0/NULL).

-- Categorias já criadas pelo ensure_estoque_schema.
-- Exemplo de um item (o seed completo roda via Python no startup):
-- INSERT IGNORE INTO tab_estoque_sku (codigo, nome, unidade, categoria_id, estoque_minimo, ativo, criado_por)
-- SELECT 'MAT-001', 'Ácido Fosfórico', 'litro', id, 0, 1, 'seed'
-- FROM tab_estoque_categoria WHERE nome = 'Insumo geral' LIMIT 1;
