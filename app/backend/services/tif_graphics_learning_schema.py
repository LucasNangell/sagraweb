"""Schema aditivo do aprendizado supervisionado de chapas TIFF."""
from database import db

SAMPLES_SQL = """
CREATE TABLE IF NOT EXISTS tab_tif_graphics_sample (
  sample_key CHAR(64) NOT NULL,
  content_sha256 CHAR(64) NOT NULL,
  feature_version VARCHAR(32) NOT NULL,
  maquina VARCHAR(128) NOT NULL,
  cor VARCHAR(128) NOT NULL,
  nome VARCHAR(255) NOT NULL,
  features_json MEDIUMTEXT NOT NULL,
  blank_graphics TINYINT(1) NOT NULL,
  autor_ponto VARCHAR(32) NOT NULL,
  revision BIGINT NOT NULL DEFAULT 1,
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (sample_key),
  KEY idx_tif_training (maquina, cor, feature_version, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin
"""

FEEDBACK_SQL = """
CREATE TABLE IF NOT EXISTS tab_tif_graphics_feedback (
  id BIGINT NOT NULL AUTO_INCREMENT,
  sample_key CHAR(64) NOT NULL,
  autor_ponto VARCHAR(32) NOT NULL,
  detected_blank TINYINT(1) DEFAULT NULL,
  corrected_blank TINYINT(1) NOT NULL,
  detection_source VARCHAR(32) NOT NULL,
  revision BIGINT NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY idx_tif_feedback_sample (sample_key, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin
"""


def ensure_tif_graphics_learning_schema() -> None:
    db.execute_query(SAMPLES_SQL)
    db.execute_query(FEEDBACK_SQL)
