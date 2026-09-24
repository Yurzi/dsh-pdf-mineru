# 面向模型的 PDF 阅读指南

适用于 dsh-pdf-mineru 0.1.3（最低 DSH 0.1.7-rc.2）：索引版本2、阅读协议/游标版本3。安装与Provider配置见[README](../README.md)，实现和安全约束见[ARCHITECTURE](../ARCHITECTURE.md)，历史变化见[CHANGELOG](../CHANGELOG.md)。

## 1. 推荐工作流

正常阅读应在 `read_pdf` 内完成“定位 → 精读 → 续读 → 原页核对”，无需先找缓存文件或执行 shell。以下是工具参数示例，替换文件路径和返回的块 ID 后使用。

### 选择本地文件或会话附件

`read_pdf`（content、cursor、page）和 `async_parse_pdf` 均接受 `file_path` 或 `attachment_id`，两者互斥。schema 中两个字段均可选，运行时必须且只能提供一个。下文的 `file_path` 示例也可替换为 `attachment_id`：

```json
{"attachment_id":"<当前可见附件的完整内容ID或唯一摘要前缀>","focus":"toc"}
```

- 接受完整 `sha256:<64位十六进制摘要>`，或 8–64 位十六进制摘要前缀；`sha256:` 前缀可省略。多个不同内容 ID 匹配时明确拒绝，需补长前缀或使用完整 ID；同一内容 ID 的重复引用不算歧义。
- 仅在当前会话 `deriveMessages()` 的可见消息中查找 `file` 引用，包括独立 `role: "tool"` 消息的平坦内容，不查全局存储，也不恢复已压缩移出的引用。找不到时请重新提供可见附件或使用已有本地路径，不猜测附件路径。
- 匹配到的真实引用原样交给 DSH `fileHostPath`。DSH 拥有存储文件；缺少本地路径能力时返回 `UNSUPPORTED_OPTION`，不把附件流另存为临时文件。现有源文件校验、缓存和 Provider 行为不变；附件 ID 不是新增的完整性保证。
- 续读必须原样传回 cursor，调用方应保持同一来源选择器（字段及值），不同时传两个来源；附件续读仍要求引用当前可见、源文件可用。这是调用约定，游标不绑定选择器字符串，运行时仍按既有结果／投影身份校验。

### 定位目录或关键字

```json
{"file_path":"paper.pdf","focus":"toc"}
```

```json
{"file_path":"paper.pdf","query":"图 7"}
```

`query` 是1–256字符、不区分大小写的字面检索，不是正则表达式或语义检索。空格保留语义：“图7”不等于“图 7”。检索返回命中上下文和完整 `block_id`，不是整个命中块。

### 精读证据

```json
{"file_path":"paper.pdf","block_id":"<返回的完整块ID>"}
```

```json
{"file_path":"paper.pdf","pages":"7-8","focus":"text","inline_images":false}
```

```json
{"file_path":"paper.pdf","pages":14,"focus":"table"}
```

页码为从1开始的物理页码，不是论文印刷页号。块 ID 在筛选前分配，绑定解析结果；不同 Provider/解析配置产生的 ID 不可互换。目录标题也是单个块，读取标题块不代表读取整节。

### 续读

```json
{"file_path":"paper.pdf","cursor":"<上一响应的原样cursor>"}
```

- `partial`：必须继续；保持同一来源选择器（`file_path` 或 `attachment_id`）并传回游标，不重复 pages/focus/block_id/query。
- `complete`：本次选择的解析文本已交付完成；此前各块的 `markdown_content` 应顺序拼接。query 模式的“选择”是检索摘要。
- `not_requested`：当前请求不要求正文，例如仅导出产物清单。
- `cursor` 总是存在，结束时为 `null`；此时停止，不将 null 再作为输入。
- 长段落/目录项跨响应时，`continuation_block` 标明来源；不会为了补定位而重复正文。

### 原页核对

```json
{"file_path":"paper.pdf","view":"page","pages":7,"expected_sha256":"<此前返回的source_sha256>"}
```

