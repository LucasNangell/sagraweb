-- Modelos de e-mail múltiplos por grupo/variante (prova OS, prova SP, problemas técnicos).
-- Idempotente: CREATE TABLE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS `tabEmailTemplateModel` (
  `Id` int NOT NULL AUTO_INCREMENT,
  `Grupo` varchar(32) NOT NULL,
  `Variante` varchar(32) NOT NULL,
  `Nome` varchar(120) NOT NULL,
  `Assunto` varchar(500) NOT NULL DEFAULT '',
  `Html` longtext NOT NULL,
  `Ativo` tinyint(1) NOT NULL DEFAULT 0,
  `AnexarPdf` tinyint(1) NOT NULL DEFAULT 0,
  `ContentMode` varchar(16) NOT NULL DEFAULT 'custom',
  `PresetId` varchar(64) DEFAULT NULL,
  `Ordem` int NOT NULL DEFAULT 0,
  `CreatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `UpdatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `UpdatedByPonto` varchar(20) DEFAULT NULL,
  `LegacyTemplateId` varchar(64) DEFAULT NULL,
  PRIMARY KEY (`Id`),
  KEY `idx_email_tpl_grupo_variante` (`Grupo`, `Variante`),
  KEY `idx_email_tpl_ativo` (`Grupo`, `Variante`, `Ativo`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
