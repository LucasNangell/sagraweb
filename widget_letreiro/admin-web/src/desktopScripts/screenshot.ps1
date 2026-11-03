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
    $encoded = $null
    # Mantém JSON + base64 dentro dos 64 KiB do canal de resultado existente.
    foreach ($maxWidth in @(1600, 1280, 960, 720)) {
        $ratio = [Math]::Min(1.0, [Math]::Min($maxWidth / [double]$bounds.Width, 1200.0 / $bounds.Height))
        $width = [Math]::Max(1, [int]($bounds.Width * $ratio))
        $height = [Math]::Max(1, [int]($bounds.Height * $ratio))
        $scaled = New-Object System.Drawing.Bitmap($width, $height)
        $graphics = [System.Drawing.Graphics]::FromImage($scaled)
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.DrawImage($original, 0, 0, $width, $height)
        $graphics.Dispose(); $graphics = $null
        foreach ($quality in @(75, 55, 35, 20)) {
            $stream = New-Object System.IO.MemoryStream
            $encoderParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
            $encoderParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]$quality)
            $scaled.Save($stream, $codec, $encoderParams)
            if ($stream.Length -le 45000) { $encoded = [Convert]::ToBase64String($stream.ToArray()) }
            $encoderParams.Dispose(); $encoderParams = $null
            $stream.Dispose(); $stream = $null
            if ($encoded) { break }
        }
        $scaled.Dispose(); $scaled = $null
        if ($encoded) { break }
    }
    if (-not $encoded) { throw 'Não foi possível compactar a captura. Tente novamente.' }
    @{ type = 'screenshot'; mime = 'image/jpeg'; image = $encoded; width = $width; height = $height;
        originalWidth = $bounds.Width; originalHeight = $bounds.Height; capturedAt = $capturedAt } | ConvertTo-Json -Compress
} finally {
    if ($encoderParams) { $encoderParams.Dispose() }
    if ($stream) { $stream.Dispose() }
    if ($graphics) { $graphics.Dispose() }
    if ($scaled) { $scaled.Dispose() }
    if ($capture) { $capture.Dispose() }
    $original.Dispose()
}
