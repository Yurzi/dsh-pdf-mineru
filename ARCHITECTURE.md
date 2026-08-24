# dsh-pdf-mineru 多 Provider 与全局结果缓存架构设计

## 1. 文档目的

本文定义 dsh-pdf-mineru 的目标架构和实施要求。插件面向模型提供统一的 MinerU 文档解析工具，内部以统一领域模型管理请求、任务、状态和结果，通过 Provider 适配自托管 MinerU v2 协议与 MinerU 官方云服务 v4 API，并在插件全局范围缓存不可变解析结果。

本文不规定每个函数的具体实现，但规定模块职责、数据模型、状态转换、持久化格式、并发语义、安全要求、错误分类、配置、测试和迁移方案。后续实现若偏离本文中的必须项，应先更新设计并说明兼容与安全影响。

## 2. 背景与问题

MinerU 的自托管 FastAPI v2 与官方云 v4 使用不同协议：前者通过 multipart 提交文件，以 task_id 查询状态并从 JSON 响应读取结果；后者先申请预签名上传地址，再以裸 PUT 上传，使用 batch_id 查询逐文件状态，最后下载并解压 ZIP 结果。

若工具层直接兼容这两套 HTTP 数据，会导致以下问题：

- 模型需要理解 task_id、batch_id 和不同状态名称。
- 官方批次被错误压缩成自托管单任务语义。
- 配置参数依赖隐式、有损映射。
- ZIP、内联 JSON、缓存和工具渲染互相耦合。
- 同一文件被不同会话重复解析，浪费本地算力或官方额度。
- Provider 切换后，历史任务可能被路由到错误后端。

因此，重构统一的是插件领域语义，而不是两套上游 HTTP 响应。

## 3. 目标

### 3.1 必须实现

1. 模型只面对一套稳定的解析工具和统一输出。
2. 自托管 v2 与官方云 v4 分别实现同一个 Provider interface。
3. 插件内部使用统一、版本化、可持久化的请求、任务和结果 schema。
4. 每次提交创建会话作用域任务；任务只能由创建它的 DSH 会话访问。
5. 成功解析结果存入插件全局、内容寻址、不可变的缓存。
6. 相同文件、相同解析语义和兼容 Provider 输出可以复用缓存。
7. 同一进程内并发的相同请求合并成一个上游解析操作。
8. 官方 v4 完整支持预签名上传、批次轮询、ZIP 下载和安全解包。
9. 所有网络等待、轮询和大文件操作支持取消、超时和资源上限。
10. 凭据、预签名地址和临时下载地址不进入持久任务、结果 manifest 或模型输出。

### 3.2 非目标

首版不包含以下能力：

- 修改 DeepSeek Harness 的 session persistence 或通用 attachment 服务。
- 在不同 DSH 实例之间共享缓存。
- 允许模型通过任意全局 result_id 枚举或读取其他会话结果。
- 保证不同 Provider、不同模型版本之间的结果等价。
- 将完整 Markdown、JSON、图片 base64 或 ZIP 写入会话日志。
- 提供通用文档解析 Provider 市场；当前 Provider interface 以 MinerU 能力为范围。

跨进程请求合并、多租户缓存隔离和缓存管理工具属于可选增强，见第 18 节。

## 4. 设计原则

### 4.1 领域模型独立于协议

公共 schema 不出现官方 API 的 batch_id、full_zip_url、extract_result，也不把自托管响应的 backend、status_url 当作统一字段。协议字段只存在于 Provider 私有类型和 ProviderJobRef 中。

### 4.2 会话任务与全局结果分离

任务表示某个会话发起的一次操作和访问权限。结果表示由文件内容与解析语义确定的不可变产物。多个会话任务可以引用同一个全局结果，但一个会话不能使用 result_id 绕过自己的 job_id 读取缓存。

### 4.3 解析语义与结果投影分离

会影响上游输出的参数进入缓存键。只影响工具展示的参数，例如 Markdown 内联字符上限，不进入缓存键。缓存尽可能保存 Provider 能提供的完整规范化产物，工具按调用请求投影结果。

### 4.4 Provider 只适配上游

Provider 不注册工具，不读写 DSH 会话，不决定全局缓存目录，也不生成模型文案。它负责参数转换、上游通信、状态规范化以及将远端结果写入受控 ArtifactSink。

### 4.5 持久化发布必须原子

半下载、半解压或未验证的结果只能存在于 staging。只有 manifest 和所有必要产物通过验证后，结果才可以原子发布到内容寻址目录并被任务引用。

## 5. 总体架构

~~~text
Model
  |
  v
DSH Tool Layer
  |  require exec.agent.session
  v
MinerUService
  |-- RequestNormalizer
  |-- JobRepository             session-scoped jobs
  |-- ResultRepository          global immutable results
  |-- SharedOperationRegistry   in-process request coalescing
  |-- ProviderRegistry
          |-- SelfHostedV2Provider
          |-- OfficialV4Provider
~~~

### 5.1 Tool Layer

