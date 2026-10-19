# PDF 阅读契约（read_pdf / async_parse_pdf）

本文是两个模型工具行为的唯一说明，面向编写提示词、调用工具或审查输出的人。模型在运行时看到的是工具 schema 和描述，内容与本文一致。Provider 配置见[配置与运维指南](configuration.md)，实现约束见 [ARCHITECTURE](../ARCHITECTURE.md)。

## 工作流

正常阅读都在 `read_pdf` 内完成，不需要先找缓存文件或执行 shell：定位 → 精读 → 续读 → 原页核对。下面的示例用 `file_path`，也都可以换成 `attachment_id`。

**定位**：先看目录，或用短关键词检索。

```json
{"file_path":"paper.pdf","focus":"toc"}
```

```json
{"file_path":"paper.pdf","query":"图 7"}
```

`query` 是 1–256 个字符、不区分大小写的字面检索，不是正则或语义检索。空格有意义："图7" 与 "图 7" 不同。检索返回命中处的上下文片段和完整 `block_id`，不是整个命中块。

**精读**：用返回的块 ID 读完整块，或按物理页和内容类型选择。

```json
{"file_path":"paper.pdf","block_id":"<返回的完整块ID>"}
```

```json
{"file_path":"paper.pdf","pages":"7-8","focus":"text","inline_images":false}
```

页码是从 1 开始的物理页，不是论文的印刷页码。块 ID 在筛选前分配，绑定当前解析结果；不同 Provider 或解析配置产生的 ID 不能混用。目录中的标题也只是一个块，读到标题不等于读完整节。

**续读**：`content_status` 为 `partial` 时，原样传回 `cursor`，并保持同一个来源字段和值。

```json
{"file_path":"paper.pdf","cursor":"<上一响应的原样 cursor>"}
```

续读时不要再传 `pages`、`focus`、`block_id` 或 `query`。`cursor` 为 `null` 时停止，不要把 `null` 传回去。

**原页核对**：对关键公式、数值和图表，回看原页图像。

```json
{"file_path":"paper.pdf","view":"page","pages":7,"expected_sha256":"<此前返回的 source_sha256>"}
```

## 来源选择

两个工具（包括 `read_pdf` 的正文、续读和原页模式）都接受 `file_path` 或 `attachment_id`。schema 中两者都是可选字段，但每次调用必须且只能提供一个。

**`file_path`**

- 相对路径按当前会话的工作目录解析，也就是 DSH 中 `working_directory` 切换后的目录。路径在工具调用开始时解析一次。
- `async_parse_pdf` 在提交时就确定绝对路径，之后会话切换目录不影响已提交的任务。

**`attachment_id`**

- 接受完整的 `sha256:<64 位十六进制>`，或 8–64 位十六进制摘要前缀（`sha256:` 前缀可省略）。
- 只在当前会话可见的消息中查找文件引用，包括工具结果消息中的文件。已被压缩移出上下文的引用不可见，也不会搜索全局附件库。
- 同一内容 ID 被多次引用不算歧义；前缀匹配到多个不同内容 ID 时报错，需要更长的前缀或完整 ID。
- 附件由 DSH 管理。宿主不提供附件本地路径时返回 `UNSUPPORTED_OPTION`，请改用 `file_path`。

续读时保持同一个来源字段和值是调用约定。游标本身不记录来源字段，运行时校验的是结果和文本投影的身份。

## 参数速查

