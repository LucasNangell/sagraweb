namespace SagraLetreiro;

public static class OverlayBounds
{
    public const int MinWidth = 320;
    public const int MaxWidth = 4000;
    public const int TrayGap = 8;

    public static int RightBound(int taskbarLeft, int taskbarRight, int? notifyLeft)
    {
        if (notifyLeft is int left)
        {
            var mid = taskbarLeft + (taskbarRight - taskbarLeft) / 2;
            if (left > mid && left < taskbarRight)
                return Math.Max(taskbarLeft, left - TrayGap);
        }
        return taskbarRight;
    }

    public static (int X, int Width) ClampX(int x, int width, int leftBound, int rightBound)
    {
        var available = rightBound - leftBound;
        if (available < 1)
            return (leftBound, Math.Max(MinWidth, width));

        var minW = Math.Min(MinWidth, available);
        width = Math.Max(minW, Math.Min(width, available));
        x = Math.Max(leftBound, Math.Min(x, rightBound - width));
        return (x, width);
    }
}
