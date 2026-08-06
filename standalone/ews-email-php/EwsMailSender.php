<?php
/**
 * Cliente EWS (Exchange Web Services) independente para envio de e-mail via SOAP.
 *
 * Espelha o comportamento de app/backend/services/ews_service.py do SAGRA Web:
 * - Endpoint: https://ce.camara.leg.br/EWS/Exchange.asmx
 * - Autenticação NTLM (credenciais) ou Negotiate/SSPI (identidade Windows)
 * - Envio direto (CreateItem SendOnly/SendAndSaveCopy) ou via rascunhos delegados
 */

declare(strict_types=1);

final class EwsMailSender
{
    private const SEND_STRATEGIES = ['auto', 'direct', 'delegate_drafts'];
    private const NS_SOAP = 'http://schemas.xmlsoap.org/soap/envelope/';
    private const NS_TYPES = 'http://schemas.microsoft.com/exchange/services/2006/types';
    private const NS_MESSAGES = 'http://schemas.microsoft.com/exchange/services/2006/messages';

    private string $ewsUrl;
    private string $exchangeVersion;
    private int $timeoutSeconds;
    private bool $verifySsl;
    private ?string $proxy;
    private string $authMode;
    private ?string $username;
    private ?string $password;
    private string $messageDisposition;
    private string $sendStrategy;
    private string $defaultFromMailbox;
    private string $impersonateMailbox;
    private string $httpTransport;

    public function __construct(array $config)
    {
        $this->ewsUrl = (string) ($config['ews_url'] ?? 'https://ce.camara.leg.br/EWS/Exchange.asmx');
        $this->exchangeVersion = (string) ($config['exchange_version'] ?? 'Exchange2010_SP2');
        $this->timeoutSeconds = (int) ($config['timeout_seconds'] ?? 30);
        $this->verifySsl = (bool) ($config['verify_ssl'] ?? false);
        $this->proxy = isset($config['https_proxy']) && $config['https_proxy'] !== ''
            ? (string) $config['https_proxy']
            : null;
        $this->authMode = strtolower((string) ($config['auth_mode'] ?? 'auto'));
        $this->username = isset($config['username']) && $config['username'] !== ''
            ? (string) $config['username']
            : null;
        $this->password = isset($config['password']) && $config['password'] !== ''
            ? (string) $config['password']
            : null;
        $disposition = strtoupper((string) ($config['message_disposition'] ?? 'SendOnly'));
        if (!in_array($disposition, ['SENDONLY', 'SENDANDSAVEDCOPY'], true)) {
            throw new InvalidArgumentException(
                'message_disposition inválido. Use SendOnly ou SendAndSaveCopy.'
            );
        }
        $this->messageDisposition = $disposition === 'SENDONLY' ? 'SendOnly' : 'SendAndSaveCopy';

        $strategy = strtolower((string) ($config['send_strategy'] ?? 'delegate_drafts'));
        if (!in_array($strategy, self::SEND_STRATEGIES, true)) {
            throw new InvalidArgumentException(
                'send_strategy inválido. Use auto, direct ou delegate_drafts.'
            );
        }
        $this->sendStrategy = $strategy;
        $this->defaultFromMailbox = trim((string) ($config['from_mailbox'] ?? ''));
        $this->impersonateMailbox = trim((string) ($config['impersonate_mailbox'] ?? ''));
        $transport = strtolower((string) ($config['http_transport'] ?? 'auto'));
        if (!in_array($transport, ['auto', 'php_curl', 'curl_exe'], true)) {
            throw new InvalidArgumentException('http_transport inválido. Use auto, php_curl ou curl_exe.');
        }
        $this->httpTransport = $transport;
    }

