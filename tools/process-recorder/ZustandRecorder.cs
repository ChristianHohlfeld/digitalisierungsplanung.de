using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Automation;
using System.Windows.Forms;

namespace ZustandProcessRecorder
{
    public static class Program
    {
        [STAThread]
        public static void Run()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new RecorderHost());
        }
    }

    internal sealed class RecorderHost : ApplicationContext
    {
        private const int Port = 43127;
        private readonly object gate = new object();
        private readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = Int32.MaxValue, RecursionLimit = 64 };
        private readonly NotifyIcon tray;
        private readonly ToolStripMenuItem stateItem;
        private readonly ToolStripMenuItem stopItem;
        private readonly CancellationTokenSource shutdown = new CancellationTokenSource();
        private readonly TcpListener listener;
        private readonly GlobalHooks hooks;
        private readonly SynchronizationContext uiContext;
        private readonly System.Threading.Timer foregroundTimer;
        private CaptureSession session;
        private CapturePayload completedCapture;

        public RecorderHost()
        {
            uiContext = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();
            stateItem = new ToolStripMenuItem("Bereit") { Enabled = false };
            stopItem = new ToolStripMenuItem("Aufnahme stoppen", null, delegate { StopCapture(); }) { Enabled = false };
            var exitItem = new ToolStripMenuItem("Recorder beenden", null, delegate { ExitThread(); });
            var menu = new ContextMenuStrip();
            menu.Items.Add(stateItem);
            menu.Items.Add(stopItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(exitItem);
            tray = new NotifyIcon
            {
                Text = "Zustand Prozessaufnahme: bereit",
                Icon = SystemIcons.Application,
                ContextMenuStrip = menu,
                Visible = true
            };
            tray.DoubleClick += delegate { tray.ShowBalloonTip(1800, "Zustand Prozessaufnahme", session == null ? "Bereit. Starte die Aufnahme im Canvas." : "Aufnahme läuft. Stoppe sie im Canvas oder hier.", ToolTipIcon.Info); };

            hooks = new GlobalHooks(OnClick, OnKey, OnScroll);
            foregroundTimer = new System.Threading.Timer(delegate
            {
                CaptureSession current;
                lock (gate) current = session;
                if (current != null) current.RecordApplication();
            }, null, Timeout.Infinite, Timeout.Infinite);
            listener = new TcpListener(IPAddress.Loopback, Port);
            listener.Start();
            Task.Run((Action)AcceptLoop);
        }

        private void AcceptLoop()
        {
            while (!shutdown.IsCancellationRequested)
            {
                try
                {
                    var client = listener.AcceptTcpClient();
                    Task.Run(delegate { HandleClient(client); });
                }
                catch (SocketException)
                {
                    if (!shutdown.IsCancellationRequested) Thread.Sleep(100);
                }
                catch (ObjectDisposedException) { break; }
            }
        }

        private static bool OriginAllowed(string origin)
        {
            if (String.IsNullOrEmpty(origin)) return false;
            return origin == "https://digitalisierungsplanung.de" ||
                   origin == "http://127.0.0.1:8124" ||
                   origin == "http://localhost:8124";
        }

        private void HandleClient(TcpClient client)
        {
            using (client)
            using (var stream = client.GetStream())
            {
                stream.ReadTimeout = 5000;
                stream.WriteTimeout = 15000;
                string requestLine;
                var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                using (var reader = new StreamReader(stream, Encoding.ASCII, false, 1024, true))
                {
                    requestLine = reader.ReadLine() ?? "";
                    string line;
                    while (!String.IsNullOrEmpty(line = reader.ReadLine()))
                    {
                        int separator = line.IndexOf(':');
                        if (separator > 0) headers[line.Substring(0, separator).Trim()] = line.Substring(separator + 1).Trim();
                    }
                    string contentLengthText;
                    int contentLength;
                    if (headers.TryGetValue("Content-Length", out contentLengthText) &&
                        Int32.TryParse(contentLengthText, out contentLength) && contentLength > 0)
                    {
                        if (contentLength > 4096) return;
                        string expect;
                        if (headers.TryGetValue("Expect", out expect) &&
                            expect.IndexOf("100-continue", StringComparison.OrdinalIgnoreCase) >= 0)
                        {
                            byte[] interim = Encoding.ASCII.GetBytes("HTTP/1.1 100 Continue\r\n\r\n");
                            stream.Write(interim, 0, interim.Length);
                            stream.Flush();
                        }
                        var body = new char[contentLength];
                        int read = 0;
                        while (read < body.Length)
                        {
                            int next = reader.Read(body, read, body.Length - read);
                            if (next <= 0) break;
                            read += next;
                        }
                    }
                }
                var parts = requestLine.Split(' ');
                var method = parts.Length > 0 ? parts[0] : "";
                var path = parts.Length > 1 ? parts[1].Split('?')[0] : "";
                string origin;
                headers.TryGetValue("Origin", out origin);
                if (!OriginAllowed(origin))
                {
                    WriteJson(stream, 403, new { error = "origin_not_allowed" }, "");
                    return;
                }
                if (method == "OPTIONS")
                {
                    WriteEmpty(stream, 204, origin);
                    return;
                }
                if (method == "GET" && path == "/v1/health")
                {
                    CaptureSession current;
                    lock (gate) current = session;
                    WriteJson(stream, 200, current == null
                        ? (object)new { ok = true, version = 1, recording = false, ready = completedCapture != null }
                        : new { ok = true, version = 1, recording = true, ready = completedCapture != null, sessionId = current.Id, startedAt = current.StartedAt, eventCount = current.EventCount, frameCount = current.FrameCount }, origin);
                    return;
                }
                if (method == "GET" && path == "/v1/capture")
                {
                    CaptureSession current;
                    lock (gate) current = session;
                    if (current == null) WriteJson(stream, 409, new { error = "not_recording" }, origin);
                    else WriteJson(stream, 200, current.Snapshot(), origin);
                    return;
                }
                if (method == "POST" && path == "/v1/start")
                {
                    WriteJson(stream, 200, StartCapture(), origin);
                    return;
                }
                if (method == "POST" && path == "/v1/stop")
                {
                    var capture = TakeCapture();
                    if (capture == null) WriteJson(stream, 409, new { error = "not_recording" }, origin);
                    else WriteJson(stream, 200, capture, origin);
                    return;
                }
                if (method == "POST" && path == "/v1/cancel")
                {
                    StopCapture();
                    lock (gate) completedCapture = null;
                    WriteJson(stream, 200, new { ok = true }, origin);
                    return;
                }
                WriteJson(stream, 404, new { error = "not_found" }, origin);
            }
        }

        private object StartCapture()
        {
            CaptureSession current;
            lock (gate)
            {
                if (session == null)
                {
                    completedCapture = null;
                    var next = new CaptureSession();
                    hooks.Start();
                    session = next;
                    session.RecordApplication();
                    foregroundTimer.Change(500, 500);
                    BeginInvoke(delegate
                    {
                        tray.Icon = SystemIcons.Error;
                        tray.Text = "Zustand Prozessaufnahme: Aufnahme läuft";
                        stateItem.Text = "Aufnahme läuft";
                        stopItem.Enabled = true;
                        tray.ShowBalloonTip(1800, "Aufnahme läuft", "Klicks, Eingabeaktionen, Fensterwechsel und Kontextbilder werden jetzt erfasst.", ToolTipIcon.Info);
                    });
                }
                current = session;
            }
            return new { ok = true, version = 1, recording = true, sessionId = current.Id, startedAt = current.StartedAt };
        }

        private CapturePayload StopCapture()
        {
            CaptureSession finished;
            lock (gate)
            {
                finished = session;
                if (finished == null) return null;
                hooks.Stop();
                foregroundTimer.Change(Timeout.Infinite, Timeout.Infinite);
                session = null;
            }
            var payload = finished.Finish();
            lock (gate) completedCapture = payload;
            BeginInvoke(delegate
            {
                tray.Icon = SystemIcons.Application;
                tray.Text = "Zustand Prozessaufnahme: bereit";
                stateItem.Text = "Bereit";
                stopItem.Enabled = false;
                tray.ShowBalloonTip(1600, "Aufnahme beendet", "Der Editor übernimmt jetzt den Ablauf.", ToolTipIcon.Info);
            });
            return payload;
        }

        private CapturePayload TakeCapture()
        {
            StopCapture();
            lock (gate)
            {
                var payload = completedCapture;
                completedCapture = null;
                return payload;
            }
        }

        private void OnClick(Point point, string button)
        {
            CaptureSession current;
            lock (gate) current = session;
            if (current != null) current.RecordClick(point, button);
        }

        private void OnKey(int virtualKey)
        {
            CaptureSession current;
            lock (gate) current = session;
            if (current != null) current.RecordKey(virtualKey);
        }

        private void OnScroll(Point point, int delta)
        {
            CaptureSession current;
            lock (gate) current = session;
            if (current != null) current.RecordScroll(point, delta);
        }

        private void BeginInvoke(MethodInvoker action)
        {
            uiContext.Post(delegate { action(); }, null);
        }

        private void WriteJson(NetworkStream stream, int status, object value, string origin)
        {
            var bytes = Encoding.UTF8.GetBytes(json.Serialize(value));
            WriteResponse(stream, status, "application/json; charset=utf-8", bytes, origin);
        }

        private static void WriteEmpty(NetworkStream stream, int status, string origin)
        {
            WriteResponse(stream, status, "text/plain; charset=utf-8", new byte[0], origin);
        }

        private static void WriteResponse(NetworkStream stream, int status, string contentType, byte[] body, string origin)
        {
            string reason = status == 200 ? "OK" : status == 204 ? "No Content" : status == 403 ? "Forbidden" : status == 404 ? "Not Found" : "Conflict";
            var builder = new StringBuilder();
            builder.Append("HTTP/1.1 ").Append(status).Append(' ').Append(reason).Append("\r\n");
            builder.Append("Content-Type: ").Append(contentType).Append("\r\n");
            builder.Append("Content-Length: ").Append(body.Length).Append("\r\n");
            builder.Append("Cache-Control: no-store, max-age=0\r\nPragma: no-cache\r\nExpires: 0\r\n");
            builder.Append("Access-Control-Allow-Origin: ").Append(origin).Append("\r\n");
            builder.Append("Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n");
            builder.Append("Access-Control-Allow-Headers: content-type\r\n");
            builder.Append("Access-Control-Allow-Private-Network: true\r\nVary: Origin\r\nConnection: close\r\n\r\n");
            var header = Encoding.ASCII.GetBytes(builder.ToString());
            stream.Write(header, 0, header.Length);
            if (body.Length > 0) stream.Write(body, 0, body.Length);
        }

        protected override void ExitThreadCore()
        {
            StopCapture();
            shutdown.Cancel();
            try { listener.Stop(); } catch { }
            hooks.Dispose();
            foregroundTimer.Dispose();
            tray.Visible = false;
            tray.Dispose();
            base.ExitThreadCore();
        }
    }

    internal sealed class CaptureSession
    {
        private const int MaxEvents = 4000;
        private const int MaxFrames = 36;
        private readonly object gate = new object();
        private readonly List<Dictionary<string, object>> events = new List<Dictionary<string, object>>();
        private readonly List<Dictionary<string, object>> frames = new List<Dictionary<string, object>>();
        private readonly Random reservoir = new Random(43127);
        private int sequence;
        private int seenFrames;
        private long lastScrollAt;
        private Dictionary<string, object> inputBurst;
        private string inputBurstKey = "";
        private long inputBurstAt;
        private string applicationKey = "";

        public string Id { get; private set; }
        public long StartedAt { get; private set; }
        public int EventCount { get { lock (gate) return events.Count; } }
        public int FrameCount { get { lock (gate) return frames.Count; } }

        public CaptureSession()
        {
            Id = Guid.NewGuid().ToString("N");
            StartedAt = Now();
        }

        public void RecordApplication()
        {
            var context = DesktopContext.Foreground();
            var key = context.App + "|" + context.Window;
            lock (gate)
            {
                if (key == applicationKey) return;
                applicationKey = key;
            }
            AddEvent("application", context, null);
        }

        public void RecordClick(Point point, string button)
        {
            var context = DesktopContext.AtPoint(point);
            string controlName = context.Control == null || !context.Control.ContainsKey("name") ? "" : Convert.ToString(context.Control["name"]);
            if (controlName == "PC-Aufnahme stoppen" || controlName == "Aufnahme stoppen") return;
            var extra = new Dictionary<string, object> { { "button", button } };
            var item = AddEvent("click", context, extra);
            if (item == null) return;
            ThreadPool.QueueUserWorkItem(delegate
            {
                Thread.Sleep(140);
                AddFrame(Convert.ToInt32(item["seq"]));
            });
        }

        public void RecordKey(int virtualKey)
        {
            ThreadPool.QueueUserWorkItem(delegate
            {
                var context = DesktopContext.Focused();
                string key = KeyName(virtualKey);
                bool textControl = context.Control != null && context.Control.ContainsKey("type") &&
                    (Convert.ToString(context.Control["type"]) == "Edit" || Convert.ToString(context.Control["type"]) == "Document");
                if (virtualKey == 32 && textControl) key = "";
                if (key.Length > 0)
                {
                    AddEvent("key", context, new Dictionary<string, object> { { "key", key } });
                    return;
                }
                if (!IsTextInputKey(virtualKey)) return;
                RecordInputBurst(context);
            });
        }

        private static bool IsTextInputKey(int virtualKey)
        {
            return virtualKey == 8 || virtualKey == 32 || virtualKey == 46 ||
                   (virtualKey >= 48 && virtualKey <= 90) ||
                   (virtualKey >= 96 && virtualKey <= 111) ||
                   (virtualKey >= 186 && virtualKey <= 226);
        }

        private static string KeyName(int virtualKey)
        {
            if (virtualKey == 13) return "Enter";
            if (virtualKey == 9) return "Tab";
            if (virtualKey == 27) return "Escape";
            if (virtualKey == 32) return "Space";
            if (virtualKey == 37) return "ArrowLeft";
            if (virtualKey == 38) return "ArrowUp";
            if (virtualKey == 39) return "ArrowRight";
            if (virtualKey == 40) return "ArrowDown";
            if (virtualKey == 33) return "PageUp";
            if (virtualKey == 34) return "PageDown";
            if (virtualKey == 35) return "End";
            if (virtualKey == 36) return "Home";
            return "";
        }

        public void RecordScroll(Point point, int delta)
        {
            long now = Now();
            lock (gate)
            {
                if (now - lastScrollAt < 600) return;
                lastScrollAt = now;
            }
            ThreadPool.QueueUserWorkItem(delegate
            {
                AddEvent("scroll", DesktopContext.AtPoint(point), new Dictionary<string, object> { { "direction", delta > 0 ? "up" : "down" } });
            });
        }

        private void RecordInputBurst(DesktopContext context)
        {
            long now = Now();
            string controlId = context.App + "|" + context.Window + "|" + context.ControlKey;
            bool password = context.Control != null && context.Control.ContainsKey("password") && Convert.ToBoolean(context.Control["password"]);
            lock (gate)
            {
                if (inputBurst != null && inputBurstKey == controlId && now - inputBurstAt < 1200)
                {
                    if (!password) inputBurst["keyCount"] = Convert.ToInt32(inputBurst["keyCount"]) + 1;
                    inputBurstAt = now;
                    return;
                }
            }
            var item = AddEvent("input", context, new Dictionary<string, object> { { "keyCount", password ? 0 : 1 } });
            lock (gate)
            {
                inputBurst = item;
                inputBurstKey = controlId;
                inputBurstAt = now;
            }
        }

        private Dictionary<string, object> AddEvent(string kind, DesktopContext context, Dictionary<string, object> extra)
        {
            lock (gate)
            {
                if (events.Count >= MaxEvents) return null;
                var item = new Dictionary<string, object>
                {
                    { "seq", ++sequence },
                    { "at", Now() },
                    { "kind", kind },
                    { "app", context.App },
                    { "window", context.Window },
                    { "control", context.Control }
                };
                if (extra != null) foreach (var pair in extra) item[pair.Key] = pair.Value;
                events.Add(item);
                return item;
            }
        }

        private void AddFrame(int eventSeq)
        {
            string image = ScreenCapture.JpegDataUrl();
            if (String.IsNullOrEmpty(image)) return;
            var frame = new Dictionary<string, object> { { "at", Now() }, { "eventSeq", eventSeq }, { "image", image } };
            lock (gate)
            {
                seenFrames++;
                if (frames.Count < MaxFrames) frames.Add(frame);
                else
                {
                    int slot = reservoir.Next(seenFrames);
                    if (slot < MaxFrames) frames[slot] = frame;
                }
            }
        }

        public CapturePayload Finish()
        {
            return Snapshot(true);
        }

        public CapturePayload Snapshot()
        {
            return Snapshot(false);
        }

        private CapturePayload Snapshot(bool finished)
        {
            lock (gate)
            {
                return new CapturePayload
                {
                    sessionId = Id,
                    startedAt = StartedAt,
                    endedAt = finished ? Now() : 0,
                    events = events.OrderBy(item => Convert.ToInt32(item["seq"])).ToList(),
                    frames = frames.OrderBy(item => Convert.ToInt64(item["at"])).ToList()
                };
            }
        }

        private static long Now() { return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(); }
    }

    internal sealed class CapturePayload
    {
        public string sessionId { get; set; }
        public long startedAt { get; set; }
        public long endedAt { get; set; }
        public List<Dictionary<string, object>> events { get; set; }
        public List<Dictionary<string, object>> frames { get; set; }
    }

    internal sealed class DesktopContext
    {
        public string App = "";
        public string Window = "";
        public Dictionary<string, object> Control = null;
        public string ControlKey = "";

        public static DesktopContext Foreground() { return FromElement(null); }

        public static DesktopContext Focused()
        {
            try { return FromElement(AutomationElement.FocusedElement); }
            catch { return Foreground(); }
        }

        public static DesktopContext AtPoint(Point point)
        {
            try { return FromElement(AutomationElement.FromPoint(new System.Windows.Point(point.X, point.Y))); }
            catch { return Foreground(); }
        }

        private static DesktopContext FromElement(AutomationElement element)
        {
            var context = new DesktopContext();
            IntPtr window = Native.GetForegroundWindow();
            context.Window = Native.WindowTitle(window);
            try
            {
                int processId = element != null ? element.Current.ProcessId : Native.ProcessId(window);
                if (processId > 0) context.App = Process.GetProcessById(processId).ProcessName;
            }
            catch { context.App = ""; }
            if (element == null) return context;
            try
            {
                string type = (element.Current.ControlType.ProgrammaticName ?? "").Replace("ControlType.", "");
                bool password = element.Current.IsPassword;
                string automationId = Safe(element.Current.AutomationId, 100);
                string name = "";
                if (password) name = "Passwortfeld";
                else if (type == "Edit" || type == "Document")
                {
                    try { name = Safe(element.Current.LabeledBy == null ? "" : element.Current.LabeledBy.Current.Name, 140); } catch { }
                    if (String.IsNullOrEmpty(name)) name = "Textfeld";
                }
                else name = Safe(element.Current.Name, 140);
                context.Control = new Dictionary<string, object>
                {
                    { "name", name },
                    { "type", Safe(type, 80) },
                    { "automationId", automationId },
                    { "password", password }
                };
                context.ControlKey = type + "|" + automationId + "|" + name;
            }
            catch { context.Control = null; }
            return context;
        }

        private static string Safe(string value, int max)
        {
            if (String.IsNullOrEmpty(value)) return "";
            value = new string(value.Where(ch => !Char.IsControl(ch)).ToArray()).Trim();
            return value.Length <= max ? value : value.Substring(0, max);
        }
    }

    internal static class ScreenCapture
    {
        public static string JpegDataUrl()
        {
            try
            {
                Rectangle bounds = SystemInformation.VirtualScreen;
                if (bounds.Width <= 0 || bounds.Height <= 0) return "";
                using (var source = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format24bppRgb))
                using (var graphics = Graphics.FromImage(source))
                {
                    graphics.CopyFromScreen(bounds.Left, bounds.Top, 0, 0, bounds.Size, CopyPixelOperation.SourceCopy);
                    double scale = Math.Min(1.0, Math.Min(960.0 / bounds.Width, 540.0 / bounds.Height));
                    int width = Math.Max(1, (int)Math.Round(bounds.Width * scale));
                    int height = Math.Max(1, (int)Math.Round(bounds.Height * scale));
                    using (var target = new Bitmap(width, height, PixelFormat.Format24bppRgb))
                    using (var targetGraphics = Graphics.FromImage(target))
                    {
                        targetGraphics.InterpolationMode = InterpolationMode.HighQualityBilinear;
                        targetGraphics.DrawImage(source, 0, 0, width, height);
                        byte[] bytes = EncodeJpeg(target, 42L);
                        if (bytes.Length > 130 * 1024) bytes = EncodeJpeg(target, 24L);
                        if (bytes.Length > 130 * 1024) bytes = EncodeJpeg(target, 12L);
                        if (bytes.Length > 130 * 1024) bytes = EncodeJpeg(target, 5L);
                        if (bytes.Length > 140 * 1024) return "";
                        return "data:image/jpeg;base64," + Convert.ToBase64String(bytes);
                    }
                }
            }
            catch { return ""; }
        }

        private static byte[] EncodeJpeg(Bitmap image, long quality)
        {
            using (var stream = new MemoryStream())
            {
                var encoder = ImageCodecInfo.GetImageEncoders().First(codec => codec.MimeType == "image/jpeg");
                using (var parameters = new EncoderParameters(1))
                {
                    parameters.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, quality);
                    image.Save(stream, encoder, parameters);
                }
                return stream.ToArray();
            }
        }
    }

    internal sealed class GlobalHooks : IDisposable
    {
        private readonly Action<Point, string> click;
        private readonly Action<int> key;
        private readonly Action<Point, int> scroll;
        private Native.HookProc mouseProc;
        private Native.HookProc keyboardProc;
        private IntPtr mouseHook;
        private IntPtr keyboardHook;

        public GlobalHooks(Action<Point, string> click, Action<int> key, Action<Point, int> scroll)
        {
            this.click = click;
            this.key = key;
            this.scroll = scroll;
            mouseProc = MouseCallback;
            keyboardProc = KeyboardCallback;
        }

        public void Start()
        {
            if (mouseHook != IntPtr.Zero) return;
            using (var process = Process.GetCurrentProcess())
            using (var module = process.MainModule)
            {
                IntPtr handle = Native.GetModuleHandle(module.ModuleName);
                mouseHook = Native.SetWindowsHookEx(14, mouseProc, handle, 0);
                keyboardHook = Native.SetWindowsHookEx(13, keyboardProc, handle, 0);
            }
            if (mouseHook == IntPtr.Zero || keyboardHook == IntPtr.Zero)
            {
                Stop();
                throw new InvalidOperationException("Globale Eingabe-Hooks konnten nicht gestartet werden.");
            }
        }

        public void Stop()
        {
            if (mouseHook != IntPtr.Zero) Native.UnhookWindowsHookEx(mouseHook);
            if (keyboardHook != IntPtr.Zero) Native.UnhookWindowsHookEx(keyboardHook);
            mouseHook = IntPtr.Zero;
            keyboardHook = IntPtr.Zero;
        }

        private IntPtr MouseCallback(int code, IntPtr wParam, IntPtr lParam)
        {
            if (code >= 0)
            {
                var data = (Native.MSLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(Native.MSLLHOOKSTRUCT));
                int message = wParam.ToInt32();
                if (message == 0x0201) click(new Point(data.pt.x, data.pt.y), "left");
                else if (message == 0x0204) click(new Point(data.pt.x, data.pt.y), "right");
                else if (message == 0x0207) click(new Point(data.pt.x, data.pt.y), "middle");
                else if (message == 0x020A) scroll(new Point(data.pt.x, data.pt.y), (short)((data.mouseData >> 16) & 0xffff));
            }
            return Native.CallNextHookEx(mouseHook, code, wParam, lParam);
        }

        private IntPtr KeyboardCallback(int code, IntPtr wParam, IntPtr lParam)
        {
            if (code >= 0 && (wParam.ToInt32() == 0x0100 || wParam.ToInt32() == 0x0104))
            {
                var data = (Native.KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(Native.KBDLLHOOKSTRUCT));
                int virtualKey = (int)data.vkCode;
                bool modifier = virtualKey == 16 || virtualKey == 17 || virtualKey == 18 || virtualKey == 91 || virtualKey == 92;
                bool shortcut = Native.GetAsyncKeyState(17) < 0 || Native.GetAsyncKeyState(18) < 0 || Native.GetAsyncKeyState(91) < 0 || Native.GetAsyncKeyState(92) < 0;
                if (!modifier && !shortcut) key(virtualKey);
            }
            return Native.CallNextHookEx(keyboardHook, code, wParam, lParam);
        }

        public void Dispose() { Stop(); }
    }

    internal static class Native
    {
        internal delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);
        [StructLayout(LayoutKind.Sequential)] internal struct POINT { public int x; public int y; }
        [StructLayout(LayoutKind.Sequential)] internal struct MSLLHOOKSTRUCT { public POINT pt; public uint mouseData; public uint flags; public uint time; public IntPtr dwExtraInfo; }
        [StructLayout(LayoutKind.Sequential)] internal struct KBDLLHOOKSTRUCT { public uint vkCode; public uint scanCode; public uint flags; public uint time; public IntPtr dwExtraInfo; }

        [DllImport("user32.dll", SetLastError = true)] internal static extern IntPtr SetWindowsHookEx(int idHook, HookProc callback, IntPtr module, uint threadId);
        [DllImport("user32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool UnhookWindowsHookEx(IntPtr hook);
        [DllImport("user32.dll")] internal static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);
        [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)] internal static extern IntPtr GetModuleHandle(string moduleName);
        [DllImport("user32.dll")] internal static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] internal static extern short GetAsyncKeyState(int virtualKey);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr window, StringBuilder text, int maxCount);
        [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

        internal static string WindowTitle(IntPtr window)
        {
            var text = new StringBuilder(512);
            GetWindowText(window, text, text.Capacity);
            return text.ToString().Trim();
        }

        internal static int ProcessId(IntPtr window)
        {
            uint processId;
            GetWindowThreadProcessId(window, out processId);
            return (int)processId;
        }
    }
}
