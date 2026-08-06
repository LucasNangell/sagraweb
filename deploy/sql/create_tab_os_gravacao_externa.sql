-- Sessões de Gravação Externa vinculadas a andamento da OS
CREATE TABLE IF NOT EXISTS tab_os_gravacao_externa (
  Id INT NOT NULL AUTO_INCREMENT,
  OsAno INT NOT NULL,
  OsNro INT NOT NULL,
  CodStatus VARCHAR(32) NOT NULL,
  LancadoPorPonto VARCHAR(32) NOT NULL,
  LancadoPorNome VARCHAR(128) DEFAULT NULL,
  Status VARCHAR(16) NOT NULL DEFAULT 'pendente',
  IniciadoPorPonto VARCHAR(32) DEFAULT NULL,
  IniciadoEm DATETIME DEFAULT NULL,
  CriadoEm DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (Id),
  KEY idx_ge_os (OsAno, OsNro),
  KEY idx_ge_status (Status),
  KEY idx_ge_cod_status (CodStatus)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS tab_os_gravacao_externa_arquivo (
  Id INT NOT NULL AUTO_INCREMENT,
  GravacaoExternaId INT NOT NULL,
  RelativePath VARCHAR(512) NOT NULL,
  NomeArquivo VARCHAR(255) NOT NULL,
  TamanhoBytes BIGINT DEFAULT NULL,
  Ordem INT NOT NULL DEFAULT 0,
  PRIMARY KEY (Id),
  KEY idx_ge_arq_sessao (GravacaoExternaId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS tab_os_gravacao_externa_mensagem (
  Id INT NOT NULL AUTO_INCREMENT,
  GravacaoExternaId INT NOT NULL,
  AutorPonto VARCHAR(32) NOT NULL,
  AutorNome VARCHAR(128) DEFAULT NULL,
  AutorPapel VARCHAR(16) NOT NULL,
  Mensagem TEXT NOT NULL,
  CriadoEm DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (Id),
  KEY idx_ge_msg_sessao (GravacaoExternaId),
  KEY idx_ge_msg_data (CriadoEm)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