    /**
     * Envia e-mail HTML via EWS.
     *
     * Estratégias:
     * - delegate_drafts: cria na pasta Rascunhos da mailbox delegada e dispara SendItem
     *   (equivalente ao Outlook com caixa compartilhada — usa Full Access, não exige Send As)
     * - direct: CreateItem com campo From (exige Send As no Exchange)
     * - auto: tenta delegate_drafts e, se falhar, tenta direct
     *
     * @param list<string> $to
     * @param list<array{filename: string, content: string}> $attachments bytes brutos
     */
    public function sendEmail(
        array $to,
        string $subject,
        string $htmlBody,
        ?string $fromMailbox = null,
        array $attachments = []
    ): void {
        $to = array_values(array_filter(array_map('trim', $to)));
        if ($to === []) {
            throw new InvalidArgumentException('Informe ao menos um destinatário em "to".');
        }

        $strategies = $this->resolveStrategiesToTry();
        $errors = [];

        foreach ($strategies as $strategy) {
            try {
                if ($strategy === 'delegate_drafts') {
                    $this->sendViaDelegateDrafts($to, $subject, $htmlBody, $fromMailbox, $attachments);
                } else {
                    $this->sendViaDirect($to, $subject, $htmlBody, $fromMailbox, $attachments);
                }
                return;
            } catch (Throwable $e) {
                $errors[] = "[{$strategy}] " . $e->getMessage();
                if ($this->sendStrategy !== 'auto') {
                    throw $e;
                }
            }
        }

        throw new RuntimeException("Todas as estratégias de envio falharam:\n- " . implode("\n- ", $errors));
    }

    /**
     * @param list<string> $to
     * @param list<array{filename: string, content: string}> $attachments
     */
    private function sendViaDirect(
        array $to,
        string $subject,
        string $htmlBody,
        ?string $fromMailbox,
        array $attachments
    ): void {
        $messageXml = $this->buildMessageXml($to, $subject, $htmlBody, $fromMailbox, $attachments, true);

        $savedFolderXml = '';
        if (
            $this->messageDisposition === 'SendAndSaveCopy'
            && $fromMailbox !== null
            && trim($fromMailbox) !== ''
        ) {
            $savedFolderXml = $this->savedFolderXml('sentitems', trim($fromMailbox));
        }

        $body = '<m:CreateItem MessageDisposition="' . $this->messageDisposition . '">'
            . $savedFolderXml
            . '<m:Items>' . $messageXml . '</m:Items>'
            . '</m:CreateItem>';

        $this->postSoap($body);
    }

    /**
     * Cria o item na pasta Rascunhos da mailbox delegada e envia com SendItem.
     * Padrão usado quando o usuário tem a caixa no Outlook mas não tem Send As explícito.
     *
     * @param list<string> $to
     * @param list<array{filename: string, content: string}> $attachments
     */
    private function sendViaDelegateDrafts(
        array $to,
        string $subject,
        string $htmlBody,
        ?string $fromMailbox,
        array $attachments
    ): void {
        $mailbox = trim((string) $fromMailbox);
        if ($mailbox === '') {
            throw new InvalidArgumentException('delegate_drafts exige from_mailbox (caixa delegada).');
        }

        $messageXml = $this->buildMessageXml($to, $subject, $htmlBody, null, $attachments, false);

        $createBody = '<m:CreateItem MessageDisposition="SaveOnly">'
            . $this->savedFolderXml('drafts', $mailbox)
            . '<m:Items>' . $messageXml . '</m:Items>'
            . '</m:CreateItem>';

        $createResponse = $this->postSoap($createBody);
        $item = $this->parseCreatedItemId($createResponse);

        $saveCopy = $this->messageDisposition === 'SendAndSaveCopy';
        $sendBody = '<m:SendItem SaveItemToFolder="' . ($saveCopy ? 'true' : 'false') . '">'
            . '<m:ItemIds>'
            . '<t:ItemId Id="' . self::xmlEscape($item['id']) . '" ChangeKey="' . self::xmlEscape($item['change_key']) . '"/>'
            . '</m:ItemIds>';

        if ($saveCopy) {
            $sendBody .= $this->savedFolderXml('sentitems', $mailbox);
        }

        $sendBody .= '</m:SendItem>';
        $this->postSoap($sendBody);
    }

