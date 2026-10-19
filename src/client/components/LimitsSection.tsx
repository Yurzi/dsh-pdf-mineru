import { useState, type ReactNode } from 'react'
import type { SecurityLimits } from '../../config/model.js'
import { formatBytes } from '../helpers.js'
import type { MineruKey } from '../locales.js'
import { useSettings } from '../settings-context.js'
import { Row, Section } from './Field.js'
import css from './Storage.module.css'

const LIMITS: readonly { readonly key: keyof SecurityLimits; readonly label: MineruKey; readonly kind: 'bytes' | 'count' | 'ratio' }[] = [
  { key: 'maxFileBytes', label: 'limit.file', kind: 'bytes' },
  { key: 'maxApiResponseBytes', label: 'limit.response', kind: 'bytes' },
  { key: 'maxZipDownloadBytes', label: 'limit.zipDownload', kind: 'bytes' },
  { key: 'maxZipEntries', label: 'limit.zipEntries', kind: 'count' },
  { key: 'maxZipEntryBytes', label: 'limit.zipEntry', kind: 'bytes' },
  { key: 'maxZipTotalBytes', label: 'limit.zipTotal', kind: 'bytes' },
  { key: 'maxZipCompressionRatio', label: 'limit.zipRatio', kind: 'ratio' },
]

function formatLimit(value: number, kind: 'bytes' | 'count' | 'ratio'): string {
  switch (kind) {
    case 'bytes': return formatBytes(value)
    case 'count': return value.toLocaleString()
    case 'ratio': return value.toLocaleString() + '×'
  }
}

/** Startup-fixed limits, shown read-only. */
export function LimitsSection(): ReactNode {
  const { settings, t } = useSettings()
  const [open, setOpen] = useState(false)
  const { limits } = settings.state.draft
  return (
    <Section
      name="limits"
      title={t('section.limits')}
      hint={t('section.limits.hint')}
      collapsible={{ open, onToggle: () => { setOpen(value => !value) } }}
    >
      {LIMITS.map(limit => (
        <Row key={limit.key} id={'mineru-limit-' + limit.key} label={t(limit.label)} compact labelsControl={false}>
          <span className={css.value} data-limit={limit.key}>{formatLimit(limits[limit.key], limit.kind)}</span>
        </Row>
      ))}
    </Section>
  )
}
