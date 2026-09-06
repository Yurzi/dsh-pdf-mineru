import type { Dispatch, SetStateAction } from 'react'
import type { MinerUConfig, ProviderConfig } from '../../config/pure.js'
import type { MinerUModel, ParseMethod } from '../../domain/request.js'
import type { MineruKey } from '../locales.js'
import { updateConfigSection } from '../helpers.js'
import css from '../SettingsPage.module.css'

export interface DefaultsSectionProps {
  readonly draft: MinerUConfig
  readonly setDraft: Dispatch<SetStateAction<MinerUConfig | null>>
  readonly activeProvider: ProviderConfig
  readonly txtToAutoNotice: boolean
  readonly onDismissTxtNotice: () => void
  readonly t: (key: MineruKey) => string
}

export function DefaultsSection({
  draft,
  setDraft,
  activeProvider,
  txtToAutoNotice,
  onDismissTxtNotice,
  t,
}: DefaultsSectionProps) {
  return (
    <div className={css.editorGroup}>
      <h3 className={css.groupTitle}>{t('section.defaults')}</h3>

      {txtToAutoNotice && (
        <div className={css.error} style={{
          borderColor: 'var(--dsw-alias-state-warning-primary, #d97706)',
          backgroundColor: 'var(--dsw-alias-state-warning-tertiary, rgba(217, 119, 6, 0.12))',
          color: 'var(--dsw-alias-state-warning-primary, #d97706)',
        }}>
          <span>{t('notice.officialTxtToAuto')}</span>
          <button
            type="button"
            className={css.errorDismiss}
            onClick={onDismissTxtNotice}
          >×</button>
        </div>
      )}

      <div className={css.row}>
        <label className={css.field}>
          <span className={css.fieldLabel}>{t('field.defaultModel')}</span>
          <select
            className={css.select}
            value={draft.defaults.model}
            onChange={e => setDraft(prev => prev === null ? prev : updateConfigSection(prev, 'defaults', { model: e.target.value as MinerUModel }))}
          >
            {(activeProvider.type === 'official-v4' ? activeProvider.models : (['pipeline', 'vlm'] as const)).map(model => (
              <option key={model} value={model}>{t(model === 'pipeline' ? 'model.pipeline' : 'model.vlm')}</option>
            ))}
          </select>
        </label>

        <label className={css.field}>
          <span className={css.fieldLabel}>{t('field.defaultParseMethod')}</span>
          <select
            className={css.select}
            value={draft.defaults.parseMethod}
            onChange={e => setDraft(prev => prev === null ? prev : updateConfigSection(prev, 'defaults', { parseMethod: e.target.value as ParseMethod, ocr: e.target.value === 'ocr' }))}
          >
            <option value="auto">{t('parse.auto')}</option>
            {activeProvider.type === 'self-hosted-v2' && <option value="txt">{t('parse.txt')}</option>}
            <option value="ocr">{t('parse.ocr')}</option>
          </select>
        </label>

        <label className={css.field}>
          <span className={css.fieldLabel}>{t('field.defaultLang')}</span>
          <input
            className={css.input}
            value={draft.defaults.language}
            onChange={e => setDraft(prev => prev === null ? prev : updateConfigSection(prev, 'defaults', { language: e.target.value }))}
          />
        </label>
      </div>

      <div className={css.row}>
        <label className={css.checkboxField}>
          <input
            type="checkbox"
            checked={draft.defaults.formula}
            onChange={e => setDraft(prev => prev === null ? prev : updateConfigSection(prev, 'defaults', { formula: e.target.checked }))}
          />
          <span className={css.checkboxLabel}>{t('field.defaultFormula')}</span>
        </label>

        <label className={css.checkboxField}>
          <input
            type="checkbox"
            checked={draft.defaults.table}
            onChange={e => setDraft(prev => prev === null ? prev : updateConfigSection(prev, 'defaults', { table: e.target.checked }))}
          />
          <span className={css.checkboxLabel}>{t('field.defaultTable')}</span>
        </label>
      </div>
    </div>
  )
}