`expected_sha256` 可省略；提供时会拒绝已变化的源文件。page模式仅接受一个来源选择器（file_path 或 attachment_id）、单页pages及可选expected_sha256，不接受文本选择或呈现参数。原页结果为 `source: "local"`，不调用Provider。仅原页响应包含 `renderer: "poppler"` 或 `"pdfjs"`；Native展示同一标识，普通文本不添加该字段。成功自动回退不会先返回一次依赖错误。

## 2. 图像呈现设置

在 Web 的 **Plugins / 插件 → dsh-pdf-mineru** bundle 配置页中展开输出配置卡片可调整内联图像预算，修改后需保存配置；宿主通过 Config volatile 引用更新后续调用的预算，当前解析仍使用自己的配置快照。卡片布局与折叠状态不改变本指南的阅读协议、缓存键或游标语义。

`inline_images` 表示调用者意图，与当前环境是否能实际附图分开：

| 场景 | 意图 | 实际附图 |
|---|---|---|
| 首次省略 | 默认true | 取决于模型、附件服务和预算 |
| 首次false，续读省略 | 继承false | 不附图 |
| 续读显式true/false | 覆盖并写入下一游标 | 仍受能力和预算限制 |
| 暂时使用文本模型、没有附件服务或预算为0 | 不改写已保存意图 | 本次不附图 |

`visuals` 描述本次列出的图像候选、已附图像与未附图像。它不是整篇论文的图像完整性证明；预算缩减时相关说明会明确指出元数据省略。索引图像在对应块开始交付时附加，不在后续正文块反复附上同一图。

`document_label` 是原文图表标签，与本次第几个附件不同。多面板图可能分散在多个块中；拿到一个标有“图8”的块，不保证已拿到其所有面板。此时应查看原页。

## 3. 内容质量与诊断

**文本complete不保证OCR正确，也不保证图像已全部展示。**

- `diagnostics`：有稳定ID、code、scope、message，以及可用的完整block_id和物理页码。块级诊断针对当前交付内容，目录/表格/搜索不会夹带无关正文问题。文档/选择范围提示首次交付时出现；同一长块续读中的相关诊断可再次出现，但ID保持一致。
- `warnings`：保留兼容的范围/执行提示，例如页码范围或图像未附加；不要只检查该字段而忽略diagnostics。
- `verification_hints`：当前公式的原页核验建议，不表示已检测到公式错误。
- `metadata_shortened`：因预算没有完整列出的元数据类别；可以缩小选择或提高预算查看，不能将其省略当作没有问题。

支持的正文、代码、嵌套lines/spans与内联数学会被正规化。表格保留原始HTML、caption及脚注。`list/ref_text/list_items` 中已知字符串条目保留原编号、顺序和条目内部换行；flat `ref_text` 同样可读。未知对象不会被转换成 `[object Object]`，也不会盲目递归拼接未知结构。非空表示冲突时保留既定优先表示并告警。

少量明确的中文空值槽会标为疑似缺失，但诊断不穷尽所有OCR错误。插件不会自动把乘号改成析取符号，也不会猜填θ、EOS、B或统计数值。发现异常时先核对原页，不能把解析缺失直接认定为论文缺失。

## 4. 解析来源、页数与版本

首次响应的 `provenance` 区分：

- `provider`、`model`、`parse_method`：该缓存产物的实际解析配置。
- `upstream_version`：真实上游引擎版本；目前未知时为null。official-v4/self-hosted-v2是接口身份，不是OCR引擎版本。
- `index_version`、`reader_version`：当前索引与阅读协议版本，不冒充上游版本。

`summary.page_count_source` 区分layout/pdfinfo/pdfjs的页数与content-list推算的页数下界。有权威页数时，完全越界报错、部分越界提示；没有时不把尾部未解析页面误判为不存在。按页筛选若会静默丢掉相关的无坐标块，则拒绝该筛选。

### 升级规则

0.0.14起使用游标v3，0.1.3保持游标v3及索引v2；旧v1/v2 token明确过期，需要不带cursor重新读取。**解析缓存无需迁移或重新上传。**

