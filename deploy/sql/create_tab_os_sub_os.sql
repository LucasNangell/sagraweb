-- Sub OS por componente (MySQL-only — não replicar para MDB).
-- Execute uma vez por ambiente ou confie no ensure_os_sub_os_schema() no startup.

CREATE TABLE IF NOT EXISTS `tab_os_componentes` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `nro_protocolo` INT NOT NULL,
  `ano_protocolo` INT NOT NULL,
  `nome` VARCHAR(120) NOT NULL,
  `nome_normalizado` VARCHAR(120) NOT NULL,
  `tipo` VARCHAR(20) NULL,
  `ordem` INT NOT NULL DEFAULT 0,
  `ativo` TINYINT(1) NOT NULL DEFAULT 1,
  `techspec_json` JSON NULL,
  `criado_em` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `criado_por` VARCHAR(32) NULL,
  `atualizado_em` DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  `atualizado_por` VARCHAR(32) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_os_componentes_os` (`ano_protocolo`, `nro_protocolo`, `ativo`),
  KEY `idx_os_componentes_nome_norm` (`ano_protocolo`, `nro_protocolo`, `nome_normalizado`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tab_os_sub_os` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `nro_protocolo` INT NOT NULL,
  `ano_protocolo` INT NOT NULL,
  `componente_id` BIGINT NOT NULL,
  `display_name` VARCHAR(160) NOT NULL,
  `ativo` TINYINT(1) NOT NULL DEFAULT 1,
  `congelada` TINYINT(1) NOT NULL DEFAULT 0,
  `criado_em` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `criado_por` VARCHAR(32) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_sub_os_os_componente` (`ano_protocolo`, `nro_protocolo`, `componente_id`),
  KEY `idx_sub_os_os` (`ano_protocolo`, `nro_protocolo`, `ativo`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tab_os_sub_os_andamento` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `sub_os_id` BIGINT NOT NULL,
  `situacao` VARCHAR(120) NOT NULL,
  `setor` VARCHAR(80) NOT NULL,
  `observacao` TEXT NULL,
  `data` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `ultimo_status` TINYINT(1) NOT NULL DEFAULT 0,
  `ponto` VARCHAR(32) NULL,
  `cod_status_espelho` VARCHAR(32) NULL,
  `criado_em` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `criado_por` VARCHAR(32) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_sub_os_andamento_sub` (`sub_os_id`, `ultimo_status`),
  KEY `idx_sub_os_andamento_espelho` (`cod_status_espelho`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
