using System.Windows;
using System.Windows.Interop;
using static SagraLetreiro.NativeMethods;

namespace SagraLetreiro;

internal static class OverlayChrome
{
    /// <summary>
    /// Fora do Alt+Tab, sem roubar foco. Não reafirma TOPMOST a cada 700 ms
    /// nem usa SWP_SHOWWINDOW — o mesmo recorte do Desktop Widgets.
    /// </summary>
    public static void ApplyFloatingStyle(Window window)
    {
        void Setup(IntPtr hwnd)
        {
            var ex = GetWindowLong(hwnd, GWL_EXSTYLE);
            SetWindowLong(hwnd, GWL_EXSTYLE, (ex | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE) & ~WS_EX_APPWINDOW);
            HwndSource.FromHwnd(hwnd)?.AddHook(NoActivateProc);
            SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER);
        }

        var helper = new WindowInteropHelper(window);
        if (helper.Handle == IntPtr.Zero)
            window.SourceInitialized += (_, _) => Setup(helper.Handle);
        else
            Setup(helper.Handle);
    }

    static IntPtr NoActivateProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (msg != WM_MOUSEACTIVATE) return IntPtr.Zero;
        handled = true;
        return new IntPtr(MA_NOACTIVATE);
    }
}
