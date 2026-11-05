using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Effects;
using System.Windows.Threading;

namespace SpotifyRosettaOverlay
{
    internal static class Program
    {
        private const string MutexName = @"Local\SpotifyRosettaOverlayHelper";

        [STAThread]
        public static void Main(string[] args)
        {
            bool createdNew;
            using (var mutex = new Mutex(true, MutexName, out createdNew))
            {
                if (!createdNew)
                {
                    return;
                }

                NativeMethods.SetProcessDPIAware();
                var application = new Application
                {
                    ShutdownMode = ShutdownMode.OnExplicitShutdown
                };
                var debugWindow = Array.IndexOf(args, "--debug-window") >= 0;
                var window = new OverlayWindow(debugWindow);
                var server = new OverlayServer(window);
                try
                {
                    server.Start();
                    application.Run();
                }
                finally
                {
                    server.Stop();
                    window.CloseForShutdown();
                }
            }
        }
    }

    internal sealed class OverlayWindow : Window
    {
        private const int GWL_EXSTYLE = -20;
        private const int WS_EX_NOACTIVATE = 0x08000000;
        private const int WS_EX_TRANSPARENT = 0x00000020;

        private readonly List<LyricRowView> _rows = new List<LyricRowView>();
        private readonly Border _dragHandle;
        private readonly MenuItem _lockMenuItem;
        private bool _locked;
        private bool _overlayVisible;
        private int _visibleRowCount;
        private int _seekableRowCount;
        private string _activeLineText = String.Empty;

        public OverlayWindow(bool debugWindow = false)
        {
            Title = "Spotify Rosetta 桌面歌词";
            Width = 920;
            Height = 300;
            WindowStyle = WindowStyle.None;
            ResizeMode = ResizeMode.NoResize;
            AllowsTransparency = true;
            Background = Brushes.Transparent;
            ShowInTaskbar = debugWindow;
            ShowActivated = false;
            Topmost = true;
            WindowStartupLocation = WindowStartupLocation.Manual;
            Left = SystemParameters.WorkArea.Left +
                (SystemParameters.WorkArea.Width - Width) / 2;
            Top = SystemParameters.WorkArea.Bottom - Height - 96;

            var root = new Grid();
            root.Background = null;
            Content = root;

            _dragHandle = new Border
            {
                Height = 18,
                VerticalAlignment = VerticalAlignment.Top,
                Background = new SolidColorBrush(Color.FromArgb(1, 0, 0, 0)),
                Cursor = Cursors.SizeAll
            };
            _dragHandle.MouseLeftButtonDown += delegate { DragMove(); };
            root.Children.Add(_dragHandle);

            var stack = new StackPanel
            {
                VerticalAlignment = VerticalAlignment.Center,
                HorizontalAlignment = HorizontalAlignment.Stretch,
                Margin = new Thickness(28, 15, 28, 15)
            };
            root.Children.Add(stack);

            for (var index = 0; index < 4; index++)
            {
                var row = new LyricRowView(this);
                _rows.Add(row);
                stack.Children.Add(row.Container);
            }

            ContextMenu = BuildContextMenu();
            _lockMenuItem = (MenuItem)ContextMenu.Items[0];
            MouseRightButtonUp += delegate { OpenContextMenu(); };

            SourceInitialized += delegate
            {
                var handle = new System.Windows.Interop.WindowInteropHelper(this).Handle;
                var style = NativeMethods.GetWindowLong(handle, GWL_EXSTYLE);
                NativeMethods.SetWindowLong(
                    handle,
                    GWL_EXSTYLE,
                    style | WS_EX_NOACTIVATE);
            };
        }

        public void Update(OverlayMessage message)
        {
            Dispatcher.BeginInvoke(new Action(delegate
            {
                var rows = message.rows ?? new List<OverlayLine>();
                var visible = message.visible && rows.Count > 0;
                var seekableCount = 0;
                var activeText = String.Empty;
                for (var index = 0; index < rows.Count; index++)
                {
                    if (rows[index].seekable)
                    {
                        seekableCount += 1;
                    }
                    if (rows[index].active)
                    {
                        activeText = rows[index].original ?? String.Empty;
                    }
                }
                _overlayVisible = visible;
                _visibleRowCount = rows.Count;
                _seekableRowCount = seekableCount;
                _activeLineText = activeText;
                for (var index = 0; index < _rows.Count; index++)
                {
                    OverlayLine line = index < rows.Count ? rows[index] : null;
                    _rows[index].Update(line);
                }
                if (visible)
                {
                    if (!IsVisible)
                    {
                        Show();
                    }
                    Topmost = false;
                    Topmost = true;
                }
                else
                {
                    Hide();
                }
            }), DispatcherPriority.Render);
        }