游标是有界、无签名、无服务端会话状态的定位token，不是授权凭证。它绑定结果、文本投影、产物摘要、索引/阅读版本及选择。源文件仍须存在并保持一致。

- 索引修复：重用已发布产物，按当前实现重新投影。
- 续读：只读取已发布结果，即使普通缓存复用被关闭也不会重新解析；结果丢失报CACHE_EVICTED，产物或投影改变则要求重新开始。
- 上游已错：重新投影不能恢复真值；应先核对原页，再明确决定解析配置与缓存管理策略。没有自动force-reparse或覆盖旧结果的接口。

更新插件后需让宿主重新加载工具定义；重新构建源码或刷新Web页面不等于后端已经重载。

## 5. 预算与安全边界

| 项目 | 当前约束 |
|---|---|
| 响应预算 | 默认12,000个UTF-16单元，分别约束JSON与Native文本，包含元数据和游标 |
| 单块正文 | 最多8,000个UTF-16单元，不随更大的响应配置无限增长 |
| JSON/Native字节 | 各最多48,000个UTF-8字节 |
| 内联图像数量 | 默认6，可配置0–100；0禁用图像，也禁用原页模式 |
| 正文重建 | 在64MiB产物读取上限内完成，不是无限流式Markdown处理 |

必要元数据也无法装入预算、或无法取得正文进展时明确报错，不返回空转游标或带误导complete的截断正文。

在run_code中保留需要的markdown_content、content_status、cursor、diagnostics、verification_hints、warnings、metadata_shortened和定位信息，避免打印整份调试对象。小块只能降低常见省略风险，不能保证任意外层日志或后续上下文裁剪都无损。

### 本地原页依赖

