-- Mensagens individuais de cada conversa de suporte (thread).

CREATE TABLE IF NOT EXISTS `tabSupportThreadMessages` (
  `Id` int NOT NULL AUTO_INCREMENT,
  `TicketId` int NOT NULL,
  `AutorTipo` varchar(16) NOT NULL,
  `AutorPonto` varchar(32) DEFAULT NULL,
  `AutorNome` varchar(128) DEFAULT NULL,
  `Mensagem` text NOT NULL,
  `DataCriacao` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`Id`),
  KEY `idx_support_thread_ticket` (`TicketId`),
  KEY `idx_support_thread_data` (`DataCriacao`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Execute manualmente se as colunas ainda não existirem:
-- ALTER TABLE tabSupportMessages ADD COLUMN DataResolucao datetime DEFAULT NULL;
-- ALTER TABLE tabSupportMessages ADD COLUMN ResolvidoPor varchar(64) DEFAULT NULL;