负责模型参数 schema、会话身份取得、调用 MinerUService、限制内联输出，以及将统一结果渲染为模型可读文本。工具层不调用 fetch、不解析 ZIP、不拼接缓存路径。

### 5.2 MinerUService

负责完整用例编排：规范化请求、读取 Provider 能力、计算源文件哈希与缓存键、创建会话任务、查询缓存、合并并发操作、调用 Provider、发布结果、更新任务和返回统一输出。

### 5.3 ProviderRegistry

根据持久任务记录中的 providerId 和 providerConfigId 解析 Provider。当前配置切换不能改变已提交任务的路由。Provider 配置删除时，仍应保留完成任务的缓存读取能力；需要访问远端的未完成任务应返回明确的 PROVIDER_CONFIG_MISSING 错误。

### 5.4 JobRepository

持久化会话任务，执行 sessionId 访问校验和原子状态更新。任务是可变记录，但状态只能按定义的状态机前进。

### 5.5 ResultRepository

管理内容寻址结果、staging transaction、manifest 校验、原子发布、读取和缓存命中判定。已发布结果不可修改。

### 5.6 SharedOperationRegistry

在单个插件进程内按 CacheKey 合并并发请求。它拥有共享解析操作的生命周期；单个工具调用取消只取消该等待者，不直接取消仍有其他等待者依赖的上游操作。

## 6. 目录与模块建议

~~~text
src/
  domain/
    ids.ts
    request.ts
    job.ts
    result.ts
    errors.ts
    schemas.ts
  providers/
    provider.ts
    registry.ts
    self-hosted-v2.ts
    official-v4.ts
    official-v4-types.ts
  storage/
    paths.ts
    job-repository.ts
    result-repository.ts
    artifact-sink.ts
    manifest.ts
  service/
    mineru-service.ts
    request-normalizer.ts
    cache-key.ts
    shared-operations.ts
  tools/
    common.ts
    probe.ts
    submit.ts
    status.ts
    result.ts
    parse.ts
    index.ts
  client/
    SettingsPage.tsx
    ...
  config.ts
  rpc.ts
  index.ts
~~~

模块可以在实现中进一步合并，但不得让 Provider 依赖工具层或让存储层依赖具体 Provider 响应。

## 7. 统一标识与版本

跨持久化边界的 ID 应使用不透明、带前缀的字符串，并在 TypeScript 中使用 branded type：

- MinerUJobId：mj_<random>
- MinerUResultId：mr_<cache-key-prefix-or-random>
- MinerUFileId：mf_<stable-data-id>
- ProviderConfigId：mp_<configured-id>

持久化记录必须带 schemaVersion。Job、ResultManifest 和 CacheKeySpec 分别版本化；改变字段解释、缓存等价关系或产物布局时提升对应版本。未知版本必须失败，不得猜测兼容。

## 8. 统一解析请求

### 8.1 模型输入

模型工具接受统一字段：

~~~ts
interface ParseRequestInput {
  file_paths: readonly string[]
  model?: 'pipeline' | 'vlm'
  ocr?: boolean
  language?: string
  formula?: boolean
  table?: boolean
  pages?: string
  artifacts?: readonly ArtifactKind[]
}
~~~

首版可以只允许单文件以保持现有工具习惯，但领域 schema 和 Provider interface 应支持文件数组。若模型接口启用批量，必须明确批次数、单文件和总字节限制。

pages 使用统一的 1 基用户语义，例如 1-10,15。RequestNormalizer 负责验证、排序、合并和生成规范字符串。工具层不暴露自托管的 start_page_id/end_page_id；Provider 只在适配上游 v2 multipart 协议时生成这些私有字段。

### 8.2 规范请求

~~~ts
interface CanonicalParseRequest {
  schemaVersion: 1
  files: readonly CanonicalSourceFile[]
  semantics: ParseSemantics
  requiredArtifacts: readonly ArtifactKind[]
}

interface ParseSemantics {
  model: 'pipeline' | 'vlm'
  ocr: boolean
  parseMethod: 'auto' | 'txt' | 'ocr'
  language: string
  formula: boolean
  table: boolean
  pages?: string
}

type ArtifactKind =
  | 'markdown'
  | 'layout'
  | 'model-output'
  | 'content-list'
  | 'images'
~~~

requiredArtifacts 必须去重并按固定顺序排列。默认至少包含 markdown。工具输出策略 maxInlineMarkdownChars 不属于 CanonicalParseRequest。parseMethod 保留旧自托管 txt 与 auto 的输出语义差异；official-v4 无法表达 txt，因此必须返回 UNSUPPORTED_OPTION，不能把它折叠为 ocr=false。

CanonicalSourceFile 只包含 fileId、展示 basename、bytes 和 source SHA-256。实现使用独立的 PreparedSourceFile 增加短生命周期绝对 path 与 stat fingerprint；PreparedSourceFile 不得进入 Job、manifest 或缓存键。

### 8.3 Provider 能力验证

