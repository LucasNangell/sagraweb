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
    public const int MinWidth = OverlayBounds.MinWidth;

    static readonly string[] NotifyClasses =
    [
        "TrayNotifyWnd",
        "TrayClockWClass",
        "TrayShowDesktopButtonWClass",
        "TrayButton",
    ];

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
        int leftBound, rightBound, y, height;
        if (geom.Edge is "bottom" or "top")
        {
            leftBound = geom.Left;
            rightBound = OverlayBounds.RightBound(geom.Left, geom.Right, NotifyAreaLeft(geom));
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
        (x, width) = OverlayBounds.ClampX(x, width, leftBound, rightBound);
        return new RECT { Left = x, Top = y, Right = x + width, Bottom = y + height };
    }

    public static RECT ClampPinnedRight(int width, TaskbarGeom geom)
    {
        int leftBound, rightBound, y, height;
        if (geom.Edge is "bottom" or "top")
        {
            leftBound = geom.Left;
            rightBound = OverlayBounds.RightBound(geom.Left, geom.Right, NotifyAreaLeft(geom));
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
        int x;
        (x, width) = OverlayBounds.PinRight(width, leftBound, rightBound);
        return new RECT { Left = x, Top = y, Right = x + width, Bottom = y + height };
    }

    static int? NotifyAreaLeft(TaskbarGeom geom)
    {
        try
        {
            var tray = FindTrayWindow(geom);
            if (tray == IntPtr.Zero) return null;

            var notify = FindWindowEx(tray, IntPtr.Zero, "TrayNotifyWnd", null);
            var left = int.MaxValue;
            var found = false;
            void Consider(IntPtr hwnd)
            {
                if (hwnd == IntPtr.Zero) return;
                if (!GetWindowRect(hwnd, out var rect) || rect.Width <= 0 || rect.Height <= 0) return;
                if (rect.Left <= geom.Left + geom.Width / 2) return;
                if (rect.Right < geom.Left || rect.Left > geom.Right) return;
                left = Math.Min(left, rect.Left);
                found = true;
            }

            Consider(notify);
            EnumWindowsProc callback = (hwnd, _) =>
            {
                var name = ClassName(hwnd);
                foreach (var cls in NotifyClasses)
                {
                    if (name == cls)
                    {
                        Consider(hwnd);
                        break;
                    }
                }
                return true;
            };
            EnumChildWindows(tray, callback, IntPtr.Zero);
            GC.KeepAlive(callback);
            return found ? left : null;
        }
        catch
        {
            return null;
        }
    }

    static IntPtr FindTrayWindow(TaskbarGeom geom)
    {
        var primary = FindWindow("Shell_TrayWnd", null);
        if (primary != IntPtr.Zero && OverlapsTaskbar(primary, geom))
            return primary;

        IntPtr found = IntPtr.Zero;
        EnumWindowsProc callback = (hwnd, _) =>
        {
            if (ClassName(hwnd) != "Shell_SecondaryTrayWnd") return true;
            if (!OverlapsTaskbar(hwnd, geom)) return true;
            found = hwnd;
            return false;
        };
        EnumWindows(callback, IntPtr.Zero);
        GC.KeepAlive(callback);
        return found;
    }

    static bool OverlapsTaskbar(IntPtr hwnd, TaskbarGeom geom)
    {
        if (!GetWindowRect(hwnd, out var rect)) return false;
        return rect.Left < geom.Right && rect.Right > geom.Left
            && rect.Top < geom.Bottom && rect.Bottom > geom.Top;
    }

    static string ClassName(IntPtr hwnd)
    {
        var sb = new System.Text.StringBuilder(256);
        return GetClassName(hwnd, sb, sb.Capacity) > 0 ? sb.ToString() : "";
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
