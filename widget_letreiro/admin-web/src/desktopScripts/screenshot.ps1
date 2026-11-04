$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
if ($bounds.Width -le 0 -or $bounds.Height -le 0 -or ([long]$bounds.Width * $bounds.Height) -gt 64000000) {
    throw 'Área de captura indisponível ou grande demais nesta sessão.'
}
$original = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$capture = $null
$scaled = $null
$graphics = $null
$stream = $null
$encoderParams = $null
try {
    $capture = [System.Drawing.Graphics]::FromImage($original)
    $capture.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bounds.Size)
    $capturedAt = [DateTime]::UtcNow.ToString('o')
    $capture.Dispose(); $capture = $null
    $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' } | Select-Object -First 1
    $encoded = $null; $mime = 'image/png'; $width = $bounds.Width; $height = $bounds.Height
    # Prefere resolução original sem perdas, respeitando o limite do canal.
    $stream = New-Object System.IO.MemoryStream
    $original.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    if ($stream.Length -le 650000) { $encoded = [Convert]::ToBase64String($stream.ToArray()) }
    $stream.Dispose(); $stream = $null
    if (-not $encoded) { $mime = 'image/jpeg' }
    foreach ($ratio in @(1.0, 0.8, 0.6, 0.4, 0.3)) {
        if ($encoded) { break }
        $width = [Math]::Max(1, [int]($bounds.Width * $ratio))
        $height = [Math]::Max(1, [int]($bounds.Height * $ratio))
        $scaled = New-Object System.Drawing.Bitmap($width, $height)
        $graphics = [System.Drawing.Graphics]::FromImage($scaled)
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.DrawImage($original, 0, 0, $width, $height)
        $graphics.Dispose(); $graphics = $null
        foreach ($quality in @(100, 98, 95, 90, 85, 80, 75, 70, 65, 60)) {
            $stream = New-Object System.IO.MemoryStream
            $encoderParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
            $encoderParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]$quality)
            $scaled.Save($stream, $codec, $encoderParams)
            if ($stream.Length -le 650000) { $encoded = [Convert]::ToBase64String($stream.ToArray()) }
            $encoderParams.Dispose(); $encoderParams = $null
            $stream.Dispose(); $stream = $null
            if ($encoded) { break }
        }
        $scaled.Dispose(); $scaled = $null
        if ($encoded) { break }
    }
    if (-not $encoded) { throw 'Não foi possível compactar a captura. Tente novamente.' }
    @{ type = 'screenshot'; mime = $mime; image = $encoded; width = $width; height = $height;
        originalWidth = $bounds.Width; originalHeight = $bounds.Height; capturedAt = $capturedAt } | ConvertTo-Json -Compress
} finally {
    if ($encoderParams) { $encoderParams.Dispose() }
    if ($stream) { $stream.Dispose() }
    if ($graphics) { $graphics.Dispose() }
    if ($scaled) { $scaled.Dispose() }
    if ($capture) { $capture.Dispose() }
    $original.Dispose()
}
