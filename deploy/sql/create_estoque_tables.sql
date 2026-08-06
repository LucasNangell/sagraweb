-- Estoque (MySQL-only — não replicar para MDB).
-- Execute uma vez por ambiente ou confie no ensure_estoque_schema() no startup.

CREATE TABLE IF NOT EXISTS `tab_estoque_categoria` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `nome` VARCHAR(120) NOT NULL,
  `ativo` TINYINT(1) NOT NULL DEFAULT 1,
  `criado_em` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_estoque_categoria_nome` (`nome`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tab_estoque_sku` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `codigo` VARCHAR(64) NOT NULL,
  `nome` VARCHAR(200) NOT NULL,
  `descricao` TEXT NULL,
  `categoria_id` BIGINT NULL,
  `unidade` VARCHAR(32) NOT NULL DEFAULT 'un',
  `papel_link` VARCHAR(120) NULL,
  `custo_medio` DECIMAL(14,4) NOT NULL DEFAULT 0,
  `ultimo_custo` DECIMAL(14,4) NOT NULL DEFAULT 0,
  `moeda` VARCHAR(8) NOT NULL DEFAULT 'BRL',
  `estoque_minimo` DECIMAL(14,4) NOT NULL DEFAULT 0,
  `ativo` TINYINT(1) NOT NULL DEFAULT 1,
  `criado_em` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `criado_por` VARCHAR(32) NULL,
  `atualizado_em` DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  `atualizado_por` VARCHAR(32) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_estoque_sku_codigo` (`codigo`),
  KEY `idx_estoque_sku_nome` (`nome`),
  KEY `idx_estoque_sku_ativo` (`ativo`),
  KEY `idx_estoque_sku_categoria` (`categoria_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tab_estoque_saldo` (
  `sku_id` BIGINT NOT NULL,
  `quantidade` DECIMAL(14,4) NOT NULL DEFAULT 0,
  `reservado` DECIMAL(14,4) NOT NULL DEFAULT 0,
  `atualizado_em` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`sku_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tab_estoque_pedido` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `status` VARCHAR(32) NOT NULL DEFAULT 'pendente',
  `solicitante_ponto` VARCHAR(32) NOT NULL,
  `observacao` TEXT NULL,
  `os_nro` INT NULL,
  `os_ano` INT NULL,
  `atendido_por` VARCHAR(32) NULL,
  `atendido_em` DATETIME NULL,
  `motivo_recusa` TEXT NULL,
  `criado_em` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_estoque_pedido_status` (`status`),
  KEY `idx_estoque_pedido_solicitante` (`solicitante_ponto`),
  KEY `idx_estoque_pedido_criado` (`criado_em`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tab_estoque_pedido_item` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `pedido_id` BIGINT NOT NULL,
  `sku_id` BIGINT NOT NULL,
  `qtd_solicitada` DECIMAL(14,4) NOT NULL,
  `qtd_atendida` DECIMAL(14,4) NOT NULL DEFAULT 0,
  `custo_unitario_snapshot` DECIMAL(14,4) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_estoque_pedido_item_pedido` (`pedido_id`),
  KEY `idx_estoque_pedido_item_sku` (`sku_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tab_estoque_movimento` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `sku_id` BIGINT NOT NULL,
  `tipo` VARCHAR(32) NOT NULL,
  `quantidade` DECIMAL(14,4) NOT NULL,
  `custo_unitario` DECIMAL(14,4) NOT NULL DEFAULT 0,
  `custo_total` DECIMAL(14,4) NOT NULL DEFAULT 0,
  `saldo_apos` DECIMAL(14,4) NOT NULL DEFAULT 0,
  `motivo` TEXT NULL,
  `pedido_id` BIGINT NULL,
  `referencia_os_nro` INT NULL,
  `referencia_os_ano` INT NULL,
  `ponto` VARCHAR(32) NULL,
  `criado_em` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_estoque_mov_sku` (`sku_id`),
  KEY `idx_estoque_mov_tipo` (`tipo`),
  KEY `idx_estoque_mov_criado` (`criado_em`),
  KEY `idx_estoque_mov_pedido` (`pedido_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
