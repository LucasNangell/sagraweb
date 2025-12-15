from database import db
try:
    res = db.execute_query("SHOW TABLES LIKE 'tabOSVinculadas'")
    print('tabOSVinculadas:', res)
    res2 = db.execute_query("SHOW TABLES LIKE 'tabOSVinculoExcecoes'")
    print('tabOSVinculoExcecoes:', res2)
except Exception as e:
    print('ERROR', e)
