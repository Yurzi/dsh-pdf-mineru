# 架构与实现约束

本文面向贡献者，描述当前实现的模块边界和必须保持的约束。用户可见行为见 [README](README.md)、[配置与运维指南](docs/configuration.md) 和 [PDF 阅读契约](docs/model-reading.md)；开发流程见 [CONTRIBUTING.md](CONTRIBUTING.md)；代理规则见 [AGENTS.md](AGENTS.md)。

## 模块地图

本节是唯一的模块清单。

```text
src/
  index.ts           插件入口：name、inject、Config、apply，以及供 smoke 脚本使用的显式导出
  plugin/            lifecycle（组装与释放顺序）、settings-persistence（保存与修订号）、credentials
  tools/             read_pdf / async_parse_pdf：参数解析、来源解析、任务适配、schema、渲染
  reader/            ReaderService 与阅读管线；page/ 为本地原页渲染（含独立的 PDF.js worker）
  service/           ParseService（探测、命中、合并、生产、发布）与进程内 SharedOperationRegistry
  source/            源文件准备：stat、大小限制、流式哈希、上传前复核、规范请求
  providers/         registry（createProvider）、contract；official-v4/、self-hosted-v1/、
                     self-hosted-legacy-v2/；http/（HTTP 客户端、重试、安全 ZIP）
  storage/           paths、process-lock、access-gate、result-repository、artifact-sink、
                     artifact-port（中立的产物写入类型）；maintenance/（维护服务及其各步骤）
  domain/            branded ID、规范请求、selection（ReadQuery）、缓存键、manifest、错误、严格解析
  config/            model（浏览器安全的类型与默认值）、parse、migrate、migration-values、schema
  contracts/         浏览器安全的 RPC、探测和维护 DTO
  rpc.ts             管理 RPC：owner 校验、端点表、错误码映射
  loopback-rpc.ts    只包装本插件路由的回环 Host 校验
  client/            设置页（plugins.bundle.config 插槽）
  utils/             bounded-read、crypto、text
  observability.ts   类型化、不抛错的结构化诊断事件
```

依赖方向：

```text
tools → ReaderService → ParseService → SharedOperationRegistry
                                     → createProvider → providers/<type>
                                     → ResultRepository
loopback RPC → settings persistence / ParseService.probe / StorageMaintenanceService
```

- tools 只依赖 reader 以及 config、domain 的类型；不直接使用 service、storage 或 providers。工具不调用 fetch、不解析 ZIP、不构造存储路径。
- reader 依赖 ParseService、storage 的读取接口、domain 和 config/model。service 依赖 providers、storage、source、domain、config。
- providers 只依赖 domain、config/model、source 和 storage/artifact-port。Provider 只适配上游协议：不注册工具、不接触 DSH Session、不选择缓存路径、不解析凭据、不生成模型文案。
- storage 只依赖 domain 和 utils，不导入 service 或 Provider 实现。domain、config、contracts、source 是叶子模块。
- client 只能导入 contracts、config/model 和 domain/ids；`tests/client-boundary.spec.ts` 检查这条边界。
- 新增 Provider 类型从 `domain/ids.ts` 的 `PROVIDER_TYPES` 开始：配置解析、Schemastery 联合类型、默认值、输出枚举和工厂表都由它派生，映射类型保证穷尽。按协议区分的事实放在 `PROVIDER_TRAITS`，不要在 service 或 reader 里按类型分支。

## 领域与缓存身份

- 规范请求、缓存键规格和结果 manifest 各自独立版本化，未知版本明确拒绝。
- `mr_`、`mf_`、`mp_`、`mo_` 等 ID 经校验并使用 branded 类型。后台任务 ID 由 DSH 签发，插件不解析它的格式。
- 规范请求只持久化文件 ID、名称、字节数和 SHA-256；本地绝对路径和 stat 指纹只存在于临时的 `PreparedSourceFile`。
- `ProviderJobRef` 只在一次 Provider 执行中存在，包含上游 task/batch ID 及 dataId/fileId/name 映射，不持久化，也不包含上传、CDN、状态或结果 URL。
- manifest 为单文件、不可变，产物只记录规范化的相对路径；只有 ResultRepository 负责解析绝对路径。批量能力必须按源文件拆分缓存键和 manifest。

`domain/cache-key.ts` 的规范 JSON 是缓存格式的一部分：键排序，Unicode 与数字规范化，规范化后的键碰撞明确拒绝。不能换成依赖属性插入顺序的 `JSON.stringify`。固定向量测试保护现有身份，Provider 的 `compatibilityKey` 输入同样有金样测试。

