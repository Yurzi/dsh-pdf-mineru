# 架构与维护约束

本文描述当前实现，不保留已经完成的迁移计划或未来接口草案。安装和调用示例见 [README.md](README.md)，模型阅读契约与验证方法见 [docs/model-reading.md](docs/model-reading.md)，开发约束见 [AGENTS.md](AGENTS.md)，变更摘要见 [CHANGELOG.md](CHANGELOG.md)。

## 1. 模块职责

```text
read_pdf / async_parse_pdf
  ├─ DSH JobRegistry（仅异步入口）
  └─ MinerUService
       ├─ RequestNormalizer
       ├─ SharedOperationRegistry
       ├─ ResultRepository
       ├─ ProviderRegistry
       │    ├─ SelfHostedV2Provider
       │    └─ OfficialV4Provider
       ├─ document-index → read-delivery → tools 附件／最终预算（content）
       └─ page-renderer → Poppler 优先 / PDF.js + Canvas 子进程回退（page，无 Provider）

loopback RPC → StorageMaintenanceService
                  ├─ StorageAccessGate
                  ├─ ProcessLock
                  └─ ResultRepository
```

| 位置 | 职责 |
| --- | --- |
| `src/tools.ts` | 两个工具的 schema、DSH owner/job 适配、模型能力判断、受限附件与最终输出 |
| `src/service/mineru-service.ts` | 固定调用配置、规范化、命中／合并、Provider 编排、解析发布与阅读入口 |
| `src/service/document-index.ts` | 选择前建立稳定 block ID、物理页坐标、已知 span 的忠实规范化、原文标签和诊断 |
| `src/service/read-delivery.ts`、`read-cursor.ts` | 有界正文投影、cursor-v3、交付 block 范围内的诊断／公式核验建议和元数据裁剪 |
| `src/service/result-presenter.ts`、`image-policy.ts` | 摘要／英文展示、图片候选与限制，最终附件及预算由工具层执行 |
| `src/service/page-renderer.ts` | 临时流式源快照、本地原页渲染、哈希绑定、子进程与输出限制，不调用 Provider |
| `src/domain/` | branded ID、规范请求、缓存身份、manifest、严格边界校验和错误 |
| `src/providers/` | 仅适配上游协议、重试、下载与安全解包 |
| `src/storage/` | 受控路径、staging sink、不可变仓储、多进程互斥、使用屏障和运维 |
| `src/config.ts`、`src/config/pure.ts` | 宿主配置校验与不依赖 Node 的共享配置定义 |
| `src/client/` | 设置页编排、独立设置分组、数字草稿输入和维护界面 |

Provider 不注册工具、不取得 DSH Session、不选择缓存目录、不解析凭据、不生成模型文案。工具不调用 fetch、不解析 ZIP、不构造存储路径。

## 2. 领域与缓存身份

- 请求、缓存键规格、manifest 分别版本化。未知版本明确拒绝。
- `mr_`、`mf_`、`mp_`、`mo_` 等 ID 经校验并使用 branded type；`mineru-N` 后台 ID 由 DSH 签发。
- CanonicalSourceFile 持久化 fileId/name/bytes/SHA-256；绝对源路径和 stat fingerprint 仅存在于 PreparedSourceFile。
- ProviderJobRef 只在一次执行期间存在，包含上游 task/batch ID 与 dataId/fileId/name 映射，不持久化，也不包含上传／CDN／状态 URL。
- manifest 必须单文件、不可变；产物只保存规范相对路径。只有仓储负责解析受控绝对路径。

`src/domain/cache-key.ts` 的 canonical JSON 是缓存格式的一部分：排序键、规范化 Unicode 和数字，并明确拒绝规范化后的键碰撞。不可改为依赖属性插入顺序的普通 JSON.stringify。固定向量测试保护 v1 身份。

缓存等价由源内容、解析语义、所需产物、Provider 兼容标识及相应 schema 版本决定。源显示名称、阅读 pages/focus/query/block_id/cursor、输出预算和附件开关不改变解析身份；view: page 是独立本地路径，不创建解析缓存。`txt` 不等于 `auto`；official-v4 不能表达 txt，必须拒绝，不能偷偷折叠为 ocr=false。

