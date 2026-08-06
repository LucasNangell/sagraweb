-- Script de criação das tabelas para controle de backup incremental de releases (SAGRA Web)
-- Banco de dados padrão: sagrafulldb

CREATE TABLE IF NOT EXISTS `tabReleases` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `release_name` VARCHAR(255) NOT NULL COMMENT 'Identificador único ou timestamp do release',
  `description` TEXT NULL COMMENT 'Descrição amigável do que foi implementado',
  `backup_type` VARCHAR(50) NOT NULL COMMENT 'Tipo do backup: full ou incremental',
  `source_root` VARCHAR(512) NOT NULL COMMENT 'Diretório de origem do backup (DEV)',
  `backup_path` VARCHAR(512) NOT NULL COMMENT 'Diretório de destino do backup',
  `manifest_path` VARCHAR(512) NOT NULL COMMENT 'Caminho do arquivo manifest.json correspondente',
  `status` VARCHAR(50) NOT NULL COMMENT 'Status da execução: success ou failed',
  `started_at` DATETIME NOT NULL COMMENT 'Data e hora de início do backup',
  `finished_at` DATETIME NULL COMMENT 'Data e hora de conclusão do backup',
  `duration_seconds` INT NULL COMMENT 'Tempo de execução em segundos',
  `total_files_scanned` INT NOT NULL COMMENT 'Quantidade total de arquivos escaneados',
  `total_added` INT NOT NULL COMMENT 'Total de arquivos novos copiados',
  `total_modified` INT NOT NULL COMMENT 'Total de arquivos modificados copiados',
  `total_deleted` INT NOT NULL COMMENT 'Total de arquivos removidos no release',
  `total_unchanged` INT NOT NULL COMMENT 'Total de arquivos inalterados',
  `created_by` VARCHAR(100) NULL COMMENT 'Usuário do SO que disparou o release',
  `git_branch` VARCHAR(100) NULL COMMENT 'Branch Git ativa no momento do release',
  `git_commit` VARCHAR(100) NULL COMMENT 'Hash do commit Git ativo',
  `error_message` TEXT NULL COMMENT 'Erro detalhado se a execução falhou',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_releases_name` (`release_name`),
  KEY `idx_releases_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `tabReleaseFiles` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `release_id` INT NOT NULL COMMENT 'Vínculo com tabReleases',
  `relative_path` VARCHAR(1024) NOT NULL COMMENT 'Caminho do arquivo em relação a raiz do projeto',
  `action` VARCHAR(50) NOT NULL COMMENT 'Ação: added, modified ou deleted',
  `size_bytes` BIGINT NOT NULL COMMENT 'Tamanho do arquivo em bytes',
  `mtime` DATETIME NULL COMMENT 'Data de modificação do arquivo',
  `sha256_before` VARCHAR(64) NULL COMMENT 'Hash SHA-256 do arquivo antes do release (nulo se added)',
  `sha256_after` VARCHAR(64) NULL COMMENT 'Hash SHA-256 do arquivo depois do release (nulo se deleted)',
  `backup_file_path` VARCHAR(1024) NULL COMMENT 'Caminho físico do arquivo copiado para o backup',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_release_files_release_id` FOREIGN KEY (`release_id`) REFERENCES `tabReleases` (`id`) ON DELETE CASCADE,
  KEY `idx_release_files_release_id` (`release_id`),
  KEY `idx_release_files_action` (`action`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
