# 面向模型的 PDF 阅读改进报告（0.0.13）

## 交付范围

已完成插件源码、构建产物、回归测试与模型使用文档。未发布 npm/GitHub Release，未创建提交或标签，也未重启当前 DSH；已经运行的宿主需要重新加载插件后才会向模型提供新增参数。

## 已实现能力

| 方向 | 实现 | 模型侧收益 |
|---|---|---|
| 小块交付 | 默认响应 12,000 UTF-16 单元；正文每块最多 8,000；JSON 与 Native prose 各自最多 48,000 UTF-8 字节 | 避免常见的 DSH 对象字符串展示省略；减少默认上下文占用 |
| 精简默认结果 | 默认不返回缓存路径和重复 TOC；产物导出用 focus: artifacts，目录用 focus: toc | 正文不再被调试元数据挤占 |
| 精确续读 | v2 游标绑定结果、选择、文本投影与 manifest 产物摘要；续读只读已发布缓存 | 缓存丢失或产物变化时失败关闭，不会悄悄重新上传/解析并从错误偏移继续 |
| 稳定证据定位 | 筛选前分配结果绑定的 block_id；区分原文 document_label 和附件序号；长正文/目录跨块提供 continuation_block | 按页筛选后不会把原文图7变成图1，长块也保留来源 |
| 文档内检索 | query 为 1–256 字符 Unicode-aware、不区分大小写的字面检索；命中返回摘要及 block_id | 可直接从检索结果读取完整块，不必依赖 full.md 行号 |
| 内容保真 | 恢复已知 lines/spans、内联数学和代码；空白 flat 字段可回退 nested；冲突时保留原有非空 flat 并告警 | 不静默丢弃已知内容，不用对象字符串污染正文，不猜填数字 |
| 真实 MinerU 兼容 | 支持 img_caption、chart_caption 等别名；从 caption 的后续段落识别原文标签 | 修复原审稿论文图7 caption 位于第二段的实际问题 |
| 质量提示 | 不支持/冲突结构、空内容和少量明确中文空值槽给出有界提示；优先保留严重问题；按页/块读取时限定告警范围 | 避免一般格式告警淹没后文关键缺失，提示原页核对而非替论文补写 |
| 图像覆盖 | 仅附当前正文块起始位置对应的图；visuals 报告实际列出与附加情况；元数据缩减有明确说明 | 正文 complete 不再被当成全部图像已看过 |
| 物理页数 | 区分连续 layout 页索引、pdfinfo 页数和 content-list 页数下界；混合缺失坐标的按页筛选失败关闭 | 不把尾部空白页误判为不存在，不静默漏掉无页码块 |
| 原页复核 | view: page 本地渲染单页，支持 expected_sha256 | 数字、公式、图表可直接回看原貌，不需要模型拼装 shell 命令 |

## 原页渲染的边界

依赖 Poppler 的 pdfinfo 和 pdftoppm。源码以流式复制和 SHA-256 校验生成私有临时快照，使用 shell-free 子进程；页码、源文件大小、输出字节、像素、运行时间和并发有应用层限制。最长边保持比例缩放至 1600 像素，PNG 最多 8 MiB，并发最多2，单次总运行时间45秒。取消等待子进程退出再清理；清理失败不覆盖原有类型化错误，也不泄漏临时路径。

**这不是操作系统级隔离沙箱**：没有承诺 cgroup/rlimit 级内存和 CPU 配额，也不能隔离 Poppler 本身的漏洞。不可信 PDF 应运行在受限容器/宿主中。

## 原始审稿论文的实际回归

使用授权的原始 rx033.pdf（19页）及其本地 MinerU 缓存，核对源文件 SHA-256、31项产物的路径、字节数和 SHA-256。整个回放禁止网络，**不是新一次 Provider/OCR 解析**。

- 全篇解析文本经新版接口分7块交付，总计53,561个 UTF-16 单元，每块不超过8,000。最终状态 complete、cursor 为 null。
- 第14–15页的选定内容为5,427个单元，能同时定位表4与图7。
- 查询“表 4”得到2个命中；精确 caption 查询可定位表4正文块。
- 查询“图 7”定位第15页原文图7，标签保持为“图 7”，而非本次返回的第1张图。
- 表4块 ID 为 `mr_bea1438aa5a55c4fbcbf943ffed83a6f:b172`，返回1,515个单元并保留 HTML 表格；图7块为 `mr_bea1438aa5a55c4fbcbf943ffed83a6f:b180`，返回137个单元的图像定位与 caption。这些 ID 来自该缓存结果，不是通用硬编码编号。
- 缓存的 full.md 和 content-list 中都已存在“中的 个函数契约子任务”“通过率为 和”等空值。原页第15页能看到相应的实际数值。插件保留原始解析证据、提示疑似缺失并提供原页，不自动恢复或猜填数值。
- 搜索是字面匹配：此文原始 caption 中带空格，因此“图7”与“图 7”的结果不同。尚未引入模糊/语义检索。