## 3. 工具与阅读契约

两个工具都要求真实 `exec.agent.session`，并在 schema 中声明 file_path 必填。工具参数只关注阅读，不暴露 model/ocr/backend 等底层解析设置。

- `read_pdf`：直接返回选择投影，不创建插件任务。当前参数为 `file_path`、`view`、`pages`、`focus`、`block_id`、`query`、`expected_sha256`、`inline_images`、`poll_timeout_ms`、`cursor`。
  - `view: content`（默认）读取解析块；`pages` 是从 1 开始的物理页，`focus` 支持 all/text/table/image/toc/artifacts。`query` 是 1–256 字符、不区分大小写的字面搜索，返回有界片段和 ID；`block_id` 精确读取同一解析结果的稳定 block。两者互斥，也不能与 toc/artifacts focus 组合。
  - `view: page` 只接受 `file_path`、恰好一页的 `pages` 和可选 `expected_sha256`；哈希必须为 64 个小写十六进制字符的 SHA-256，取自先前结果的 `source_sha256`。此参数不用于 content 模式。页面模式要求支持图片的模型且 maxInlineImages > 0，不接受 focus/cursor/query/block_id/inline_images/poll_timeout_ms。
- `async_parse_pdf`：调用 `ctx.jobs.start(kind: mineru)`，传递精确的 live Agent owner；立即返回 job_id/state。完成后通过非拒绝 final-output Promise 提供摘要文本，而不是伪装为与 read_pdf 相同的正文 JSON。
- 通用 job_output/job_list/job_kill 负责后台控制；不维护第二套 JobRepository 或专用任务控制工具。

后台入口调用 `ensureParsed`，与正文入口 `parseDocument` 只共享规范化、等待及发布结果校验，不再通过 summaryOnly 布尔值让 Markdown 读取器返回虚假的空正文。`ParseSummaryView` 不包含正文／cursor／阅读字符预算字段。摘要只尝试最多 2 MiB 的 content-list，保留最多 20 项大纲及每项 160 个 UTF-16 code units；可选元数据缺失、为空、无效或超限时退化为明确的最小摘要，而仓储完整性错误与取消仍向上传递。

### 续读与完整性

`content_status: complete` 只表示所选解析文本（或续读剩余文本）已交付，不保证 OCR 忠实性、原文完整抽取、图片已看过或视觉覆盖完整。`partial` 必须提供能够取得进展的非空 cursor；complete/not_requested 的 cursor 为 null，调用方应停止而不是传回 null。`not_requested` 用于不要求正文的产物列表或原页视图。

Cursor v3 是最长 2048 字符的无签名 base64url JSON，携带 immutable result 身份、规范 pages/focus、可选 block/query、UTF-16 偏移及 inline_images 意图。projection SHA-256 绑定精确投影文本、索引／reader 版本和 manifest 文件／产物身份（含摘要）；变化后拒绝旧偏移。它不是授权凭证，也不是无需源文件的 result_id 读取接口。

1. 初次使用 file_path + 可选 pages/focus/query/block_id，建议先 toc 或短 query，再精读 block_id。
2. partial 后原样传回 cursor，保持同一 file_path，不再传 pages/focus/block_id/query。省略 inline_images 继承 cursor 的调用意图；显式布尔值覆盖它，不能把运行时模型能力或附件预算导致的省略写成用户关闭图片。
3. Native 展示必须包含实际 token，不只说“使用返回的 cursor”。
4. 各次 markdown_content 顺序拼接必须与同一选择的完整文本一致；切分不能拆 Unicode 代理对或生成的 block locator。长块内部续读通过 continuation_block 保留定位。
5. 默认全选编码为 pages=""，不能在续读中改成显式 1-N，避免丢失无 page_idx 的 block。
6. 续读严格 cache-only，即使 cacheEnabled=false 也只查既有发布结果，不启动 Provider。源文件仍需存在并匹配；缓存缺失／损坏、结果／相关解析配置变化、无效偏移或不合法 token 明确要求重新开始。

