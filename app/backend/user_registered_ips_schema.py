"""
IPs cadastrados por usuário (tabUsuarios.Ponto).
Um usuário pode ter vários IPs; o mesmo IP pode repetir em vários usuários.
"""
from __future__ import annotations

import logging

from database import Database

logger = logging.getLogger(__name__)

_CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS user_registered_ips (
    id INT AUTO_INCREMENT PRIMARY KEY,
    Ponto INT NOT NULL,
    ip VARCHAR(45) NOT NULL,
    descricao VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_user_registered_ips_ponto_ip (Ponto, ip),
    INDEX idx_user_registered_ips_ponto (Ponto),
    INDEX idx_user_registered_ips_ip (ip)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""


def ensure_user_registered_ips_schema() -> None:
    db = Database()
    try:
        with db.cursor() as cursor:
            cursor.execute(_CREATE_TABLE_SQL)
    except Exception as exc:
        logger.error("Erro ao migrar schema user_registered_ips: %s", exc)
        raise
