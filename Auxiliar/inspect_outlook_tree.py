import pythoncom
import win32com.client

def inspect_tree():
    try:
        pythoncom.CoInitialize()
        outlook = win32com.client.Dispatch("Outlook.Application")
        namespace = outlook.GetNamespace("MAPI")
        
        print("--- Outlook Folder Structure Dump ---")
        for folder in namespace.Folders:
            print(f"Account (Root): {folder.Name}")
            if "sepim" in folder.Name.lower() or "papelaria" in folder.Name.lower():
                try:
                    for child in folder.Folders:
                        print(f"  Level 1: {child.Name}")
                        if child.Name in ["Caixa de entrada", "Inbox", "Entrada de Provas", "Entrada de Prob. Tec."]:
                            for sub in child.Folders:
                                print(f"    Level 2 (inside {child.Name}): {sub.Name}")
                except Exception as e:
                    print(f"  Error iterating children: {e}")
            print("-" * 20)
            
    except Exception as e:
        print(f"Error: {e}")
    finally:
        pythoncom.CoUninitialize()

if __name__ == "__main__":
    inspect_tree()