物理页数优先使用 layout（包括末尾空白页），仅有 content-list 时 page_count 是已知页坐标下界；page_count_source 明确为 layout 或 content-list-lower-bound，本地原页模式按后端为 pdfinfo 或 pdfjs。只有可靠物理页数才能判定完全越界 `[PAGE_OUT_OF_RANGE]` 或部分越界；下界之外的空选择不能证明该页不存在或空白。缺少可靠页码／内容类型映射时，不支持的筛选返回 `[SELECTION_UNAVAILABLE]`；未知计数不捏造。markdown_path 是完整原始产物，筛选重建文本不能用 read_offset_line 指向它。

### 证据、诊断与来源

- document-index 在筛选前分配稳定、绑定结果的 block_id；只规范化已知 span，保留不熟悉的结构并诊断，不猜测修正 OCR。
- diagnostics 使用 document/selection/chunk scope；文档／选择级通知在首块出现，block 诊断只覆盖本次实际交付的块（长块续读仍有其诊断），不是全篇诊断每次重放。
- provenance 区分 provider/model/parse_method 与 index_version/reader_version；upstream_version: null 表示未知，不能把插件版本冒充上游版本。
- verification_hints 是公式的原页核验建议，包含 block_id、可用的物理页及 view: page；不是公式错误判定或自动校正。
- metadata_shortened 明确列出被预算缩短或移除的 summary/provenance/diagnostics/verification_hints/warnings；缺少这些字段不代表没有问题。

### 输出与图片

- `output.maxInlineChars` 默认 12,000 个 UTF-16 code units，约束阅读 JSON 和 Native 文本各自的完整大小，包含元信息、状态、cursor 和附件元信息；不是正文单独的预算。正文另有 8,000 字符硬上限，JSON／Native 文本各有 48 KB（48,000 UTF-8 bytes）上限。
- `output.maxInlineImages` 约束单次 `read_pdf` 响应的内联图片数量，默认 6，可配置整数 0–100（0 关闭附件）；6 不是固定最大值。图片仍受独立的单图与总字节上限约束。
- 预算小到不能容纳必要信息或不能推进正文时明确失败，不产生空转 cursor。
- 图片引用只匹配 manifest 声明的产物。允许规范相对路径匹配以及无歧义 basename 兼容，不存在任意本地路径回退。
- 单张 8 MiB、合计 24 MiB；实际文件读取及返回附件均受限。未知格式、读取失败、无法匹配及预算省略明确标注；visuals 汇总本次 chunk 的 listed/attached/omitted，不是全篇视觉覆盖率。
- 读取失败也消耗预算：每次已报告的读取字节在失败路径中记账，包括部分读取、最终 stat 和 close 失败。读取前检查剩余额度，不能让反复失败绕过累计上限。规范化附件必须提供有效实际 ref.bytes，不能用源大小代替未知附件大小；最后一张图片处理期间的取消也必须传递。
- document_label 保存原文图／表／公式标签；附件 ordinal（兼容字段 figure）只是附件选择序号，不是论文图号，不能拿它重新编号原文。图片只随其 locator 所在 chunk 提供，不提前交付后文图片，也不在每次续读重放前文附件。
- 插件生成的模型描述、状态和恢复示例用英文；PDF 自身的文字不受该语言约束。

### 本地原页验证边界

page-renderer 不调用 Provider、不上传、不依赖解析缓存。它对受文件大小限制的源文件建立私有临时流式快照并计算 SHA-256，expected_sha256 不匹配则在渲染前拒绝；完成、失败或取消都清理临时文件，不长期保留源。优先执行本地 Poppler 的 pdfinfo/pdftoppm；仅依赖或执行环境不可用才自动切换到 PDF.js + @napi-rs/canvas。工具与 Provider 不参与本地渲染命令或临时路径的构造，不回退为上传。

默认最多 2 个并发渲染、45 秒总截止时间（含排队、快照、Poppler执行与fallback）；截止时间用单调时钟计算剩余量，并结合AbortSignal终止进程。两个后端共享同一并发槽和同一快照，不重新读取原始PDF、不重置预算。等比例长边 ≤1600 px，保留独立宽/高/像素防御检查，PNG ≤8 MiB；子进程 stdout/stderr 与输出文件增长有界，PNG读取前后复核大小和身份，统一尺寸及完整块结构/CRC/IDAT/IEND检查后才交给附件层解码。