缓存等价由源内容、解析语义、所需产物、Provider 兼容标识和相应 schema 版本决定。文件显示名、阅读参数（pages、focus、query、block_id、cursor）、输出预算和附图开关都不影响解析身份；原页视图不创建解析缓存。`txt` 不等于 `auto`；official-v4 无法表达 `txt`，必须拒绝，不能折叠成 `ocr=false`。4.x V1 的档位进入 `compatibilityKey`，OCR 模式经 `parseMethod` 进入缓存键；V1 内部的模型、语言、公式、表格使用固定占位值，只用于缓存规范化，不发送给上游。

## 请求生命周期

1. 工具要求 `exec.agent.session` 存在。`parseReadArguments` 是 `read_pdf` 唯一的参数校验边界，产出来源（`DocumentSource`）和 `ReadQuery`（select / continue / page）；模型传入的游标在这里解码一次。之后的层信任已校验的查询，只做语义检查（结果、投影、偏移）。
2. `resolveSourcePath` 把来源变成绝对路径。`file_path` 通过 `ctx.workingDirectory.ensure(agent, signal)` 取得会话当前工作目录后 `path.resolve`，每次调用只解析一次；`attachment_id` 走附件解析（见下）。service 和渲染器只接收绝对路径，不接触会话或 cwd。
3. 每次调用读取一次配置快照，经 ReaderService 传到 ParseService，轮询、重试、超时和安全上限都用这份快照。`async_parse_pdf` 在提交时取快照和路径。
4. ReaderService 在 `StorageAccessGate.runShared` 内调用 `ParseService.ensurePublished`：准备源文件 → 构造规范请求（`effectiveParseDefaults`）→ 能力校验 → 计算兼容键和缓存键 → 查缓存（`cacheEnabled` 或续读时）→ 未命中则按"缓存键 + Provider profile ID"预留共享操作。
5. 生产者在自己的 `runShared` 内运行：每次 Provider 调用解析一次凭据，产物写入 staging，校验后发布。等待者按 `poll_timeout_ms` 或配置等待；超时只结束本次等待，生产者继续。
6. reader 投影、分段并执行最终预算。模型支持图像且有附件服务时，图片通过 `attachments.saveImage` 附带。
7. 工具的 `render` 生成文本展示；`presentationMeta` 只给出紧凑摘要（结果和文件 ID、来源、缓存命中、内容状态、是否有后续、计数、渲染器）。证据只在规范返回值中，因为宿主会在每次嵌套调用（如 run_code）中持久化展示元数据。

附件解析属于工具边界：只从当前会话 `deriveMessages()` 的可见消息中收集 `file` 引用（包括 `role: "tool"` 消息的平坦内容），按内容 ID 匹配完整摘要或唯一前缀，把匹配到的原始引用原样交给 `fileHostPath`。不重建引用、不扫描全局存储、不把附件流落盘；宿主不提供路径时返回 `UNSUPPORTED_OPTION`。

## 阅读管线

- `published-result` 在大小上限内加载 content-list、layout 和 Markdown；所有文件读取走 `utils/bounded-read`（`O_NOFOLLOW`、先按大小拒绝、精确长度读取、读后复核 size/mtime/ctime）。
- `document-index` 在筛选前给每个块分配绑定结果的稳定 ID，只规范化已知 span，保留不认识的结构并给出诊断，不猜测修正 OCR。
- `selection` 负责页码筛选、块查找、字面检索片段和目录前缀；文档和选择级提示是类型化的 `ReaderNotice`。
- `projection` 把块转成 Markdown，并只按 manifest 声明的产物匹配图片（规范相对路径，或无歧义的 basename）。
- `read-delivery` 负责分段、游标和最终预算。`fitToBudget` 是最终响应唯一的降级阶梯；`fitArtifactListing` 单独处理只列产物的响应。
- `visuals` 按实际读取字节计入图片预算；读取失败的字节同样计入，避免反复失败绕过累计上限。

### cursor-v3

游标是最长 2048 字符、无签名的 base64url JSON，携带不可变结果身份、规范化的 pages/focus、可选的 block/query、UTF-16 偏移和 `inline_images` 意图。投影 SHA-256 绑定精确的投影文本、索引与阅读版本，以及 manifest 中的文件和产物身份（含摘要）；任何一项变化都拒绝旧偏移。

