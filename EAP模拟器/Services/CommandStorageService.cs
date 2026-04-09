using System.IO;
using System.Text.Json;
using EAP模拟器.Models;

namespace EAP模拟器.Services;

/// <summary>
/// 将命令模板以 JSON 文件持久化到磁盘。
/// </summary>
public sealed class CommandStorageService
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true
    };

    private readonly string _filePath;

    public CommandStorageService(string? directory = null)
    {
        var dir = directory ?? Path.Combine(AppContext.BaseDirectory, "Data");
        Directory.CreateDirectory(dir);
        _filePath = Path.Combine(dir, "commands.json");
    }

    public List<SecsCommandTemplate> Load()
    {
        if (!File.Exists(_filePath))
            return CreateDefaults();

        try
        {
            var json = File.ReadAllText(_filePath);
            return JsonSerializer.Deserialize<List<SecsCommandTemplate>>(json, JsonOptions)
                   ?? CreateDefaults();
        }
        catch
        {
            return CreateDefaults();
        }
    }

    public void Save(List<SecsCommandTemplate> commands)
    {
        var json = JsonSerializer.Serialize(commands, JsonOptions);
        File.WriteAllText(_filePath, json);
    }

    /// <summary>
    /// 提供一些常用的默认 SECS 命令模板。
    /// </summary>
    private static List<SecsCommandTemplate> CreateDefaults() =>
    [
        new()
        {
            Name = "Are You There",
            Stream = 1, Function = 1,
            WaitReply = true,
            SmlBody = ""
        },
        new()
        {
            Name = "Establish Communication",
            Stream = 1, Function = 13,
            WaitReply = true,
            SmlBody = "<L\n>"
        },
        new()
        {
            Name = "Remote Command",
            Stream = 2, Function = 41,
            WaitReply = true,
            SmlBody = "<L\n  <A \"START\">\n  <L\n  >\n>"
        }
    ];
}
