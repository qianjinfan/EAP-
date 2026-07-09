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

    /// <summary>项目下保存的 MES 接口配置，可有多条。</summary>
    public List<MesInterface> MesInterfaces { get; set; } = [];
}

/// <summary>一条可复用的 MES 接口配置（SOAP / REST / 普通 HTTP）。</summary>
public sealed class MesInterface
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public string Name { get; set; } = string.Empty;

    /// <summary>接口类型：soap | rest | http</summary>
    public string Type { get; set; } = "soap";

    /// <summary>请求方式：GET | POST</summary>
    public string HttpMethod { get; set; } = "POST";

    public string Url { get; set; } = string.Empty;

    public int TimeoutSec { get; set; } = 10;

    /// <summary>SOAP 接口名（仅 type=soap）</summary>
    public string SoapMethod { get; set; } = string.Empty;

    /// <summary>SOAP 命名空间（仅 type=soap）</summary>
    public string SoapNamespace { get; set; } = string.Empty;

    /// <summary>入参键值对</summary>
    public List<MesKeyValue> Params { get; set; } = [];

    /// <summary>请求头原文（每行 Key: Value）</summary>
    public string Headers { get; set; } = string.Empty;

    /// <summary>手写请求体（非自动生成时使用）</summary>
    public string Body { get; set; } = string.Empty;
}

/// <summary>通用键值对，用于 MES 接口入参。</summary>
public sealed class MesKeyValue
{
    public string Key { get; set; } = string.Empty;

    public string Value { get; set; } = string.Empty;
}

/// <summary>
/// 工作区：多个项目 + 当前选中的项目。
/// </summary>
public sealed class SimulatorWorkspace
{
    public List<SimulatorProject> Projects { get; set; } = [];

    public Guid CurrentProjectId { get; set; }
}
