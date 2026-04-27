namespace EAP模拟器.Models;

/// <summary>
/// 一个模拟器项目：包含独立的 SECS 命令模板集合。
/// </summary>
public sealed class SimulatorProject
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public string Name { get; set; } = "未命名项目";

    public List<SecsCommandTemplate> Commands { get; set; } = [];

    /// <summary>
    /// 项目对应的 Excel 时序表（解析后的第一张 sheet）。
    /// 导入一次后持久化到 workspace.json，后续可直接查看；内容更新时可重新导入覆盖。
    /// </summary>
    public ExcelSequenceSheet? ExcelSheet { get; set; }
}

/// <summary>
/// 工作区：多个项目 + 当前选中的项目。
/// </summary>
public sealed class SimulatorWorkspace
{
    public List<SimulatorProject> Projects { get; set; } = [];

    public Guid CurrentProjectId { get; set; }
}