~~~ts
interface ProviderCapabilities {
  models: readonly ('pipeline' | 'vlm')[]
  parseMethods: readonly ('auto' | 'txt' | 'ocr')[]
  supportsOcr: boolean
  supportsLanguage: boolean
  supportsFormula: boolean
  supportsTable: boolean
  supportsPageRanges: boolean
  supportedArtifacts: readonly ArtifactKind[]
  maxFilesPerSubmission: number
  maxFileBytes?: number
  maxPagesPerFile?: number
}
~~~

MinerUService 在提交前校验请求。Provider 不支持的参数必须返回 UNSUPPORTED_OPTION，不得静默忽略或执行有损映射。配置默认值必须先由 RequestNormalizer 显式解析成 CanonicalParseRequest。

## 9. Provider Interface

~~~ts
interface MinerUProvider {
  readonly id: MinerUProviderId
  readonly capabilities: ProviderCapabilities

  probe(context: ProviderCallContext): Promise<ProviderProbeResult>

  compatibilityKey(
    request: CanonicalParseRequest,
    context: ProviderCompatibilityContext,
  ): Promise<string>

  submit(
    request: CanonicalParseRequest,
    sources: readonly PreparedSourceFile[],
    context: ProviderCallContext,
  ): Promise<ProviderSubmission>

  inspect(
    ref: ProviderJobRef,
    context: ProviderCallContext,
  ): Promise<ProviderJobSnapshot>

  collect(
    ref: ProviderJobRef,
    request: CanonicalParseRequest,
    sink: ArtifactSink,
    context: ProviderCallContext,
  ): Promise<ProviderCollection>
}
~~~

ProviderCallContext 至少包含 AbortSignal、已解析凭据和请求超时策略。凭据只存在于调用上下文。ProviderJobRef 是判别联合并可安全持久化：

~~~ts
type ProviderJobRef =
  | {
      provider: 'self-hosted-v2'
      taskId: string
      files: readonly ProviderSubmittedFile[]
    }
  | {
      provider: 'official-v4'
      batchId: string
      files: readonly ProviderSubmittedFile[]
    }
~~~

ProviderSubmittedFile 保存插件生成的 dataId、fileId 与规范文件名映射，不保存本地绝对路径、上传 URL 或 Token。自托管分支同样保存文件映射，以便 JSON 结果收集和重启恢复；官方分支只按 dataId 关联。

### 9.1 probe 语义

probe 表示连接、协议和鉴权可用性检查，不等同于 GET /health。统一结果可包含 available、provider、protocolVersion、serverVersion 和 Provider 可提供的可选诊断。官方 v4 无健康端点时，必须使用官方支持的轻量鉴权请求或明确返回 connectivity-only 诊断，不能伪造队列与容量。

### 9.2 compatibilityKey 语义

该值声明当前 Provider 输出与缓存结果的兼容范围。首版采用保守策略：

- 自托管：self-hosted-v2:<canonical-base-url-hash>:<reported-or-configured-version>:<model>
- 官方：official-v4:<api-version>:<model>

无法确认模型或服务版本时应降低复用范围，而不是跨未知版本共享结果。compatibilityKey 不包含明文 URL、Token 或 credential value。

## 10. Provider 适配

### 10.1 SelfHostedV2Provider

提交使用 POST /tasks multipart；inspect 使用 GET /tasks/{taskId}；collect 使用 GET /tasks/{taskId}/result。Provider 将自托管状态映射为统一状态，将 results 中每个文件转换为标准产物，并通过 ArtifactSink 保存文本、JSON 和图片。

自托管特有 backend 值不直接暴露为统一 model。配置必须显式声明每个统一 model 应映射到哪个 backend，例如 pipeline -> pipeline、vlm -> vlm-engine。若用户需要 hybrid-engine，应作为 Provider 配置的显式模型映射，不由 Service 猜测。

### 10.2 OfficialV4Provider

提交步骤固定为：

1. POST /file-urls/batch，以 Bearer Token 和 application/json 申请预签名地址。
2. 校验 code、batch_id、file_urls 数量及顺序。
3. 为每个本地文件执行 PUT <presigned-url>。
4. PUT 必须是裸请求：不得带 Authorization、Content-Type 或 Provider 默认头。
5. 上传完成后返回包含 batchId 与 dataId 映射的 ProviderSubmission。

请求映射：

- model 直接映射到 model_version 的 pipeline 或 vlm。
- ocr 映射到 files[].is_ocr。
- language、enable_formula 和 enable_table 使用官方字段。
- pages 映射到 files[].page_ranges。
- 每个文件生成唯一 data_id，后续只用 data_id 关联，不信任 file_name。

inspect 调用 GET /extract-results/batch/{batchId}，保留逐文件状态并统一映射：

- waiting-file、pending -> queued
- running、converting -> processing
- done -> completed
- failed -> failed

批次聚合规则：全部完成才是 completed；全部失败为 failed；完成与失败并存为 partially-completed；存在 queued/processing 时批次保持非终态。err_msg 进入文件级错误。

collect 只处理终态文件。对 full_zip_url 去重下载；一个 ZIP 可对应多个结果条目。下载请求不得携带 API Token。Provider 使用安全 ZIP reader 将条目写入 ArtifactSink，并支持官方单文件根目录和多文件子目录布局。文件归属优先使用 data_id 和提交 manifest；无法无歧义关联时失败，不按相似文件名猜测。

