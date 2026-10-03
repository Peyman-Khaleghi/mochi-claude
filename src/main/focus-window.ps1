# Brings a VS Code window to the front, for Mochi (see vscode.ts).
#
# Why a helper: Windows only lets a program pull another program's window to the front
# in a few situations, and Mochi, which never takes focus itself, isn't in any of them.
# This uses the usual way around it: briefly share keyboard input with the window that
# has focus now (AttachThreadInput), then switch, the way Alt+Tab does.
#
# Mochi starts it once and keeps it running, so a click doesn't wait for PowerShell to
# start. It reads one JSON object per line on stdin:   {"id":1,"folder":"my-website"}
# and answers one line per request on stdout:          1 ok    (or: 1 none, 1 error)
# "none" means no VS Code window shows that folder in its title.

$ErrorActionPreference = "Stop"

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class MochiWindows {
    delegate bool EnumProc(IntPtr hwnd, IntPtr param);

    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr param);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int max);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd, int command);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, IntPtr processId);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint from, uint to, bool attach);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern void SwitchToThisWindow(IntPtr hwnd, bool altTab);

    // VS Code titles read "file - folder - Visual Studio Code" (or "folder - Visual Studio Code").
    static IntPtr Find(string folder) {
        IntPtr found = IntPtr.Zero;
        EnumWindows(delegate (IntPtr hwnd, IntPtr param) {
            if (!IsWindowVisible(hwnd)) return true;
            StringBuilder text = new StringBuilder(512);
            GetWindowText(hwnd, text, 512);
            string[] parts = text.ToString().Split(new string[] { " - " }, StringSplitOptions.None);
            if (parts.Length >= 2 && parts[parts.Length - 1].StartsWith("Visual Studio Code") && Array.IndexOf(parts, folder) >= 0) {
                found = hwnd;
                return false;
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    public static bool Focus(string folder) {
        IntPtr hwnd = Find(folder);
        if (hwnd == IntPtr.Zero) return false;
        if (IsIconic(hwnd)) ShowWindow(hwnd, 9); // SW_RESTORE
        uint mine = GetCurrentThreadId();
        uint theirs = GetWindowThreadProcessId(GetForegroundWindow(), IntPtr.Zero);
        bool attached = theirs != 0 && theirs != mine && AttachThreadInput(mine, theirs, true);
        BringWindowToTop(hwnd);
        bool ok = SetForegroundWindow(hwnd);
        if (attached) AttachThreadInput(mine, theirs, false);
        if (!ok) SwitchToThisWindow(hwnd, true);
        return true;
    }
}
"@

while ($null -ne ($line = [Console]::In.ReadLine())) {
    $id = 0
    try {
        $request = $line | ConvertFrom-Json
        $id = [int]$request.id
        $answer = if ([MochiWindows]::Focus([string]$request.folder)) { "ok" } else { "none" }
    } catch {
        $answer = "error"
    }
    [Console]::Out.WriteLine("$id $answer")
    [Console]::Out.Flush()
}
