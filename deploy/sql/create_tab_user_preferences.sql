-- Preferências de UI por usuário (Ponto = ID do colaborador).

CREATE TABLE IF NOT EXISTS `tabUserPreferences` (
  `Ponto` varchar(32) NOT NULL,
  `PreferenceKey` varchar(64) NOT NULL,
  `Payload` json NOT NULL,
  `DataAtualizacao` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`Ponto`, `PreferenceKey`),
  KEY `idx_user_pref_updated` (`DataAtualizacao`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
