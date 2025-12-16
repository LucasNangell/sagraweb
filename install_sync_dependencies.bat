# Instalar dependências necessárias
pip install pyodbc mysql-connector-python

# Verificar instalação
python -c "import pyodbc; print('pyodbc:', pyodbc.version)"
python -c "import mysql.connector; print('mysql-connector:', mysql.connector.__version__)"