能力检测就是实际执行，不另开探测进程，也不在文本阅读中探测、缓存永久不可用或引入设置UI。只有执行环境 errno ENOENT/EACCES/EPERM/ENOEXEC/ENOSYS 被归类为内部 RendererUnavailable；Poppler文档失败、页数输出错误、越界、摘要/身份不匹配、取消、超限及超时都不触发切换。PDF.js成功结果包含顶层renderer，严格schema和Native展示/metadata一致，summary.page_count_source对应pdfjs；普通文本结果不添加renderer。

PDF.js入口是发布包内独立 ESM 文件 lib/pdfjs-worker.mjs，pdfjs-backend只在父进程构造固定参数；runPdfPageProcess以process.execPath运行、不用shell、不继承NODE_OPTIONS等用户注入环境。小型进程协议为成功exit0 +唯一JSON {page_count}；20仅依赖/资源不可用、21文档/页错误、22资源限制、23其他错误。父进程不把stdout/stderr或原始异常透传给模型。取消/超时杀死并等待close，回收后清理；清理失败不覆盖主要错误。

PDF.js 6.3 已移除旧 isEvalSupported 选项；子进程用 Node --disallow-code-generation-from-strings 禁止字符串代码生成，不导入 PDF scripting sandbox、不执行 OpenAction/JavaScript/URI 动作，XFA及系统字体关闭。AnnotationMode.ENABLE仅绘制PDF已有的注释外观，不创建交互viewer。BinaryDataFactory只允许固定资源kind、basename与扩展，单资源 ≤16 MiB，按包目录以O_NOFOLLOW读取；网络API另外禁用。PDF.js快照硬限200MiB（同时遵守更小的配置上限），页原始边 ≤1,000,000 pt，Canvas每边 ≤1600 px，单Canvas/嵌入图像 ≤3,200,000像素，活动Canvas合计 ≤12,800,000像素；超限失败而非默默省略图像。PDF.js 6.3 的严格operator-list路径可能吞掉超图异常，worker使用其容错路径并仅在进程内捕获固定maxImageSize警告来返回资源错误；依赖升级必须重跑该真实fixture，不能只依赖旧选项名或错误类型。此后端不是PDF完整性验证器，禁用系统字体/XFA也可能影响特殊或未嵌入字体文档的保真。

正常生产dependencies包含固定版本pdfjs-dist和@napi-rs/canvas；它们不打入host/client bundle。PDF.js包本身携带字体、CMap、WASM及PDF worker，入口按模块安装位置解析资源、而非开发cwd；构建末尾copy-page-worker复制固定入口，clean会移除旧入口后重新生成，package.files明确保留。平台Canvas二进制由其optionalDependencies提供，不需要开发依赖或安装期本地编译；缺失只在选用fallback时报告，不在插件加载时导入原生库。

**这些限制不是 OS sandbox，也不是进程内存硬限制**；PDF.js的512MiB old-space限制不涵盖Buffer/typed-array backing、原生Canvas/WASM分配及同页解码图像缓存的总和；单图与活动Canvas计数不是聚合RSS预算。只使用本地数据和包资源，禁用PDF JS eval/交互执行及网络加载，但不能将应用层限制当作引擎漏洞隔离。处理不可信 PDF 时仍需宿主部署操作系统级隔离及资源限制。

## 4. Producer、waiter 与配置

SharedOperationRegistry 只在同一进程内，按 CacheKey 和 Provider authority 合并 producer。每个调用拥有独立 waiter。

- waiter 取消、同步超时或 native job_kill 只结束该调用的等待。
- producer 的 AbortController 归共享操作所有，继续到成功、领域失败、operation timeout 或插件关闭。
- `MinerUService` 用 runProducer 覆盖实际生产生命周期；工具使用 runShared 覆盖解析等待、图片读取和最终预算。不能用 Promise.race 提前释放仍在 I/O 的使用记录。
- 重启不恢复旧 SharedOperation 或远端任务，但相同规范请求可以复用已发布结果。