        public void HideOverlay()
        {
            _overlayVisible = false;
            _visibleRowCount = 0;
            _seekableRowCount = 0;
            _activeLineText = String.Empty;
            Dispatcher.BeginInvoke(new Action(delegate
            {
                Hide();
            }), DispatcherPriority.Background);
        }

        public void CloseForShutdown()
        {
            Close();
        }

        public bool OverlayVisible
        {
            get { return _overlayVisible; }
        }

        public int VisibleRowCount
        {
            get { return _visibleRowCount; }
        }

        public int SeekableRowCount
        {
            get { return _seekableRowCount; }
        }

        public string ActiveLineText
        {
            get { return _activeLineText; }
        }

        private ContextMenu BuildContextMenu()
        {
            var menu = new ContextMenu();
            var lockItem = new MenuItem { Header = "锁定位置" };
            lockItem.Click += delegate
            {
                _locked = !_locked;
                lockItem.Header = _locked ? "解锁位置" : "锁定位置";
                ApplyLockState();
            };
            var recenter = new MenuItem { Header = "重新居中" };
            recenter.Click += delegate { Recenter(); };
            var hide = new MenuItem { Header = "隐藏歌词" };
            hide.Click += delegate { Hide(); };
            var exit = new MenuItem { Header = "退出悬浮歌词" };
            exit.Click += delegate { Application.Current.Shutdown(); };
            menu.Items.Add(lockItem);
            menu.Items.Add(recenter);
            menu.Items.Add(new Separator());
            menu.Items.Add(hide);
            menu.Items.Add(exit);
            return menu;
        }

        private void ApplyLockState()
        {
            _dragHandle.IsEnabled = !_locked;
            _dragHandle.Cursor = _locked ? Cursors.Arrow : Cursors.SizeAll;
        }

        private void Recenter()
        {
            Left = SystemParameters.WorkArea.Left +
                (SystemParameters.WorkArea.Width - Width) / 2;
            Top = SystemParameters.WorkArea.Bottom - Height - 96;
        }

        private void OpenContextMenu()
        {
            ContextMenu.PlacementTarget = this;
            ContextMenu.IsOpen = true;
        }

        public void QueueSeek(long startMs)
        {
            Dispatcher.BeginInvoke(new Action(delegate
            {
                var server = OverlayServer.Current;
                if (server != null)
                {
                    server.QueueSeek(startMs);
                }
            }), DispatcherPriority.Background);
        }

        private sealed class LyricRowView
        {
            private readonly OverlayWindow _window;
            private readonly TextBlock _original;
            private readonly TextBlock _translation;
            private long? _startMs;

            public LyricRowView(OverlayWindow window)
            {
                _window = window;
                _original = CreateTextBlock(22, FontWeights.Bold, Brushes.White);
                _translation = CreateTextBlock(14, FontWeights.Normal, Brushes.White);
                _translation.Margin = new Thickness(0, 3, 0, 0);
                _translation.Opacity = 0.82;

                var stack = new StackPanel();
                stack.Children.Add(_original);
                stack.Children.Add(_translation);
                Container = new Border
                {
                    Background = new SolidColorBrush(Color.FromArgb(1, 0, 0, 0)),
                    Padding = new Thickness(2, 7, 2, 7),
                    Child = stack,
                    Cursor = Cursors.Arrow
                };
                Container.MouseLeftButtonUp += OnMouseLeftButtonUp;
            }

            public Border Container { get; private set; }

