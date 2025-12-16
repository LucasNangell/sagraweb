from database import db
res = db.execute_query("DESCRIBE tabAnalises")
for r in res: print(r)
