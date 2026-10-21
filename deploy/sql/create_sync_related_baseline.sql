-- Baseline por coluna para reconciliação MDB → MySQL de tabProtocolos / tabDetalhesServico.
-- O serviço também cria esta tabela via sync_policy.ensure_sync_control_tables.
CREATE TABLE IF NOT EXISTS sync_related_baseline (
    table_name VARCHAR(64) NOT NULL,
    nro INT NOT NULL,
    ano INT NOT NULL,
    values_json LONGTEXT NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (table_name, nro, ano)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
