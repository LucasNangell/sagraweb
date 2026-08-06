-- Funções de custo / mão de obra (MySQL-only — não replicar para MDB).
-- Execute uma vez por ambiente ou confie no ensure_custo_funcao_schema() no startup.

CREATE TABLE IF NOT EXISTS `tab_custo_funcao` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `nome` VARCHAR(120) NOT NULL,
  `codigo` VARCHAR(64) NULL,
  `descricao` TEXT NULL,
  `custo_mensal` DECIMAL(14,4) NOT NULL DEFAULT 0,
  `custo_hora` DECIMAL(14,4) NOT NULL DEFAULT 0,
  `horas_mes` DECIMAL(8,2) NOT NULL DEFAULT 176,
  `moeda` VARCHAR(8) NOT NULL DEFAULT 'BRL',
  `ativo` TINYINT(1) NOT NULL DEFAULT 1,
  `criado_em` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `criado_por` VARCHAR(32) NULL,
  `atualizado_em` DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  `atualizado_por` VARCHAR(32) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_custo_funcao_codigo` (`codigo`),
  KEY `idx_custo_funcao_nome` (`nome`),
  KEY `idx_custo_funcao_ativo` (`ativo`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
