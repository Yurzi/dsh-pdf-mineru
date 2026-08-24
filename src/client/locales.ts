export type MineruKey =
  | 'nav'
  | 'page.title'
  | 'page.intro'
  | 'section.provider'
  | 'section.defaults'
  | 'section.storage'
  | 'section.polling'
  | 'section.output'
  | 'section.limits'
  | 'field.activeProvider'
  | 'field.providerType'
  | 'field.baseURL'
  | 'field.baseURL.placeholder'
  | 'field.apiKeyEnv'
  | 'field.apiKeyEnv.placeholder'
  | 'field.allowInsecureHttp'
  | 'field.configuredVersion'
  | 'field.modelMap.pipeline'
  | 'field.modelMap.vlm'
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
  | 'test.healthy'
  | 'test.unhealthy'
  | 'test.error'
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
  'page.intro': 'Configure MinerU document parsing providers, global content-addressed caching, and execution limits.',
  'section.provider': 'Provider Settings',
  'section.defaults': 'Parsing Defaults',
  'section.storage': 'Storage & Cache',
  'section.polling': 'Polling & Timeouts',
  'section.output': 'Output Limits',
  'section.limits': 'Security & Payload Limits',

  'field.activeProvider': 'Active Provider',
  'field.providerType': 'Provider Type',
  'field.baseURL': 'API Base URL',
  'field.baseURL.placeholder': 'https://mineru.net/api/v4 or http://localhost:18000',
  'field.apiKeyEnv': 'API Key Env Var',
  'field.apiKeyEnv.placeholder': 'MINERU_API_KEY',
  'field.allowInsecureHttp': 'Allow Insecure HTTP (Local Only)',
  'field.configuredVersion': 'Server Protocol / Version',
  'field.modelMap.pipeline': 'Pipeline Backend Map',
  'field.modelMap.vlm': 'VLM Backend Map',
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
  'test.healthy': 'Connection Healthy',
  'test.unhealthy': 'Service Unhealthy',
  'test.error': 'Test Failed',

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
  'page.intro': '配置 MinerU 文档解析 Provider、全局内容寻址缓存及执行资源上限。',
  'section.provider': 'Provider 适配与鉴权',
  'section.defaults': '统一解析默认值',
  'section.storage': '存储与全局缓存',
  'section.polling': '轮询与超时控制',
  'section.output': '模型输出限制',
  'section.limits': '安全与资源上限',

  'field.activeProvider': '当前激活的 Provider',
  'field.providerType': 'Provider 类型',
  'field.baseURL': 'API 服务地址',
  'field.baseURL.placeholder': 'https://mineru.net/api/v4 或 http://localhost:18000',
  'field.apiKeyEnv': 'API Key 环境变量名',
  'field.apiKeyEnv.placeholder': 'MINERU_API_KEY',
  'field.allowInsecureHttp': '允许非加密 HTTP 连接',
  'field.configuredVersion': '服务端协议版本标识',
  'field.modelMap.pipeline': 'Pipeline 模型后端映射',
  'field.modelMap.vlm': 'VLM 模型后端映射',
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
  'test.healthy': '连接正常',
  'test.unhealthy': '服务状态异常',
  'test.error': '连接测试失败',

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
