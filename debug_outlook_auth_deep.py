import win32com.client
import sys

# Force encoding
sys.stdout.reconfigure(encoding='utf-8')

TARGET_EMAIL = "papelaria.deapa@camara.leg.br"

print(f"--- TESTE DE ATRIBUIÇÃO DE CONTA: {TARGET_EMAIL} ---")

try:
    outlook = win32com.client.Dispatch("Outlook.Application")
    mail = outlook.CreateItem(0)
    
    # 1. Tentar localizar a conta
    print("1. Buscando conta...")
    target_account = None
    
    for i in range(1, outlook.Session.Accounts.Count + 1):
        acc = outlook.Session.Accounts.Item(i)
        print(f"  Verificando Conta #{i}: SMTP='{acc.SmtpAddress}' Display='{acc.DisplayName}'")
        
        # Logica exata do backend
        match = False
        if acc.SmtpAddress and acc.SmtpAddress.lower() == TARGET_EMAIL.lower():
            print("    -> MATCH por SMTP!")
            match = True
        elif acc.DisplayName and acc.DisplayName.lower() == TARGET_EMAIL.lower():
            print("    -> MATCH por DisplayName!")
            match = True
            
        if match:
            target_account = acc
            break
            
    if not target_account:
        print("RESULTADO: Conta não encontrada! A lógica de busca falhou.")
        sys.exit(1)
        
    print(f"Conta encontrada: {target_account.DisplayName}")
    
    # 2. Tentar atribuir
    print("2. Tentando atribuir SendUsingAccount...")
    try:
        mail.SendUsingAccount = target_account
        print("Atribuição executada sem erro.")
    except Exception as e:
        print(f"ERRO AO ATRIBUIR: {e}")
        
    # 3. Verificar se pegou
    print("3. Verificando propriedade mail.SendUsingAccount...")
    try:
        current_acc = mail.SendUsingAccount
        if current_acc:
            print(f"  Valor atual no email: '{current_acc.DisplayName}'")
        else:
            print("  FALHA: mail.SendUsingAccount está VAZIO/None.")
    except:
        pass

    # 4. TENTATIVA ALTERNATIVA: SentOnBehalfOfName
    print("4. Tentando SentOnBehalfOfName...")
    try:
        mail.SentOnBehalfOfName = TARGET_EMAIL
        print(f"  Atribuído SentOnBehalfOfName = '{TARGET_EMAIL}' com sucesso.")
        print("  SUCESSO ALTERNATIVO: Esta propriedade funcionou sem erro.")
    except Exception as e:
        print(f"  FALHA em SentOnBehalfOfName: {e}")
        
    # Não enviamos, apenas descartamos
    # mail.Close(1) # Discard

except Exception as e:
    print(f"ERRO GERAL DE COM: {e}")

print("--- FIM DO TESTE ---")
