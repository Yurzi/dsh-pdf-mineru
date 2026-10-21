import { openAsBlob } from 'node:fs'
import type { MinerUFileId } from '../../domain/ids.js'
import type { PreparedSourceFile } from '../../domain/request.js'
import { MinerUError, failure, sanitizeDiagnostic } from '../../domain/errors.js'
import { assertSourcesUnchanged } from '../../source/prepared-source.js'
import type { ProviderCallContext } from '../contract.js'
import { extractErrorDetail, safeProviderCode, type ProviderHttpClient } from '../http/http-client.js'
import { executeWithRetry, isRetryableHttpStatus, parseRetryAfter, readBoundedResponseText } from '../http/retry.js'

const EXTENSION_MIME_TYPES: Readonly<Record<string, string>> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jp2': 'image/jp2',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

export interface SelfHostedV1UploadResponse {
  readonly id?: string
  readonly status?: string
  readonly upload_url?: string | null
  readonly upload_method?: string | null
  readonly upload_headers?: Readonly<Record<string, string>> | null
  readonly file?: { readonly id?: string } | null
}

function uploadFailed(
  message: string,
  retryable = false,
  details: { readonly fileId?: MinerUFileId; readonly providerCode?: string } = {},
  http?: MinerUError['http'],
): MinerUError {
  return new MinerUError(failure('UPLOAD_FAILED', message, retryable, { provider: 'self-hosted-v1', ...details }), { http })
}

export function mimeTypeForName(name: string): string {
  const match = /\.[^./\\]+$/.exec(name.toLowerCase())
  return (match === null ? undefined : EXTENSION_MIME_TYPES[match[0]]) ?? 'application/octet-stream'
}

function effectivePort(url: URL): string {
  return url.port !== '' ? url.port : (url.protocol === 'https:' ? '443' : '80')
}

/** Same scheme, host, and effective port; the only target that may receive the API key. */
export function isSameOriginUrl(target: URL, baseUrl: URL): boolean {
  return target.protocol === baseUrl.protocol
    && target.hostname.toLowerCase() === baseUrl.hostname.toLowerCase()
    && effectivePort(target) === effectivePort(baseUrl)
}

/** True when an HTTPS endpoint points the byte upload at a cleartext origin elsewhere. */
export function isInsecureCrossOriginUpload(target: URL, baseUrl: URL): boolean {
  return target.protocol === 'http:' && baseUrl.protocol !== 'http:' && !isSameOriginUrl(target, baseUrl)
}

/** Owns V1 upload-session allocation, fresh byte PUTs, and completion. */
export class SelfHostedV1Uploader {
  constructor(private readonly baseUrl: URL, private readonly client: ProviderHttpClient) {}

  async uploadSource(source: PreparedSourceFile, context: ProviderCallContext): Promise<string> {
    const created = await this.client.requestJson<SelfHostedV1UploadResponse>({
      method: 'POST',
      path: '/v1/uploads',
      body: JSON.stringify({
        filename: source.name,
        bytes: source.bytes,
        mime_type: mimeTypeForName(source.name),
        purpose: 'parse',
        sha256sum: source.sha256,
      }),
      headers: { 'content-type': 'application/json' },
      context,
      acceptedStatuses: [200],
      operation: 'submit',
      retry: false,
    })

    // Upload deduplication: an identical file is already stored and needs no byte transfer.
    if (created?.status === 'completed') return this.requireFileId(created, source.name)
    if (created?.status !== 'pending') {
      throw uploadFailed(`MinerU upload session entered unsupported state "${String(created?.status)}"`, false, { fileId: source.fileId })
    }

    const uploadId = created.id
    const uploadUrl = created.upload_url
    if (typeof uploadId !== 'string' || uploadId.trim() === '' || typeof uploadUrl !== 'string' || uploadUrl.trim() === '') {
      throw uploadFailed('MinerU server returned an incomplete upload session', false, { fileId: source.fileId })
    }
    if (created.upload_method !== undefined && created.upload_method !== null && created.upload_method !== 'PUT') {
      throw uploadFailed(`MinerU server requested unsupported upload method "${String(created.upload_method)}"`, false, { fileId: source.fileId })
    }

    await this.putUploadBytes(uploadUrl, created.upload_headers ?? {}, source, context)

    const completed = await this.client.requestJson<SelfHostedV1UploadResponse>({
      method: 'POST',
      path: `/v1/uploads/${encodeURIComponent(uploadId)}/complete`,
      body: JSON.stringify({}),
      headers: { 'content-type': 'application/json' },
      context,
      acceptedStatuses: [200],
      operation: 'submit',
      retry: false,
    })
    return this.requireFileId(completed, source.name)
  }

  private requireFileId(upload: SelfHostedV1UploadResponse | undefined, name: string): string {
    const fileId = upload?.file?.id
    if (typeof fileId !== 'string' || fileId.trim() === '') {
      throw uploadFailed(`MinerU server did not return a file id for "${name}"`)
    }
    return fileId
  }