每次操作使用配置快照；凭据仍在每次 Provider 调用时从 DSH credentials 或环境变量解析，不缓存密钥。

`parseConfig` 是唯一配置解析入口，拒绝旧 flat config、未知 schemaVersion、未知字段和 retainSources=true。parseMethod/ocr 一次性规范化；设置页切换到不支持 txt 的 Provider 时明确提示调整。

storageRoot 与 limits.* 在启动时固定。运行中保存不同值会被拒绝；修改宿主配置并重启才生效。其余允许的 live 更新只影响之后的执行。数字输入保留临时空白／非法草稿，失焦后恢复或收敛，不在每次击键时强行覆盖。

## 5. 存储布局与发布

```text
$DSH_HOME/cache/pdf-mineru/
  results/sha256/<key-prefix>/<cache-key>/
    manifest.json
    files/<file-id>/
      full.md
      content_list.json
      layout.json
      model.json
      images/
  staging/<operation-id>/
  quarantine/
  .process.lock                  persistent protocol-v2 fence
  .lock/claims/<unique-owner>/    choosing presence, then atomic ticket
  .lock/users/<unique-owner>/     reader/producer use record
```

Staging 写入经大小、SHA-256、UTF-8、JSON、manifest 一致性和目录内容校验后，以同文件系统 atomic rename 发布。EXDEV 是错误，禁止 copy fallback。结果祖先逐级验证／创建，不允许沿符号链接写出配置根目录。

同一缓存身份的首个有效发布结果获胜，即使独立 OCR/VLM 执行输出字节不同。比较源 SHA/bytes、语义、所需产物与兼容身份，不把原始文件名加入等价条件。旧的有效结果不因新竞争结果而被覆盖或隔离。

普通 get 不修改存储。损坏结果返回可操作的 CACHE_CORRUPT，要求显式维护；不能在共享使用记录仍活跃时偷偷移动已发布目录。生产者私有 staging 的失败清理与已发布结果隔离是两类不同权限。

cacheEnabled=false 仅禁用解析前的命中复用，结果仍然不可变发布；它不是不存储或强制覆盖开关。没有自动结果容量／时间驱逐。

## 6. 多进程协调与升级

### 支持边界

只支持同一主机、同一 PID 可见命名空间、支持 hard link 与一致原子目录操作的本地文件系统。不承诺 NFS、跨主机或 PID 互不可见的容器共享。源码可使用的 API 与实际验证的平台不是同一承诺；本轮实际验收环境为 Linux。

### ProcessLock

文件系统 Lamport bakery 使用永不复用的 claim 目录，目录名原子携带 host fingerprint、PID 和随机身份。创建目录即 choosing；选择 ticket 时不等待其他 choosing，发布后按 `(ticket, id)` 排队。后来的较小随机 ID 不能抢占当前临界区。

同一实例也必须走 FIFO。isHeld 仅供诊断，不是当前异步调用的授权。内部嵌套变更传递显式 ProcessLockScope 并验证其属于当前获取，不能隐式重入。排队可取消、有有限等待。

只在同主机 PID 已确认 ESRCH 时删除该 owner 的唯一目录。PID 活跃、foreign host、权限不明、格式损坏均 fail closed；不按 TTL 偷锁。

### 使用记录与维护

runShared/runProducer 在 mutation scope 中登记唯一 `.lock/users/` 目录，结束后只移除自己的目录。取消等待不会移除独立 producer 的记录。

破坏性维护先检查本地操作与跨进程使用者，再在 mutation scope 内复查。发现活跃或不可验证使用者时 fail-fast，不以排队 writer 阻塞嵌套 producer。已发布 quarantine 即使直接调用仓储，也必须遵守这项检查。

启动 staging TTL 清理同样受 scope 和使用记录保护；staging 根或祖先符号链接不能被跟随。TTL 只决定候选年龄，不证明 producer 已死亡。

### 升级与人工恢复

`.process.lock` 是持久的 v2 协议隔离标记，以唯一临时文件 + hard link 原子 no-replace 发布。其有效 foreign-host payload 使旧 v1 拒绝使用旧锁路径；实际锁位于 `.lock/claims/`。

