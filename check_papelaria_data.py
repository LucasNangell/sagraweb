from database import db
res = db.execute_query("SELECT COUNT(*) as count FROM tabPapelariaModelos")
print(res)
res2 = db.execute_query("SELECT NomeProduto, ConfigCampos FROM tabPapelariaModelos LIMIT 5")
print(res2)