## 11. 任务模型与状态机

### 11.1 任务记录

~~~ts
interface MinerUJobRecord {
  schemaVersion: 1
  id: MinerUJobId
  sessionId: SessionId
  providerId: MinerUProviderId
  providerConfigId: ProviderConfigId
  sourceFiles: readonly JobSourceFile[]
  request: CanonicalParseRequest
  cacheKey: CacheKey
  state: MinerUJobState
  resolution: JobResolution
  files: readonly MinerUFileStatus[]
  resultId?: MinerUResultId
  failure?: MinerUFailure
  createdAt: number
  updatedAt: number
}

type JobResolution =
  | { kind: 'cache-hit' }
  | { kind: 'shared-operation'; operationId: string; ref?: ProviderJobRef }
  | { kind: 'provider'; ref?: ProviderJobRef }
~~~

本地 sourceFiles 仅保存 fileId、展示名、字节数和 SHA-256；任务记录不依赖原文件路径完成 status/result。当前实现 retainSources 固定为 false，不保存任意绝对路径。共享 producer 获得 ProviderJobRef 后立即把 ref 原子广播到所有 waiter Job。

### 11.2 统一任务状态

~~~ts
type MinerUJobState =
  | 'queued'
  | 'uploading'
  | 'processing'
  | 'collecting'
  | 'completed'
  | 'partially-completed'
  | 'failed'
~~~

允许的主要转换：

~~~text
queued -> uploading -> processing -> collecting -> completed
   |          |             |            |-> partially-completed
   |          |             |            |-> failed
   |          |             |-> failed
   |          |-> failed
   |-> completed             cache hit
   |-> failed
~~~

终态不可回退。状态更新先持久化，再对调用者发布。Provider 原始状态可以保存在诊断字段，但不能代替统一状态。

### 11.3 会话授权

所有 job 操作都接收当前 Session，而不是裸 sessionId 字符串。JobRepository.get(session, jobId) 必须验证 job.sessionId 与 session.header.id 一致。不提供直接以 resultId 读取完整结果的模型工具。

## 12. 全局缓存设计

### 12.1 缓存键

单文件缓存键定义为：

~~~text
CacheKey = sha256(canonical-json({
  cacheKeySchemaVersion,
  sourceSha256,
  parseSemantics,
  requiredArtifacts,
  providerCompatibilityKey,
  resultSchemaVersion
}))
~~~

canonical-json 必须固定对象字段、数组顺序、数字和 Unicode 表示。禁止使用普通 JSON.stringify 依赖构造顺序作为长期格式。

批量请求首版建议按文件分别缓存：每个文件拥有 FileCacheKey，批次任务引用多个结果。这样同一文件在不同批次中仍可命中。若 Provider 只能批量收集，Service 在发布时拆分为逐文件 ResultManifest。

### 12.2 缓存命中规则

ResultRepository 只有在以下条件全部满足时返回命中：

- 结果目录存在。
- manifest schema 版本受支持。
- manifest.cacheKey 与查询键一致。
- 所有 requiredArtifacts 均存在。
- 每个文件的字节数和可选 SHA-256 与 manifest 一致。
- 结果未被 retention 策略标记失效。

损坏缓存必须隔离并重新解析，不能将缺失文件当作部分成功返回。

### 12.3 解析结果

~~~ts
interface MinerUResultManifest {
  schemaVersion: 1
  id: MinerUResultId
  cacheKey: CacheKey
  sourceSha256: string
  request: CanonicalParseRequest
  producer: ResultProducer
  files: readonly [ParsedDocumentManifest]
  createdAt: number
}

interface ParsedDocumentManifest {
  fileId: MinerUFileId
  name: string
  artifacts: readonly ArtifactRef[]
}

interface ArtifactRef {
  kind: ArtifactKind | 'manifest'
  relativePath: string
  mediaType: string
  bytes: number
  sha256: string
}
~~~

ArtifactRef.relativePath 必须为规范相对路径。一个已发布 manifest 严格对应一个源文件和一个 FileCacheKey，因此 files 是单元素 tuple。全局结果可在 host 工具输出中附带可读绝对路径，方便模型调用文件工具，但绝对路径不进入持久 manifest 或缓存键。

### 12.4 物理布局

默认根目录从 DSH Home 派生，也允许通过经过验证的 storageRoot 配置覆盖：

~~~text
$DSH_HOME/mineru/v1/
  jobs/
    <session-id>/
      <job-id>.json
  results/
    sha256/
      <key[0:2]>/
        <cache-key>/
          manifest.json
          files/
            <file-id>/
              full.md
              layout.json
              model.json
              content_list.json
              images/
  staging/
    <operation-id>/
  quarantine/
  sources/                 optional
~~~

sessionId 和所有 ID 必须经过格式校验后才能参与路径拼接。

### 12.5 原子发布

ResultTransaction 在 staging 写入并计算哈希，完成后生成 manifest。commit 执行完整校验并以原子 rename 发布。若目标已存在，校验现有结果：一致则复用，不一致则将新旧冲突隔离并返回 CACHE_CONFLICT。