升级必须先停止所有共享目录的旧实例，再统一更新。发现旧锁或不兼容记录时不自动猜测恢复：确认没有旧进程、读者、producer 后才可人工清理不兼容协调记录。**不要在任何相关进程运行时删除 `.process.lock` 或 `.lock/`。** 正常退出保留版本标记是预期行为。

## 7. Provider 与网络安全

Self-hosted v2 使用 multipart POST /tasks、GET /tasks/{taskId} 与结果端点，显式 modelMap 将统一 model 映射为 backend。Official v4 先 POST /file-urls/batch，再按预签名 URL 裸 PUT，随后轮询 batch 结果并下载 ZIP；按 data_id 映射，不猜测相似文件名。

- 鉴权请求固定 redirect:error。官方 PUT 显式空 headers；CDN 下载不带 API Token。
- 只重试幂等 GET，以及重新打开源文件流的官方 PUT。提交结果不明确的官方分配 POST／自托管 multipart POST 绝不自动重放。
- 处理有界退避、Retry-After、取消和耗尽；重试诊断只含 typed operation/status/count，不含 URL、header、body、密钥和路径。
- 源文件流式哈希，上传前复核 size/mtime/device/inode，不能把变化后的文件上传到旧缓存身份。
- ZIP 使用 yauzl lazy entries，先验证路径、类型、声明大小和压缩比，再逐条目流式写入 staging。限制下载、条目数、单条目、总解压量；拒绝绝对路径、遍历、符号链接和压缩炸弹。
- compatibilityKey 表示输出兼容范围，不包含明文 URL 或凭据；probe 不是虚构健康／容量保证。

## 8. 运维与验证

以 DSH `v0.1.5-rc.2` 为最低宿主基线，不保留 `v0.1.2-rc.1` 兼容分支。RPC 在 `connection` 与 `webServer` 同时可用的注入作用域注册；缺少任一服务时不影响两个模型工具。`registerLoopbackRpc` 使用调用方局部 Context 元数据提供带 Host 回环检查的路由注册器，解决 Cordis 服务 getter 将依赖查找指向 Connection 提供方的问题；不修改全局服务。原生 Connection 继续负责认证、Origin 检查、消息封装和取消，插件不依赖已不受支持的 `authority` 参数。错误封装遵循 rc.2 的 `code`、`message`、`details` 契约。

运维 RPC 保持 loopback-only，不暴露任意路径读取。完整性扫描和 quarantine cleanup 默认只读／dry-run；隔离、缓存清除、实际清理都要求显式确认。GC 只提供预览。无法证明遍历完整、安全、无活跃使用者时，不执行破坏性计划。

统计的大小和逻辑数量来自同一次条目／深度／时间有界遍历；无效条目也消耗遍历预算。根及祖先符号链接不被跟随，只读检查不为了初始化而写入锁文件。complete/truncated/depthLimitCount 贯通响应，GUI 将不完整总量标为下界。

```sh
pnpm run build
pnpm run typecheck
pnpm test
git diff --check
pnpm run verify:gui
```

默认全部使用 fixture/mock。关键回归包括真实子进程互斥及崩溃回收、reader 对抗 clear/quarantine、活跃 producer 与取消、源／产物路径安全、cursor 实际拼接、Native token、图片实际预算、严格 SDK schema 和 Provider 协议边界。

GUI 脚本在既有 DSH Web shell 注入当前构建 bundle，使用隔离 RPC／凭据 fixture，检查桌面／移动布局、配置与维护交互；不是对真实 Provider 的在线验收。截图保存在忽略目录 `.vitest-cache/gui/`。后端部署需遵守统一重启要求，不以开启另一个 Vite server 代替现有 GUI 更新。

### 有意保留的限制

- 跨进程安全不等于跨进程 Provider exactly-once；独立进程仍可能分别提交并计费。
- 每次独立读取仍做源哈希及必要深度完整性校验，没有全局无界 memo 或持久阅读索引。
- 普通正文阅读仍在 64 MiB 硬上限内重建文本，不是任意大小的流式 Markdown AST。
- 不实现远端任务跨重启恢复、源文件保留、自动结果驱逐、跨主机锁或 result_id 无源读取。
