using System.Text.Json;
using System.Text.Json.Serialization;
using EAP模拟器.Models;

namespace EAP模拟器.Services;

/// <summary>
/// 将多项目工作区持久化到 workspace.json，并从旧的 commands.json 迁移。
/// </summary>
public sealed class ProjectStorageService
{
    private static readonly JsonSerializerOptions ReadWriteOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private static readonly JsonSerializerOptions LegacyCommandFileOptions = new()
    {
        WriteIndented = true,
    };

    private readonly string _dataDir;
    private readonly string _workspacePath;
    private readonly string _legacyCommandsPath;

    public ProjectStorageService(string? directory = null)
    {
        _dataDir = directory ?? Path.Combine(AppContext.BaseDirectory, "Data");
        Directory.CreateDirectory(_dataDir);
        _workspacePath = Path.Combine(_dataDir, "workspace.json");
        _legacyCommandsPath = Path.Combine(_dataDir, "commands.json");
    }

    public SimulatorWorkspace Load()
    {
        if (File.Exists(_workspacePath))
        {
            try
            {
                var json = File.ReadAllText(_workspacePath);
                var ws = JsonSerializer.Deserialize<SimulatorWorkspace>(json, ReadWriteOptions);
                if (ws is not null && ws.Projects.Count > 0)
                {
                    if (ws.Projects.All(p => p.Id != ws.CurrentProjectId))
                        ws.CurrentProjectId = ws.Projects[0].Id;
                    EnsureIds(ws);
                    return ws;
                }
            }
            catch
            {
                /* fall through */
            }
        }

        if (File.Exists(_legacyCommandsPath))
        {
            try
            {
                var json = File.ReadAllText(_legacyCommandsPath);
                var cmds = JsonSerializer.Deserialize<List<SecsCommandTemplate>>(json, LegacyCommandFileOptions)
                           ?? [];
                var proj = new SimulatorProject
                {
                    Name = "默认项目",
                    Commands = cmds.Count > 0 ? cmds : CreateDefaultCommands(),
                };
                var legacyWs = new SimulatorWorkspace
                {
                    Projects = [proj],
                    CurrentProjectId = proj.Id,
                };
                EnsureIds(legacyWs);
                return legacyWs;
            }
            catch
            {
                /* fall through */
            }
        }

        var def = new SimulatorProject { Name = "默认项目", Commands = CreateDefaultCommands() };
        var fresh = new SimulatorWorkspace
        {
            Projects = [def],
            CurrentProjectId = def.Id,
        };
        EnsureIds(fresh);
        return fresh;
    }

    private static void EnsureIds(SimulatorWorkspace ws)
    {
        foreach (var p in ws.Projects)
        {
            if (p.Id == Guid.Empty) p.Id = Guid.NewGuid();
            foreach (var c in p.Commands)
            {
                if (c.Id == Guid.Empty) c.Id = Guid.NewGuid();
            }
        }
    }

    public void Save(SimulatorWorkspace workspace)
    {
        var json = JsonSerializer.Serialize(workspace, ReadWriteOptions);
        File.WriteAllText(_workspacePath, json);
    }

    private static List<SecsCommandTemplate> CreateDefaultCommands() =>
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
