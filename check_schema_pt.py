from database import db
res = db.execute_query("DESCRIBE tabProblemasPadrao")
for r in res: print(r)