- 续读严格只读缓存：即使 `cacheEnabled=false` 也只查已发布结果，未命中返回 `CACHE_EVICTED`，绝不启动 Provider。源文件仍需存在且一致。
- 默认全选编码为 `pages=""`，不能在续读时改写为显式的 1–N，否则会丢失没有页码的块。
- 分段不拆开 UTF-16 代理对或生成的块定位符；长块内续读通过 `continuation_block` 保留定位。
- 块级诊断和公式核验建议只覆盖本次交付的块；文档和选择级提示只在首次出现。解析来源（provider/model/parse_method）与索引、阅读版本分开记录。

页数优先取 layout；只有 content-list 时，页数是已知页坐标的下界，不能据此判定后面的页不存在。缺少可靠页码或类型映射时，相应筛选返回 `[SELECTION_UNAVAILABLE]`，不捏造计数。

## 原页渲染

`reader/page/page-renderer` 不调用 Provider、不上传、不依赖解析缓存。它在受 `limits.maxFileBytes` 约束的前提下为源文件建立私有临时快照并计算 SHA-256，`expected_sha256` 不匹配则在渲染前拒绝；完成、失败或取消后都清理临时文件。

- 先执行 Poppler（`pdfinfo`、`pdftoppm`）。所有渲染子进程都不经 shell，环境只保留 `PATH` 和固定的 C 语言区域设置，不继承 `NODE_OPTIONS` 等用户变量。只有执行环境错误（ENOENT、EACCES、EPERM、ENOEXEC、ENOSYS）才归为渲染器不可用并切换到 PDF.js；文档错误、越界、摘要不匹配、取消、超限和超时都不切换。
- 两个后端共享同一份快照、同一个并发槽和同一个截止时间：同进程最多 2 个并发渲染，从排队到渲染结束共 45 秒（单调时钟）。
- 输出：长边不超过 1600 px（保持纵横比），PNG 不超过 8 MiB；读取 PNG 前后复核大小和身份，检查尺寸、块结构、CRC 和 IEND 后才交给附件层。子进程 stdout/stderr 和输出文件增长都有上限。
- 能力检测就是实际执行：不单独探测、不缓存永久不可用、文本阅读不触发探测。

PDF.js 后端在独立 Node 子进程中运行 `pdfjs-worker.mjs`：用 `process.execPath` 启动、参数固定，带 `--disallow-code-generation-from-strings` 和 512 MiB old-space 上限。进程协议：成功退出码 0 并输出唯一的 `{page_count}` JSON；20 表示依赖或资源不可用，21 文档或页面错误，22 资源超限，23 其他错误。父进程不把子进程输出或原始异常透传给模型。

worker 的加固：快照硬上限 200 MiB（同时受更小的配置上限约束）；原始页边不超过 1,000,000 pt；每张 Canvas 不超过 3,200,000 像素，活动 Canvas 合计不超过 12,800,000 像素，超限则失败而不是静默丢图。不导入 PDF 脚本沙箱，不执行 OpenAction、JavaScript 或 URI 动作，关闭 XFA 和系统字体；字体、CMap、WASM 只按包目录以 `O_NOFOLLOW` 读取（固定类型和扩展名，单个不超过 16 MiB）；网络模块在 worker 内被禁用。PDF.js 的严格 operator-list 路径可能吞掉超大图像异常，worker 用容错路径并捕获固定的 `maxImageSize` 警告来返回资源错误；升级 PDF.js 时必须用真实 fixture 重新验证这一点。

打包：`pdfjs-dist` 与 `@napi-rs/canvas` 是固定版本的生产依赖，不打进 host 或 client bundle；tsdown 把 worker 原样复制到 `lib/pdfjs-worker.mjs`，`package.json` 的 `files` 必须保留它。Canvas 平台二进制来自其 optionalDependencies，只在子进程选用 PDF.js 时加载。

**这些限制不是操作系统沙箱，也不是进程内存硬上限。** old-space 限制不覆盖 Buffer、typed array、原生 Canvas 和 WASM 的分配；单图和 Canvas 计数也不是 RSS 预算。处理不可信 PDF 仍需宿主部署层面的隔离和资源限制。

## 存储

```text
<storageRoot>/                       默认 $DSH_HOME/cache/pdf-mineru
  results/sha256/<prefix>/<cache-key>/
    manifest.json
    files/<file-id>/                 full.md、content_list.json、layout.json、model.json、images/
  staging/<operation-id>/
  quarantine/
  .process.lock                      持久的锁协议版本标记
  .lock/claims/<owner>/              bakery 锁的 claim 目录
  .lock/users/<owner>/               读者与生产者的使用记录
```

**发布**：staging 写入经过大小、SHA-256、UTF-8、JSON、manifest 一致性和目录内容校验后，以同文件系统原子 rename 发布。EXDEV 是错误，不回退为复制。结果目录的祖先逐级验证，不沿符号链接写出存储根。同一缓存身份第一个有效发布的结果胜出，后来的竞争结果不覆盖、不隔离它。

