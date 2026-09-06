import type { Dispatch, SetStateAction } from 'react'
import type { MinerUConfig } from '../../config/pure.js'
import type { MineruKey } from '../locales.js'
import { updateConfigSection } from '../helpers.js'
import { NumericInput } from '../NumericInput.js'
import css from '../SettingsPage.module.css'

export interface AdvancedSectionsProps {
  readonly draft: MinerUConfig
  readonly setDraft: Dispatch<SetStateAction<MinerUConfig | null>>
  readonly t: (key: MineruKey) => string
}

export function AdvancedSections({
  draft,
  setDraft,
  t,
}: AdvancedSectionsProps) {
  return (
    <>
      {/* 3. Storage & Cache */}
      <div className={css.editorGroup}>
        <h3 className={css.groupTitle}>{t('section.storage')}</h3>

        <div className={css.row}>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('field.storageRoot')}</span>
            <input
              className={css.input}
              value={draft.storage.storageRoot}
              readOnly
              disabled
              title="Storage root changes require editing plugin configuration and restarting the plugin."
            />
          </label>

          <label className={css.field}>
            <span className={css.fieldLabel}>{t('field.stagingTtlMs')}</span>
            <NumericInput
              className={css.input}
              value={draft.storage.stagingTtlMs}
              min={1}
              onChange={val => setDraft(prev => prev === null ? prev : updateConfigSection(prev, 'storage', { stagingTtlMs: val }))}
            />
          </label>
        </div>

        <div className={css.row}>
          <label className={css.checkboxField}>
            <input
              type="checkbox"
              checked={draft.storage.cacheEnabled}
              onChange={e => setDraft(prev => prev === null ? prev : updateConfigSection(prev, 'storage', { cacheEnabled: e.target.checked }))}
            />
            <span className={css.checkboxLabel}>{t('field.cacheEnabled')}</span>
          </label>
        </div>
      </div>

      {/* 5. Polling & Timeouts */}
      <div className={css.editorGroup}>
        <h3 className={css.groupTitle}>{t('section.polling')}</h3>

        <div className={css.row}>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('field.pollIntervalMs')}</span>
            <NumericInput
              className={css.input}
              value={draft.polling.pollIntervalMs}
              min={100}
              onChange={val => setDraft(prev => prev === null ? prev : updateConfigSection(prev, 'polling', { pollIntervalMs: val }))}
            />
          </label>

          <label className={css.field}>
            <span className={css.fieldLabel}>{t('field.pollTimeoutMs')}</span>
            <NumericInput
              className={css.input}
              value={draft.polling.pollTimeoutMs}
              min={1000}
              onChange={val => setDraft(prev => prev === null ? prev : updateConfigSection(prev, 'polling', { pollTimeoutMs: val }))}
            />
          </label>
        </div>

        <div className={css.row}>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('field.requestTimeoutMs')}</span>
            <NumericInput
              className={css.input}
              value={draft.polling.requestTimeoutMs}
              min={1000}
              onChange={val => setDraft(prev => prev === null ? prev : updateConfigSection(prev, 'polling', { requestTimeoutMs: val }))}
            />
          </label>

          <label className={css.field}>
            <span className={css.fieldLabel}>{t('field.operationTimeoutMs')}</span>
            <NumericInput
              className={css.input}
              value={draft.polling.operationTimeoutMs}
              min={1000}
              onChange={val => setDraft(prev => prev === null ? prev : updateConfigSection(prev, 'polling', { operationTimeoutMs: val }))}
            />
          </label>
        </div>
      </div>

      {/* 6. Retry Policy */}
      <div className={css.editorGroup}>
        <h3 className={css.groupTitle}>{t('section.retry')}</h3>

        <div className={css.row}>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('field.retryMaxAttempts')}</span>
            <NumericInput
              className={css.input}
              min={1}
              max={10}
              value={draft.retry.maxAttempts}
              onChange={val => setDraft(prev => prev === null ? prev : updateConfigSection(prev, 'retry', { maxAttempts: val }))}
            />
          </label>

          <label className={css.field}>
            <span className={css.fieldLabel}>{t('field.retryBaseDelayMs')}</span>
            <NumericInput
              className={css.input}
              min={1}
              max={60000}
              value={draft.retry.baseDelayMs}
              onChange={val => setDraft(prev => prev === null ? prev : updateConfigSection(prev, 'retry', { baseDelayMs: val }))}
            />
          </label>

          <label className={css.field}>
            <span className={css.fieldLabel}>{t('field.retryMaxDelayMs')}</span>
            <NumericInput
              className={css.input}
              min={1}
              max={300000}
              value={draft.retry.maxDelayMs}
              onChange={val => setDraft(prev => prev === null ? prev : updateConfigSection(prev, 'retry', { maxDelayMs: val }))}
            />
          </label>
        </div>
      </div>

      {/* 7. Output Limits */}
      <div className={css.editorGroup}>
        <h3 className={css.groupTitle}>{t('section.output')}</h3>

        <div className={css.row}>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('field.maxInlineChars')}</span>
            <NumericInput
              className={css.input}
              min={1024}
              max={1000000}
              value={draft.output.maxInlineChars}
              onChange={val => setDraft(prev => prev === null ? prev : updateConfigSection(prev, 'output', { maxInlineChars: val }))}
            />
          </label>
        </div>
      </div>

      {/* 8. Security Limits */}
      <div className={css.editorGroup}>
        <h3 className={css.groupTitle}>{t('section.limits')}</h3>
        <span className={css.fieldHint} style={{ marginBottom: '4px', display: 'block' }}>
          {t('section.limits.restartHint')}
        </span>

        <div className={css.row}>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('field.maxFileBytes')}</span>
            <NumericInput
              className={css.input}
              min={1}
              value={draft.limits.maxFileBytes}
              onChange={val => setDraft(prev => prev === null ? prev : updateConfigSection(prev, 'limits', { maxFileBytes: val }))}
            />
          </label>
        </div>

        <div className={css.row}>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('field.maxApiResponseBytes')}</span>
            <NumericInput
              className={css.input}
              min={1}
              value={draft.limits.maxApiResponseBytes}
              onChange={val => setDraft(prev => prev === null ? prev : updateConfigSection(prev, 'limits', { maxApiResponseBytes: val }))}
            />
          </label>
        </div>

        <div className={css.row}>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('field.maxZipDownloadBytes')}</span>
            <NumericInput
              className={css.input}
              min={1}
              value={draft.limits.maxZipDownloadBytes}
              onChange={val => setDraft(prev => prev === null ? prev : updateConfigSection(prev, 'limits', { maxZipDownloadBytes: val }))}
            />
          </label>
        </div>

        <div className={css.row}>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('field.maxZipEntries')}</span>
            <NumericInput
              className={css.input}
              min={1}
              value={draft.limits.maxZipEntries}
              onChange={val => setDraft(prev => prev === null ? prev : updateConfigSection(prev, 'limits', { maxZipEntries: val }))}
            />
          </label>
        </div>

        <div className={css.row}>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('field.maxZipEntryBytes')}</span>
            <NumericInput
              className={css.input}
              min={1}
              value={draft.limits.maxZipEntryBytes}
              onChange={val => setDraft(prev => prev === null ? prev : updateConfigSection(prev, 'limits', { maxZipEntryBytes: val }))}
            />
          </label>
        </div>

        <div className={css.row}>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('field.maxZipTotalBytes')}</span>
            <NumericInput
              className={css.input}
              min={1}
              value={draft.limits.maxZipTotalBytes}
              onChange={val => setDraft(prev => prev === null ? prev : updateConfigSection(prev, 'limits', { maxZipTotalBytes: val }))}
            />
          </label>
        </div>

        <div className={css.row}>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('field.maxZipCompressionRatio')}</span>
            <NumericInput
              className={css.input}
              min={1}
              value={draft.limits.maxZipCompressionRatio}
              onChange={val => setDraft(prev => prev === null ? prev : updateConfigSection(prev, 'limits', { maxZipCompressionRatio: val }))}
            />
          </label>
        </div>
      </div>
    </>
  )
}
