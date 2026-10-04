export type MineruKey =
  | 'nav'
  | 'probe.tiers'
  | 'probe.formats'
  | 'probe.sources'
  | 'probe.scope'
  | 'provider.type.selfHostedV1'
  | 'provider.v1.hint'
  | 'provider.legacy.hint'
  | 'field.configuredVersion'
  | 'field.configuredVersion.hint'
  | 'field.v1OcrMode'
  | 'field.v1OcrMode.hint'
  | 'notice.v1ServerManaged'
  | 'probe.auth'
  | 'probe.protocol'
  | 'probe.server'
  | 'probe.queue'
  | 'probe.diagnostics'
  | 'page.title'
  | 'page.intro'
  | 'section.provider'
  | 'section.defaults'
  | 'section.storage'
  | 'section.operations'
  | 'section.polling'
  | 'section.retry'
  | 'section.output'
  | 'section.limits'
  | 'section.limits.restartHint'
  | 'section.provider.desc'
  | 'section.defaults.desc'
  | 'section.defaults.v1.desc'
  | 'section.storage.desc'
  | 'section.operations.desc'
  | 'section.polling.desc'
  | 'section.retry.desc'
  | 'section.output.desc'
  | 'section.limits.desc'
  | 'action.retryLoad'
  | 'badge.selfHosted'
  | 'badge.official'
  | 'action.expandAll'
  | 'action.collapseAll'
  | 'action.expand'
  | 'action.collapse'
  | 'action.dismiss'
  | 'unit.attempts'
  | 'unit.chars'
  | 'unit.images'
  | 'unit.ms'
  | 'unit.seconds'
  | 'unit.fileLimit'
  | 'badge.configured'
  | 'badge.notConfigured'
  | 'badge.healthy'
  | 'badge.unhealthy'
  | 'badge.testing'
  | 'badge.cacheOn'
  | 'badge.cacheOff'
  | 'badge.readOnly'
  | 'badge.maintenance'
  | 'notice.officialTxtToAuto'
  | 'field.activeProvider'
  | 'field.baseURL'
  | 'field.baseURL.placeholder'
  | 'field.apiKeyEnv'
  | 'field.apiKeyEnv.placeholder'
  | 'field.apiKeyEnv.hint'
  | 'field.apiKey'
  | 'field.allowInsecureHttp'
  | 'field.configuredVersion'
  | 'field.tier'
  | 'field.tier.hint'
  | 'field.tier.serverDefault'
  | 'field.tier.opt.flash'
  | 'field.tier.opt.basic'
  | 'field.tier.opt.standard'
  | 'field.tier.opt.advanced'
  | 'field.legacyParams'
  | 'field.legacyParams.hint'
  | 'field.modelMap.pipeline'
  | 'field.modelMap.pipeline.hint'
  | 'field.modelMap.pipeline.placeholder'
  | 'field.modelMap.vlm'
  | 'field.modelMap.vlm.hint'
  | 'field.modelMap.vlm.placeholder'
  | 'field.modelMap.chip.default'
  | 'field.modelMap.chip.recommended'
  | 'field.modelMap.chip.vlmEngine'
  | 'field.modelMap.opt.pipeline'
  | 'field.modelMap.opt.hybridEngine'
  | 'field.modelMap.opt.vlmEngine'
  | 'field.officialModels'
  | 'field.defaultModel'
  | 'field.defaultParseMethod'
  | 'field.defaultLang'
  | 'field.defaultFormula'
  | 'field.defaultTable'
  | 'field.storageRoot'
  | 'field.cacheEnabled'
  | 'field.stagingTtlMs'
  | 'field.pollIntervalMs'
  | 'field.pollTimeoutMs'
  | 'field.requestTimeoutMs'
  | 'field.operationTimeoutMs'
  | 'field.retryMaxAttempts'
  | 'field.retryBaseDelayMs'
  | 'field.retryMaxDelayMs'
  | 'field.maxInlineChars'
  | 'field.maxInlineImages'
  | 'field.maxFileBytes'
  | 'field.maxApiResponseBytes'
  | 'field.maxZipDownloadBytes'
  | 'field.maxZipEntries'
  | 'field.maxZipEntryBytes'
  | 'field.maxZipTotalBytes'
  | 'field.maxZipCompressionRatio'
  | 'action.save'
  | 'action.saved'
  | 'action.resetDefaults'
  | 'action.resetSection'
  | 'action.test'
  | 'action.testing'
  | 'action.clearApiKey'
  | 'action.clearingApiKey'
  | 'action.storageStats'
  | 'action.integrityScan'
  | 'action.gcPreview'
  | 'action.cacheClear'
  | 'action.cacheClearConfirm'
  | 'action.quarantineList'
  | 'action.cleanupPreview'
  | 'action.cleanupDelete'
  | 'action.cleanupConfirm'
  | 'action.running'
  | 'ops.statsIncomplete'
  | 'ops.bytes'
  | 'ops.entries'
  | 'ops.results'
  | 'ops.staging'
  | 'ops.quarantine'
  | 'ops.readOnly'
  | 'ops.valid'
  | 'ops.corrupt'
  | 'ops.missing'
  | 'ops.unreadable'
  | 'ops.gcEligible'
  | 'ops.gcBlocked'
  | 'ops.gcCandidates'
  | 'ops.clearReady'
  | 'ops.clearBlocked'
  | 'ops.activeOperations'
  | 'ops.selectAll'
  | 'ops.modified'
  | 'ops.cleanupPlanned'
  | 'ops.cleanupDeleted'
  | 'test.healthy'
  | 'test.unhealthy'
  | 'test.error'
  | 'credential.placeholderStored'
  | 'credential.placeholderEmpty'
  | 'credential.loading'
  | 'credential.configured'
  | 'credential.notConfigured'
  | 'credential.readOnly'
  | 'credential.referenceRequired'
  | 'provider.type.selfHosted'
  | 'provider.type.official'
  | 'model.pipeline'
  | 'model.vlm'
  | 'parse.auto'
  | 'parse.txt'
  | 'parse.ocr'
  | 'artifact.markdown'
  | 'artifact.layout'
  | 'artifact.model-output'
  | 'artifact.content-list'
  | 'artifact.images'

