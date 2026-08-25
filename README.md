# dsh-pdf-mineru

DSH MinerU 文档解析插件。模型通过统一工具接口使用自托管 MinerU v2 或 MinerU 官方云 v4；Provider 差异、上游任务 ID、预签名地址和 ZIP 结果不会暴露给模型。

## 能力

- 自托管 v2：`GET /health`、multipart `POST /tasks`、任务轮询和 JSON 结果收集。
- 官方 v4：`POST /file-urls/batch`、裸 PUT 上传、`GET /extract-results/batch/{batch_id}`、安全 ZIP 收集。
- 会话 Job：每次提交创建独立 `job_id`，只能由创建它的 DSH Session 查询。
- 全局结果缓存：按源 SHA-256、规范解析语义、产物集合、Provider compatibility key 和 schema 版本寻址。
- 单进程请求合并：相同 CacheKey 只提交一次上游解析，每个会话仍保留独立 Job；单个等待者取消不取消 producer。
- 持久恢复：上游接受任务后立即持久化不含秘密的 ProviderJobRef，重启后可继续轮询和收集。
- staging、完整校验、原子 rename 发布、损坏缓存隔离和 storageRoot 进程锁。
- 安全网络重试：幂等 GET 与官方裸 PUT 使用有界 backoff/Retry-After；模糊提交 POST 不重放。
- loopback 存储运维：统计、只读完整性扫描、GC preview、quarantine 列表和二次确认清理。
- 结构化诊断只记录 Job/operation、Provider、阶段、耗时、字节、重试计数和标准错误码。

当前模型工具每次只接受一个文件。领域请求和 Provider 接口保留文件数组，以支持后续按文件缓存的批量 fan-out/fan-in。

## 安装

```sh
dsh plugin --profile web add dsh-pdf-mineru

# 本地 checkout
dsh plugin --profile web add link:/absolute/path/to/dsh-pdf-mineru
```

从 git 安装且使用 pnpm 10+ 时，在 profile 的 `pnpm-workspace.yaml` 允许该包的构建脚本。

## 配置

配置通过 DSH Settings 的 `dsh-pdf-mineru` namespace 持久化。`cordis.patch.yml` 只提供首次启动默认值。API Token 只保存于 DSH credentials 或环境变量中，配置仅保存 credential reference。

### 自托管 v2

```yaml
schemaVersion: 1
activeProvider: mp_self_hosted
providers:
  - id: mp_self_hosted
    type: self-hosted-v2
    baseURL: http://localhost:18000
    apiKeyEnv: MINERU_API_KEY
    allowInsecureHttp: true
    modelMap:
      pipeline: pipeline
      vlm: vlm-engine
defaults:
  model: pipeline
  ocr: false
  parseMethod: auto
  language: ch
  formula: true
  table: true
  artifacts: [markdown]
retry:
  maxAttempts: 3
  baseDelayMs: 500
  maxDelayMs: 10000
```

`modelMap` 是显式映射。`hybrid-engine` 等值可以配置为统一 `vlm` 的后端，但 Service 不会猜测或静默降级。HTTP 只允许在自托管配置显式启用 `allowInsecureHttp` 时使用。

### 官方 v4

```yaml
schemaVersion: 1
activeProvider: mp_official
providers:
  - id: mp_official
    type: official-v4
    baseURL: https://mineru.net/api/v4
    apiKeyEnv: MINERU_API_KEY
    models: [pipeline, vlm]
    configuredVersion: v4
defaults:
  model: vlm
  ocr: false
  parseMethod: auto
  language: ch
  formula: true
  table: true
  artifacts: [markdown]
```

官方 v4 当前限制为单文件不超过 200 MB、200 页。官方 Provider 不支持自托管专用的 `parseMethod: txt`，配置或请求会明确失败。

### 存储与限制

默认 storageRoot 为 `$DSH_HOME/dsh-pdf-mineru/v1`，布局如下：

```text
jobs/<session-id>/<job-id>.json
results/sha256/<prefix>/<cache-key>/manifest.json
staging/<operation-id>/
quarantine/<timestamp_reason_id>/
.process.lock
```