## 真实 PDF 原页测试

均通过构建后的插件工具执行链调用 view: page；测试禁止网络，并检查严格输出 schema、附件渲染、错误源摘要及越界保护。下列耗时是本机单次 smoke 观测值，不是正式性能基准。

| 来源/文档 | 页码 / 总页数 | 输出尺寸 | PNG 字节 | 单次耗时 |
|---|---:|---:|---:|---:|
| 系统 pigz.pdf | 1 / 3 | 1237×1600 | 382,069 | 424 ms |
| Zotero VUDDY 双栏论文 | 4 / 20 | 1237×1600 | 587,871 | 578 ms |
| 中文 CCF 目录 | 3 / 72 | 1600×1134 | 140,544 | 204 ms |
| 原审稿 rx033.pdf | 15 / 19 | 1133×1600 | 503,300 | 390 ms |

原始 PDF 与缓存内容没有加入仓库；测试产物仅位于被忽略的 .vitest-cache。

## 验证结果

- `pnpm run build`：通过，已更新 lib 构建产物和类型声明。
- `pnpm run typecheck`：通过。
- `pnpm test`：**28个测试文件，517个测试全部通过**。
- `git diff --check`：通过。
- `pnpm run verify:gui`：通过；现有 Web shell 的 Provider 切换、保存、凭据 UI、维护界面均正常，errors 为空，桌面/移动端无横向溢出。
- 4份真实 PDF 的本地原页工具链测试：全部通过。
- 原审稿论文缓存回放：通过；最终版本优先展示了 block 119、124、155、174、176、181、182 等位置的疑似空值提示，没有被前面的普通格式告警挤掉。上述提示只是核对线索，不是对原文错误的认定。

## 验证命令

```sh
pnpm run build
pnpm run typecheck
pnpm test
git diff --check
pnpm run verify:gui

# 通用单页原貌验证，无上传
pnpm run smoke:reader-local -- /absolute/path/sample.pdf 1

# 原审稿论文案例的已有缓存回放，无上传
pnpm run smoke:reader-cache -- /absolute/path/rx033.pdf /absolute/path/manifest.json
```

GUI 验证在现有 http://127.0.0.1:3080 的 DSH Web shell 内隔离加载当前 client bundle，验证 Provider 切换、设置保存、凭据 UI、维护界面以及桌面/移动端布局；不启动替代服务器，不表示当前后端工具定义已热重载。

## 兼容与保留项

- 仍只有 read_pdf 和 async_parse_pdf 两个模型工具；后台任务、Provider、缓存发布和存储维护的归属未改变。
- 已发布解析缓存不迁移；旧 v1 阅读游标明确失效，需不带 cursor 重新读取。
- 即使禁用普通缓存复用，已有游标也只续读其已发布结果；找不到结果就报错。
- 保留 full.md 导出能力；不将“禁止读取全文产物”当作成功指标。
- 未实现区域 bbox 裁剪、向量检索、一般化 OCR 纠错或自动表格数值推导。复杂表格保留原始 HTML，不冒充已经完成通用结构化表格理解。
- 小块与精简结果降低外层省略风险，但无法保证任意 run_code 自定义打印、额外日志、后续消息裁剪都无损。Native 紧急超限会明确报错，不保留误导的 complete 声明。

## 主要实现文件

- `src/service/document-index.ts`：稳定块索引、已知内容结构保真与质量提示。
- `src/service/read-delivery.ts`、`read-cursor.ts`：有界交付、原子定位范围、来源信息与摘要绑定的续读。
- `src/service/page-renderer.ts`：本地原页复核。
- `src/service/mineru-service.ts`、`src/tools.ts`：读、搜、按块读取、页数边界和模型工具集成。
- `tests/model-reading.spec.ts`、`document-index.spec.ts`、`page-renderer.spec.ts`、`page-tool.spec.ts`：模型工作流、保真与失败路径回归。
- `scripts/smoke-reader-local.mjs`、`smoke-reader-cache.mjs`：可复现的离线真实文档验收。
