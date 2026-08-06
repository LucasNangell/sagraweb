-- Modelos de e-mail e contas de envio (configurações do administrador).

CREATE TABLE IF NOT EXISTS `tabEmailTemplateConfig` (
  `Id` int NOT NULL PRIMARY KEY,
  `Payload` longtext NULL,
  `UpdatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
