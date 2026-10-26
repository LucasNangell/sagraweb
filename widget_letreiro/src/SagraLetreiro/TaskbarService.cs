using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using static SagraLetreiro.NativeMethods;

namespace SagraLetreiro;

internal readonly record struct TaskbarGeom(
    int Left, int Top, int Right, int Bottom, int Thickness, string Edge,
    int MonitorLeft, int MonitorTop, int MonitorRight, int MonitorBottom)
{
    public int Width => Math.Max(1, Right - Left);
}

internal static class TaskbarService
{
    public const int MinWidth = 320;

    public static TaskbarGeom At(int x, int y)
    {
        var monitor = MonitorFromPoint(new POINT { X = x, Y = y }, MONITOR_DEFAULTTONEAREST);
        var info = new MONITORINFO { cbSize = Marshal.SizeOf<MONITORINFO>() };
        if (monitor == IntPtr.Zero || !GetMonitorInfo(monitor, ref info))
        {
            return new TaskbarGeom(0, 1032, 1920, 1080, 48, "bottom", 0, 0, 1920, 1080);
        }

        var mon = info.rcMonitor;
        var work = info.rcWork;
        var leftGap = work.Left - mon.Left;
        var topGap = work.Top - mon.Top;
        var rightGap = mon.Right - work.Right;
        var bottomGap = mon.Bottom - work.Bottom;

        if (bottomGap >= Math.Max(Math.Max(leftGap, topGap), Math.Max(rightGap, 1)))
        {
            var thickness = Math.Max(bottomGap, 40);
            return new TaskbarGeom(mon.Left, mon.Bottom - thickness, mon.Right, mon.Bottom, thickness, "bottom",
                mon.Left, mon.Top, mon.Right, mon.Bottom);
        }
        if (topGap >= Math.Max(Math.Max(leftGap, rightGap), 1))
        {
            var thickness = Math.Max(topGap, 40);
            return new TaskbarGeom(mon.Left, mon.Top, mon.Right, mon.Top + thickness, thickness, "top",
                mon.Left, mon.Top, mon.Right, mon.Bottom);
        }
        if (leftGap >= rightGap)
        {
            var thickness = Math.Max(leftGap, 40);
            return new TaskbarGeom(mon.Left, mon.Top, mon.Left + thickness, mon.Bottom, thickness, "left",
                mon.Left, mon.Top, mon.Right, mon.Bottom);
        }
        {
            var thickness = Math.Max(rightGap, 40);
            return new TaskbarGeom(mon.Right - thickness, mon.Top, mon.Right, mon.Bottom, thickness, "right",
                mon.Left, mon.Top, mon.Right, mon.Bottom);
        }
    }

    public static RECT Clamp(int x, int width, TaskbarGeom geom)
    {
        var maxWidth = Math.Max(MinWidth, geom.Edge is "bottom" or "top"
            ? geom.Width
            : geom.MonitorRight - geom.MonitorLeft);
        width = Math.Max(MinWidth, Math.Min(width, maxWidth));
        int leftBound, rightBound, y, height;
        if (geom.Edge is "bottom" or "top")
        {
            leftBound = geom.Left;
            rightBound = geom.Right;
            y = geom.Top;
            height = geom.Thickness;
        }
        else
        {
            leftBound = geom.MonitorLeft;
            rightBound = geom.MonitorRight;
            height = geom.Thickness;
            y = geom.MonitorBottom - height;
        }
        x = Math.Max(leftBound, Math.Min(x, rightBound - width));
        return new RECT { Left = x, Top = y, Right = x + width, Bottom = y + height };
    }

    public static void ApplyPhysical(Window window, RECT rect)
    {
        var hwnd = new WindowInteropHelper(window).EnsureHandle();
        var dpi = VisualTreeHelper.GetDpi(window);
        window.Width = Math.Max(1, rect.Width / dpi.DpiScaleX);
        window.Height = Math.Max(1, rect.Height / dpi.DpiScaleY);
        SetWindowPos(hwnd, HWND_TOPMOST, rect.Left, rect.Top, rect.Width, rect.Height,
            SWP_NOACTIVATE | SWP_NOOWNERZORDER);
    }
}