优先运行 PATH 中的 Poppler（pdfinfo、pdftoppm）。仅找不到命令或明确无法执行（ENOENT/EACCES/EPERM/ENOEXEC/ENOSYS）时，自动用正常安装依赖中的 PDF.js 6.3.289 + @napi-rs/canvas 1.0.9 运行原页。无需系统安装 Poppler，但 Canvas 仍需相应平台原生二进制与系统 ABI；支持范围、安装体积及恢复方式见[README](../README.md#本地原页渲染的安装条件)。不新增模型参数或持久设置。

图像模型、附件服务及大于0的图像预算在源文件读取前校验。源身份与可选摘要匹配后，两后端使用同一私有临时快照；不会因回退重新读取变化的原始路径。PDF.js快照另有200MiB硬上限（同时受更小的limits.maxFileBytes约束）；原始页边超过1,000,000 pt会在Canvas分配前拒绝。单页保持纵横比（包含旋转），最长边至多1600像素，PNG最多8MiB，同进程并发最多2；从入队、快照、Poppler能力/实际执行到PDF.js执行共享45秒截止时间。普通文本阅读不探测渲染器；没有永久负缓存，之后安装好Poppler可在下次请求恢复优先使用。

损坏、加密或不支持的PDF、页码越界、摘要/身份不匹配、取消、超时及资源限制均不是自动回退理由。两后端都不可用返回脱敏的 UNSUPPORTED_OPTION，提示安装Poppler或恢复平台依赖，不显示临时路径、内部命令行或原始错误。PDF.js无法处理的文档明确失败，不上传给Provider重试。

PDF.js重型解析与Canvas只在固定Node子进程运行；取消/超时会终止并等待退出，然后清理临时目录并释放同一个并发槽。输出文件增长、读取前后字节数及PNG尺寸、块结构/CRC/IEND统一校验；清理失败不覆盖已经确定的主要错误。字体、CMap、WASM从包内资源本地加载，不使用CDN或PDF内的远程资源，不执行PDF脚本/交互动作。不同引擎可能在字体、抗锯齿、透明度等处有保真差异，不能据此声称像素等价。

**这不是OS级隔离沙箱。** 512MiB V8 old-space与应用层画布检查不是总进程内存硬限制；PDF.js可能缓存同页多个解码图像，Buffer/typed-array backing、字体和WASM/原生内存不计入该V8堆限额。不承诺cgroup/rlimit级CPU/内存隔离，也不能隔离Poppler、PDF.js或原生Canvas的漏洞；不可信PDF应在受限容器或宿主中处理。

## 6. 导出、错误恢复与后台解析

- `focus: "artifacts"` 按需提供manifest、Markdown和其他产物路径；`full.md`仍可用于导出，但不能替代原页核对。默认阅读不重复返回缓存路径和完整目录。
- BLOCK_NOT_FOUND：重新搜索当前结果，不在不同解析结果间挪用块ID。
- SELECTION_UNAVAILABLE：没有可靠映射；缩小/调整选择，或使用原页核对，不能猜造页码。
- CACHE_CORRUPT：显式检查与维护缓存，不自动覆盖损坏的已发布结果。
- 长文档可先调用 `async_parse_pdf`，使用原生job_output/job_list/job_kill；完成后再按需read_pdf。后台摘要有独立预算，不等于全文已读。DSH 以 SessionId 隔离任务，原生进度表示准备／等待解析／读取结果／整理摘要，不表示已解析页数；缓存命中跳过等待。完成摘要通过 JobOutcome.result 在结算后的首次消费读取中返回，后续 job_output 不保证重复摘要；请保留首次读取内容，再用 read_pdf 获取证据。取消只终止该次等待，共用解析生产者不受影响；通知和空闲唤醒由宿主负责。

## 7. 开发者验收

默认测试使用fixture/mock，附件来源应覆盖：恰好一个来源字段、完整 ID／前缀边界、独立工具结果消息中的文件引用、同内容去重与歧义拒绝、当前可见范围、真实引用原样传给 fileHostPath、无路径能力的 UNSUPPORTED_OPTION，以及 content／cursor／page／后台入口；不得依赖全局存储扫描或流落盘：

```sh
pnpm run build
pnpm run typecheck
pnpm test
git diff --check
pnpm run verify:gui
```

显式选择的离线真实文档测试：

```sh
# 通用原页工具链，禁止网络访问；auto保留PATH，pdfjs使用空PATH触发回退
pnpm run smoke:reader-local -- /absolute/path/sample.pdf 1 .vitest-cache/page-auto --backend=auto
pnpm run smoke:reader-local -- /absolute/path/sample.pdf 1 .vitest-cache/page-pdfjs --backend=pdfjs

# rx033论文的专用缓存回放，分别传入self-hosted-v2/vlm和official-v4/pipeline的manifest
pnpm run smoke:reader-cache -- /absolute/path/rx033.pdf /absolute/path/manifest.json
```

缓存回放脚本核对源文件与所有产物的SHA-256、完整参考文献、图表/公式定位、文本保留、诊断范围、图像意图继承及输出schema。它针对已知案例，不接受任意论文替代；测试PDF和缓存需由有权限的开发者提供，不随仓库分发。**已有缓存回放不等于新的OCR质量测试。**

发布前还应检查实际tarball：运行 `pnpm pack --out .vitest-cache/dsh-pdf-mineru.tgz`，在独立临时项目内安装该包的生产依赖和DSH宿主peers（不要让pnpm误选父workspace）。再执行：

```sh
node scripts/smoke-reader-package.mjs /absolute/installed/node_modules/dsh-pdf-mineru /absolute/path/sample.pdf 1 .vitest-cache/page-package --backend=pdfjs
```

此脚本检查入口、生产依赖和包资源，并从无关cwd调用完整read_pdf工具链。也可将两个smoke脚本复制到该临时项目，使验收脚本自身仅使用生产安装的宿主包。真实验收应覆盖嵌入中文字体、数学符号、双栏、横版/旋转与透明图形，并实际查看图片；对比引擎的字重、抗锯齿和图像编码差异，不把相同尺寸当作像素等价证明。PDF及验收图片只放忽略目录，不加入发布包。

GUI验收在现有DSH Web shell隔离加载当前client bundle，验证设置、凭据和维护交互，不启动替代服务器、不表示生产后端已热更新。测试产物保存在被忽略的 `.vitest-cache/`。
