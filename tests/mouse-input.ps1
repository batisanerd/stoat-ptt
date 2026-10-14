param(
    [ValidateSet('position', 'move', 'down', 'up')][string]$Action,
    [ValidateSet(4, 5)][int]$Button = 5,
    [int]$X = -1,
    [int]$Y = -1
)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PttTestMouse {
    [StructLayout(LayoutKind.Sequential)]
    public struct Point { public int X; public int Y; }
    [DllImport("user32.dll")]
    public static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")]
    public static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
}
'@
$taskPoint = New-Object PttTestMouse+Point
[PttTestMouse]::GetCursorPos([ref]$taskPoint) | Out-Null
if ($X -ge 0 -and $Y -ge 0) { [PttTestMouse]::SetCursorPos($X, $Y) | Out-Null }
if ($Action -eq 'down') { [PttTestMouse]::mouse_event(0x0080, 0, 0, [uint32]($Button - 3), [UIntPtr]::Zero) }
if ($Action -eq 'up') { [PttTestMouse]::mouse_event(0x0100, 0, 0, [uint32]($Button - 3), [UIntPtr]::Zero) }
@{ x = $taskPoint.X; y = $taskPoint.Y } | ConvertTo-Json -Compress
