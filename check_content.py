from database import db
res = db.execute_query("SELECT ID, TituloPT, LEFT(ProbTecHTML, 200) as StartHTML FROM tabProblemasPadrao LIMIT 1")
print(res)