staging 中断残留可在插件启动或定时维护时按 TTL 清理。清理不得删除活跃 SharedOperation 使用的目录。

## 13. 并发、取消与恢复

### 13.1 单进程请求合并

SharedOperationRegistry 以 CacheKey 为键。缓存未命中时，第一个调用创建 producer，后续调用创建各自会话 Job 并成为 waiter。每个 waiter 有独立 AbortSignal：

- waiter 取消后停止等待并更新其调用结果，但不破坏其他会话任务。
- 只要仍有 waiter 或 Provider 已提交不可撤销远端任务，共享操作继续。
- producer 完成后，每个未取消 Job 分别提交 resultId 和终态。
- producer 失败后，每个关联 Job 记录规范化失败。

工具调用取消和任务取消是不同语义。首版没有 mineru_cancel 工具；取消一个同步等待仅停止当前工具调用，异步任务仍可由 status/result 查询。

### 13.2 进程重启

Job 是持久记录。重启后 status/result 可根据 ProviderJobRef 恢复远端查询和收集。处于 uploading 且没有完整 ProviderJobRef 的任务无法可靠恢复，应标记为 failed，错误码为 INTERRUPTED_UPLOAD。

首版不允许多个 DSH 进程同时共享同一 storageRoot。插件注册工具前以 .process.lock 原子获取 PID/owner 锁；活进程冲突明确返回 STORAGE_LOCKED，只回收格式有效且 PID 已确认死亡的 stale lock。

### 13.3 超时层次

- requestTimeoutMs：单次 API、上传或下载的 inactivity/overall timeout。
- pollIntervalMs：状态轮询间隔。
- pollTimeoutMs：mineru_parse_document 的总等待时间，不改变异步任务本身。
- operationTimeoutMs：可选共享 producer 总时限。

超时必须保留可恢复 ProviderJobRef。同步工具超时不应将仍在远端执行的任务标为 failed。

## 14. 错误模型

统一错误：

~~~ts
interface MinerUFailure {
  code: MinerUErrorCode
  message: string
  retryable: boolean
  provider?: MinerUProviderId
  providerCode?: string
  traceId?: string
  fileId?: MinerUFileId
}
~~~

核心错误码至少包含：

- INVALID_REQUEST
- FILE_NOT_FOUND
- FILE_TOO_LARGE
- UNSUPPORTED_OPTION
- CREDENTIAL_MISSING
- AUTHENTICATION_FAILED
- PROVIDER_UNAVAILABLE
- PROVIDER_CONFIG_MISSING
- PROVIDER_RATE_LIMITED
- PROVIDER_QUOTA_EXHAUSTED
- UPLOAD_FAILED
- REMOTE_PARSE_FAILED
- RESULT_NOT_READY
- RESULT_DOWNLOAD_FAILED
- RESULT_ARCHIVE_INVALID
- RESULT_TOO_LARGE
- CACHE_CORRUPT
- CACHE_CONFLICT
- INTERRUPTED_UPLOAD
- POLL_TIMEOUT
- CANCELLED

Provider 应保留官方 code/msg/trace_id 或自托管 HTTP 状态作为诊断，但工具只依赖统一 code 与 retryable。错误消息不得包含 Bearer Token、预签名 URL 查询参数或完整敏感响应头。

失败结果不进入永久结果缓存。可重试抑制只允许作为有 TTL 的独立 failure record；首版可以不实现 negative cache。

## 15. 工具接口

为减少模型行为迁移，保留现有五个工具名，但重新定义为统一领域接口。旧参数可以在一个明确的迁移周期内作为兼容别名，内部立即规范化。

### 15.1 mineru_health

执行当前 Provider 的 probe。返回 provider、available、authentication、protocol_version、server_version 和可选能力摘要。不得假设所有 Provider 有队列或健康端点。

### 15.2 mineru_submit_parse_job

输入 file_paths 和统一解析参数，立即返回：

- job_id
- state
- source：cache、shared-operation 或 provider
- provider
- files
- result_available

缓存命中时任务可以直接 completed。工具不返回上游 status_url、result_url、batch_id 或预签名地址。

### 15.3 mineru_get_parse_status

输入 job_id。校验当前会话所有权，必要时查询 Provider 并持久化最新统一状态。返回任务状态、逐文件状态、进度、缓存来源和统一错误。

### 15.4 mineru_get_parse_result

输入 job_id 和可选结果投影。仅终态成功文件可读取。返回：

- job_id、state、cache_hit、result_id
- 文件清单及 artifact paths
- 第一个或指定文件的 Markdown preview
- preview_truncated
- manifest_path

完整结果路径来自 ResultRepository 解析，不从 manifest 读取绝对路径。

### 15.5 mineru_parse_document

高层组合工具，执行 submit -> wait -> result。pollTimeout 仅停止当前等待；若远端任务已提交，返回 job_id 和当前状态，允许模型稍后继续查询。

### 15.6 模型输出限制

