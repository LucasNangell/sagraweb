<?php

$url = "https://ce.camara.leg.br/EWS/Exchange.asmx";

$soap = <<<XML
<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope
 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
 xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
 xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types"
 xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages">

<soap:Header>
  <t:RequestServerVersion Version="Exchange2010_SP2"/>

  <t:ExchangeImpersonation>
    <t:ConnectingSID>
      <t:PrimarySmtpAddress>
        sepim.deapa@camara.leg.br
      </t:PrimarySmtpAddress>
    </t:ConnectingSID>
  </t:ExchangeImpersonation>
</soap:Header>

<soap:Body>

  <m:CreateItem MessageDisposition="SendAndSaveCopy">
    <m:Items>

      <t:Message>

        <t:Subject>Teste EWS PHP</t:Subject>

        <t:Body BodyType="Text">
          Teste EWS
        </t:Body>

        <t:ToRecipients>
          <t:Mailbox>
            <t:EmailAddress>
              lucassantosabreu@gmail.com
            </t:EmailAddress>
          </t:Mailbox>
        </t:ToRecipients>

      </t:Message>

    </m:Items>
  </m:CreateItem>

</soap:Body>

</soap:Envelope>
XML;

$ch = curl_init($url);

curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => $soap,

    CURLOPT_HTTPAUTH => CURLAUTH_NEGOTIATE,
    CURLOPT_USERPWD => ":",

    CURLOPT_HTTPHEADER => [
        "Content-Type: text/xml; charset=utf-8",
        "Accept: text/xml"
    ],

    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_SSL_VERIFYHOST => false,

    CURLOPT_VERBOSE => true
]);

$response = curl_exec($ch);

echo "\nHTTP: " . curl_getinfo($ch, CURLINFO_HTTP_CODE) . "\n\n";

echo $response;

curl_close($ch);
