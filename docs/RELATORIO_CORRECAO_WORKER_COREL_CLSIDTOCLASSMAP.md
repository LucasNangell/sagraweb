# Relatório — Correção Worker Corel (CLSIDToClassMap + DLL PyInstaller)

**Data:** 18/06/2026

---

## 1. Problemas corrigidos

### 1.1 Falha ao iniciar CorelDRAW (CLSIDToClassMap)

```
Job #71 falhou: ... module 'win32com.gen_py.95E23C91...' has no attribute 'CLSIDToClassMap'
```

**Causa:** cache `win32com.gen_py` corrompido do CorelDRAW 19.

**Correção:** `runtime.py` usa `Dispatch` + limpeza automática do cache gen_py corrompido antes de retentar.

### 1.2 Falha ao abrir executável (python310.dll)

```
Failed to load Python DLL '...\Temp\_MEI179362\python310.dll'
LoadLibrary: Não foi possível encontrar o módulo especificado.
```

**Causa:** build onefile extraía para `%TEMP%\_MEI*` (fallback quando `C:\SAGRA-Papelaria-Worker\_pyi` não era gravável), e dependências de `python310.dll` não estavam todas no diretório de extração.

**Correção (onefile mantido):**
- `runtime_tmpdir` → `C:\ProgramData\SAGRA-Papelaria-Worker\_pyi` (gravável em todas as máquinas)
- Bundling ampliado de todas as DLLs do Python + MSVC na raiz do `_MEIPASS`
- `contents_directory="."` para manter DLLs na raiz da extração

---

## 2. Arquivos alterados

| Arquivo | Alteração |
|---------|-----------|
| `worker/papelaria_worker/runtime.py` | Recuperação cache gen_py; remoção de instrumentação debug |
| `worker/papelaria_worker/papelaria_worker.spec` | onefile corrigido: ProgramData + DLLs completas |
| `worker/papelaria_worker/build_exe.ps1` | Cria pasta ProgramData antes do build |
| `worker/papelaria_worker/tests/test_runtime.py` | Testes unitários da recuperação gen_py |
| `worker/papelaria_worker/dist/SAGRA-Papelaria-Worker.exe` | Executável onefile recompilado |
| `docs/RELATORIO_CORRECAO_WORKER_COREL_CLSIDTOCLASSMAP.md` | Este relatório (atualizado) |

---

## 3. Deploy

Copie **apenas** o executável:

```
worker\papelaria_worker\dist\SAGRA-Papelaria-Worker.exe
```

Na primeira execução, arquivos temporários são extraídos em:

```
C:\ProgramData\SAGRA-Papelaria-Worker\_pyi\
```

(O `build_exe.ps1` cria essa pasta automaticamente na máquina de build; em outras máquinas o bootloader cria na primeira execução.)

---

## 4. Testes

```text
python -m pytest worker/papelaria_worker/tests/ -q
41 passed

build_exe.ps1 — onedir + --test-connection OK
```

---

## 5. Verificação

1. Abra `dist\SAGRA-Papelaria-Worker\SAGRA-Papelaria-Worker.exe` (duplo clique ou linha de comando).
2. Confirme que **não** aparece o erro de `python310.dll`.
3. Enfileire um job de papelaria e confirme geração CDR/PDF.