Markdown preview 的完整包装和正文必须共同受 maxInlineMarkdownChars 或字节限制约束。JSON、图片和完整 Markdown只以路径和小型元数据返回。工具 execute 返回规范 JSON，render 继续作为纯投影。

## 16. 配置、RPC 与设置页

### 16.1 配置结构

使用 Provider 判别联合，而不是 mode 加语义混杂的字段：

~~~ts
interface MinerUConfig {
  activeProvider: ProviderConfigId
  providers: readonly ProviderConfig[]
  defaults: ParseDefaults
  storage: StorageConfig
  polling: PollingConfig
  retry: RetryConfig
  output: OutputConfig
}

type ProviderConfig = SelfHostedV2Config | OfficialV4Config
~~~

SelfHostedV2Config 包含 id、type、baseURL、可选 apiKeyEnv、统一 model 到 backend 的显式映射。OfficialV4Config 包含 id、type、默认 https://mineru.net/api/v4 的 baseURL、必填 apiKeyEnv 和受支持模型配置。当前官方限制按文档固定为单文件 200 MB、200 页；官方 Provider 只声明 auto/ocr parseMethods。

StorageConfig 包括 storageRoot、cacheEnabled、retainSources=false 和 stagingTtlMs。当前采用第 18.1 节的引用保留策略，不执行结果时间/容量驱逐；ZIP、API、文件、轮询、重试和输出限制在 limits/polling/retry/output 分组显式配置并验证。RetryConfig 使用 maxAttempts、baseDelayMs 和 maxDelayMs 表达总尝试次数与退避边界。storageRoot 在进程启动时固定，设置修改需重启生效。

### 16.2 配置快照

Job 保存 providerConfigId 和不含秘密的 provider compatibility metadata。配置热更新只影响新任务。旧任务恢复时通过 providerConfigId 解析原配置；不得使用当前 activeProvider 替代。

### 16.3 RPC

配置 RPC 负责 get/set/probe；存储运维 RPC 提供 stats、只读 integrity scan、GC preview、quarantine list 和 cleanup。所有通道保持 loopback authority，不接受任意路径。integrity isolation 和非 dry-run quarantine cleanup 必须携带显式 confirm=true；GC 当前永远只生成计划，不执行删除。probe 接受待测试 draft 配置，避免用户必须先保存错误配置才能测试。

### 16.4 设置页

设置页提供 Provider 列表或当前 Provider 选择，并根据 type 显示对应字段。统一解析默认值、存储策略、轮询和输出限制独立分组。测试连接展示 Provider 类型、鉴权和版本，不展示 Token。

## 17. 安全与资源限制

### 17.1 凭据与网络

- API Token 按调用从 DSH credentials 或环境变量解析，不持久化实际值。
- 带鉴权请求设置 redirect: error，防止跨主机泄漏。
- 官方预签名 PUT 使用独立请求构造器，禁止继承认证头和 Content-Type。
- ZIP/CDN 下载不携带 API Token。
- 错误日志对 URL 查询参数和认证信息脱敏；结构化诊断不接受 URL、Header、响应体、Token 或本地路径字段。
- 只对幂等 GET 和可重新打开新文件流的官方裸 PUT 执行有界重试，识别网络错误、408、429、5xx 和 Retry-After。
- 官方 /file-urls/batch POST 与自托管 multipart POST 在结果不明确时不得自动重试，避免重复上游任务。
- 可配置 baseURL 必须使用 URL parser 验证；是否允许 HTTP 由 Provider 类型和配置明确决定。

### 17.2 本地文件

- 提交前使用文件 API 确认普通文件，拒绝目录和不支持类型。
- 哈希和上传使用流式读取，避免将 200 MB 文件整体读入内存。
- 文件在哈希后、上传前发生 size/mtime 变化时重新验证或失败，避免缓存键与上传内容不一致。
- 源文件名只用于展示和上游 name；所有本地目标路径使用内部 fileId。

### 17.3 ZIP

- 拒绝绝对路径、..、NUL、驱动器前缀和符号链接条目。
- 限制下载字节、压缩条目数、单条目解压字节、总解压字节和压缩比。
- ZIP 先扫描中央目录的路径、类型、entry 数、声明大小和压缩比，再逐 entry 流式写入 sink 创建的 staging 临时区；不把整个 entry 或归档聚合到内存。
- 先写 staging，不直接覆盖最终结果。
- JSON 产物验证为 UTF-8 和有效 JSON；Markdown 验证大小和文本解码。
- 未识别文件可以忽略或记录诊断，但不能绕过资源限制。

### 17.4 缓存访问

模型只能通过当前会话 Job 获取结果。RPC 不暴露任意路径读取。ArtifactRef 的相对路径必须在 ResultRepository 内解析并验证仍位于结果根目录。

## 18. 生命周期与维护

### 18.1 缓存保留

当前采用引用保留加 staging TTL：任意严格可解析 Job 的顶层或逐文件 cacheKey 都视为引用，不执行已发布结果自动删除。时间/容量优先策略仍是未来选项；若启用，历史 result 必须返回 CACHE_EVICTED 并明确是否允许重新解析。