**读取**：普通读取不修改存储。损坏结果返回 `CACHE_CORRUPT`，等待显式维护；生产者清理自己的 staging 与隔离已发布结果是两种不同权限。没有自动淘汰。启动时的 staging TTL 清理同样受锁和使用记录保护。

**ProcessLock**：文件系统 Lamport bakery。claim 目录名原子地携带主机指纹、PID 和随机身份，永不复用；按 `(ticket, id)` 排队，同一实例内也走 FIFO。嵌套变更显式传递 `ProcessLockScope` 并校验归属，不隐式重入；排队可取消。只有同主机 PID 确认 ESRCH 时才删除对应 owner 的目录；PID 存活、外部主机、权限不明或格式损坏都 fail closed，不按 TTL 抢锁。`.process.lock` 以临时文件加 hard link 原子发布，阻止旧协议版本使用旧锁路径。

**使用记录**：`StorageAccessGate.runShared` 在锁内登记唯一的 `.lock/users/` 目录，覆盖读者或生产者实际 I/O 的整个生命周期，结束后只删除自己的目录。不能用 `Promise.race` 提前释放仍在 I/O 的记录。插件不在整个生命周期内持锁。

**维护**（`storage/maintenance/`）：破坏性操作先检查本进程的共享操作和跨进程使用记录，再在锁内复查；发现活跃或无法验证的使用者即失败。遍历按条目数、深度和时间设上限，无效条目也消耗预算；根和祖先的符号链接不跟随，只读检查不为初始化写锁文件。完整性扫描和隔离区清理默认只读或 dry-run；隔离、隔离区删除和缓存清除都要求显式确认。缓存清除的确认令牌是预览时计划删除的缓存键清单的哈希，清单变化即令牌失效；遍历不完整或发现不安全条目时不签发令牌。删除前对每个目标重新检查整条路径。

## Provider 与网络安全

三种 Provider 由配置显式选择，不自动探测或降级：

- **self-hosted-v1**（4.x）：先 `GET /v1/health` 和 `/v1/tiers` 确认支持 zip、file_id 和所配档位，再创建上传、PUT 字节、完成上传、创建解析任务、轮询并下载结果。只接收 `tier` 和 `ocrMode`。结果中的 Markdown、middle/structured JSON、模型输出和图片归一到现有产物形状；`provenance.model` 为 `null`。不依赖服务器重启后可能失效的资源 ID。
- **self-hosted-legacy-v2**（3.x）：只使用 `/health`、multipart `/tasks` 和结果端点，接收 `modelMap` 与共享解析默认值。
- **official-v4**：官方批量上传 URL 分配、裸 PUT、状态轮询和 ZIP 下载，按 data_id 映射。

安全约束：

- 认证请求固定 `redirect: "error"`。官方预签名 PUT 显式使用空 headers；CDN 下载不带认证头。V1 字节上传只在上传地址与配置端点同源时附带 API Key，拒绝 HTTPS 端点返回的跨源明文上传地址。
- 只重试幂等 GET，以及重新打开源文件流的上传 PUT 和结果下载。官方分配 POST、multipart POST、V1 的创建上传 / 完成 / 创建任务 POST 绝不自动重放。重试遵守退避、`Retry-After`、取消和次数上限；重试诊断只含类型化的操作、状态和计数，不含错误消息、URL、header、body、凭据或路径。
- 源文件流式计算哈希，上传前立即复核 size、mtime、device、inode。
- ZIP 用 yauzl 惰性读取条目：先校验路径、类型、声明大小和压缩比，再逐条目流式写入 staging，限制下载大小、条目数、单条目和总解压量；拒绝绝对路径、路径穿越、符号链接和压缩炸弹。不要恢复整包或整条目读入内存的做法。
- 凭据每次 Provider 调用解析一次，不缓存、不持久化。解析顺序在 `plugin/credentials.ts`：有 DSH 凭据服务时只问它（已保存值优先，回退由宿主决定）；没有该服务时才读 `process.env`。
- `compatibilityKey` 表示输出兼容范围，不含明文 URL 或凭据。探测结果不是解析质量或容量保证。

## 配置、设置与 RPC

**配置**：`config/schema.ts` 导出 Schemastery `Config`，可热更新字段标为 `.volatile()`；`storage.storageRoot`、`retainSources` 和 `limits` 是普通字段，只在启动时读取。Standard Schema 入口调用 `parseConfigWithMigration` 做完整领域校验，再把迁移后的结果（而非旧对象）交给 Schemastery 包装，因此 ConfigEditor 在持久化前就会拒绝无效配置。