export const NS = 'dsh-pdf-mineru'

export const en: Record<MineruKey, string> = {
  'section.defaults.v1.desc': 'Independent OCR mode for this V1 profile; model and extraction switches are server-managed.',
  'probe.tiers': "Available tiers",
  'probe.formats': "API output formats",
  'probe.sources': "API source types",
  'probe.scope': "Discovery checks API access and advertised capabilities, not parsing quality. This plugin uses uploaded files and ZIP; URL/inline sources are not exposed.",
  'provider.type.selfHostedV1': "Self-Hosted MinerU (V1 API)",
  'provider.v1.hint': "MinerU 4.x resource API. Uses /v1/uploads and /v1/parse/jobs; never falls back to legacy endpoints.",
  'provider.legacy.hint': "MinerU 3.x task API. Uses /health and /tasks only; choose V1 API for a 4.x server.",
  'field.configuredVersion': "Deployment / model revision",
  'field.configuredVersion.hint': "Optional cache namespace. Change this after an in-place server or model upgrade to avoid reusing old results.",
  'field.v1OcrMode': "OCR Mode (V1)",
  'field.v1OcrMode.hint': "Saved per V1 profile: auto detects the PDF text layer, txt uses it, ocr forces recognition. txt does not guarantee that no vision model runs.",
  'notice.v1ServerManaged': "V1 has no request fields for model, language, formula or table switches. Tier and the server control parsing. Shared legacy/cloud defaults are preserved but do not apply here. Native documents use the server-supported native parsing route.",
  'probe.auth': "Authentication",
  'probe.protocol': "Protocol",
  'probe.server': "Server",
  'probe.queue': "Queue (active / queued / max)",
  'probe.diagnostics': "Diagnostics",
  'nav': 'MinerU',
  'page.title': 'MinerU Configuration',
  'page.intro': 'Configure MinerU document parsing providers, global content-addressed caching, and execution limits.',
  'section.provider': 'Provider Settings',
  'section.defaults': 'Parsing Defaults',
  'section.storage': 'Storage & Cache',
  'section.operations': 'Storage Operations',
  'section.polling': 'Polling & Timeouts',
  'section.retry': 'Retry Policy',
  'section.output': 'Output Limits',
  'section.limits': 'Security & Payload Limits',
  'section.limits.restartHint': 'Security and payload limits are initialized at plugin startup. Changes require restarting the plugin.',
  'section.provider.desc': 'Provider profile, service endpoint, protocol version, and credential management',
  'section.defaults.desc': 'Default extraction model, parse method, language, and formula/table switches',
  'section.storage.desc': 'Content-addressed cache root, global caching toggle, and staging cleanup TTL',
  'section.operations.desc': 'Storage statistics, cache verification, garbage collection preview, and quarantine',
  'section.polling.desc': 'Status polling interval, sync tool timeout, and operation deadlines',
  'section.retry.desc': 'Bounded exponential backoff, maximum attempts, and delay limits',
  'section.output.desc': 'Inline model projection character budget and visual attachment limits',
  'section.limits.desc': 'System payload limits, safe decompression ratios, and zip bounds (startup configured)',
  'action.retryLoad': 'Retry Loading',
  'badge.selfHosted': 'Self-hosted',
  'badge.official': 'Official cloud (v4)',
  'action.expandAll': 'Expand All',
  'action.collapseAll': 'Collapse All',
  'action.expand': 'Expand card',
  'action.collapse': 'Collapse card',
  'action.dismiss': 'Dismiss',
  'unit.attempts': 'attempts',
  'unit.chars': 'chars',
  'unit.images': 'images',
  'unit.ms': 'ms',
  'unit.seconds': 's',
  'unit.fileLimit': 'file limit',
  'badge.configured': 'Configured',
  'badge.notConfigured': 'Not Configured',
  'badge.healthy': 'Healthy',
  'badge.unhealthy': 'Unhealthy',
  'badge.testing': 'Testing…',
  'badge.cacheOn': 'Cache ON',
  'badge.cacheOff': 'Cache OFF',
  'badge.readOnly': 'Read-only',
  'badge.maintenance': 'Preview & confirm',
  'notice.officialTxtToAuto': 'Official v4 provider does not support txt extraction mode; parse method was automatically adjusted to auto.',

  'field.activeProvider': 'Active Provider',
  'field.baseURL': 'API Base URL',
  'field.baseURL.placeholder': 'https://mineru.net/api/v4 or http://localhost:18000',
  'field.apiKeyEnv': 'Credential Reference',
  'field.apiKeyEnv.placeholder': 'MINERU_API_KEY',
  'field.apiKeyEnv.hint': 'Reference name stored in MinerU configuration. The API key value is kept separately by DeepSeek Harness.',
  'field.apiKey': 'API Key',
  'field.allowInsecureHttp': 'Allow Insecure HTTP (Local Only)',
  'field.tier': 'Parse Tier',
  'field.tier.hint': "V1 quality / speed tier, not a model name. Server default omits tier; availability depends on the deployment. Standard and advanced may share a model with different compute effort.",
  'field.tier.serverDefault': 'Server default',
  'field.tier.opt.flash': "flash (fast parsing; lightweight OCR when needed)",
  'field.tier.opt.basic': 'basic (local lightweight models)',
  'field.tier.opt.standard': 'standard (balanced parsing, recommended)',
  'field.tier.opt.advanced': "advanced (higher compute effort)",
  'field.legacyParams': 'Legacy Parameters (MinerU 3.x and earlier)',
  'field.legacyParams.hint': "Backend identifiers sent only to the legacy /tasks API. These are not V1 tiers.",
  'field.modelMap.pipeline': 'Pipeline Backend Map',
  'field.modelMap.pipeline.hint': 'Upstream selector for pipeline requests. MinerU 3.x and earlier expect a backend engine identifier, normally pipeline; MinerU 4.0+ ignores it unless it names a tier — set the parse tier above instead.',
  'field.modelMap.pipeline.placeholder': 'pipeline',
  'field.modelMap.vlm': 'VLM Backend Map',
  'field.modelMap.vlm.hint': 'Upstream selector for VLM requests. MinerU 3.x and earlier expect a backend engine identifier such as hybrid-engine (hybrid layout + VLM, recommended) or vlm-engine (pure local VLM); MinerU 4.0+ ignores it unless it names a tier — set the parse tier above instead.',
  'field.modelMap.vlm.placeholder': 'hybrid-engine or vlm-engine',
  'field.modelMap.chip.default': 'default',
  'field.modelMap.chip.recommended': 'recommended',
  'field.modelMap.chip.vlmEngine': 'pure VLM',
  'field.modelMap.opt.pipeline': 'pipeline (Rule & OCR pipeline, fast and deterministic)',
  'field.modelMap.opt.hybridEngine': 'hybrid-engine (Layout analysis + VLM hybrid, high accuracy & low hallucination - recommended)',
  'field.modelMap.opt.vlmEngine': 'vlm-engine (Pure local VLM inference)',
  'field.officialModels': 'Supported Cloud Models',

  'field.defaultModel': 'Default Model',
  'field.defaultParseMethod': 'Default Parse Method',
  'field.defaultLang': 'Default Language',
  'field.defaultFormula': 'Enable Formula Extraction',
  'field.defaultTable': 'Enable Table Extraction',

  'field.storageRoot': 'Storage Root Directory',
  'field.cacheEnabled': 'Enable Global Cache',
  'field.stagingTtlMs': 'Staging Cleanup TTL (ms)',

  'field.pollIntervalMs': 'Poll Interval (ms)',
  'field.pollTimeoutMs': 'Sync Tool Timeout (ms)',
  'field.requestTimeoutMs': 'Request Timeout (ms)',
  'field.operationTimeoutMs': 'Shared Operation Timeout (ms)',

  'field.retryMaxAttempts': 'Maximum Attempts',
  'field.retryBaseDelayMs': 'Base Retry Delay (ms)',
  'field.retryMaxDelayMs': 'Maximum Retry Delay (ms)',

  'field.maxInlineChars': 'Max Response Characters',
  'field.maxInlineImages': 'Max Inlined Images',

  'field.maxFileBytes': 'Max File Bytes',
  'field.maxApiResponseBytes': 'Max API Response Bytes',
  'field.maxZipDownloadBytes': 'Max ZIP Download Bytes',
  'field.maxZipEntries': 'Max ZIP Entries',
  'field.maxZipEntryBytes': 'Max Single ZIP Entry Bytes',
  'field.maxZipTotalBytes': 'Max ZIP Total Bytes',
  'field.maxZipCompressionRatio': 'Max ZIP Compression Ratio',

  'action.save': 'Save Configuration',
  'action.saved': 'Saved',
  'action.resetDefaults': 'Reset to Defaults',
  'action.resetSection': 'Reset',
  'action.test': 'Test Active Provider',
  'action.testing': 'Testing…',
  'action.clearApiKey': 'Clear API Key',
  'action.clearingApiKey': 'Clearing…',
  'action.storageStats': 'Refresh Statistics',
  'action.integrityScan': 'Verify Cache',
  'action.gcPreview': 'Preview GC',
  'action.cacheClear': 'Clear Cache',
  'action.cacheClearConfirm': 'Confirm Clear',
  'action.quarantineList': 'List Quarantine',
  'action.cleanupPreview': 'Preview Cleanup',
  'action.cleanupDelete': 'Delete Selected',
  'action.cleanupConfirm': 'Confirm Delete',
  'action.running': 'Running…',
  'ops.statsIncomplete': 'Incomplete storage scan: marked totals are lower bounds, not exact sizes or counts.',
  'ops.bytes': 'Bytes',
  'ops.entries': 'Entries',
  'ops.results': 'Published Results',
  'ops.staging': 'Staging',
  'ops.quarantine': 'Quarantine',
  'ops.readOnly': 'Read-only',
  'ops.valid': 'Valid',
  'ops.corrupt': 'Corrupt',
  'ops.missing': 'Missing',
  'ops.unreadable': 'Unreadable',
  'ops.gcEligible': 'Complete Preview',
  'ops.gcBlocked': 'Blocked Preview',
  'ops.gcCandidates': 'Candidates',
  'ops.clearReady': 'Ready to Clear',
  'ops.clearBlocked': 'Clear Blocked',
  'ops.activeOperations': 'Active Operations',
  'ops.selectAll': 'Select all quarantine entries',
  'ops.modified': 'Modified',
  'ops.cleanupPlanned': 'Planned',
  'ops.cleanupDeleted': 'Deleted',
  'test.healthy': 'Connection Healthy',
  'test.unhealthy': 'Service Unhealthy',
  'test.error': 'Test Failed',
  'credential.placeholderStored': 'Stored; leave blank to keep the current key',
  'credential.placeholderEmpty': 'Enter an API key to store on save',
  'credential.loading': 'Checking credential status…',
  'credential.configured': 'A credential is configured. Saving with this field blank keeps it unchanged.',
  'credential.notConfigured': 'No credential is configured. Enter a key and save the configuration to store it.',
  'credential.readOnly': 'This credential comes from a read-only source, such as the process environment, and cannot be changed here.',
  'credential.referenceRequired': 'Set a credential reference before entering an API key.',

  'provider.type.selfHosted': "Self-Hosted MinerU (Legacy v2)",
  'provider.type.official': 'Official MinerU Cloud (v4 API)',
  'model.pipeline': 'Pipeline (Hallucination-free, multi-language)',
  'model.vlm': 'VLM (Visual Language Model)',
  'parse.auto': 'auto (Automatic detection)',
  'parse.txt': "txt (Use the text layer)",
  'parse.ocr': 'ocr (Force OCR recognition)',
  'artifact.markdown': 'Markdown (.md)',
  'artifact.layout': 'Layout (.json)',
  'artifact.model-output': 'Model Output (.json)',
  'artifact.content-list': 'Content List (.json)',
  'artifact.images': 'Extracted Images',
}

