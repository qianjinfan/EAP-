using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Xml.Linq;
using EAP模拟器.Models;
using EAP模拟器.Services;
using ClosedXML.Excel;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Secs4Net;
using Secs4Net.Sml;

namespace EAP模拟器;

/// <summary>
/// 通过 WebView2 与页面 JSON 消息通信，桥接存储与 SECS 客户端。
/// </summary>
public sealed class WebAppBridge : IAsyncDisposable
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        WriteIndented = false,
    };

    private readonly WebView2 _web;
    private readonly ProjectStorageService _projects = new();
    private readonly SecsClientService _secs = new();
    private readonly LogFileService _logFile = new();
    private CoreWebView2? _core;
    private bool _initialized;

    public WebAppBridge(WebView2 webView)
    {
        _web = webView;
    }

    public async Task InitializeAsync()
    {
        if (_initialized) return;

        await _web.EnsureCoreWebView2Async();
        _core = _web.CoreWebView2;
        _core.WebMessageReceived += OnWebMessageReceived;

        _secs.LogMessage += line =>
        {
            _logFile.Write(line);
            PostEvent("log", new { line });
        };
        _secs.ConnectionStateChanged += state =>
        {
            var connected = state == ConnectionState.Selected;
            PostEvent("connection", new { connected, state = state.ToString() });
        };

        var webUi = Path.Combine(AppContext.BaseDirectory, "WebUi");
        if (!Directory.Exists(webUi))
            throw new DirectoryNotFoundException($"未找到 WebUi 目录: {webUi}");

        _core.SetVirtualHostNameToFolderMapping(
            "app.local",
            webUi,
            CoreWebView2HostResourceAccessKind.Allow);

        _initialized = true;
        _core.Navigate("https://app.local/index.html");
    }

    private void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        _ = HandleMessageAsync(e);
    }

    private async Task HandleMessageAsync(CoreWebView2WebMessageReceivedEventArgs e)
    {
        var id = 0;
        try
        {
            var json = e.WebMessageAsJson;
            // 若脚本误用 postMessage(JSON.stringify(obj))，根节点会是 JSON 字符串，需再解析一层
            using (var outer = JsonDocument.Parse(json))
            {
                var r = outer.RootElement;
                if (r.ValueKind == JsonValueKind.String)
                    json = r.GetString() ?? "{}";
            }

            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (root.GetProperty("type").GetString() != "call")
                return;

            id = root.GetProperty("id").GetInt32();
            var method = root.GetProperty("method").GetString() ?? "";
            var prm = root.TryGetProperty("params", out var p) ? p : default;

            switch (method)
            {
                case "getLogDir":
                    PostReply(id, true, new { dir = _logFile.LogDirectory }, null);
                    break;

                case "openLogDir":
                    try
                    {
                        var dir = _logFile.LogDirectory;
                        Directory.CreateDirectory(dir);
                        System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
                        {
                            FileName = dir,
                            UseShellExecute = true,
                        });
                        PostReply(id, true, new { }, null);
                    }
                    catch (Exception ex)
                    {
                        PostReply(id, false, null, ex.Message);
                    }
                    break;

                case "getWorkspace":
                    {
                        var ws = _projects.Load();
                        PostReply(id, true, new { workspace = ws }, null);
                    }
                    break;

                case "setWorkspace":
                    {
                        if (!prm.TryGetProperty("workspace", out var wsEl))
                        {
                            PostReply(id, false, null, "缺少 workspace");
                            break;
                        }
                        var ws = wsEl.Deserialize<SimulatorWorkspace>(JsonOpts);
                        if (ws is null || ws.Projects.Count == 0)
                        {
                            PostReply(id, false, null, "无效工作区");
                            break;
                        }
                        if (ws.Projects.All(p => p.Id != ws.CurrentProjectId))
                            ws.CurrentProjectId = ws.Projects[0].Id;
                        _projects.Save(ws);
                        PostReply(id, true, null, null);
                    }
                    break;

                case "importExcel":
                    {
                        if (!prm.TryGetProperty("projectId", out var pidEl) || !Guid.TryParse(pidEl.GetString(), out var pid))
                        {
                            PostReply(id, false, null, "缺少或无效 projectId");
                            break;
                        }
                        var fileName = prm.TryGetProperty("fileName", out var fnEl) ? (fnEl.GetString() ?? "") : "";
                        if (!prm.TryGetProperty("contentBase64", out var b64El))
                        {
                            PostReply(id, false, null, "缺少 contentBase64");
                            break;
                        }
                        var base64 = b64El.GetString() ?? "";
                        byte[] bytes;
                        try
                        {
                            bytes = Convert.FromBase64String(base64);
                        }
                        catch
                        {
                            PostReply(id, false, null, "Excel 内容不是有效的 Base64");
                            break;
                        }

                        try
                        {
                            var ws = _projects.Load();
                            var proj = ws.Projects.FirstOrDefault(p => p.Id == pid);
                            if (proj is null)
                            {
                                PostReply(id, false, null, "未找到项目");
                                break;
                            }

                            proj.ExcelSheet = ParseFirstSheet(bytes, fileName);
                            _projects.Save(ws);
                            PostReply(id, true, new { workspace = ws }, null);
                        }
                        catch (Exception ex)
                        {
                            PostReply(id, false, null, ex.Message);
                        }
                    }
                    break;

                case "connect":
                    {
                        var ip = prm.GetProperty("ip").GetString() ?? "";
                        if (!prm.TryGetProperty("port", out var portEl) || !portEl.TryGetInt32(out var port))
                        {
                            PostReply(id, false, null, "无效端口");
                            break;
                        }
                        if (!prm.TryGetProperty("deviceId", out var devEl) || !devEl.TryGetInt32(out var devInt) || devInt < 0 || devInt > ushort.MaxValue)
                        {
                            PostReply(id, false, null, "无效 DeviceID");
                            break;
                        }
                        var active = prm.TryGetProperty("active", out var a) && a.GetBoolean();
                        try
                        {
                            await _secs.ConnectAsync(ip, port, (ushort)devInt, active).ConfigureAwait(true);
                            PostReply(id, true, new { }, null);
                        }
                        catch (Exception ex)
                        {
                            PostReply(id, false, null, ex.Message);
                        }
                    }
                    break;

                case "disconnect":
                    await _secs.DisconnectAsync().ConfigureAwait(true);
                    PostReply(id, true, new { }, null);
                    break;

                case "getAutoReplyRules":
                    PostReply(id, true, new
                    {
                        enabled = _secs.AutoReplyEnabled,
                        rules = CommandResponder.Rules.Select(r => new
                        {
                            name = r.Name,
                            primary = $"S{r.PrimaryStream}F{r.PrimaryFunction}",
                            reply = $"S{r.ReplyStream}F{r.ReplyFunction}",
                            description = r.Description,
                        }),
                    }, null);
                    break;

                case "setAutoReply":
                    _secs.AutoReplyEnabled = !prm.TryGetProperty("enabled", out var enEl) || enEl.GetBoolean();
                    PostReply(id, true, new { enabled = _secs.AutoReplyEnabled }, null);
                    break;

                case "send":
                    {
                        if (!_secs.IsConnected)
                        {
                            PostReply(id, false, null, "未连接");
                            break;
                        }
                        if (!prm.TryGetProperty("stream", out var sEl) || !sEl.TryGetInt32(out var si) || si is < 0 or > 127 ||
                            !prm.TryGetProperty("function", out var fEl) || !fEl.TryGetInt32(out var fi) || fi is < 0 or > 255)
                        {
                            PostReply(id, false, null, "无效 Stream/Function");
                            break;
                        }
                        var s = (byte)si;
                        var f = (byte)fi;
                        var wait = !prm.TryGetProperty("waitReply", out var w) || w.GetBoolean();
                        var smlBody = prm.TryGetProperty("smlBody", out var sb) ? (sb.GetString() ?? "") : "";

                        try
                        {
                            SecsMessage msg;
                            if (string.IsNullOrWhiteSpace(smlBody))
                                msg = new SecsMessage(s, f, replyExpected: wait);
                            else
                            {
                                // Secs4Net.Sml.SmlReader 要求首行为 'SxFy' [W]（带单引号）；原先拼成 SxFy 会导致解析越界异常。
                                var body = smlBody.Trim();
                                while (body.EndsWith('.'))
                                    body = body[..^1].TrimEnd();
                                var header = wait ? $"'S{s}F{f}' W" : $"'S{s}F{f}'";
                                var sml = string.IsNullOrEmpty(body)
                                    ? $"{header}\n."
                                    : $"{header}\n{body}\n.";
                                msg = SmlReader.ToSecsMessage(sml);
                            }

                            var reply = await _secs.SendAsync(msg).ConfigureAwait(true);
                            PostReply(id, true, new
                            {
                                reply = reply is null
                                    ? null
                                    : new { stream = (int)reply.S, function = (int)reply.F },
                            }, null);
                        }
                        catch (Exception ex)
                        {
                            PostReply(id, false, null, ex.Message);
                        }
                    }
                    break;

                case "mesRequest":
                    await HandleMesRequestAsync(id, prm).ConfigureAwait(true);
                    break;

                default:
                    PostReply(id, false, null, $"未知方法: {method}");
                    break;
            }
        }
        catch (Exception ex)
        {
            PostReply(id, false, null, ex.Message);
        }
    }

    /// <summary>共享 HttpClient，避免频繁创建导致的 socket 耗尽；超时通过 CancellationToken 单独控制。</summary>
    private static readonly HttpClient MesHttp = new(new HttpClientHandler
    {
        // MES 测试环境常用自签名证书，这里放宽校验，仅用于内网调试工具。
        ServerCertificateCustomValidationCallback = HttpClientHandler.DangerousAcceptAnyServerCertificateValidator,
    });

    /// <summary>
    /// 通用 HTTP/SOAP 接口测试：支持 GET/POST、自定义请求头、查询参数、请求体，并可解析 SOAP 返回值。
    /// </summary>
    private async Task HandleMesRequestAsync(int id, JsonElement prm)
    {
        var httpMethod = (prm.TryGetProperty("httpMethod", out var mEl) ? mEl.GetString() : "POST") ?? "POST";
        var url = prm.TryGetProperty("url", out var uEl) ? (uEl.GetString() ?? "").Trim() : "";
        var body = prm.TryGetProperty("body", out var bEl) ? (bEl.GetString() ?? "") : "";
        var contentType = prm.TryGetProperty("contentType", out var ctEl) ? (ctEl.GetString() ?? "text/xml") : "text/xml";
        if (string.IsNullOrWhiteSpace(contentType)) contentType = "text/xml";
        var timeoutSec = prm.TryGetProperty("timeoutSec", out var tEl) && tEl.TryGetInt32(out var ts) && ts > 0 ? ts : 10;
        var resultTag = prm.TryGetProperty("resultTag", out var rtEl) ? (rtEl.GetString() ?? "").Trim() : "";
        var parseMode = prm.TryGetProperty("parseMode", out var pmEl) ? (pmEl.GetString() ?? "soap").Trim() : "soap";

        if (string.IsNullOrWhiteSpace(url))
        {
            PostReply(id, false, null, "URL 不能为空");
            return;
        }

        var isGet = httpMethod.Equals("GET", StringComparison.OrdinalIgnoreCase);

        // 查询参数：GET 时拼接到 URL
        if (prm.TryGetProperty("queryParams", out var qEl) && qEl.ValueKind == JsonValueKind.Array)
        {
            var parts = new List<string>();
            foreach (var q in qEl.EnumerateArray())
            {
                var k = q.TryGetProperty("key", out var kk) ? (kk.GetString() ?? "").Trim() : "";
                if (string.IsNullOrEmpty(k)) continue;
                var v = q.TryGetProperty("value", out var vv) ? (vv.GetString() ?? "") : "";
                parts.Add($"{Uri.EscapeDataString(k)}={Uri.EscapeDataString(v)}");
            }
            if (parts.Count > 0)
                url += (url.Contains('?') ? "&" : "?") + string.Join("&", parts);
        }

        using var request = new HttpRequestMessage(isGet ? HttpMethod.Get : HttpMethod.Post, url);

        if (prm.TryGetProperty("headers", out var hEl) && hEl.ValueKind == JsonValueKind.Array)
        {
            foreach (var h in hEl.EnumerateArray())
            {
                var k = h.TryGetProperty("key", out var kk) ? (kk.GetString() ?? "").Trim() : "";
                if (string.IsNullOrEmpty(k)) continue;
                var v = h.TryGetProperty("value", out var vv) ? (vv.GetString() ?? "") : "";
                // Content-Type 交给 StringContent 设置，避免与实体头冲突
                if (k.Equals("Content-Type", StringComparison.OrdinalIgnoreCase))
                {
                    contentType = v;
                    continue;
                }
                request.Headers.TryAddWithoutValidation(k, v);
            }
        }

        if (!isGet && !string.IsNullOrEmpty(body))
            request.Content = new StringContent(body, Encoding.UTF8, contentType);

        _logFile.Write($"[MES] -> {httpMethod} {url}");

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(timeoutSec));
        var sw = Stopwatch.StartNew();
        try
        {
            using var resp = await MesHttp.SendAsync(request, cts.Token).ConfigureAwait(true);
            var text = await resp.Content.ReadAsStringAsync(cts.Token).ConfigureAwait(true);
            sw.Stop();

            string? parsed = null;
            string? parseError = null;
            if (parseMode != "none" && !string.IsNullOrEmpty(text))
            {
                try
                {
                    parsed = parseMode == "json"
                        ? ExtractJsonResult(text)
                        : ExtractSoapResult(text, resultTag);
                }
                catch (Exception ex)
                {
                    parseError = ex.Message;
                }
            }

            _logFile.Write($"[MES] <- HTTP {(int)resp.StatusCode} ({sw.ElapsedMilliseconds}ms)");
            PostReply(id, true, new
            {
                status = (int)resp.StatusCode,
                ok = resp.IsSuccessStatusCode,
                elapsedMs = sw.ElapsedMilliseconds,
                body = text,
                parsed,
                parseError,
            }, null);
        }
        catch (OperationCanceledException)
        {
            sw.Stop();
            _logFile.Write($"[MES] [ERROR] 请求超时 (>{timeoutSec}s)");
            PostReply(id, false, null, $"请求超时（超过 {timeoutSec} 秒）");
        }
        catch (Exception ex)
        {
            sw.Stop();
            _logFile.Write($"[MES] [ERROR] {ex.Message}");
            PostReply(id, false, null, ex.Message);
        }
    }

    /// <summary>
    /// 从 SOAP/XML 响应中提取返回值：优先取指定的结果节点（如 TestMachineCallProCP3Result），
    /// 否则回退取 SOAP Body 下第一个包含文本的叶子节点。
    /// </summary>
    private static string? ExtractSoapResult(string responseXml, string resultTag)
    {
        var doc = XDocument.Parse(responseXml);

        if (!string.IsNullOrEmpty(resultTag))
        {
            var byTag = doc.Descendants().FirstOrDefault(e => e.Name.LocalName == resultTag);
            if (byTag is not null) return byTag.Value;
        }

        // 约定：WebService 方法返回节点通常以 Result 结尾
        var byResult = doc.Descendants().FirstOrDefault(e => e.Name.LocalName.EndsWith("Result", StringComparison.Ordinal));
        if (byResult is not null) return byResult.Value;

        return null;
    }

    /// <summary>
    /// 从 REST JSON 响应中提取关键字段：优先 resultData，其次 result / data / message，
    /// 都找不到则返回整段 JSON 文本，便于查看。
    /// </summary>
    private static string? ExtractJsonResult(string responseJson)
    {
        using var doc = JsonDocument.Parse(responseJson);
        foreach (var key in new[] { "resultData", "result", "data", "message" })
        {
            if (TryFindJsonProperty(doc.RootElement, key, out var found))
                return found.ValueKind == JsonValueKind.String ? found.GetString() : found.GetRawText();
        }
        return responseJson.Trim();
    }

    /// <summary>不区分大小写地在 JSON 树中递归查找首个匹配的属性。</summary>
    private static bool TryFindJsonProperty(JsonElement element, string name, out JsonElement value)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            foreach (var p in element.EnumerateObject())
            {
                if (string.Equals(p.Name, name, StringComparison.OrdinalIgnoreCase))
                {
                    value = p.Value;
                    return true;
                }
                if (TryFindJsonProperty(p.Value, name, out value))
                    return true;
            }
        }
        else if (element.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in element.EnumerateArray())
                if (TryFindJsonProperty(item, name, out value))
                    return true;
        }
        value = default;
        return false;
    }

    private static ExcelSequenceSheet ParseFirstSheet(byte[] bytes, string fileName)
    {
        using var ms = new MemoryStream(bytes);
        using var wb = new XLWorkbook(ms);
        var ws = wb.Worksheets.First();

        var sheet = new ExcelSequenceSheet
        {
            FileName = string.IsNullOrWhiteSpace(fileName) ? ws.Name : fileName.Trim(),
            ImportedAt = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
        };

        var range = ws.RangeUsed();
        if (range is null) return sheet;

        // 根据你的约定：
        // - B 列：>>> 行表示发送内容（每行一条）
        // - E 列：<<< 行表示期望接收内容
        // 这里保留 A/B/D/E/F/G 以及方向箭头，方便后续生成流程。
        var firstRow = range.FirstRow().RowNumber();
        var lastRow = range.LastRow().RowNumber();

        for (var r = firstRow; r <= lastRow; r++)
        {
            var dir = (ws.Cell(r, 3).GetString() ?? "").Trim(); // C 列
            var a = (ws.Cell(r, 1).GetString() ?? "").Trim();
            var b = (ws.Cell(r, 2).GetString() ?? "").Trim();
            var d = (ws.Cell(r, 4).GetString() ?? "").Trim();
            var e = (ws.Cell(r, 5).GetString() ?? "").Trim();
            var f = (ws.Cell(r, 6).GetString() ?? "").Trim();
            var g = (ws.Cell(r, 7).GetString() ?? "").Trim();

            // 跳过完全空行
            if (string.IsNullOrWhiteSpace(a) &&
                string.IsNullOrWhiteSpace(dir) &&
                string.IsNullOrWhiteSpace(b) &&
                string.IsNullOrWhiteSpace(d) &&
                string.IsNullOrWhiteSpace(e) &&
                string.IsNullOrWhiteSpace(f) &&
                string.IsNullOrWhiteSpace(g))
                continue;

            // 只保留 >>> / <<<；其他内容（标题/分隔）方向留空但也可展示
            if (dir != ">>>" && dir != "<<<") dir = string.Empty;

            sheet.Rows.Add(new ExcelSequenceRow
            {
                ExcelRow = r,
                A = a,
                Direction = dir,
                B = b,
                D = d,
                E = e,
                F = f,
                G = g,
            });
        }

        return sheet;
    }

    private void PostReply(int id, bool ok, object? result, string? error)
    {
        string json;
        if (ok && result is not null)
            json = JsonSerializer.Serialize(new { type = "reply", id, ok = true, result }, JsonOpts);
        else if (ok)
            json = JsonSerializer.Serialize(new { type = "reply", id, ok = true }, JsonOpts);
        else
            json = JsonSerializer.Serialize(new { type = "reply", id, ok = false, error }, JsonOpts);

        PostJsonString(json);
    }

    private void PostEvent(string name, object payload)
    {
        var json = JsonSerializer.Serialize(new { type = "event", name, payload }, JsonOpts);
        PostJsonString(json);
    }

    private void PostJsonString(string json)
    {
        void Post()
        {
            if (_core is null) return;
            try
            {
                _core.PostWebMessageAsJson(json);
            }
            catch
            {
                /* 窗体关闭过程中可能失败 */
            }
        }

        if (_web.InvokeRequired)
            _web.BeginInvoke(Post);
        else
            Post();
    }

    public async ValueTask DisposeAsync()
    {
        if (_core is not null)
            _core.WebMessageReceived -= OnWebMessageReceived;
        await _secs.DisposeAsync();
        _logFile.Dispose();
    }
}
