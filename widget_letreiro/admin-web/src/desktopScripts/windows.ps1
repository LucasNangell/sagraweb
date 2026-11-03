$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
# Executado pelo canal de jobs existente, na sessão Windows do client.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public class SagraDesktopWindow {
    public string handle { get; set; }
    public int processId { get; set; }
    public string processStart { get; set; }
    public string title { get; set; }
    public string processName { get; set; }
    public string state { get; set; }
    public bool fullscreen { get; set; }
}
public static class SagraDesktop {
    delegate bool EnumProc(IntPtr hwnd, IntPtr param);
    [StructLayout(LayoutKind.Sequential)] struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] struct Placement { public int Length; public int Flags, Show; public Point Min, Max; public Rect Normal; }
    [StructLayout(LayoutKind.Sequential)] struct MonitorInfo { public int Size; public Rect Monitor, Work; public uint Flags; }
    [StructLayout(LayoutKind.Sequential)] struct GuiThreadInfo { public int Size, Flags; public IntPtr Active, Focus, Capture, MenuOwner, MoveSize, Caret; public Rect CaretRect; }
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr param);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr hwnd);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder title, int max);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint thread, ref GuiThreadInfo info);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out int value, int size);
    [DllImport("user32.dll", SetLastError=true)] static extern bool ShowWindowAsync(IntPtr hwnd, int state);
    [DllImport("user32.dll", SetLastError=true)] static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int w, int h, uint flags);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll", SetLastError=true)] static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll", SetLastError=true)] static extern int GetWindowLong(IntPtr hwnd, int index);
    [DllImport("user32.dll", SetLastError=true)] static extern int SetWindowLong(IntPtr hwnd, int index, int value);
    [DllImport("user32.dll")] static extern bool GetWindowPlacement(IntPtr hwnd, ref Placement placement);
    [DllImport("user32.dll")] static extern bool SetWindowPlacement(IntPtr hwnd, ref Placement placement);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr GetProp(IntPtr hwnd, string name);
    [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool SetProp(IntPtr hwnd, string name, IntPtr data);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr RemoveProp(IntPtr hwnd, string name);
    const string Prefix = "SagraLetreiro.Desktop.v1.";
    static readonly string[] Props = { "style", "exStyle", "flags", "show", "minX", "minY", "maxX", "maxY", "left", "top", "right", "bottom", "active" };
    static int Session { get { return Process.GetCurrentProcess().SessionId; } }
    static void Require(bool ok) { if (!ok) throw new InvalidOperationException("O Windows recusou a operação nesta janela."); }
    static void Save(IntPtr h, string name, int value) { Require(SetProp(h, Prefix + name, new IntPtr(value))); }
    static int Read(IntPtr h, string name) { return unchecked((int)GetProp(h, Prefix + name).ToInt64()); }
    static void Clear(IntPtr h) { foreach (string name in Props) RemoveProp(h, Prefix + name); }
    static void Style(IntPtr h, int index, int value) {
        SetWindowLong(h, index, value);
        Require(GetWindowLong(h, index) == value);
    }
    public static int FullscreenStyle(int style) { return style & ~(0x00C40000 | 0x20000000 | 0x01000000); }

    public static List<SagraDesktopWindow> List() {
        var rows = new List<SagraDesktopWindow>();
        EnumWindows(delegate(IntPtr h, IntPtr param) {
            if (rows.Count >= 100) return false;
            try {
                int cloaked;
                if (!IsWindowVisible(h) || (DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0)) return true;
                var title = new StringBuilder(201);
                if (GetWindowText(h, title, title.Capacity) == 0) return true;
                uint pid; GetWindowThreadProcessId(h, out pid);
                using (var process = Process.GetProcessById((int)pid)) {
                    if (process.SessionId != Session) return true;
                    rows.Add(new SagraDesktopWindow {
                        handle = h.ToInt64().ToString(), processId = (int)pid,
                        processStart = process.StartTime.ToUniversalTime().Ticks.ToString(),
                        title = title.ToString(), processName = process.ProcessName,
                        state = IsIconic(h) ? "minimized" : IsZoomed(h) ? "maximized" : "normal",
                        fullscreen = GetProp(h, Prefix + "active") != IntPtr.Zero
                    });
                }
            } catch { /* Janelas que fecharam ou não podem ser consultadas são ignoradas. */ }
            return true;
        }, IntPtr.Zero);
        return rows;
    }

    public static string Act(long handle, int pid, long started, string action) {
        if (action != "close" && action != "foreground" && action != "fullscreen" && action != "maximize" && action != "minimize" && action != "restore" && action != "refresh")
            throw new ArgumentException("Ação de janela inválida.");
        var h = new IntPtr(handle);
        uint owner; GetWindowThreadProcessId(h, out owner);
        if (!IsWindow(h) || !IsWindowVisible(h) || owner != pid) throw new InvalidOperationException("A janela mudou ou foi fechada. Atualize a lista.");
        using (var process = Process.GetProcessById(pid)) {
            if (process.SessionId != Session || process.StartTime.ToUniversalTime().Ticks != started)
                throw new InvalidOperationException("A janela não pertence mais à sessão consultada. Atualize a lista.");
        }
        if (action == "refresh") {
            uint actualOwner; uint thread = GetWindowThreadProcessId(h, out actualOwner);
            var info = new GuiThreadInfo(); info.Size = Marshal.SizeOf(typeof(GuiThreadInfo));
            IntPtr destination = h;
            if (GetGUIThreadInfo(thread, ref info) && info.Focus != IntPtr.Zero && GetAncestor(info.Focus, 2) == h) destination = info.Focus;
            Require(PostMessage(destination, 0x0100, new IntPtr(0x74), new IntPtr(1)));
            Require(PostMessage(destination, 0x0101, new IntPtr(0x74), new IntPtr(unchecked((int)0xC0000001))));
            return "Atualização solicitada (F5). A resposta depende do aplicativo.";
        }
        if (action == "close") {
            Require(PostMessage(h, 0x0010, IntPtr.Zero, IntPtr.Zero));
            return "Solicitação de fechamento enviada. O aplicativo pode pedir para salvar alterações.";
        }
        if (action == "foreground") {
            if (IsIconic(h)) Require(ShowWindowAsync(h, 9));
            Require(SetWindowPos(h, IntPtr.Zero, 0, 0, 0, 0, 0x4003));
            Require(SetForegroundWindow(h));
            return "Janela trazida ao topo.";
        }
        if (action == "fullscreen" && GetProp(h, Prefix + "active") == IntPtr.Zero) {
            var place = new Placement(); place.Length = Marshal.SizeOf(typeof(Placement));
            Require(GetWindowPlacement(h, ref place));
            var info = new MonitorInfo(); info.Size = Marshal.SizeOf(typeof(MonitorInfo));
            Require(GetMonitorInfo(MonitorFromWindow(h, 2), ref info));
            try {
                Save(h, "style", GetWindowLong(h, -16)); Save(h, "exStyle", GetWindowLong(h, -20));
                Save(h, "flags", place.Flags); Save(h, "show", place.Show);
                Save(h, "minX", place.Min.X); Save(h, "minY", place.Min.Y); Save(h, "maxX", place.Max.X); Save(h, "maxY", place.Max.Y);
                Save(h, "left", place.Normal.Left); Save(h, "top", place.Normal.Top); Save(h, "right", place.Normal.Right); Save(h, "bottom", place.Normal.Bottom);
                Save(h, "active", 1);
            } catch { Clear(h); throw; }
            // Remove WPF_ASYNCWINDOWPLACEMENT: normaliza antes de alterar a moldura.
            place.Flags &= ~4; place.Show = 1; Require(SetWindowPlacement(h, ref place));
            Style(h, -16, FullscreenStyle(Read(h, "style")));
            Style(h, -20, Read(h, "exStyle") & ~0x00020201);
            Require(SetWindowPos(h, IntPtr.Zero, info.Monitor.Left, info.Monitor.Top,
                info.Monitor.Right-info.Monitor.Left, info.Monitor.Bottom-info.Monitor.Top, 0x0060));
            return "Tela cheia sem bordas ativada.";
        }
        if (GetProp(h, Prefix + "active") != IntPtr.Zero) {
            Style(h, -16, Read(h, "style")); Style(h, -20, Read(h, "exStyle"));
            var place = new Placement(); place.Length = Marshal.SizeOf(typeof(Placement));
            place.Flags = Read(h, "flags") & ~4; place.Show = Read(h, "show");
            place.Min.X = Read(h, "minX"); place.Min.Y = Read(h, "minY"); place.Max.X = Read(h, "maxX"); place.Max.Y = Read(h, "maxY");
            place.Normal.Left = Read(h, "left"); place.Normal.Top = Read(h, "top"); place.Normal.Right = Read(h, "right"); place.Normal.Bottom = Read(h, "bottom");
            Require(SetWindowPlacement(h, ref place));
            Require(SetWindowPos(h, IntPtr.Zero, 0, 0, 0, 0, 0x0027));
            Clear(h);
            if (action == "fullscreen") return "Tamanho e bordas originais restaurados.";
        }
        if (action == "maximize") Require(ShowWindowAsync(h, 3));
        else if (action == "minimize") Require(ShowWindowAsync(h, 6));
        else if (action == "restore") Require(ShowWindowAsync(h, 9));
        else throw new ArgumentException("Ação de janela inválida.");
        return "Comando enviado à janela.";
    }
}
'@
