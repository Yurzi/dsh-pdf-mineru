# 配置与运维指南

本文面向使用者和运维者，说明设置页、Provider 配置、凭据、配置迁移、缓存维护和多进程共享。安装与快速上手见 [README](../README.md)，模型如何调用工具见 [PDF 阅读契约](model-reading.md)。

## 设置页

入口：**Plugins / 插件 → dsh-pdf-mineru**。设置页只在 DSH Web 中提供；没有 Web 服务的宿主仍可使用两个模型工具，配置直接写在 profile 中（见 [YAML 示例](#yaml-示例)）。

设置页分为两个标签：

- **服务与解析**：选择服务类型、填写地址与凭据、测试连接，设置默认解析选项；轮询、超时、重试和输出预算在「高级」中。
- **存储**：缓存开关、暂存区保留时间、只读显示的缓存目录和启动时确定的安全上限，以及存储统计和维护操作。首次打开该标签时会自动读取一次存储统计（只读）。

### 草稿与保存

- 所有修改先进入草稿。切换标签、切换 Provider profile、折叠分组都不会丢失草稿。
- 有未保存的修改时，页面底部出现操作栏：**保存** 才写入；**放弃** 回到上次加载的配置。「高级」末尾的 **恢复默认值** 只重置轮询、重试和输出数值，同样只改草稿。
- 保存先写入配置，再保存新输入的 API Key；密钥保存失败时会保留在输入框中，可以再次保存。
- 保存成功后，新配置影响之后的调用；正在进行的解析继续使用开始时的配置。
- 设置页加载时会记下配置的修订号。如果保存前配置已被其他窗口、进程或直接编辑文件改过，保存会被拒绝，操作栏提示「设置已在别处修改」，点击 **重新加载** 会丢弃过期草稿并读取最新配置。插件不会用旧草稿覆盖别人的修改。

### 连接测试

连接测试针对当前草稿中的 Provider 设置（地址、协议选项等），不需要先保存；API Key 则只使用凭据服务中已保存的值，新输入的密钥要先保存再测试。修改地址、凭据或 Provider 字段后，上一次的测试结果会被清除。

测试只确认 API 可访问以及服务声明的能力：4.x V1 会显示部署支持的档位、产物格式和来源类型。测试通过不代表解析效果已经验证。

### 访问限制

设置页背后的配置读写、连接测试和存储维护接口有两道限制：

1. 调用方必须是 DSH 的 owner 身份。
2. 请求的 Host 必须是回环地址：`localhost`、`127.x.x.x` 或 `[::1]`。

通过局域网 IP 或反向代理域名打开 Web 时，这些接口会返回 403。请在运行 DSH 的机器上通过回环地址打开设置页。模型工具不受这些限制。

## Provider 参考

插件内置三份互相独立的 profile，各自保存草稿和缓存身份。协议需要显式选择，插件不会根据 URL 或服务响应猜测协议，连接失败也不会降级到另一种协议。

| 类型 | 适用服务 | 可配置的解析选项 | 不接受的字段 |
| --- | --- | --- | --- |
| `official-v4` | MinerU 官方云 API | `models`；共享解析默认值（不支持 `txt`） | `tier`、`ocrMode`、`modelMap` |
| `self-hosted-v1` | 自部署 MinerU 4.x，V1 API | `tier`（flash / basic / standard / advanced，可省略由服务端决定）、`ocrMode`（auto / txt / ocr） | `modelMap` |
| `self-hosted-legacy-v2` | 自部署 MinerU 3.x，旧版 `/tasks` API | `modelMap`（pipeline / vlm 到 backend 名称的映射）；共享解析默认值 | `tier`、`ocrMode` |

各类型的共同规则：

- **官方云** 只接受 HTTPS，必须配置凭据。
- **自部署** 默认要求 HTTPS；本机或内网 HTTP 需打开 `allowInsecureHttp`。凭据可选。
- `configuredVersion` 是自部署服务的缓存版本标记。原地升级服务或模型后修改它，旧结果就不会再被复用。
- 4.x V1 不使用共享默认值里的模型、语言、公式、表格设置。切换到 V1 时这些值在草稿中保持不变，但不会发送给服务，也不影响缓存。
- `txt` 与 `auto` 是不同的解析方式，缓存也分开。`txt` 不保证服务端完全不运行视觉模型。官方云无法表达 `txt`，选中官方云时不能使用它。
- 档位、OCR 模式、解析方式、模型或 Provider 类型变化都会产生新的缓存身份，下次读取会重新解析。

### 4.x V1 的能力边界

- 工具一次处理一个文件。插件通过上传会话提交文件，下载 ZIP 结果后发布到自己的缓存，不保存服务端资源 ID。
- 不提供 URL / inline 来源、回调、服务端取消、HTML/DOCX 产物选择等上游功能。
- 输入类型仍限于 PDF、常见图片和 doc/docx/ppt/pptx/xls/xlsx；原页核对只支持 PDF。
- `read_pdf` 的 `pages` 是对已解析结果按物理页筛选，不是上游的 page_range 语法。

## 凭据

插件配置只保存「凭据引用名」（`apiKeyEnv`，默认 `MINERU_API_KEY`），不保存密钥本身。每次调用 Provider 时按引用名解析密钥，不缓存，也不写入配置或日志。

解析顺序：

1. 宿主装有 DSH 凭据服务时（Web profile 默认如此），由凭据服务决定：已保存的值优先；没有保存值时，凭据服务会回退到它所继承的环境变量等来源。设置页会把这类来源标为只读。
2. 宿主没有凭据服务时，插件直接读取进程环境变量中的同名变量。

在设置页输入 API Key 并保存，就是写入 DSH 凭据服务；清除后，环境变量等后备来源会重新生效。

## YAML 示例

设置页保存的就是 profile 配置中 `id: dsh-pdf-mineru` 条目的 `config`，通常位于 `$DSH_HOME/profiles/<profile>/cordis.patch.yml`（`dsh web` 启动时 profile 为 `web`）。下面的片段是 `config` 的内容，未写出的字段使用默认值。

官方云：

```yaml
schemaVersion: 3
activeProvider: mp_official
providers:
  - id: mp_official
    type: official-v4
    baseURL: https://mineru.net/api/v4
    apiKeyEnv: MINERU_API_KEY
    models: [pipeline, vlm]
defaults:
  model: vlm
  parseMethod: auto
  formula: true
  table: true
```

自部署 4.x（V1）：

```yaml
schemaVersion: 3
activeProvider: mp_self_hosted_v1
providers:
  - id: mp_self_hosted_v1
    type: self-hosted-v1
    baseURL: http://localhost:8000
    allowInsecureHttp: true
    apiKeyEnv: MINERU_API_KEY
    tier: standard              # 可省略，由服务端选择；不是具体模型名
    ocrMode: auto               # auto / txt / ocr
    configuredVersion: '4.0.10' # 原地升级服务或模型后修改
```

自部署 3.x（旧版）：

```yaml
schemaVersion: 3
activeProvider: mp_self_hosted
providers:
  - id: mp_self_hosted
    type: self-hosted-legacy-v2
    baseURL: http://localhost:18000
    allowInsecureHttp: true
    modelMap:                   # 3.x 服务的 backend 名称
      pipeline: pipeline
      vlm: vlm-engine
defaults:
  model: pipeline
  parseMethod: auto
```

存储、输出与安全上限（可选）：

```yaml
storage:
  storageRoot: /absolute/path/to/pdf-mineru  # 默认 $DSH_HOME/cache/pdf-mineru
  cacheEnabled: true
output:
  maxInlineChars: 12000   # 单次响应预算
  maxInlineImages: 6      # 单次响应最多附带的图片数，0–100
limits:
  maxFileBytes: 209715200 # 200 MB
```

`storageRoot` 和 `limits.*` 只在插件启动时读取。设置页会拒绝在运行中修改它们；请改配置文件后重启插件。输出预算的具体含义见 [PDF 阅读契约 · 预算](model-reading.md#预算)。

## 配置版本与迁移

当前配置版本为 `schemaVersion: 3`，与 MinerU 的 API 版本、缓存格式和游标版本无关。

- 读取旧版本配置时，插件只在内存中逐级转换（1 → 2 → 3）；没有写版本号的 Provider 配置按版本 2 处理。启动和读取都不会改写文件。
- 在设置页点击保存时，才把完整的转换结果写回，包括设置页上没有的字段中被修复的值。保存失败不会改变运行中的配置。
- 历史上的 `self-hosted-v2` 会转为 `self-hosted-legacy-v2`，并去掉它不支持的 `tier`。原先依赖自动识别 V1 的部署，需要手动改选 `self-hosted-v1`。
- 旧版本中缺失或无效的值用默认值填补，重复的 profile ID 换成不冲突的 ID。迁移不会自动开启 HTTP：未授权的 HTTP 默认地址改用 HTTPS。
- 未知的未来版本和当前版本中的未知字段会被拒绝，避免误降级。
- 自部署 Provider 的身份变化后，旧缓存不再复用，首次读取会重新解析；已有解析产物不会被改写。

## 存储、缓存与维护

### 缓存行为

- 解析结果按源文件内容、解析配置和 Provider 兼容标识寻址，默认存放在 `$DSH_HOME/cache/pdf-mineru/`。
- `cacheEnabled: false` 只关闭解析前的缓存复用，结果仍会发布到缓存。它不是"不存储"，也不会覆盖已有结果。续读（cursor）始终只读已发布结果。
- 同一进程内对同一文档的并发请求会合并为一次解析；不同进程仍可能各自提交，因此不保证跨进程只计费一次。
- 没有自动按容量或时间淘汰结果。暂存区（staging）中的过期目录在插件启动时清理，保留时间由 `stagingTtlMs` 控制。
- 已发布结果损坏时，读取返回 `CACHE_CORRUPT`，不会自动覆盖，需要通过维护操作处理。

### 维护操作

「存储」标签提供以下操作。所有维护都在有读取或解析正在进行时拒绝执行，不会为了清理而取消它们；遍历不完整或发现不安全条目（如符号链接）时，也不会执行删除。

| 操作 | 行为 |
| --- | --- |
| 存储统计 | 只读。遍历有上限，超出上限时显示的总量是下界 |
| 校验缓存 | 默认只读扫描；把损坏结果移入隔离区需要额外确认 |
| 隔离区清理 | 先列出隔离条目并预览，确认后才永久删除选中项 |
| 清除缓存 | 先预览将删除的结果数和字节数，确认后删除。确认绑定预览时的结果清单；如果预览后缓存发生变化，确认会被拒绝，需要重新预览 |

这些操作只在设置页提供，不会作为模型工具开放。访问要求见[访问限制](#访问限制)。

## 多进程共享 storageRoot

多个 DSH 进程可以共享同一个 `storageRoot`，前提是：

- 同一台主机、同一个 PID 可见的命名空间；
- 本地文件系统，支持 hard link 和原子目录操作。

不支持 NFS、跨主机共享，或 PID 互不可见的容器之间共享。

升级插件前，先停止所有使用该目录的进程，再统一升级并重启。目录中的 `.process.lock` 是持久的协议版本标记，`.lock/` 保存实际的互斥和使用记录；正常退出后保留它们是预期行为。**不要在任何相关进程运行时删除 `.process.lock` 或 `.lock/`。** 遇到旧锁或损坏的记录时，确认所有相关进程都已停止，再按错误提示手动处理。