            public void Update(OverlayLine line)
            {
                var hasOriginal = line != null && !String.IsNullOrWhiteSpace(line.original);
                var hasTranslation =
                    line != null && !String.IsNullOrWhiteSpace(line.translation);
                Container.Visibility =
                    hasOriginal || hasTranslation ? Visibility.Visible : Visibility.Collapsed;
                _original.Text = hasOriginal ? line.original.Trim() : String.Empty;
                _translation.Text =
                    hasTranslation ? line.translation.Trim() : String.Empty;
                _translation.Visibility =
                    hasTranslation ? Visibility.Visible : Visibility.Collapsed;

                var active = line != null && line.active;
                var color = active
                    ? new SolidColorBrush(Color.FromRgb(255, 64, 86))
                    : Brushes.White;
                _original.Foreground = color;
                _translation.Foreground = color;
                _startMs = line != null && line.seekable
                    ? (long?)line.startMs
                    : null;
                Container.Cursor = _startMs.HasValue ? Cursors.Hand : Cursors.Arrow;
            }

            private static TextBlock CreateTextBlock(
                double fontSize,
                FontWeight fontWeight,
                Brush color)
            {
                return new TextBlock
                {
                    FontFamily = new FontFamily("Spotify Mix, CircularSp, Segoe UI"),
                    FontSize = fontSize,
                    FontWeight = fontWeight,
                    Foreground = color,
                    TextWrapping = TextWrapping.Wrap,
                    TextAlignment = TextAlignment.Center,
                    HorizontalAlignment = HorizontalAlignment.Stretch,
                    Effect = new DropShadowEffect
                    {
                        BlurRadius = 10,
                        ShadowDepth = 0,
                        Opacity = 0.95,
                        Color = Colors.Black
                    }
                };
            }

            private void OnMouseLeftButtonUp(
                object sender,
                MouseButtonEventArgs e)
            {
                if (_startMs.HasValue)
                {
                    _window.QueueSeek(_startMs.Value);
                    e.Handled = true;
                }
            }
        }
    }

    internal sealed class OverlayServer
    {
        public static OverlayServer Current;

        private const int Port = 18573;
        private const string AllowedOrigin = "https://xpui.app.spotify.com";
        private readonly OverlayWindow _window;
        private readonly TcpListener _listener;
        private readonly Queue<long> _seekEvents = new Queue<long>();
        private readonly object _eventLock = new object();
        private readonly string _token;
        private volatile bool _stopping;
        private long _lastSeekStartMs = -1;
        private Thread _acceptThread;

        public OverlayServer(OverlayWindow window)
        {
            _window = window;
            _token = Guid.NewGuid().ToString("N");
            _listener = new TcpListener(IPAddress.Loopback, Port);
        }

        public void Start()
        {
            Current = this;
            _listener.Start();
            _acceptThread = new Thread(AcceptLoop);
            _acceptThread.IsBackground = true;
            _acceptThread.Name = "Spotify Rosetta overlay server";
            _acceptThread.Start();
        }

        public void Stop()
        {
            _stopping = true;
            try
            {
                _listener.Stop();
            }
            catch
            {
            }
            Current = null;
        }

        public void QueueSeek(long startMs)
        {
            lock (_eventLock)
            {
                _lastSeekStartMs = startMs;
                _seekEvents.Enqueue(startMs);
            }
        }

        private void AcceptLoop()
        {
            while (!_stopping)
            {
                try
                {
                    var client = _listener.AcceptTcpClient();
                    ThreadPool.QueueUserWorkItem(HandleClient, client);
                }
                catch (SocketException)
                {
                    if (_stopping)
                    {
                        return;
                    }
                }
                catch
                {
                    if (_stopping)
                    {
                        return;
                    }
                }
            }
        }

        private void HandleClient(object state)
        {
            var client = state as TcpClient;
            if (client == null)
            {
                return;
            }

            using (client)
            {
                try
                {
                    client.ReceiveTimeout = 4000;
                    client.SendTimeout = 4000;
                    using (var stream = client.GetStream())
                    {
                        var request = ReadRequest(stream);
                        HandleRequest(stream, request);
                    }
                }
                catch
                {
                }
            }
        }

