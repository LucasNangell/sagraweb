-- Persistência de download de arquivos da Gravação Externa (badge / contadores).
-- Idempotente: só adiciona BaixadoEm se a coluna ainda não existir.
-- Aplicar em DEV (127.0.0.1) e PROD (10.1.1.73 / sagrafulldb).

SET @schema := DATABASE();
SET @exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @schema
    AND TABLE_NAME = 'tab_os_gravacao_externa_arquivo'
    AND COLUMN_NAME = 'BaixadoEm'
);

SET @ddl := IF(
  @exists = 0,
  'ALTER TABLE tab_os_gravacao_externa_arquivo ADD COLUMN BaixadoEm DATETIME DEFAULT NULL',
  'SELECT ''BaixadoEm already exists'' AS info'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
