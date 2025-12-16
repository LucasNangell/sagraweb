from database import db
try:
    res = db.execute_query("DESCRIBE tabPapelariaModelos")
    for r in res: print(r)
except Exception as e:
    print(e)