        private void HandleRequest(NetworkStream stream, HttpRequest request)
        {
            var origin = request.Headers.ContainsKey("Origin")
                ? request.Headers["Origin"]
                : String.Empty;
            if (!String.Equals(origin, AllowedOrigin, StringComparison.OrdinalIgnoreCase))
            {
                WriteResponse(stream, 403, "Forbidden", "application/json",
                    "{\"error\":\"origin\"}", origin);
                return;
            }

            if (String.Equals(request.Method, "OPTIONS", StringComparison.Ordinal))
            {
                WriteResponse(stream, 204, "No Content", "text/plain",
                    String.Empty, origin);
                return;
            }

            if (String.Equals(request.Path, "/health", StringComparison.Ordinal) &&
                String.Equals(request.Method, "GET", StringComparison.Ordinal))
            {
                var body = "{\"version\":1,\"token\":\"" + _token + "\"}";
                WriteResponse(stream, 200, "OK", "application/json", body, origin);
                return;
            }

            var suppliedToken = request.Headers.ContainsKey("X-Rosetta-Token")
                ? request.Headers["X-Rosetta-Token"]
                : String.Empty;
            if (!String.Equals(suppliedToken, _token, StringComparison.Ordinal))
            {
                WriteResponse(stream, 401, "Unauthorized", "application/json",
                    "{\"error\":\"token\"}", origin);
                return;
            }

            if (String.Equals(request.Path, "/state", StringComparison.Ordinal) &&
                String.Equals(request.Method, "POST", StringComparison.Ordinal))
            {
                var serializer = new JavaScriptSerializer();
                var message = serializer.Deserialize<OverlayMessage>(
                    request.Body ?? "{}");
                _window.Update(message);
                WriteResponse(stream, 204, "No Content", "text/plain",
                    String.Empty, origin);
                return;
            }

            if (String.Equals(request.Path, "/events", StringComparison.Ordinal) &&
                String.Equals(request.Method, "GET", StringComparison.Ordinal))
            {
                string body = "{\"type\":\"none\"}";
                lock (_eventLock)
                {
                    if (_seekEvents.Count > 0)
                    {
                        body = "{\"type\":\"seek\",\"startMs\":" +
                            _seekEvents.Dequeue().ToString(CultureInfo.InvariantCulture) +
                            "}";
                    }
                }
                WriteResponse(stream, 200, "OK", "application/json", body, origin);
                return;
            }

            if (String.Equals(request.Path, "/status", StringComparison.Ordinal) &&
                String.Equals(request.Method, "GET", StringComparison.Ordinal))
            {
                var status = new Dictionary<string, object>
                {
                    { "visible", _window.OverlayVisible },
                    { "rows", _window.VisibleRowCount },
                    { "seekable", _window.SeekableRowCount },
                    { "active", _window.ActiveLineText },
                    { "lastSeekStartMs", _lastSeekStartMs }
                };
                var body = new JavaScriptSerializer().Serialize(status);
                WriteResponse(stream, 200, "OK", "application/json", body, origin);
                return;
            }

            if (String.Equals(request.Path, "/hide", StringComparison.Ordinal) &&
                String.Equals(request.Method, "POST", StringComparison.Ordinal))
            {
                _window.HideOverlay();
                WriteResponse(stream, 204, "No Content", "text/plain",
                    String.Empty, origin);
                return;
            }

            if (String.Equals(request.Path, "/shutdown", StringComparison.Ordinal) &&
                String.Equals(request.Method, "POST", StringComparison.Ordinal))
            {
                WriteResponse(stream, 204, "No Content", "text/plain",
                    String.Empty, origin);
                _window.Dispatcher.BeginInvoke(new Action(delegate
                {
                    Application.Current.Shutdown();
                }), DispatcherPriority.Background);
                return;
            }

            WriteResponse(stream, 404, "Not Found", "application/json",
                "{\"error\":\"not_found\"}", origin);
        }

