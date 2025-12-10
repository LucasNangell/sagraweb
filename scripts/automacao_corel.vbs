' automacao_corel.vbs
' Script para intermediar Python -> CorelDRAW
Option Explicit

Dim args, fso, jsonPath, pdfPath, corelApp

' 1. Capturar Argumentos do Python
Set args = WScript.Arguments
If args.Count < 2 Then
    WScript.Echo "Erro: Argumentos insuficientes. Uso: script.vbs [JSON_PATH] [PDF_PATH]"
    WScript.Quit 1
End If

jsonPath = args(0)
pdfPath = args(1)

' 2. Conectar ou Iniciar o CorelDRAW
On Error Resume Next
Set corelApp = GetObject(, "CorelDRAW.Application")
If Err.Number <> 0 Then
    ' Se não estiver aberto, tenta abrir
    Set corelApp = CreateObject("CorelDRAW.Application")
    ' corelApp.Visible = True ' Descomente se quiser ver o Corel abrindo
End If
On Error Goto 0

If corelApp Is Nothing Then
    WScript.Echo "Erro: Não foi possível iniciar o CorelDRAW."
    WScript.Quit 1
End If

' 3. Executar a Macro VBA (SagraWeb)
' Esta linha assume que você tem um módulo VBA chamado "SagraWeb" dentro do Corel (GMS)
' e uma Sub pública chamada "GerarPreview" que recebe (pathJson, pathPdf)

On Error Resume Next
' A sintaxe pode variar dependendo da versão do Corel, mas geralmente é:
' GMSManager.RunMacro "NomeDoArquivoGMS", "NomeDoModulo.NomeDaSub", Parametros
' Vamos passar os caminhos concatenados ou array, dependendo de como sua macro espera.
' Para simplificar, passamos o JSON e a Macro lá dentro lê e decide onde salvar, 
' ou a Macro lê o JSON e descobre onde salvar.

' IMPORTANTE: Ajuste "SagraWeb" e "MainModule.GerarPreview" para os nomes REAIS da sua macro no Corel
corelApp.GMSManager.RunMacro "SagraWeb", "MainModule.GerarPreview", jsonPath & "|" & pdfPath

If Err.Number <> 0 Then
    WScript.Echo "Erro ao executar macro: " & Err.Description
    WScript.Quit 1
End If

' Limpeza
Set corelApp = Nothing
Set args = Nothing