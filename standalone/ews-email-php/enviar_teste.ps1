# Envio EWS com NTLM nativo do Windows (Invoke-WebRequest).
# Use quando PHP/cURL retorna HTTP 401 com credentials.enc, em máquina
# onde OUTRO usuário está logado mas você envia com SUAS credenciais.
#
# Uso:
#   .\enviar_teste.ps1
#   .\enviar_teste.ps1 -ProbeOnly

param(
    [switch]$ProbeOnly
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

function Escape-Xml([string]$value) {
    return [System.Security.SecurityElement]::Escape($value)
}

function Invoke-EwsRequest {
    param(
        [string]$Url,
        [string]$Body,
        [System.Management.Automation.PSCredential]$Credential
    )

    # Certificado interno da Camara (equivalente a verify_ssl=false no PHP)
    if (-not $script:CertBypassConfigured) {
        [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
        $script:CertBypassConfigured = $true
    }

    $params = @{
        Uri = $Url
        Method = 'Post'
        Body = $Body
        Credential = $Credential
        ContentType = 'text/xml; charset=utf-8'
        UseBasicParsing = $true
    }
    if ($PSVersionTable.PSVersion.Major -ge 7) {
        return Invoke-WebRequest @params -SkipCertificateCheck
    }
    return Invoke-WebRequest @params
}

function Test-EwsResponse([string]$Xml) {
    if ($Xml -match '<[^:]*:?ResponseCode[^>]*>([^<]+)</') {
        $code = $Matches[1].Trim()
        if ($code -and $code -ne 'NoError') {
            $msg = ''
            if ($Xml -match '<[^:]*:?MessageText[^>]*>([^<]+)</') {
                $msg = $Matches[1].Trim()
            }
            throw "EWS ResponseCode=${code}: ${msg}"
        }
    }
    if ($Xml -match '<faultstring>([^<]+)</faultstring>') {
        throw "SOAP Fault: $($Matches[1])"
    }
}

Write-Host '=== Envio EWS via PowerShell (NTLM Windows) ===' -ForegroundColor Cyan

$json = & php "$scriptDir\carregar_credenciais.php"
if ($LASTEXITCODE -ne 0) {
    throw 'Falha ao carregar credenciais (credentials.enc / config).'
}

$c = $json | ConvertFrom-Json
$secure = ConvertTo-SecureString $c.password -AsPlainText -Force
$credential = New-Object System.Management.Automation.PSCredential($c.username, $secure)

Write-Host "Usuario NTLM : $($c.username)"
Write-Host "Remetente    : $($c.from_mailbox)"
Write-Host "Destino      : $($c.test_to)"
Write-Host "Endpoint     : $($c.ews_url)"
Write-Host ''

$envelopeHeader = @"
<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
 xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
 xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types"
 xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages">
<soap:Header>
  <t:RequestServerVersion Version="Exchange2010_SP2"/>
</soap:Header>
<soap:Body>
"@

$envelopeFooter = @"
</soap:Body>
</soap:Envelope>
"@

if ($ProbeOnly) {
    Write-Host 'Testando autenticacao (FindFolder Inbox)...' -ForegroundColor Yellow
    $mailbox = Escape-Xml $c.from_mailbox
    $body = @"
<m:FindFolder Traversal="Shallow">
  <m:FolderShape>
    <t:BaseShape>IdOnly</t:BaseShape>
  </m:FolderShape>
  <m:ParentFolderIds>
    <t:DistinguishedFolderId Id="inbox">
      <t:Mailbox><t:EmailAddress>$mailbox</t:EmailAddress></t:Mailbox>
    </t:DistinguishedFolderId>
  </m:ParentFolderIds>
</m:FindFolder>
"@
    $response = Invoke-EwsRequest -Url $c.ews_url -Body ($envelopeHeader + $body + $envelopeFooter) -Credential $credential
    Test-EwsResponse $response.Content
    Write-Host 'OK — autenticacao NTLM aceita pelo Exchange.' -ForegroundColor Green
    exit 0
}

Write-Host 'Enviando e-mail (delegate_drafts)...' -ForegroundColor Yellow

$to = Escape-Xml $c.test_to
$mailbox = Escape-Xml $c.from_mailbox
$subject = Escape-Xml 'Teste EWS PowerShell — sepim.deapa@camara.leg.br'
$html = Escape-Xml '<p>Teste enviado via PowerShell com NTLM nativo do Windows.</p>'

$createBody = @"
<m:CreateItem MessageDisposition="SaveOnly">
  <m:SavedItemFolderId>
    <t:DistinguishedFolderId Id="drafts">
      <t:Mailbox><t:EmailAddress>$mailbox</t:EmailAddress></t:Mailbox>
    </t:DistinguishedFolderId>
  </m:SavedItemFolderId>
  <m:Items>
    <t:Message>
      <t:ToRecipients><t:Mailbox><t:EmailAddress>$to</t:EmailAddress></t:Mailbox></t:ToRecipients>
      <t:Subject>$subject</t:Subject>
      <t:Body BodyType="HTML">$html</t:Body>
    </t:Message>
  </m:Items>
</m:CreateItem>
"@

$createResponse = Invoke-EwsRequest -Url $c.ews_url -Body ($envelopeHeader + $createBody + $envelopeFooter) -Credential $credential
Test-EwsResponse $createResponse.Content

if ($createResponse.Content -notmatch 'ItemId[^>]+Id="([^"]+)"[^>]+ChangeKey="([^"]+)"') {
    throw 'CreateItem: ItemId nao encontrado na resposta.'
}
$itemId = $Matches[1]
$changeKey = $Matches[2]

$sendBody = @"
<m:SendItem SaveItemToFolder="false">
  <m:ItemIds>
    <t:ItemId Id="$(Escape-Xml $itemId)" ChangeKey="$(Escape-Xml $changeKey)"/>
  </m:ItemIds>
</m:SendItem>
"@

$sendResponse = Invoke-EwsRequest -Url $c.ews_url -Body ($envelopeHeader + $sendBody + $envelopeFooter) -Credential $credential
Test-EwsResponse $sendResponse.Content

Write-Host 'OK — e-mail enviado com sucesso.' -ForegroundColor Green
Write-Host "Verifique a caixa de $($c.test_to)"
