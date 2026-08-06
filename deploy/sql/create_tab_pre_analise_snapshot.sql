-- Uma pré-análise salva por OS + rótulo de versão (sobrescrita a cada nova execução completa).

CREATE TABLE IF NOT EXISTS `tab_pre_analise_snapshot` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `AnoProtocolo` int NOT NULL,
  `NroProtocolo` int NOT NULL,
  `VersaoLabel` varchar(255) NOT NULL,
  `ResultsJson` longtext NOT NULL,
  `CheckCount` int NOT NULL DEFAULT 0,
  `AlertCount` int NOT NULL DEFAULT 0,
  `ExecutadoEm` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `ExecutadoPor` varchar(32) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_pre_analise_os_versao` (`AnoProtocolo`, `NroProtocolo`, `VersaoLabel`),
  KEY `idx_pre_analise_os` (`AnoProtocolo`, `NroProtocolo`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
