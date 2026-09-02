export type MineruKey =
  | 'nav'
  | 'page.title'
  | 'page.intro'
  | 'card.description'
  | 'section.provider'
  | 'section.defaults'
  | 'section.storage'
  | 'section.operations'
  | 'section.polling'
  | 'section.retry'
  | 'section.output'
  | 'section.limits'
  | 'field.activeProvider'
  | 'field.baseURL'
  | 'field.baseURL.placeholder'
  | 'field.apiKeyEnv'
  | 'field.apiKeyEnv.placeholder'
  | 'field.apiKeyEnv.hint'
  | 'field.apiKey'
  | 'field.allowInsecureHttp'
  | 'field.configuredVersion'
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
  | 'field.defaultArtifacts'
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
  | 'field.maxFilesPerRequest'
  | 'field.maxFileBytes'
  | 'field.maxApiResponseBytes'
  | 'field.maxZipDownloadBytes'
  | 'field.maxZipEntries'
  | 'field.maxZipEntryBytes'
  | 'field.maxZipTotalBytes'
  | 'field.maxZipCompressionRatio'
  | 'action.save'
  | 'action.saved'
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
  'nav': 'MinerU',
  'page.title': 'MinerU Configuration',
  'card.description': 'Configure parsing providers, credentials, and cache settings.',
  'page.intro': 'Configure MinerU document parsing providers, global content-addressed caching, and execution limits.',
  'section.provider': 'Provider Settings',
  'section.defaults': 'Parsing Defaults',
  'section.storage': 'Storage & Cache',
  'section.operations': 'Storage Operations',
  'section.polling': 'Polling & Timeouts',
  'section.retry': 'Retry Policy',
  'section.output': 'Output Limits',
  'section.limits': 'Security & Payload Limits',

  'field.activeProvider': 'Active Provider',
  'field.baseURL': 'API Base URL',
  'field.baseURL.placeholder': 'https://mineru.net/api/v4 or http://localhost:18000',
  'field.apiKeyEnv': 'Credential Reference',
  'field.apiKeyEnv.placeholder': 'MINERU_API_KEY',
  'field.apiKeyEnv.hint': 'Reference name stored in MinerU configuration. The API key value is kept separately by DeepSeek Harness.',
  'field.apiKey': 'API Key',
  'field.allowInsecureHttp': 'Allow Insecure HTTP (Local Only)',
  'field.configuredVersion': 'Server Protocol / Version',
  'field.modelMap.pipeline': 'Pipeline Backend Map',
  'field.modelMap.pipeline.hint': 'Backend engine identifier sent to the self-hosted MinerU server for pipeline requests. Default and standard value is pipeline.',
  'field.modelMap.pipeline.placeholder': 'pipeline',
  'field.modelMap.vlm': 'VLM Backend Map',
  'field.modelMap.vlm.hint': 'Backend engine identifier sent to the self-hosted MinerU server for VLM requests. Common choices include hybrid-engine (hybrid layout + VLM, recommended) and vlm-engine (pure local VLM).',
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
  'field.defaultArtifacts': 'Default Required Artifacts',

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

  'field.maxInlineChars': 'Max Inline Markdown Chars',

  'field.maxFilesPerRequest': 'Max Files Per Request',
  'field.maxFileBytes': 'Max File Bytes',
  'field.maxApiResponseBytes': 'Max API Response Bytes',
  'field.maxZipDownloadBytes': 'Max ZIP Download Bytes',
  'field.maxZipEntries': 'Max ZIP Entries',
  'field.maxZipEntryBytes': 'Max Single ZIP Entry Bytes',
  'field.maxZipTotalBytes': 'Max ZIP Total Bytes',
  'field.maxZipCompressionRatio': 'Max ZIP Compression Ratio',

  'action.save': 'Save Configuration',
  'action.saved': 'Saved',
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

  'provider.type.selfHosted': 'Self-Hosted MinerU (v2 API)',
  'provider.type.official': 'Official MinerU Cloud (v4 API)',
  'model.pipeline': 'Pipeline (Hallucination-free, multi-language)',
  'model.vlm': 'VLM (Visual Language Model)',
  'parse.auto': 'auto (Automatic detection)',
  'parse.txt': 'txt (Fast text only, no OCR)',
  'parse.ocr': 'ocr (Force OCR recognition)',
  'artifact.markdown': 'Markdown (.md)',
  'artifact.layout': 'Layout (.json)',
  'artifact.model-output': 'Model Output (.json)',
  'artifact.content-list': 'Content List (.json)',
  'artifact.images': 'Extracted Images',
}

