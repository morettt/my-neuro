using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Windows.Forms;

internal static class ElectronUiLauncher
{
    // Escape one argument for the Windows command-line parser.
    private static string Quote(string value)
    {
        var result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char c in value)
        {
            if (c == '\\') { slashes++; continue; }
            result.Append('\\', c == '"' ? slashes * 2 + 1 : slashes);
            result.Append(c);
            slashes = 0;
        }
        result.Append('\\', slashes * 2);
        return result.Append('"').ToString();
    }

    [STAThread]
    private static int Main(string[] args)
    {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string electron = Path.Combine(root, "node_modules", "electron", "dist", "electron.exe");
        string entry = Path.Combine(root, "control-main.js");
        try
        {
            if (!File.Exists(entry))
                throw new FileNotFoundException("Keep this EXE in the live-2d project directory. Missing: " + entry);
            if (!File.Exists(electron))
                throw new FileNotFoundException("Electron is missing. Run npm install, then run the Electron build BAT again. Missing: " + electron);

            var arguments = new StringBuilder(Quote(entry));
            foreach (string arg in args) arguments.Append(' ').Append(Quote(arg));
            var start = new ProcessStartInfo(electron, arguments.ToString());
            start.WorkingDirectory = root;
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            start.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
            using (Process child = Process.Start(start)) { }
            return 0;
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "Feiniu", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}
