import type { MinerUFileId } from '../domain/ids.js'

export interface OfficialV4BatchFileItem {
  readonly name: string
  readonly data_id: string
  readonly is_ocr?: boolean
  readonly enable_formula?: boolean
  readonly enable_table?: boolean
  readonly language?: string
  readonly page_ranges?: string
  readonly layout_model?: string
}

export interface OfficialV4BatchSubmitRequest {
  readonly files: readonly OfficialV4BatchFileItem[]
  readonly model_version?: string
  readonly extra_formats?: readonly string[]
  readonly no_cache?: boolean
  readonly cache_tolerance?: number
}

export interface OfficialV4BatchSubmitData {
  readonly batch_id: string
  readonly file_urls: readonly string[]
}

export interface OfficialV4ApiResponse<T> {
  readonly code: number | string
  readonly msg: string
  readonly trace_id?: string
  readonly data?: T
}

export interface OfficialV4ExtractProgressObject {
  readonly extracted_pages?: number
  readonly total_pages?: number
}

export interface OfficialV4ExtractResultItem {
  readonly data_id?: string
  readonly file_name?: string
  readonly state: string
  readonly full_zip_url?: string
  readonly err_msg?: string
  readonly extract_progress?: OfficialV4ExtractProgressObject | number | null | unknown
}

export interface OfficialV4ExtractResultsData {
  readonly batch_id: string
  readonly extract_result?: readonly OfficialV4ExtractResultItem[]
}

export interface SafeZipLimits {
  readonly maxZipEntries: number
  readonly maxZipEntryBytes: number
  readonly maxZipTotalBytes: number
  readonly maxZipCompressionRatio: number
}

export interface ExtractZipTargetFile {
  readonly fileId: MinerUFileId
  readonly dataId: string
  readonly name: string
}