export const zh: Record<MineruKey, string> = {
  'nav': 'MinerU',
  'page.title': 'MinerU 配置',
  'card.description': '配置解析服务、凭据与缓存设置。',
  'page.intro': '配置 MinerU 文档解析 Provider、全局内容寻址缓存及执行资源上限。',
  'section.provider': 'Provider 适配与鉴权',
  'section.defaults': '统一解析默认值',
  'section.storage': '存储与全局缓存',
  'section.operations': '存储运维',
  'section.polling': '轮询与超时控制',
  'section.retry': '网络重试策略',
  'section.output': '模型输出限制',
  'section.limits': '安全与资源上限',

  'field.activeProvider': '当前激活的 Provider',
  'field.baseURL': 'API 服务地址',
  'field.baseURL.placeholder': 'https://mineru.net/api/v4 或 http://localhost:18000',
  'field.apiKeyEnv': '凭据引用名',
  'field.apiKeyEnv.placeholder': 'MINERU_API_KEY',
  'field.apiKeyEnv.hint': 'MinerU 配置中仅保存此引用名；API Key 值由 DeepSeek Harness 凭据服务单独保管。',
  'field.apiKey': 'API Key',
  'field.allowInsecureHttp': '允许非加密 HTTP 连接',
  'field.configuredVersion': '服务端协议版本标识',
  'field.modelMap.pipeline': 'Pipeline 模型后端映射',
  'field.modelMap.pipeline.hint': '自托管 MinerU 服务端在处理 pipeline（规则与 OCR 流水线）解析请求时调用的底层后端标识，默认且通常填写 pipeline。',
  'field.modelMap.pipeline.placeholder': 'pipeline',
  'field.modelMap.vlm': 'VLM 模型后端映射',
  'field.modelMap.vlm.hint': '自托管 MinerU 服务端在处理 vlm（视觉大模型）解析请求时调用的底层后端标识。常用项包括 hybrid-engine（混合引擎，高精度低幻觉，推荐）和 vlm-engine（纯本地视觉大模型）。',
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
  'field.defaultArtifacts': '默认必要产物',

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

  'field.maxInlineChars': 'Markdown 预览字符上限',

  'field.maxFilesPerRequest': '单次请求最大文件数',
  'field.maxFileBytes': '单个源文件大小上限 (bytes)',
  'field.maxApiResponseBytes': 'API 响应体大小上限 (bytes)',
  'field.maxZipDownloadBytes': 'ZIP 下载包大小上限 (bytes)',
  'field.maxZipEntries': 'ZIP 最大解压条目数',
  'field.maxZipEntryBytes': 'ZIP 单条目解压字节上限 (bytes)',
  'field.maxZipTotalBytes': 'ZIP 总解压字节上限 (bytes)',
  'field.maxZipCompressionRatio': 'ZIP 最大解压压缩比',

  'action.save': '保存配置',
  'action.saved': '已保存',
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

  'provider.type.selfHosted': '自托管 MinerU (v2 API)',
  'provider.type.official': '官方云服务 MinerU (v4 API)',
  'model.pipeline': 'Pipeline（无幻觉，支持多语言 OCR）',
  'model.vlm': 'VLM（视觉大模型）',
  'parse.auto': 'auto（自动检测）',
  'parse.txt': 'txt（纯文本提取，速度快）',
  'parse.ocr': 'ocr（强制文字 OCR）',
  'artifact.markdown': 'Markdown 文本 (.md)',
  'artifact.layout': '版面分析 (.json)',
  'artifact.model-output': '模型输出 (.json)',
  'artifact.content-list': '结构化内容块 (.json)',
  'artifact.images': '提取图片',
}
