$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskAssets = Join-Path $taskRoot 'resources/ptt'
New-Item -ItemType Directory -Force -Path $taskAssets | Out-Null
$taskImages = @{}
foreach ($taskSize in @(16, 32, 48, 64, 128, 256, 512)) {
    $taskBitmap = New-Object System.Drawing.Bitmap($taskSize, $taskSize)
    $taskGraphics = [System.Drawing.Graphics]::FromImage($taskBitmap)
    $taskGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $taskGraphics.ScaleTransform(($taskSize / 256.0), ($taskSize / 256.0))
    $taskBackground = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#1b2921'))
    $taskMint = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#8de5bb'))
    $taskPen = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml('#8de5bb'), 14)
    $taskPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $taskPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $taskGraphics.FillEllipse($taskBackground, 4, 4, 248, 248)
    $taskGraphics.FillEllipse($taskMint, 98, 46, 60, 60)
    $taskGraphics.FillRectangle($taskMint, 98, 76, 60, 50)
    $taskGraphics.FillEllipse($taskMint, 98, 96, 60, 60)
    $taskGraphics.DrawArc($taskPen, 76, 96, 104, 88, 0, 180)
    $taskGraphics.DrawLine($taskPen, 76, 140, 76, 120)
    $taskGraphics.DrawLine($taskPen, 180, 140, 180, 120)
    $taskGraphics.DrawLine($taskPen, 128, 184, 128, 207)
    $taskGraphics.DrawLine($taskPen, 104, 207, 152, 207)
    $taskStream = New-Object System.IO.MemoryStream
    $taskBitmap.Save($taskStream, [System.Drawing.Imaging.ImageFormat]::Png)
    $taskImages[$taskSize] = $taskStream.ToArray()
    $taskHicolor = Join-Path $taskAssets 'hicolor'
    New-Item -ItemType Directory -Force -Path $taskHicolor | Out-Null
    [System.IO.File]::WriteAllBytes((Join-Path $taskHicolor "${taskSize}x${taskSize}.png"), $taskImages[$taskSize])
    $taskGraphics.Dispose()
    $taskBitmap.Dispose()
    $taskStream.Dispose()
    $taskPen.Dispose()
    $taskMint.Dispose()
    $taskBackground.Dispose()
}
[System.IO.File]::WriteAllBytes((Join-Path $taskAssets 'icon.png'), $taskImages[256])
[System.IO.File]::WriteAllBytes((Join-Path $taskAssets 'iconTemplate.png'), $taskImages[32])
$taskIcoSizes = @(16, 32, 48, 64, 128, 256)
$taskIco = [System.IO.File]::Create((Join-Path $taskAssets 'icon.ico'))
$taskWriter = New-Object System.IO.BinaryWriter($taskIco)
$taskWriter.Write([uint16]0)
$taskWriter.Write([uint16]1)
$taskWriter.Write([uint16]$taskIcoSizes.Length)
$taskOffset = 6 + 16 * $taskIcoSizes.Length
foreach ($taskSize in $taskIcoSizes) {
    $taskDim = [byte]($taskSize % 256)
    $taskWriter.Write($taskDim)
    $taskWriter.Write($taskDim)
    $taskWriter.Write([byte]0)
    $taskWriter.Write([byte]0)
    $taskWriter.Write([uint16]1)
    $taskWriter.Write([uint16]32)
    $taskWriter.Write([uint32]$taskImages[$taskSize].Length)
    $taskWriter.Write([uint32]$taskOffset)
    $taskOffset += $taskImages[$taskSize].Length
}
foreach ($taskSize in $taskIcoSizes) { $taskWriter.Write([byte[]]$taskImages[$taskSize]) }
$taskWriter.Dispose()
$taskIco.Dispose()
Write-Output 'Generated Stoat PTT icons.'
