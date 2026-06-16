using System.Text;

namespace EAP模拟器.Services;

/// <summary>
/// 将通信日志按天滚动写入文件（默认目录为程序目录下的 Logs）。
/// </summary>
public sealed class LogFileService : IDisposable
{
    private readonly string _logDir;
    private readonly object _lock = new();
    private StreamWriter? _writer;
    private DateOnly _currentDay;

    /// <summary>日志输出目录的绝对路径。</summary>
    public string LogDirectory => _logDir;

    public LogFileService(string? directory = null)
    {
        _logDir = directory ?? Path.Combine(AppContext.BaseDirectory, "Logs");
        Directory.CreateDirectory(_logDir);
    }

    /// <summary>追加一行日志（线程安全），按日期自动切换文件。</summary>
    public void Write(string line)
    {
        lock (_lock)
        {
            try
            {
                var today = DateOnly.FromDateTime(DateTime.Now);
                if (_writer is null || today != _currentDay)
                {
                    _writer?.Dispose();
                    _currentDay = today;
                    var path = Path.Combine(_logDir, $"comm-{today:yyyyMMdd}.log");
                    _writer = new StreamWriter(path, append: true, Encoding.UTF8) { AutoFlush = true };
                }

                _writer.WriteLine(line);
            }
            catch
            {
                /* 写文件失败不应影响界面日志 */
            }
        }
    }

    public void Dispose()
    {
        lock (_lock)
        {
            _writer?.Dispose();
            _writer = null;
        }
    }
}
