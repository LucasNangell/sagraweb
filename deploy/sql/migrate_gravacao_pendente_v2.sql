-- Migração: Gravação Pendente + extensões Gravação Externa v2

CREATE TABLE IF NOT EXISTS tab_os_gravacao_pendente (
  Id INT NOT NULL AUTO_INCREMENT,
  OsAno INT NOT NULL,
  OsNro INT NOT NULL,
  CodStatus VARCHAR(32) NOT NULL,
  LancadoPorPonto VARCHAR(32) NOT NULL,
  LancadoPorNome VARCHAR(128) DEFAULT NULL,
  Status VARCHAR(16) NOT NULL DEFAULT 'ativa',
  EnviadaEm DATETIME DEFAULT NULL,
  EnviadaPorPonto VARCHAR(32) DEFAULT NULL,
  CriadoEm DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (Id),
  KEY idx_gp_os (OsAno, OsNro),
  KEY idx_gp_status (Status),
  KEY idx_gp_cod_status (CodStatus)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS tab_os_gravacao_pendente_arquivo (
  Id INT NOT NULL AUTO_INCREMENT,
  GravacaoPendenteId INT NOT NULL,
  AbsolutePath VARCHAR(1024) NOT NULL,
  NomeArquivo VARCHAR(255) NOT NULL,
  TamanhoBytes BIGINT DEFAULT NULL,
  Ordem INT NOT NULL DEFAULT 0,
  PRIMARY KEY (Id),
  KEY idx_gp_arq_sessao (GravacaoPendenteId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS tab_os_gravacao_pendente_chapa (
  Id INT NOT NULL AUTO_INCREMENT,
  GravacaoPendenteId INT NOT NULL,
  Maquina VARCHAR(128) NOT NULL,
  QuantidadeChapas INT NOT NULL DEFAULT 0,
  PRIMARY KEY (Id),
  KEY idx_gp_chapa_sessao (GravacaoPendenteId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