    /**
     * @param list<string> $to
     * @param list<array{filename: string, content: string}> $attachments
     */
    private function buildMessageXml(
        array $to,
        string $subject,
        string $htmlBody,
        ?string $fromMailbox,
        array $attachments,
        bool $includeFrom
    ): string {
        $toXml = '';
        foreach ($to as $address) {
            $toXml .= '<t:Mailbox><t:EmailAddress>' . self::xmlEscape($address) . '</t:EmailAddress></t:Mailbox>';
        }

        $fromXml = '';
        if ($includeFrom && $fromMailbox !== null && trim($fromMailbox) !== '') {
            $fromXml = '<t:From><t:Mailbox><t:EmailAddress>'
                . self::xmlEscape(trim($fromMailbox))
                . '</t:EmailAddress></t:Mailbox></t:From>';
        }

        $attachmentsXml = '';
        if ($attachments !== []) {
            $parts = [];
            foreach ($attachments as $attachment) {
                $filename = (string) ($attachment['filename'] ?? 'anexo.bin');
                $content = (string) ($attachment['content'] ?? '');
                $parts[] = '<t:FileAttachment>'
                    . '<t:Name>' . self::xmlEscape($filename) . '</t:Name>'
                    . '<t:IsInline>false</t:IsInline>'
                    . '<t:Content>' . base64_encode($content) . '</t:Content>'
                    . '</t:FileAttachment>';
            }
            $attachmentsXml = '<t:Attachments>' . implode('', $parts) . '</t:Attachments>';
        }

        return '<t:Message>'
            . $fromXml
            . '<t:ToRecipients>' . $toXml . '</t:ToRecipients>'
            . '<t:Subject>' . self::xmlEscape($subject) . '</t:Subject>'
            . '<t:Body BodyType="HTML">' . self::xmlEscape($htmlBody) . '</t:Body>'
            . $attachmentsXml
            . '</t:Message>';
    }

    private function savedFolderXml(string $folderId, string $mailbox): string
    {
        return '<m:SavedItemFolderId>'
            . '<t:DistinguishedFolderId Id="' . self::xmlEscape($folderId) . '">'
            . '<t:Mailbox><t:EmailAddress>' . self::xmlEscape($mailbox) . '</t:EmailAddress></t:Mailbox>'
            . '</t:DistinguishedFolderId>'
            . '</m:SavedItemFolderId>';
    }

    /** @return list<string> */
    private function resolveStrategiesToTry(): array
    {
        if ($this->sendStrategy === 'auto') {
            return ['delegate_drafts', 'direct'];
        }
        return [$this->sendStrategy];
    }

    /** @return array{id: string, change_key: string} */
    private function parseCreatedItemId(string $xml): array
    {
        $doc = new DOMDocument();
        $prev = libxml_use_internal_errors(true);
        $loaded = $doc->loadXML($xml);
        libxml_clear_errors();
        libxml_use_internal_errors($prev);

        if (!$loaded) {
            throw new RuntimeException('CreateItem: resposta XML inválida ao obter ItemId.');
        }

        $xpath = new DOMXPath($doc);
        $nodes = $xpath->query('//*[local-name()="ItemId"]');
        if ($nodes === false || $nodes->length === 0) {
            throw new RuntimeException('CreateItem: ItemId não retornado na resposta EWS.');
        }

        $node = $nodes->item(0);
        $id = trim($node->getAttribute('Id'));
        $changeKey = trim($node->getAttribute('ChangeKey'));
        if ($id === '' || $changeKey === '') {
            throw new RuntimeException('CreateItem: ItemId/ChangeKey vazios na resposta EWS.');
        }

        return ['id' => $id, 'change_key' => $changeKey];
    }

    /**
     * Teste leve de conectividade: lista subpastas da Inbox de uma mailbox.
     * Útil para validar autenticação e permissão antes do envio.
     */
    public function probeMailboxAccess(string $mailbox): bool
    {
        $mailbox = trim($mailbox);
        if ($mailbox === '') {
            return false;
        }

        $body = '<m:FindFolder Traversal="Shallow">'
            . '<m:FolderShape>'
            . '<t:BaseShape>IdOnly</t:BaseShape>'
            . '<t:AdditionalProperties><t:FieldURI FieldURI="folder:DisplayName"/></t:AdditionalProperties>'
            . '</m:FolderShape>'
            . '<m:ParentFolderIds>'
            . '<t:DistinguishedFolderId Id="inbox">'
            . '<t:Mailbox><t:EmailAddress>' . self::xmlEscape($mailbox) . '</t:EmailAddress></t:Mailbox>'
            . '</t:DistinguishedFolderId>'
            . '</m:ParentFolderIds>'
            . '</m:FindFolder>';

        try {
            $this->postSoap($body);
            return true;
        } catch (Throwable $e) {
            return false;
        }
    }

