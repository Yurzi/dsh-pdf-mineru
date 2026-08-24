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

首次版本明确限制一个 storageRoot 只能由一个 DSH 进程使用。修改 `storageRoot` 后需重启；Provider、默认参数、轮询和输出限制对新任务热生效。

可配置限制包括源文件大小、API 响应大小、ZIP 下载大小、entry 数、单 entry 解压字节、总解压字节和压缩比。

## 模型工具

所有工具都要求 `exec.agent.session`。模型只看到插件 `job_id`，不会看到上游 `task_id`、`batch_id`、上传 URL、CDN URL 或状态 URL。

- `mineru_health`：探测当前 Provider 的连通性、鉴权和协议版本。
- `mineru_submit_parse_job`：创建会话 Job，返回 `source: cache | shared-operation | provider`。
- `mineru_get_parse_status`：返回统一 Job 状态和逐文件状态。
- `mineru_get_parse_result`：返回受限 Markdown preview、manifest 路径和产物路径。
- `mineru_parse_document`：submit、等待、result 的组合工具；等待超时保留 Job，可稍后继续查询。

新参数为 `file_paths/model/ocr/language/formula/table/pages/artifacts`。旧 `file_path/backend/parse_method/lang_list/formula_enable/table_enable/return_*/start_page_id/end_page_id` 在当前 major 版本保留为 deprecated alias，进入 Service 前立即规范化。`task_id` 仅作为 `job_id` 的过渡别名，不接受真实上游 ID。

## 官方 v4 安全边界

- MinerU API 请求使用 Bearer Token、JSON 和 `redirect: error`。
- 预签名 PUT 使用独立请求构造器，headers 严格为空：无 Authorization、Content-Type 或默认头。
- CDN ZIP 下载不携带 API Token，并禁止重定向。
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
node scripts/verify-current-gui.mjs
```

测试默认使用 mock HTTP 和本地 ZIP fixture，不需要真实 Token。真实官方/自托管 e2e 应显式 opt-in，不能作为本地完成条件。

## 许可证

本项目使用 [MIT License](./LICENSE) 开源。

## 致谢

感谢 [Huanlin/dsh-plugin-mineru](https://github.com/HuanLinOTO/dsh-plugin-mineru) 提供灵感。
