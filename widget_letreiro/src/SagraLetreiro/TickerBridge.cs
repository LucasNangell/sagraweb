using System.Runtime.InteropServices;

namespace SagraLetreiro;

[ComVisible(true)]
[ClassInterface(ClassInterfaceType.AutoDual)]
public class TickerBridge
{
    readonly object _gate = new();
    string _frameJson = """{"items":[]}""";

    public string FrameJson
    {
        get { lock (_gate) return _frameJson; }
        set { lock (_gate) _frameJson = value ?? """{"items":[]}"""; }
    }
}