export const zh: Record<MineruKey, string> = {
  'section.defaults.v1.desc': '当前 V1 配置的独立 OCR 模式；模型及细粒度解析开关由服务端管理。',
  'probe.tiers': "部署可用档位",
  'probe.formats': "API 输出格式",
  'probe.sources': "API 来源类型",
  'probe.scope': "能力发现仅验证 API 访问和声明的能力，不代表解析效果已验证。本插件使用上传文件与 ZIP，不暴露 URL／inline 来源。",
  'provider.type.selfHostedV1': "自托管 MinerU（V1 API）",
  'provider.v1.hint': "MinerU 4.x 资源接口：使用 /v1/uploads 与 /v1/parse/jobs，不自动回退旧协议。",
  'provider.legacy.hint': "MinerU 3.x 任务接口：仅使用 /health 和 /tasks；4.x 服务请选择 V1 API。",
  'field.configuredVersion': "部署／模型版本",
  'field.configuredVersion.hint': "可选的缓存版本标识。原地升级服务或模型后请更新，避免复用旧结果。",
  'field.v1OcrMode': "OCR 模式（V1）",
  'field.v1OcrMode.hint': "按 V1 配置单独保存：auto 自动判断 PDF 文本层，txt 使用文本层，ocr 强制识别；txt 不保证完全不运行视觉模型。",
  'notice.v1ServerManaged': "V1 请求没有模型、语言、公式或表格开关；解析由档位和服务端控制。旧版／云服务的共享默认值会保留，但不作用于 V1；原生文档按服务端支持的原生路径解析。",
  'probe.auth': "认证",
  'probe.protocol': "协议",
  'probe.server': "服务端",
  'probe.queue': "队列（执行／等待／上限）",
  'probe.diagnostics': "诊断",
  'nav': 'MinerU',
  'page.title': 'MinerU 配置',
  'page.intro': '配置 MinerU 文档解析 Provider、全局内容寻址缓存及执行资源上限。',
  'section.provider': 'Provider 适配与鉴权',
  'section.defaults': '统一解析默认值',
  'section.storage': '存储与全局缓存',
  'section.operations': '存储运维',
  'section.polling': '轮询与超时控制',
  'section.retry': '网络重试策略',
  'section.output': '模型输出限制',
  'section.limits': '安全与资源上限',
  'section.limits.restartHint': '安全与有效载荷上限在插件启动时初始化并绑定存储仓，修改需要重启插件后生效。',
  'section.provider.desc': 'Provider 配置文件、服务端点、协议版本与认证凭据管理',
  'section.defaults.desc': '默认解析模型、提取方式、目标语言与公式表格开关',
  'section.storage.desc': '内容寻址缓存根目录、全局缓存开关与暂存区清理 TTL',
  'section.operations.desc': '存储统计、缓存完整性校验、GC 预览清理与隔离区管理',
  'section.polling.desc': '状态轮询间隔、同步等待超时与单进程共享操作时限',
  'section.retry.desc': '指数退避重试策略、最大尝试次数与延迟上下限',
  'section.output.desc': '单次模型响应字符上限与内联图片配额',
  'section.limits.desc': '系统有效载荷上限、安全解压比与 ZIP 边界保护（启动时绑定）',
  'action.retryLoad': '重新加载',
  'badge.selfHosted': '自托管',
  'badge.official': '官方云 (v4)',
  'action.expandAll': '展开全部',
  'action.collapseAll': '折叠全部',
  'action.expand': '展开卡片',
  'action.collapse': '折叠卡片',
  'action.dismiss': '关闭提示',
  'unit.attempts': '次尝试',
  'unit.chars': '字符',
  'unit.images': '张图片',
  'unit.ms': 'ms',
  'unit.seconds': '秒',
  'unit.fileLimit': '文件上限',
  'badge.configured': '已配置凭据',
  'badge.notConfigured': '未配置凭据',
  'badge.healthy': '连接正常',
  'badge.unhealthy': '状态异常',
  'badge.testing': '测试中…',
  'badge.cacheOn': '已开启缓存',
  'badge.cacheOff': '已关闭缓存',
  'badge.readOnly': '只读',
  'badge.maintenance': '预览后确认',
  'notice.officialTxtToAuto': '官方 v4 Provider 不支持 txt 纯文本提取模式，解析方式已自动调整为 auto。',

  'field.activeProvider': '当前激活的 Provider',
  'field.baseURL': 'API 服务地址',
  'field.baseURL.placeholder': 'https://mineru.net/api/v4 或 http://localhost:18000',
  'field.apiKeyEnv': '凭据引用名',
  'field.apiKeyEnv.placeholder': 'MINERU_API_KEY',
  'field.apiKeyEnv.hint': 'MinerU 配置中仅保存此引用名；API Key 值由 DeepSeek Harness 凭据服务单独保管。',
  'field.apiKey': 'API Key',
  'field.allowInsecureHttp': '允许非加密 HTTP 连接',
  'field.tier': '解析档位',
  'field.tier.hint': "V1 的质量／速度档位，不是模型名称。“服务端默认”不发送 tier；可用性取决于部署。standard 与 advanced 可能共用模型、采用不同计算量。",
  'field.tier.serverDefault': '服务端默认',
  'field.tier.opt.flash': "flash（快速解析；需要时使用轻量 OCR）",
  'field.tier.opt.basic': 'basic（本地轻量模型）',
  'field.tier.opt.standard': 'standard（均衡解析，推荐）',
  'field.tier.opt.advanced': "advanced（更高推理计算量）",
  'field.legacyParams': '旧版参数（MinerU 3.x 及更早）',
  'field.legacyParams.hint': "仅发送至旧版 /tasks 接口的后端标识，不是 V1 档位。",
  'field.modelMap.pipeline': 'Pipeline 模型后端映射',
  'field.modelMap.pipeline.hint': '自托管 MinerU 在处理 pipeline（规则与 OCR 流水线）解析请求时使用的上游选择项。MinerU 3.x 及更早填写后端标识，通常为 pipeline；MinerU 4.0+ 会忽略该值（除非它本身是档位名），请改用上方“解析档位”。',
  'field.modelMap.pipeline.placeholder': 'pipeline',
  'field.modelMap.vlm': 'VLM 模型后端映射',
  'field.modelMap.vlm.hint': '自托管 MinerU 在处理 vlm（视觉大模型）解析请求时使用的上游选择项。MinerU 3.x 及更早填写后端标识，常用 hybrid-engine（混合引擎，高精度低幻觉，推荐）和 vlm-engine（纯本地视觉大模型）；MinerU 4.0+ 会忽略该值（除非它本身是档位名），请改用上方“解析档位”。',
  'field.modelMap.vlm.placeholder': 'hybrid-engine 或 vlm-engine',
  'field.modelMap.chip.default': '默认',
  'field.modelMap.chip.recommended': '推荐',
  'field.modelMap.chip.vlmEngine': '纯 VLM',
  'field.modelMap.opt.pipeline': 'pipeline（规则与 OCR 流水线，速度快且无幻觉）',
  'field.modelMap.opt.hybridEngine': 'hybrid-engine（版面分析 + VLM 混合引擎，高精度低幻觉，推荐）',
  'field.modelMap.opt.vlmEngine': 'vlm-engine（纯本地视觉大模型端到端推理）',
  'field.officialModels': '云服务支持模型',

  'field.defaultModel': '默认解析模型',
  'field.defaultParseMethod': '默认解析方式',
  'field.defaultLang': '默认语言',
  'field.defaultFormula': '开启公式解析',
  'field.defaultTable': '开启表格解析',

  'field.storageRoot': '持久存储根目录',
  'field.cacheEnabled': '启用全局内容寻址缓存',
  'field.stagingTtlMs': 'Staging 暂存清理 TTL (ms)',

  'field.pollIntervalMs': '状态轮询间隔 (ms)',
  'field.pollTimeoutMs': '同步等待解析超时 (ms)',
  'field.requestTimeoutMs': '单次网络请求超时 (ms)',
  'field.operationTimeoutMs': '单进程共享操作超时 (ms)',

  'field.retryMaxAttempts': '最大尝试次数',
  'field.retryBaseDelayMs': '基础重试延迟 (ms)',
  'field.retryMaxDelayMs': '最大重试延迟 (ms)',

  'field.maxInlineChars': '单次响应字符预算',
  'field.maxInlineImages': '单次响应内联图片预算',

  'field.maxFileBytes': '单个源文件大小上限 (bytes)',
  'field.maxApiResponseBytes': 'API 响应体大小上限 (bytes)',
  'field.maxZipDownloadBytes': 'ZIP 下载包大小上限 (bytes)',
  'field.maxZipEntries': 'ZIP 最大解压条目数',
  'field.maxZipEntryBytes': 'ZIP 单条目解压字节上限 (bytes)',
  'field.maxZipTotalBytes': 'ZIP 总解压字节上限 (bytes)',
  'field.maxZipCompressionRatio': 'ZIP 最大解压压缩比',

  'action.save': '保存配置',
  'action.saved': '已保存',
  'action.resetDefaults': '恢复默认配置',
  'action.resetSection': '重置',
  'action.test': '测试当前 Provider 连接',
  'action.testing': '测试中…',
  'action.clearApiKey': '清除 API Key',
  'action.clearingApiKey': '清除中…',
  'action.storageStats': '刷新统计',
  'action.integrityScan': '校验缓存',
  'action.gcPreview': '预览 GC',
  'action.cacheClear': '清除缓存',
  'action.cacheClearConfirm': '确认清除',
  'action.quarantineList': '查看隔离区',
  'action.cleanupPreview': '预览清理',
  'action.cleanupDelete': '删除已选项',
  'action.cleanupConfirm': '确认删除',
  'action.running': '执行中…',
  'ops.statsIncomplete': '存储扫描不完整：带标记的数值仅为下界，并非精确大小或条目数。',
  'ops.bytes': '字节数',
  'ops.entries': '条目数',
  'ops.results': '已发布结果',
  'ops.staging': '暂存区',
  'ops.quarantine': '隔离区',
  'ops.readOnly': '只读',
  'ops.valid': '有效',
  'ops.corrupt': '损坏',
  'ops.missing': '缺失',
  'ops.unreadable': '不可读',
  'ops.gcEligible': '预览完整',
  'ops.gcBlocked': '预览受阻',
  'ops.gcCandidates': '候选项',
  'ops.clearReady': '可以清除',
  'ops.clearBlocked': '清除受阻',
  'ops.activeOperations': '活动共享操作',
  'ops.selectAll': '选择全部隔离条目',
  'ops.modified': '修改时间',
  'ops.cleanupPlanned': '计划清理',
  'ops.cleanupDeleted': '已删除',
  'test.healthy': '连接正常',
  'test.unhealthy': '服务状态异常',
  'test.error': '连接测试失败',
  'credential.placeholderStored': '已保存；留空将保留当前 Key',
  'credential.placeholderEmpty': '输入 API Key，保存配置时写入凭据服务',
  'credential.loading': '正在检查凭据状态…',
  'credential.configured': '凭据已配置；API Key 留空保存不会覆盖现有值。',
  'credential.notConfigured': '尚未配置凭据；输入 API Key 并保存配置即可写入。',
  'credential.readOnly': '该凭据来自进程环境变量等只读来源，无法在此修改或清除。',
  'credential.referenceRequired': '请先填写凭据引用名，再输入 API Key。',

  'provider.type.selfHosted': "旧版自托管 MinerU（Legacy v2）",
  'provider.type.official': '官方云服务 MinerU (v4 API)',
  'model.pipeline': 'Pipeline（无幻觉，支持多语言 OCR）',
  'model.vlm': 'VLM（视觉大模型）',
  'parse.auto': 'auto（自动检测）',
  'parse.txt': "txt（使用文本层）",
  'parse.ocr': 'ocr（强制文字 OCR）',
  'artifact.markdown': 'Markdown 文本 (.md)',
  'artifact.layout': '版面分析 (.json)',
  'artifact.model-output': '模型输出 (.json)',
  'artifact.content-list': '结构化内容块 (.json)',
  'artifact.images': '提取图片',
}