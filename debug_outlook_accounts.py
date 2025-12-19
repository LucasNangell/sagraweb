import win32com.client
import sys

# Force encoding for console output
sys.stdout.reconfigure(encoding='utf-8')

try:
    print("--- INICIANDO DIAGNOSTICO OUTLOOK ---")
    outlook = win32com.client.Dispatch("Outlook.Application")
    accounts = outlook.Session.Accounts
    print(f"Total de contas encontradas: {accounts.Count}")
    
    for i in range(1, accounts.Count + 1):
        acc = accounts.Item(i)
        try:
            name = acc.DisplayName
            smtp = acc.SmtpAddress
            print(f"Conta #{i}:")
            print(f"  DisplayName: '{name}'")
            print(f"  SmtpAddress: '{smtp}'")
            print(f"  Class: {acc.Class}")
        except Exception as e:
            print(f"  Erro ao ler propriedades da conta #{i}: {e}")
            
    print("--- FIM DO DIAGNOSTICO ---")

except Exception as e:
    print(f"ERRO CRITICO: {e}")