    private function postSoap(string $bodyInnerXml): string
    {
        if ($this->httpTransport === 'curl_exe') {
            return $this->postSoapViaCurlExe($bodyInnerXml);
        }

        try {
            return $this->postSoapViaPhpCurl($bodyInnerXml);
        } catch (RuntimeException $e) {
            $canFallback = $this->httpTransport === 'auto'
                && strpos($e->getMessage(), 'HTTP 401') !== false
                && $this->resolveAuthMode() === 'ntlm'
                && $this->canUseCurlExe();

            if (!$canFallback) {
                throw $e;
            }

            return $this->postSoapViaCurlExe($bodyInnerXml);
        }
    }

    private function postSoapViaPhpCurl(string $bodyInnerXml): string
    {
        if (!function_exists('curl_init')) {
            throw new RuntimeException('Extensão PHP cURL não está instalada/habilitada.');
        }

        $lastError = null;
        $attempts = $this->buildAuthAttempts();

        foreach ($attempts as $index => $attempt) {
            try {
                return $this->postSoapOnce(
                    $bodyInnerXml,
                    $attempt['username'],
                    $attempt['httpauth'],
                    $attempt['label'],
                    !empty($attempt['split_credentials'])
                );
            } catch (RuntimeException $e) {
                $lastError = $e;
                $is401 = strpos($e->getMessage(), 'HTTP 401') !== false;
                $hasMore = $index < count($attempts) - 1;
                if (!$is401 || !$hasMore) {
                    throw $e;
                }
            }
        }

        if ($lastError !== null) {
            throw $lastError;
        }

        throw new RuntimeException('Falha inesperada na requisição EWS (php_curl).');
    }

    private function postSoapViaCurlExe(string $bodyInnerXml): string
    {
        if (!$this->canUseCurlExe()) {
            throw new RuntimeException(
                'curl.exe não encontrado. Instale o curl do Windows 10+ ou defina EWS_CURL_EXE.'
            );
        }

        if ($this->username === null || $this->password === null) {
            throw new RuntimeException('curl.exe exige username e password para NTLM.');
        }

        $envelope = $this->buildEnvelope($bodyInnerXml);
        $tmpFile = tempnam(sys_get_temp_dir(), 'ews');
        if ($tmpFile === false) {
            throw new RuntimeException('Falha ao criar arquivo temporário para curl.exe.');
        }

        file_put_contents($tmpFile, $envelope);

        $lastError = null;
        try {
            foreach ($this->ntlmUsernameVariants() as $usernameVariant) {
                if ($usernameVariant === null) {
                    continue;
                }
                try {
                    return $this->execCurlExe($tmpFile, $usernameVariant);
                } catch (RuntimeException $e) {
                    $lastError = $e;
                    if (strpos($e->getMessage(), 'HTTP 401') === false) {
                        throw $e;
                    }
                }
            }
        } finally {
            @unlink($tmpFile);
        }

        if ($lastError !== null) {
            throw $lastError;
        }

        throw new RuntimeException('Falha inesperada na requisição EWS (curl.exe).');
    }

    private function execCurlExe(string $payloadFile, string $username): string
    {
        $curlExe = $this->resolveCurlExePath();
        $args = [
            $curlExe,
            '--ntlm',
            '-u',
            $username . ':' . $this->password,
            '-H',
            'Content-Type: text/xml; charset=utf-8',
            '-H',
            'Accept: text/xml',
            '-s',
            '-S',
            '-w',
            "\n%{http_code}",
            '--data-binary',
            '@' . $payloadFile,
        ];

        if (!$this->verifySsl) {
            $args[] = '-k';
        }

        if ($this->proxy !== null && $this->proxy !== '') {
            $args[] = '--proxy';
            $args[] = $this->proxy;
        }

        $args[] = $this->ewsUrl;

        $descriptor = [
            0 => ['pipe', 'r'],
            1 => ['pipe', 'w'],
            2 => ['pipe', 'w'],
        ];

        $process = proc_open($args, $descriptor, $pipes, null, null, ['bypass_shell' => true]);
        if (!is_resource($process)) {
            throw new RuntimeException('Falha ao executar curl.exe.');
        }

        fclose($pipes[0]);
        $stdout = stream_get_contents($pipes[1]);
        $stderr = stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        $exitCode = proc_close($process);

        if ($stdout === false) {
            $stdout = '';
        }

        $lines = preg_split("/\r\n|\n|\r/", rtrim($stdout));
        if ($lines === false || $lines === []) {
            throw new RuntimeException(
                'curl.exe sem resposta.'
                . ($stderr ? ' stderr: ' . trim($stderr) : '')
            );
        }

        $statusLine = array_pop($lines);
        $status = is_numeric($statusLine) ? (int) $statusLine : 0;
        $responseBody = implode("\n", $lines);

        if ($exitCode !== 0 && $status === 0) {
            throw new RuntimeException(
                'curl.exe falhou (exit ' . $exitCode . '): ' . trim((string) $stderr)
            );
        }

        if ($status < 200 || $status >= 300) {
            throw new RuntimeException(
                'EWS retornou HTTP ' . $status . ' [curl.exe+' . $username . ']. '
                . self::extractHttpErrorDetail($responseBody)
            );
        }

        $this->assertNoSoapFault($responseBody);
        return $responseBody;
    }