### 18.2 存储运维

- StorageMaintenanceService 只在持有同一 storageRoot 的 ProcessLock 时运行，不注册模型工具。
- stats 对 results、jobs、staging、quarantine 统计字节和条目，遍历不跟随符号链接。
- integrity scan 默认只读；显式 isolation 只原子移动已确认无效的完整 result 目录。
- quarantine cleanup 默认 dry-run，只接受 list 返回的安全 entry ID；实际删除由 loopback RPC 二次确认。
- GC dry-run 严格解析全部 Job 引用，只报告已验证且无引用的 immutable result。任意 malformed、unreadable、temporary、unexpected 或 symlinked Job，以及 result 扫描截断，都会令计划 eligible=false。
- Manifest 和 persisted Job 使用流式有界读取；超限数据按 corrupt/malformed 处理，不允许运维扫描无界分配内存。
- 候选项、诊断和 quarantine 列表都有响应上限及 truncated 元数据；当前不存在已发布结果删除 API。

### 18.3 可选增强

- 跨进程 claim、heartbeat 和 stale-owner 接管。
- credential 或 tenant 级 cacheScope。
- 自动容量/时间驱逐、Job 保留期和 CACHE_EVICTED 后重新解析。
- URL 输入 Provider 能力。
- source object 内容寻址存储与失败重试。
- DSH 通用 Session Artifact 服务和 session export 集成。
- 独立 mineru_cancel 工具及 Provider 取消能力。

这些增强不能改变现有 CacheKey 和 manifest 解释；需要改变时提升版本。

## 19. 接口收敛

插件只接受 Provider-based canonical config 和当前工具参数，不对旧接口做静默转换。

1. flat `baseURL/apiKeyEnv/defaultBackend` 配置会被配置解析器拒绝。
2. 模型工具只接受 `file_paths/model/ocr/language/formula/table/pages/artifacts`，查询只接受 `job_id`。
3. Self-hosted v2 的 `task_id/backend/parse_method/start_page_id/end_page_id` 仅存在于 Provider 私有协议适配中。
4. 旧 `/tmp/mineru-*` 文件不迁移到全局缓存，因为缺少可靠 CacheKey 与 manifest。

## 20. 典型流程

### 20.1 缓存命中

1. Tool 从 exec.agent 取得 Session。
2. Service 规范化请求并流式计算 sourceSha256。
3. Provider 生成 compatibilityKey，Service 计算 CacheKey。
4. Service 创建 session Job。
5. ResultRepository 验证缓存命中。
6. Job 原子更新为 completed、resolution=cache-hit、resultId=<id>。
7. Tool 返回有限 preview 和产物路径。

### 20.2 官方 v4 缓存未命中

1. Service 创建 Job 并取得 SharedOperation producer。
2. OfficialV4Provider 申请上传地址并执行裸 PUT。
3. Job 保存 batchId 与 dataId 映射，进入 processing。
4. inspect 轮询逐文件状态。
5. 进入 collecting 后下载去重 ZIP 并安全解包到 staging。
6. ResultRepository 校验并原子发布。
7. Job 提交 completed 或 partially-completed 与 resultId。
8. 所有等待该 CacheKey 的会话任务分别引用同一结果。

### 20.3 同步等待超时

1. mineru_parse_document 已完成远端提交并持久化 ProviderJobRef。
2. pollTimeout 到期，当前工具返回 job_id、processing 和 POLL_TIMEOUT 诊断。
3. 远端任务和共享 producer 不因单个等待超时而失效。
4. 模型稍后使用 status/result 继续。

## 21. 测试策略

### 21.1 领域与规范化

- 默认值解析、页范围规范化、artifact 排序和无效组合。
- canonical JSON 与 CacheKey 稳定性，包括字段顺序、Unicode 和版本变化。
- branded ID、持久 schema 版本拒绝和状态转换。

### 21.2 SelfHostedV2Provider

- multipart 字段和显式 modelMap。
- Bearer 可选、重定向策略、HTTP/JSON 错误。
- 状态和内联结果向统一 schema 转换。
- 取消、请求超时和多文件结果。
- probe/inspect/collect 的有界重试、Retry-After、耗尽和 backoff 取消；multipart POST 不重试。

### 21.3 OfficialV4Provider

- file-urls/batch 请求字段与 data_id 关联。
- PUT 无 Authorization、Content-Type 和其他默认头。
- HTTP 200 但 code 非成功时失败，并保留 trace_id。
- waiting-file/pending/running/converting/done/failed 映射和部分成功。
- full_zip_url 去重下载。
- 单文件根目录、多文件子目录和重复内容 ZIP。
- Token 不发送到上传或 CDN 主机。
- inspect/collect/CDN GET 和新流裸 PUT 的安全重试；file-urls/batch POST 不重试。

### 21.4 存储与安全

