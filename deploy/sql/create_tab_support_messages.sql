-- Mensagens de suporte enviadas pelos usuários e respostas do administrador.

CREATE TABLE IF NOT EXISTS `tabSupportMessages` (
  `Id` int NOT NULL AUTO_INCREMENT,
  `Ponto` varchar(32) NOT NULL,
  `NomeUsuario` varchar(128) DEFAULT NULL,
  `Tipo` varchar(16) NOT NULL DEFAULT 'problema',
  `Assunto` varchar(255) NOT NULL,
  `Mensagem` text NOT NULL,
  `Status` varchar(16) NOT NULL DEFAULT 'aberto',
  `Resposta` text DEFAULT NULL,
  `RespondidoPor` varchar(64) DEFAULT NULL,
  `DataCriacao` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `DataResposta` datetime DEFAULT NULL,
  PRIMARY KEY (`Id`),
  KEY `idx_support_status` (`Status`),
  KEY `idx_support_ponto` (`Ponto`),
  KEY `idx_support_data` (`DataCriacao`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