    private function canUseCurlExe(): bool
    {
        if (PHP_OS_FAMILY !== 'Windows') {
            return is_executable($this->resolveCurlExePath());
        }

        return $this->resolveCurlExePath() !== '';
    }

    private function resolveCurlExePath(): string
    {
        $explicit = trim((string) (getenv('EWS_CURL_EXE') ?: ''));
        if ($explicit !== '' && is_file($explicit)) {
            return $explicit;
        }

        if (PHP_OS_FAMILY === 'Windows') {
            $system32 = getenv('SystemRoot') ?: 'C:\\Windows';
            $candidate = $system32 . '\\System32\\curl.exe';
            if (is_file($candidate)) {
                return $candidate;
            }
        }

        return '';
    }

    private function buildEnvelope(string $bodyInnerXml): string
    {
        return '<?xml version="1.0" encoding="utf-8"?>'
            . '<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"'
            . ' xmlns:xsd="http://www.w3.org/2001/XMLSchema"'
            . ' xmlns:soap="' . self::NS_SOAP . '"'
            . ' xmlns:t="' . self::NS_TYPES . '"'
            . ' xmlns:m="' . self::NS_MESSAGES . '">'
            . '<soap:Header>'
            . '<t:RequestServerVersion Version="' . self::xmlEscape($this->exchangeVersion) . '"/>'
            . $this->buildImpersonationHeaderXml()
            . '</soap:Header>'
            . '<soap:Body>' . $bodyInnerXml . '</soap:Body>'
            . '</soap:Envelope>';
    }

    /**
     * @return list<array{username: ?string, httpauth: int, label: string, split_credentials: bool}>
     */
    private function buildAuthAttempts(): array
    {
        $mode = $this->resolveAuthMode();
        if ($mode === 'negotiate') {
            return [
                [
                    'username' => null,
                    'httpauth' => CURLAUTH_NEGOTIATE,
                    'label' => 'negotiate',
                    'split_credentials' => false,
                ],
            ];
        }

        $authSchemes = [
            ['httpauth' => CURLAUTH_NTLM, 'label' => 'ntlm', 'split' => false],
        ];
        if (defined('CURLAUTH_ANY')) {
            $authSchemes[] = ['httpauth' => CURLAUTH_ANY, 'label' => 'any', 'split' => false];
        }
        $authSchemes[] = ['httpauth' => CURLAUTH_NTLM, 'label' => 'ntlm-split', 'split' => true];

        $attempts = [];
        foreach ($this->ntlmUsernameVariants() as $usernameVariant) {
            foreach ($authSchemes as $scheme) {
                $attempts[] = [
                    'username' => $usernameVariant,
                    'httpauth' => $scheme['httpauth'],
                    'label' => $scheme['label'] . '+' . $usernameVariant,
                    'split_credentials' => $scheme['split'],
                ];
            }
        }

        return $attempts;
    }