- staging 原子提交、并发目标已存在、损坏缓存隔离。
- ZIP Slip、绝对路径、符号链接、压缩炸弹、条目数和大小限制。
- ArtifactRef 越界路径拒绝。
- manifest 哈希、字节数和 requiredArtifacts 校验。
- 残留 staging 清理不影响活跃 operation，也不跟随 staging 符号链接。
- 只读统计/完整性扫描、quarantine 边界、删除 dry-run、响应截断和取消。
- GC preview 的 Job 引用并集、orphan 候选与 malformed/unreadable/symlink fail-closed。

### 21.5 Service 与并发

- 缓存命中不调用 Provider。
- 相同 CacheKey 的并发请求只提交一次，各自创建会话 Job。
- 不同解析参数、Provider compatibilityKey 或 artifact 集不共享。
- 一个 waiter 取消不取消其他 waiter。
- 重启后用 ProviderJobRef 恢复 processing/collecting。
- 会话 A 不能读取会话 B 的 job_id。

### 21.6 工具、RPC 和 UI

- 五个工具的 canonical output 和 render 文本。
- 大 Markdown 的完整工具输出限制。
- RPC 配置判别联合、draft probe 和热更新只影响新任务。
- loopback 运维 RPC 的输入上限、只读默认值和 destructive confirm。
- 设置页按 Provider 显示有效字段，并提供统计、扫描、GC preview 与 quarantine 二次确认流程。
- 桌面/移动布局验证包含 CSS module 生效、内部表格滚动和页面无横向溢出。
- 真实插件组合测试验证工具注册、会话绑定和持久输出。

### 21.7 验证命令

实现完成后至少运行：

~~~sh
pnpm run typecheck
pnpm test
pnpm run build
git diff --check
pnpm run verify:gui
~~~

涉及客户端设置页时，还需构建客户端 bundle，并在现有 DSH Web GUI 中刷新验证 Provider 切换、字段可见性、保存和连接测试。

## 22. 实施阶段

### 阶段一：领域与自托管迁移

建立统一 schema、Provider interface、MinerUService、JobRepository 和 ResultRepository；将现有自托管实现迁入 SelfHostedV2Provider，确保本地能力和工具行为可用。

### 阶段二：全局缓存

实现文件流式哈希、CacheKey、staging transaction、原子 manifest、会话任务授权和单进程共享 operation。补齐缓存与并发测试。

### 阶段三：官方 v4

实现官方提交、裸 PUT、批次状态、ZIP 下载、安全解包和产物规范化。使用 mock fetch 与 ZIP fixtures 覆盖 Issue #2 中的实测问题。

### 阶段四：配置与界面

迁移到 Provider 配置联合，更新 RPC、设置页和多语言字典，实现 draft probe 和 Provider 特定字段。

### 阶段五：接口收敛、文档和集成验证

移除旧配置与旧工具参数入口，更新 README/AGENTS，生成 lib 构建产物，并执行完整类型、测试、构建和 GUI 验证。

## 23. 验收标准

实现满足以下条件时可以视为完成：

1. 同一组工具可在不改变模型工作流的情况下使用自托管 v2 或官方 v4。
2. 工具输出不泄漏 Provider 私有 URL、Token、batch_id 或自托管 status_url。
3. 相同文件与规范解析请求第二次提交命中全局缓存，不调用上游。
4. 两个会话并发提交相同请求只产生一个上游操作，但各自拥有独立 job_id。
5. 任意会话不能读取另一个会话的 job。
6. Provider 或解析参数的实质变化不会错误命中缓存。
7. 官方上传请求不携带任何签名之外的自定义头，API Token 不离开 mineru.net API 请求。
8. 官方状态、部分失败和 ZIP 结果完整转换为统一 schema。
9. 损坏、超限或恶意 ZIP 不会写出 staging、消耗无界资源或发布结果。
10. 重启后已持久化的远端任务可继续查询和收集；不可恢复上传明确失败。
11. 所有模型可见大内容受限，完整产物通过安全路径引用。
12. typecheck、测试、构建和设置页验证全部通过。
13. 安全网络操作在瞬时失败时有界重试，模糊提交 POST 不会被自动重放，重试日志不泄漏请求私有信息。
14. 存储统计和完整性检查默认不修改数据；GC 只预览，无法证明引用扫描完整时不产生 eligible 删除计划。
15. quarantine 实际清理只作用于显式选择的安全 entry ID，并通过 loopback RPC 二次确认。

## 24. 决策摘要

- 对模型统一工具，对内部统一领域 schema，对上游统一 Provider interface。
- Provider 差异保留在 ProviderJobRef、能力声明和适配实现中，不污染工具协议。
- 会话拥有 Job 和访问权限；插件全局拥有不可变 Result。
- 缓存键由源内容、规范解析语义、必要产物、Provider 兼容标识和 schema 版本共同决定。
- 完成结果全局复用，并发相同请求在进程内合并。
- DSH 会话日志保留工具结果和轻量引用，不承载完整解析产物。
- 官方 v4 的预签名上传、无认证 CDN 下载和 ZIP 解包使用独立安全路径。
- 重试仅属于 Provider 网络适配层；Service 提供热配置和不含私有字符串的结构化诊断。
- 存储运维属于 loopback 管理面；模型工具、持久 Job/Result schema 和 CacheKey 解释保持不变。