**迁移**（`config/migrate.ts`、`migration-values.ts`）：按 1→2→3 顺序执行，缺省版本视为 2，未知未来版本拒绝。旧版本的缺失或无效值填默认值，关联字段先单独校验再组合校验，不扩大 HTTP 授权，迁移元数据不含原值。2→3 把 `self-hosted-v2` 转为 `self-hosted-legacy-v2` 并去掉 `tier`，不根据 URL 或网络猜测协议。转换幂等、不修改输入。加载、激活和读取只在内存中转换，启动时不写配置。

**设置**：插件用 `settings.configure({ auto: false }, ctx.fiber)` 关闭自动表单，由自定义页面负责草稿和显式保存。`plugin/settings-persistence.ts` 的保存流程：

- 先校验完整配置，并确认 `storageRoot` 和 `limits` 与运行时一致。
- 原始条目仍是旧版本时（只有用户显式保存才会走到这里），通过 `ConfigEditor.edit` 在一个宿主事务中写入完整的迁移后快照，连同修复过的普通字段。
- 否则用实际 Loader 条目 ID 调用 `settings.replace`，提交完整的可热更新值：`replace` 会把省略的值重置为 profile 继承值，而不是包默认值。
- `config.get` / `config.set` 携带修订号（宿主 `settings.describe()` 中该条目的 revision，不可用时为 null）。保存时把 `expected_revision` 交给 `settings.replace`；ConfigEditor 路径在事务内比较。宿主冲突或修订号不符统一映射为 `SETTINGS_CONFLICT` / `mineru/conflict`，界面提示重新加载。
- 持久化失败不会发布新的运行时配置。旧 settings 文档的导入由 DSH 负责。

**RPC**：只在同时注入 `connection` 和 `webServer` 时注册，headless 宿主仍有两个工具。处理函数第一步检查 `peer.principal.kind === 'owner'`，否则对任何端点（包括未知端点）都返回 `mineru/forbidden`，不读取 payload、不调用依赖；之后才按端点表分发。`loopback-rpc.ts` 只为本插件的路由包装一层 Host 校验（仅接受裸的 `localhost`、`127.x.x.x`、`[::1]` 加端口），认证、Origin 检查、消息封装和取消仍由原生 Connection 负责；回环 Host 校验不能替代 owner 授权，两者都需要。维护端点之外没有任意路径读取，维护也从不作为模型工具开放。

**客户端**：设置页注册到 `plugins.bundle.config` 插槽，key 为包名 `dsh-pdf-mineru`，使用插件管理器公开的 slot 契约，不注册全局 `settings.section`，不依赖可选的通用 `form`。密钥通过 `remote.credentials` 写入 DSH 凭据服务，从不进入配置草稿。

## 后台任务

`async_parse_pdf` 在提交前解析来源路径并取配置快照，然后调用 `ctx.jobs.start`：`kind: "mineru"`，owner 为 `agent.session.id`，`toolCall` 记录 `callId` 和 `rootCallId`，`outputLimitBytes: 48_000`。任务 ID 由 DSH 签发并原样返回。

- `done` 是不会 reject 的 `Promise<JobOutcome>`：成功时 `result` 为摘要文本，失败时为 `[CODE] message`，取消时为 killed。宿主负责一次性消费结果、通知、空闲唤醒和归档准入。
- 阶段进度（preparing / waiting-for-parse / reading-result / summarizing）通过 `JobHandle.updateProgress` 发布，不含路径、凭据、Provider 引用或虚构的百分比；观察者异常不影响解析。
- 摘要最多读取 2 MiB 的 content-list，保留最多 20 条大纲、每条 160 个 UTF-16 单元；可选元数据缺失或超限时退化为最小摘要，仓储完整性错误和取消照常抛出。
- 共享操作拥有生产者的 AbortController。等待者取消（包括 `job_kill`）只结束这一次等待；生产者运行到成功、领域失败、操作超时或插件关闭。插件释放时先注销工具并取消自己启动的后台等待，再关闭共享操作。

## 有意保留的限制

- 跨进程安全不等于跨进程 Provider exactly-once，独立进程仍可能各自提交并计费。
- 每次读取都重新计算源哈希并做必要的完整性校验；没有全局无界缓存或持久阅读索引。
- 正文在 64 MiB 读取上限内重建，不是任意大小的流式 Markdown 处理。
- 不实现远端任务跨重启恢复、源文件保留、自动结果淘汰、跨主机锁，或不提供源文件的 `result_id` 读取。