    private function postSoapOnce(
        string $bodyInnerXml,
        ?string $usernameOverride = null,
        ?int $httpAuthOverride = null,
        ?string $attemptLabel = null,
        bool $splitCredentials = false
    ): string
    {
        $envelope = $this->buildEnvelope($bodyInnerXml);

        $ch = curl_init($this->ewsUrl);
        if ($ch === false) {
            throw new RuntimeException('Falha ao inicializar cURL.');
        }

        $headers = [
            'Content-Type: text/xml; charset=utf-8',
            'Accept: text/xml',
        ];

        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $envelope,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HEADER => true,
            CURLOPT_TIMEOUT => $this->timeoutSeconds,
            CURLOPT_CONNECTTIMEOUT => min(10, $this->timeoutSeconds),
            CURLOPT_SSL_VERIFYPEER => $this->verifySsl,
            CURLOPT_SSL_VERIFYHOST => $this->verifySsl ? 2 : 0,
        ]);

        $this->applyAuth($ch, $usernameOverride, $httpAuthOverride, $splitCredentials);
        $this->applyProxy($ch);

        $raw = curl_exec($ch);
        if ($raw === false) {
            $error = curl_error($ch);
            $errno = curl_errno($ch);
            curl_close($ch);
            throw new RuntimeException("Falha na requisição EWS (cURL {$errno}): {$error}");
        }

        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $headerSize = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
        curl_close($ch);

        $responseBody = substr($raw, $headerSize);
        if ($status < 200 || $status >= 300) {
            $detail = self::extractHttpErrorDetail($responseBody);
            $hint = $attemptLabel ? " [tentativa: {$attemptLabel}]" : '';
            throw new RuntimeException("EWS retornou HTTP {$status}{$hint}. {$detail}");
        }

        $this->assertNoSoapFault($responseBody);
        return $responseBody;
    }

    /**
     * @return list<string|null>
     */
    private function ntlmUsernameVariants(): array
    {
        if ($this->resolveAuthMode() !== 'ntlm') {
            return [null];
        }

        $user = trim((string) $this->username);
        if ($user === '') {
            return [null];
        }

        $variants = [$user];

        if (strpos($user, '\\') !== false) {
            $local = substr($user, strrpos($user, '\\') + 1);
            if ($local !== '') {
                $variants[] = $local . '@camara.leg.br';
            }
        } elseif (strpos($user, '@') === false) {
            $variants[] = 'redecamara\\' . $user;
            $variants[] = $user . '@camara.leg.br';
        }

        return array_values(array_unique($variants));
    }

    /** @return list<string> */
    public function getNtlmUsernameVariantsForDiagnostics(): array
    {
        $variants = $this->ntlmUsernameVariants();
        return array_values(array_filter($variants, static function ($value) {
            return $value !== null;
        }));
    }

    public function getAuthUsernameForDiagnostics(): string
    {
        return trim((string) $this->username);
    }

    public function getPasswordLengthForDiagnostics(): int
    {
        return strlen((string) $this->password);
    }

    private function applyAuth(
        $ch,
        ?string $usernameOverride = null,
        ?int $httpAuthOverride = null,
        bool $splitCredentials = false
    ): void {
        $mode = $this->resolveAuthMode();

        if ($mode === 'ntlm') {
            if ($this->username === null || $this->password === null) {
                throw new RuntimeException(
                    'auth_mode=ntlm exige username e password (config ou variáveis EWS_USERNAME/EWS_PASSWORD).'
                );
            }
            $username = $usernameOverride ?? $this->username;
            curl_setopt($ch, CURLOPT_HTTPAUTH, $httpAuthOverride ?? CURLAUTH_NTLM);
            if (defined('CURLOPT_UNRESTRICTED_AUTH')) {
                curl_setopt($ch, CURLOPT_UNRESTRICTED_AUTH, true);
            }
            if ($splitCredentials && defined('CURLOPT_USERNAME') && defined('CURLOPT_PASSWORD')) {
                curl_setopt($ch, CURLOPT_USERNAME, $username);
                curl_setopt($ch, CURLOPT_PASSWORD, $this->password);
            } else {
                curl_setopt($ch, CURLOPT_USERPWD, $username . ':' . $this->password);
            }
            return;
        }

        if ($mode === 'negotiate') {
            curl_setopt($ch, CURLOPT_HTTPAUTH, $httpAuthOverride ?? CURLAUTH_NEGOTIATE);
            curl_setopt($ch, CURLOPT_USERPWD, ':');
            if (defined('CURLOPT_UNRESTRICTED_AUTH')) {
                curl_setopt($ch, CURLOPT_UNRESTRICTED_AUTH, true);
            }
            return;
        }

        throw new RuntimeException("auth_mode inválido: {$mode}. Use auto, ntlm ou negotiate.");
    }

    private function resolveAuthMode(): string
    {
        if ($this->authMode === 'ntlm' || $this->authMode === 'negotiate') {
            return $this->authMode;
        }

        if ($this->username !== null && $this->password !== null) {
            return 'ntlm';
        }

        return 'negotiate';
    }

    private function buildImpersonationHeaderXml(): string
    {
        if ($this->resolveAuthMode() !== 'negotiate') {
            return '';
        }

        $mailbox = $this->impersonateMailbox !== ''
            ? $this->impersonateMailbox
            : $this->defaultFromMailbox;

        if ($mailbox === '') {
            return '';
        }

        return '<t:ExchangeImpersonation><t:ConnectingSID><t:PrimarySmtpAddress>'
            . self::xmlEscape($mailbox)
            . '</t:PrimarySmtpAddress></t:ConnectingSID></t:ExchangeImpersonation>';
    }

    private function applyProxy($ch): void
    {
        if ($this->proxy !== null) {
            curl_setopt($ch, CURLOPT_PROXY, $this->proxy);
            return;
        }

        // Igual ao Python: ignora HTTP_PROXY/HTTPS_PROXY do ambiente por padrão.
        foreach (['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy'] as $var) {
            putenv($var . '=');
        }
        curl_setopt($ch, CURLOPT_PROXY, '');
        if (defined('CURLOPT_NOPROXY')) {
            curl_setopt($ch, CURLOPT_NOPROXY, '*');
        }
    }

    private static function assertNoSoapFault(string $xml): void
    {
        if (trim($xml) === '') {
            throw new RuntimeException('EWS retornou corpo vazio.');
        }

        $doc = new DOMDocument();
        $prev = libxml_use_internal_errors(true);
        $loaded = $doc->loadXML($xml);
        libxml_clear_errors();
        libxml_use_internal_errors($prev);

        if (!$loaded) {
            throw new RuntimeException('Resposta EWS não é XML válido.');
        }

        $xpath = new DOMXPath($doc);
        $xpath->registerNamespace('soap', self::NS_SOAP);
        $xpath->registerNamespace('m', self::NS_MESSAGES);

        $faultNodes = $xpath->query('//soap:Fault');
        if ($faultNodes !== false && $faultNodes->length > 0) {
            $fault = $faultNodes->item(0);
            $faultString = self::firstNodeText($xpath, './/faultstring', $fault)
                ?: self::firstNodeText($xpath, './/soap:Reason/soap:Text', $fault)
                ?: 'SOAP Fault sem detalhe';
            throw new RuntimeException('EWS SOAP Fault: ' . trim($faultString));
        }

        $responseCodes = $xpath->query('//*[local-name()="ResponseCode"]');
        if ($responseCodes !== false) {
            foreach ($responseCodes as $node) {
                $code = trim($node->textContent ?? '');
                if ($code !== '' && strcasecmp($code, 'NoError') !== 0) {
                    $message = self::findSiblingOrParentMessageText($xpath, $node) ?: $code;
                    throw new RuntimeException("EWS ResponseCode={$code}: {$message}");
                }
            }
        }
    }

    private static function findSiblingOrParentMessageText(DOMXPath $xpath, DOMNode $responseCodeNode): ?string
    {
        $parent = $responseCodeNode->parentNode;
        if ($parent instanceof DOMNode) {
            $msg = self::firstNodeText($xpath, './/*[local-name()="MessageText"]', $parent);
            if ($msg !== null) {
                return $msg;
            }
        }
        return self::firstNodeText($xpath, '//*[local-name()="MessageText"]');
    }

    private static function firstNodeText(DOMXPath $xpath, string $query, ?DOMNode $context = null): ?string
    {
        $nodes = $context === null
            ? $xpath->query($query)
            : $xpath->query($query, $context);

        if ($nodes === false || $nodes->length === 0) {
            return null;
        }

        $text = trim($nodes->item(0)->textContent ?? '');
        return $text !== '' ? $text : null;
    }

    private static function extractHttpErrorDetail(string $body): string
    {
        if (trim($body) === '') {
            return 'Sem corpo na resposta.';
        }

        try {
            self::assertNoSoapFault($body);
        } catch (Throwable $e) {
            return $e->getMessage();
        }

        return 'Detalhe indisponível.';
    }

    public static function xmlEscape(string $value): string
    {
        return htmlspecialchars($value, ENT_XML1 | ENT_QUOTES, 'UTF-8');
    }
}