| 参数 | 适用 | 说明 |
| --- | --- | --- |
| `file_path` / `attachment_id` | 全部 | 来源，二选一 |
| `pages` | `read_pdf` | 物理页：`3`、`[1, 2, 5]` 或 `"1-3, 5"` |
| `focus` | `read_pdf` | `all`（默认）、`text`、`table`、`image`、`toc`、`artifacts`，可传数组 |
| `query` | `read_pdf` | 字面检索；与 `block_id` 互斥，不能与 `toc`、`artifacts` 组合 |
| `block_id` | `read_pdf` | 原样使用此前返回的块 ID |
| `cursor` | `read_pdf` | 原样传回；与 `pages`、`focus`、`block_id`、`query` 互斥 |
| `inline_images` | `read_pdf` | 是否希望附带图片，见[图片](#图片) |
| `view` | `read_pdf` | `content`（默认）或 `page` |
| `expected_sha256` | `read_pdf` | 仅 `view: "page"`；64 位小写十六进制 SHA-256 |
| `poll_timeout_ms` | `read_pdf` | 同步等待解析的上限（毫秒，1–86400000） |

工具不接受 `model`、`ocr`、`backend` 等解析参数；解析方式由设置决定。

## 响应字段

**正文与进度**

- `markdown_content`：本次交付的所选文本。各次续读的内容按顺序拼接，等于同一选择的完整文本。
- `content_status`：`partial` 表示还有剩余，必须用 `cursor` 继续；`complete` 表示所选文本已交付完；`not_requested` 表示本次请求不含正文（如产物清单、原页视图）。query 模式下"所选文本"是检索摘要。
- `cursor`：`partial` 时为非空字符串，否则为 `null`。
- `continuation_block`：长块跨响应时标明当前内容所属的块，不会为了定位而重复正文。

**`complete` 只表示所选解析文本交付完成，不保证 OCR 正确，也不保证图片已全部展示。** 请同时检查下面的字段。

**质量与核验**

- `diagnostics`：带稳定 ID、`code`、`scope`（document / selection / chunk）、`message`，以及可用的块 ID 和页码。块级诊断只覆盖本次实际交付的块；文档级和选择级提示只在首次响应出现。
- `warnings`：范围和执行提示，例如页码越界、图片未附带。不要只看它而忽略 `diagnostics`。
- `verification_hints`：建议对公式回看原页，给出块 ID、页码和 `view: "page"`。它不表示检测到了错误，也不会自动修正。
- `metadata_shortened`：因预算未完整列出的元数据类别（summary、provenance、diagnostics、verification_hints、warnings）。缺少这些字段不代表没有问题；可以缩小选择后再看。

插件会规范化已知的正文、代码、行内公式和嵌套 span 结构，表格保留原始 HTML、标题和脚注，参考文献保留原编号和顺序。不认识的结构保留原样并给出诊断，不猜测修正 OCR：不会自动替换符号，也不会填补缺失的数值。发现异常时先核对原页，不要把解析缺失当成原文缺失。

**来源与页数**

- `provenance`：`provider`、`model`、`parse_method` 是该缓存结果实际使用的解析配置；4.x V1 用档位而不选模型，因此 `model` 为 `null`。`upstream_version` 目前总是 `null`，表示上游引擎版本未知；`index_version`、`reader_version` 是插件自身的索引和阅读协议版本。
- `summary.page_count` 与 `page_count_source`：`layout`、`pdfinfo`、`pdfjs` 是可靠的物理页数；`content-list-lower-bound` 只是已知页坐标的下界，不能证明后面的页不存在或为空。
- `source`：`cache`、`shared-operation`、`provider` 或 `local`（原页视图）。`source_sha256` 是源文件摘要，可作为原页核对的 `expected_sha256`。

**在 run_code 中调用**

嵌套调用时，工具的展示元数据只是一份紧凑摘要（结果 ID、来源、缓存命中、`content_status`、是否还有后续、各类计数、原页渲染器），不包含正文和游标。证据在工具返回值里：请保留 `markdown_content`、`content_status`、`cursor`、`diagnostics`、`verification_hints`、`warnings`、`metadata_shortened` 和定位信息，不要打印整个调试对象。

## 图片

`inline_images` 表达调用者的意图，实际是否附图还取决于环境：

| 场景 | 意图 | 实际附图 |
| --- | --- | --- |
| 首次调用省略 | 默认 `true` | 取决于模型是否支持图像、附件服务和图片预算 |
| 首次 `false`，续读省略 | 继承 `false` | 不附图 |
| 续读显式 `true` / `false` | 覆盖，并写入下一个游标 | 仍受能力和预算限制 |
| 当前模型不支持图像、无附件服务或预算为 0 | 不改写已保存的意图 | 本次不附图 |

- 图片随它所在的块一起交付，不提前给出后文的图，也不在续读时重复前文的图。
- `visuals` 统计本次响应列出、附带和省略的图片数，不是全文的图片覆盖率。
- `document_label` 是原文中的图、表、公式标签。`figure` 只是本次附件的序号，不是论文图号。多面板图可能分散在多个块中，拿到一个标为"图 8"的块不代表拿到了所有面板。

## 预算

| 项目 | 约束 |
| --- | --- |
| 响应预算 | 默认 12,000 个 UTF-16 单元（`output.maxInlineChars`），分别约束 JSON 结果和文本展示，包含元数据和游标 |
| 单次正文 | 最多 8,000 个 UTF-16 单元，不随响应预算增大 |
| 响应字节 | JSON 结果和文本展示各最多 48,000 个 UTF-8 字节 |
| 图片数量 | 默认 6，可配置 0–100（`output.maxInlineImages`）；0 同时禁用原页模式 |
| 图片字节 | 单张最多 8 MiB，单次响应合计最多 24 MiB |
| 正文重建 | 解析产物读取上限 64 MiB，不是无限流式处理 |

预算连必要元数据都放不下、或无法推进正文时，工具明确报错，不返回原地打转的游标，也不返回被截断却标为 `complete` 的正文。默认响应不重复列出缓存路径；需要导出时用 `focus: "artifacts"`。

## 原页核对

`view: "page"` 只接受一个来源、恰好一页的 `pages` 和可选的 `expected_sha256`，不接受其他选择或呈现参数。

- 需要支持图像的模型、DSH 附件服务和大于 0 的图片预算，这些条件在读取源文件前检查。
- 在本地渲染，不上传文件、不调用 Provider，也不依赖解析缓存。结果为 `source: "local"`，并带 `renderer: "poppler"` 或 `"pdfjs"`；只有原页结果有 `renderer` 字段。
- 提供 `expected_sha256` 时，源文件已变化会在渲染前被拒绝。
- 优先用 Poppler；Poppler 缺失或无法执行时自动改用 PDF.js，不会先返回一次依赖错误。损坏、加密、页码越界、摘要不匹配、取消、超时和资源超限都不会触发后端切换。两个后端都不可用时返回 `UNSUPPORTED_OPTION`。
- 两个后端在字体、抗锯齿和透明度上可能有差异，不保证像素一致。

渲染器的尺寸、时间和并发限制不是操作系统级沙箱。具体数值见 [ARCHITECTURE · 原页渲染](../ARCHITECTURE.md#原页渲染)。

## 错误与恢复

| 情况 | 做法 |
| --- | --- |
| `[BLOCK_NOT_FOUND]` | 块 ID 不属于当前结果或不在所选范围内；重新检索，不要跨解析结果挪用块 ID |
| `[SELECTION_UNAVAILABLE]` | 缺少可靠的页码或类型映射；去掉页码筛选、改用 `block_id`，或用原页核对，不要猜页码 |
| `[PAGE_OUT_OF_RANGE]` | 只有在页数可靠时才判定越界；调整页码 |
| 游标无效、过期或版本不符 | 不带 `cursor` 重新开始。游标是有界、无签名的定位信息，不是授权凭证 |
| `CACHE_EVICTED` | 续读时结果已不在缓存中。续读从不重新解析，请不带 `cursor` 重新读取 |
| `CACHE_CORRUPT` | 已发布结果损坏；需要在设置页做维护，插件不会自动覆盖 |
| `POLL_TIMEOUT` | 同步等待超时，解析仍在进行；用相同参数重试即可加入同一次解析，或改用 `async_parse_pdf` |
| `UNSUPPORTED_OPTION` | 当前环境缺少所需能力（附件路径、图像能力、渲染后端等）；按消息提示改用其他方式 |

续读只读取已发布的结果，即使关闭了缓存复用也一样。解析结果本身有误时，重新读取不能恢复真值；先核对原页，再决定是否调整解析配置。没有强制重新解析或覆盖旧结果的工具参数。

更新插件后，宿主需要重新加载工具定义；只重新构建源码或刷新 Web 页面不等于后端已经重载。

## 后台解析

- 长文档可以先调用 `async_parse_pdf`。它立即返回 DSH 签发的任务 ID（形如 `mineru-3f9c…`，格式由 DSH 决定，不要解析它），然后用通用的 `job_output`、`job_list`、`job_kill` 管理。
- 进度只显示阶段：准备、等待解析、读取结果、整理摘要，不表示页数或百分比；缓存命中时跳过等待阶段。
- 完成后，任务结果是一份结构摘要（页数、大纲、表格和图片数等），有独立预算，不等于读完全文。摘要在任务结束后的首次读取中交付，之后的 `job_output` 不保证重复返回，请保留首次读取的内容，再用 `read_pdf` 获取证据。
- `job_kill` 只取消这一次等待；其他调用共用的解析会继续。通知和空闲唤醒由 DSH 负责。
