from database import db

ip = '10.120.1.12'
try:
    db.execute_query('''
    CREATE TABLE IF NOT EXISTS tabIpPermitidos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        ip VARCHAR(45) NOT NULL,
        descricao VARCHAR(255) DEFAULT NULL,
        ativo TINYINT(1) DEFAULT 1,
        UNIQUE KEY (ip)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    ''')

    existing = db.execute_query("SELECT id, ativo FROM tabIpPermitidos WHERE ip = %s", (ip,))
    if existing:
        print('IP já existe no banco:', existing)
        rec = existing[0]
        if not rec.get('ativo'):
            db.execute_query("UPDATE tabIpPermitidos SET ativo = 1 WHERE id = %s", (rec['id'],))
            print('Registro ativado.')
        else:
            print('Registro já ativo.')
    else:
        db.execute_query("INSERT INTO tabIpPermitidos (ip, descricao, ativo) VALUES (%s, %s, %s)", (ip, 'auto-added by script', 1))
        print('IP inserido e ativado.')
except Exception as e:
    print('Erro ao inserir IP:', e)