        private static HttpRequest ReadRequest(NetworkStream stream)
        {
            const int maxHeaderBytes = 64 * 1024;
            var buffer = new byte[maxHeaderBytes];
            var used = 0;
            var headerEnd = -1;
            while (used < buffer.Length)
            {
                var read = stream.Read(buffer, used, buffer.Length - used);
                if (read <= 0)
                {
                    break;
                }
                used += read;
                headerEnd = FindHeaderEnd(buffer, used);
                if (headerEnd >= 0)
                {
                    break;
                }
            }
            if (headerEnd < 0)
            {
                throw new InvalidDataException("Invalid HTTP headers.");
            }

            var headerText = Encoding.ASCII.GetString(buffer, 0, headerEnd);
            var lines = headerText.Split(new[] { "\r\n" },
                StringSplitOptions.RemoveEmptyEntries);
            var requestLine = lines.Length > 0
                ? lines[0].Split(' ')
                : new string[0];
            if (requestLine.Length < 2)
            {
                throw new InvalidDataException("Invalid request line.");
            }

            var headers = new Dictionary<string, string>(
                StringComparer.OrdinalIgnoreCase);
            for (var index = 1; index < lines.Length; index++)
            {
                var separator = lines[index].IndexOf(':');
                if (separator <= 0)
                {
                    continue;
                }
                headers[lines[index].Substring(0, separator).Trim()] =
                    lines[index].Substring(separator + 1).Trim();
            }

            var contentLength = 0;
            string lengthText;
            if (headers.TryGetValue("Content-Length", out lengthText))
            {
                Int32.TryParse(lengthText, out contentLength);
            }
            contentLength = Math.Max(0, Math.Min(contentLength, 1024 * 1024));

            var bodyBytes = new byte[contentLength];
            var alreadyRead = Math.Max(0, used - (headerEnd + 4));
            if (alreadyRead > 0)
            {
                Buffer.BlockCopy(
                    buffer,
                    headerEnd + 4,
                    bodyBytes,
                    0,
                    Math.Min(alreadyRead, bodyBytes.Length));
            }
            var bodyOffset = Math.Min(alreadyRead, contentLength);
            while (bodyOffset < contentLength)
            {
                var read = stream.Read(
                    bodyBytes,
                    bodyOffset,
                    contentLength - bodyOffset);
                if (read <= 0)
                {
                    break;
                }
                bodyOffset += read;
            }

            return new HttpRequest
            {
                Method = requestLine[0],
                Path = requestLine[1].Split('?')[0],
                Headers = headers,
                Body = Encoding.UTF8.GetString(bodyBytes)
            };
        }

        private static int FindHeaderEnd(byte[] buffer, int count)
        {
            for (var index = 0; index <= count - 4; index++)
            {
                if (buffer[index] == 13 &&
                    buffer[index + 1] == 10 &&
                    buffer[index + 2] == 13 &&
                    buffer[index + 3] == 10)
                {
                    return index;
                }
            }
            return -1;
        }

        private static void WriteResponse(
            NetworkStream stream,
            int statusCode,
            string statusText,
            string contentType,
            string body,
            string origin)
        {
            var bodyBytes = Encoding.UTF8.GetBytes(body ?? String.Empty);
            var response = new StringBuilder();
            response.Append("HTTP/1.1 ")
                .Append(statusCode)
                .Append(' ')
                .Append(statusText)
                .Append("\r\n");
            response.Append("Content-Type: ")
                .Append(contentType)
                .Append("; charset=utf-8\r\n");
            response.Append("Content-Length: ")
                .Append(bodyBytes.Length)
                .Append("\r\n");
            response.Append("Connection: close\r\n");
            response.Append("Access-Control-Allow-Origin: ")
                .Append(origin)
                .Append("\r\n");
            response.Append("Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n");
            response.Append(
                "Access-Control-Allow-Headers: Content-Type, X-Rosetta-Token\r\n");
            response.Append("Access-Control-Max-Age: 600\r\n");
            response.Append("Access-Control-Allow-Private-Network: true\r\n");
            response.Append("Cache-Control: no-store\r\n\r\n");
            var headerBytes = Encoding.ASCII.GetBytes(response.ToString());
            stream.Write(headerBytes, 0, headerBytes.Length);
            if (bodyBytes.Length > 0)
            {
                stream.Write(bodyBytes, 0, bodyBytes.Length);
            }
        }

        private sealed class HttpRequest
        {
            public string Method;
            public string Path;
            public Dictionary<string, string> Headers;
            public string Body;
        }
    }

    internal sealed class OverlayMessage
    {
        public string type { get; set; }
        public bool visible { get; set; }
        public List<OverlayLine> rows { get; set; }
    }

    internal sealed class OverlayLine
    {
        public string original { get; set; }
        public string translation { get; set; }
        public bool active { get; set; }
        public bool seekable { get; set; }
        public long startMs { get; set; }
    }

    internal static class NativeMethods
    {
        [DllImport("user32.dll")]
        public static extern bool SetProcessDPIAware();

        [DllImport("user32.dll")]
        public static extern int GetWindowLong(IntPtr window, int index);

        [DllImport("user32.dll")]
        public static extern int SetWindowLong(
            IntPtr window,
            int index,
            int value);
    }
}