一个 storageRoot 只能由一个 DSH 进程使用。修改 `storageRoot` 后需重启；Provider、默认参数、轮询、重试和输出限制对新任务热生效。

可配置限制包括源文件大小、API 响应大小、ZIP 下载大小、entry 数、单 entry 解压字节、总解压字节和压缩比。

Settings 的“存储运维”区域按需执行，不会自动扫描磁盘：

- 统计 results、jobs、staging 和 quarantine 的字节与条目。
- 完整性扫描默认只读；显式隔离无效结果需要确认。
- GC 只生成引用保留策略下的 preview，不删除已发布结果；Job 扫描不完整或结果扫描截断时 `eligible=false`。
- “清除缓存”先预览全部已发布结果，二次确认后删除；若预览后结果集合发生变化则必须重新预览。活动 Job、Job 扫描不完整、结果扫描截断或不安全目录会让操作 fail closed。历史 Job 会保留，但其结果读取将返回 `CACHE_EVICTED`，重新提交会重新解析。
- quarantine 删除默认 dry-run，只删除显式选中的安全 entry ID；实际删除需要二次确认。

## 模型工具

所有工具都要求 `exec.agent.session`。模型只看到插件 `job_id`，不会看到上游 `task_id`、`batch_id`、上传 URL、CDN URL 或状态 URL。

- `mineru_health`：探测当前 Provider 的连通性、鉴权和协议版本。
- `mineru_submit_parse_job`：创建会话 Job，返回 `source: cache | shared-operation | provider`。
- `mineru_get_parse_status`：返回统一 Job 状态和逐文件状态。
- `mineru_get_parse_result`：返回受限 Markdown preview、manifest 路径和产物路径。
- `mineru_parse_document`：submit、等待、result 的组合工具；等待超时保留 Job，可稍后继续查询。

工具仅接受 `file_paths/model/ocr/language/formula/table/pages/artifacts`；状态和结果查询仅接受插件 `job_id`。旧 flat config 与旧工具参数不再解析，传入时会由闭合 schema 或配置校验直接拒绝。

## 官方 v4 安全边界

- MinerU API 请求使用 Bearer Token、JSON 和 `redirect: error`。
- 预签名 PUT 使用独立请求构造器，headers 严格为空：无 Authorization、Content-Type 或默认头。
- CDN ZIP 下载不携带 API Token，并禁止重定向。
- inspect/collect/CDN GET 与重新打开新流的裸 PUT 可重试；`/file-urls/batch` POST 不自动重试。
- HTTP 200 但 `code != 0` 仍失败，保留脱敏 `providerCode` 和 `traceId`。
- 状态和结果只按插件生成的 `data_id` 关联，不信任 `file_name`。
- 重复 `full_zip_url` 只下载一次。
- ZIP 拒绝绝对路径、`..`、NUL、反斜杠/驱动器路径、符号链接、非普通条目和加密条目。
- ZIP 中央目录先扫描限制，随后逐 entry 流式进入 staging；不会把整个归档解压到内存。

## 开发与验证

```sh
pnpm install
pnpm run typecheck
pnpm test
pnpm run build
git diff --check

# 在已运行的 DSH Web shell 中隔离加载当前 client bundle
pnpm run verify:gui

# 构建后显式启用真实官方 v4 全链路 smoke
MINERU_API_KEY=<token> pnpm run smoke:official-v4 -- /absolute/path/sample.pdf
```

GUI verifier 只修改其隔离 Playwright 页面中的 boot graph，并 mock 该页面的插件 RPC；它不会安装插件、修改 profile 或重启 `127.0.0.1:3080`。校验覆盖 Provider 切换、retry 保存、全部存储运维命令、删除确认、console error、桌面/移动几何和截图。

测试默认使用 mock HTTP 和本地 ZIP fixture，不需要真实 Token。`smoke:official-v4` 调用构建后的 `mineru_parse_document` 完整插件链路，必须显式提供真实 Token 和 PDF，不进入默认测试。

## 许可证

本项目使用 [MIT License](./LICENSE) 开源。

## 致谢

感谢 [Huanlin/dsh-plugin-mineru](https://github.com/HuanLinOTO/dsh-plugin-mineru) 提供灵感。
