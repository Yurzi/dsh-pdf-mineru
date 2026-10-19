import type { Context } from '@deepseek-ai/cordis'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { JobOutcome } from '@deepseek-ai/dsh-jobs'
import type { MinerUConfig } from '../config/model.js'
import { MinerUError, failure } from '../domain/errors.js'
import type { ReaderService } from '../reader/reader-service.js'
import { asyncParsePdfTool } from './async-parse-pdf.js'
import { readPdfTool } from './read-pdf.js'

export interface ToolDependencies {
  readonly reader: Pick<ReaderService, 'readContent' | 'viewPage' | 'summarize'>
  /** Live configuration; each tool invocation reads one snapshot. */
  readonly config: () => MinerUConfig
  /** Optional sibling service, absent on hosts without attachments. */
  readonly attachments: () => AttachmentStore | undefined
}

export interface BackgroundInvocation {
  readonly controller: AbortController
  readonly done: Promise<JobOutcome>
}

/** Register both model tools; the disposer cancels and awaits background parses this plugin started. */
export function registerTools(ctx: Context, deps: ToolDependencies): () => Promise<void> {
  const invocations = new Set<BackgroundInvocation>()
  const disposers = [
    ctx.tools.register(asyncParsePdfTool(ctx, deps, invocations)) as () => void,
    ctx.tools.register(readPdfTool(ctx, deps)) as () => void,
  ]
  return async () => {
    for (const dispose of disposers) dispose()
    const active = [...invocations]
    for (const invocation of active) {
      if (!invocation.controller.signal.aborted) {
        invocation.controller.abort(new MinerUError(failure('CANCELLED', 'MinerU plugin disposed', true)))
      }
    }
    await Promise.allSettled(active.map(invocation => invocation.done))
  }
}