  /**
   * Streams source bytes to the service-provided upload URL. The API key is attached only
   * when the target is same-origin with the configured endpoint; service-provided upload
   * headers are otherwise preserved verbatim. PUT is idempotent, so transient failures retry
   * with a freshly opened source file.
   */
  private async putUploadBytes(
    rawUploadUrl: string,
    uploadHeaders: Readonly<Record<string, string>>,
    source: PreparedSourceFile,
    context: ProviderCallContext,
  ): Promise<void> {
    const target = this.resolveUploadUrl(rawUploadUrl)
    const sameOrigin = this.isSameOrigin(target)
    const headers: Record<string, string> = {}
    let serviceAuthorization = false
    for (const [key, value] of Object.entries(uploadHeaders)) {
      // Service-provided headers are forwarded verbatim, but never as header-injection vectors.
      if (typeof value !== 'string' || /[\r\n]/.test(key) || /[\r\n]/.test(value)) {
        throw uploadFailed('MinerU server returned an invalid upload header')
      }
      if (key.toLowerCase() === 'authorization') serviceAuthorization = true
      headers[key] = value
    }
    // A service-provided Authorization describes the upload target itself and must win;
    // HTTP header names are case-insensitive, so a second spelling would be merged into one
    // corrupted value instead of overriding it.
    if (sameOrigin && !serviceAuthorization
      && typeof context.credential === 'string' && context.credential.trim() !== '') {
      headers['authorization'] = `Bearer ${context.credential}`
    }

    await executeWithRetry({
      provider: 'self-hosted-v1',
      operation: 'upload-put',
      signal: context.signal,
      retryOptions: context.retry,
      fn: async () => {
        context.signal.throwIfAborted()
        await assertSourcesUnchanged([source], context.signal)

        const controller = new AbortController()
        let timedOut = false
        const timer = setTimeout(() => {
          timedOut = true
          controller.abort(new DOMException(`Upload timed out after ${String(context.timeoutMs)}ms`, 'TimeoutError'))
        }, context.timeoutMs)
        const onParentAbort = (): void => { controller.abort(context.signal.reason) }
        context.signal.addEventListener('abort', onParentAbort, { once: true })

        try {
          // A Blob body makes the runtime send Content-Length, which presigned and
          // size-checking upload targets require; it is reopened on every attempt.
          const blob = await openAsBlob(source.path)
          const requestInit: RequestInit = {
            method: 'PUT',
            headers,
            body: blob,
            signal: controller.signal,
            redirect: 'error',
          }
          let response: Response
          try {
            response = await fetch(target.toString(), requestInit)
          } catch (error: unknown) {
            if (context.signal.aborted) throw new MinerUError(failure('CANCELLED', 'Upload was cancelled', true))
            if (timedOut) {
              const timeoutError = uploadFailed(`Upload to MinerU server timed out after ${String(context.timeoutMs)}ms`, true, { fileId: source.fileId }, { status: 408 })
              throw timeoutError
            }
            const message = error instanceof Error ? error.message : String(error)
            throw uploadFailed(`Failed to upload source bytes: ${message}`, true, { fileId: source.fileId })
          }

          if (response.status !== 200 && response.status !== 204) {
            let errorBody = ''
            try {
              errorBody = await readBoundedResponseText(response, 2048, controller.signal)
            } catch {
              if (response.body) { try { await response.body.cancel() } catch {} }
            }
            // Same-origin targets answer with the V1 error envelope (for example an expired session's
            // `upload_not_found`); any other body, such as a presigned target's, is kept as bounded raw text.
            const secrets = [context.credential ?? '']
            const detail = extractErrorDetail(errorBody, 'self-hosted-v1')
            const providerCode = safeProviderCode(detail.code, secrets)
            const diagnostic = detail.message || errorBody
            const error = uploadFailed(
              `Upload failed with HTTP status ${String(response.status)}${diagnostic === '' ? '' : `: ${sanitizeDiagnostic(diagnostic, secrets)}`}`,
              isRetryableHttpStatus(response.status),
              { fileId: source.fileId, ...(providerCode === undefined ? {} : { providerCode }) },
              { status: response.status, retryAfterMs: parseRetryAfter(response.headers.get('retry-after')) },
            )
            throw error
          }
          if (response.body) { try { await response.body.cancel() } catch {} }
        } finally {
          clearTimeout(timer)
          context.signal.removeEventListener('abort', onParentAbort)
        }
      },
    })
  }

  private resolveUploadUrl(raw: string): URL {
    let target: URL
    try {
      target = new URL(raw, this.baseUrl)
    } catch {
      throw uploadFailed('MinerU server returned an invalid upload URL')
    }
    if ((target.protocol !== 'https:' && target.protocol !== 'http:') || target.username !== '' || target.password !== '') {
      throw uploadFailed('MinerU server returned an unsupported upload URL')
    }
    // Never let an HTTPS-configured endpoint downgrade the byte transfer to cleartext elsewhere.
    if (isInsecureCrossOriginUpload(target, this.baseUrl)) {
      throw uploadFailed('MinerU server returned an insecure cross-origin upload URL')
    }
    return target
  }

  private isSameOrigin(target: URL): boolean {
    return isSameOriginUrl(target, this.baseUrl)
  }

}
