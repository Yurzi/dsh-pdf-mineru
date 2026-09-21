import type { Dispatch, SetStateAction } from 'react'
import {
  MAX_INLINE_IMAGE_BUDGET,
  MIN_INLINE_IMAGE_BUDGET,
  type MinerUConfig,
} from '../../config/pure.js'
import type { MineruKey } from '../locales.js'
import { resetConfigSection, updateConfigSection } from '../helpers.js'
import { NumericInput } from '../NumericInput.js'
import { DisclosureCard } from '../DisclosureCard.js'
import {
  ClockIcon,
  DatabaseIcon,
  FileTextIcon,
  RotateCcwIcon,
  RotateCwIcon,
  ShieldCheckIcon,
} from '../icons.js'
import css from '../SettingsPage.module.css'

export interface AdvancedSectionsProps {
  readonly draft: MinerUConfig
  readonly setDraft: Dispatch<SetStateAction<MinerUConfig | null>>
  readonly cardsOpen: Record<string, boolean>
  readonly onToggleCard: (cardId: string) => void
  readonly t: (key: MineruKey) => string
}

export function AdvancedSections({
  draft,
  setDraft,
  cardsOpen,
  onToggleCard,
  t,
}: AdvancedSectionsProps) {
  return (
    <>
      {/* 3. Storage & Cache */}
      <DisclosureCard
        id="storage"
        title={t('section.storage')}
        subtitle={t('section.storage.desc')}
        icon={<DatabaseIcon size={16} />}
        open={cardsOpen.storage ?? false}
        onToggle={() => onToggleCard('storage')}
        toggleTitle={cardsOpen.storage ? t('action.collapse') : t('action.expand')}
        badge={
          <span
            className={`${css.cardBadge} ${
              draft.storage.cacheEnabled ? css.badgeOk : css.badgeNeutral
            }`}
          >
            <span className={css.badgeDot} aria-hidden="true" />
            {draft.storage.cacheEnabled ? t('badge.cacheOn') : t('badge.cacheOff')}
          </span>
        }
        action={
          <button
            type="button"
            className={css.resetButton}
            title={t('action.resetSection')}
            onClick={() => setDraft(prev => (prev === null ? prev : resetConfigSection(prev, 'storage')))}
          >
            <RotateCcwIcon size={11} className={css.resetIcon} />
            <span>{t('action.resetSection')}</span>
          </button>
        }
      >
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
              ariaLabel={t('field.stagingTtlMs')}
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
      </DisclosureCard>

      {/* 4. Polling & Timeouts */}
      <DisclosureCard
        id="polling"
        title={t('section.polling')}
        subtitle={t('section.polling.desc')}
        icon={<ClockIcon size={16} />}
        open={cardsOpen.polling ?? false}
        onToggle={() => onToggleCard('polling')}
        toggleTitle={cardsOpen.polling ? t('action.collapse') : t('action.expand')}
        badge={
          <span className={`${css.cardBadge} ${css.badgeNeutral}`}>
            {draft.polling.pollIntervalMs} {t('unit.ms')} / {Math.round(draft.polling.pollTimeoutMs / 1000)} {t('unit.seconds')}
          </span>
        }
        action={
          <button
            type="button"
            className={css.resetButton}
            title={t('action.resetSection')}
            onClick={() => setDraft(prev => (prev === null ? prev : resetConfigSection(prev, 'polling')))}
          >
            <RotateCcwIcon size={11} className={css.resetIcon} />
            <span>{t('action.resetSection')}</span>
          </button>
        }
      >
        <div className={css.row}>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('field.pollIntervalMs')}</span>
            <NumericInput
              className={css.input}
              ariaLabel={t('field.pollIntervalMs')}
              value={draft.polling.pollIntervalMs}
              min={100}
              onChange={val => setDraft(prev => prev === null ? prev : updateConfigSection(prev, 'polling', { pollIntervalMs: val }))}
            />
          </label>

          <label className={css.field}>
            <span className={css.fieldLabel}>{t('field.pollTimeoutMs')}</span>
            <NumericInput
              className={css.input}
              ariaLabel={t('field.pollTimeoutMs')}
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
              ariaLabel={t('field.requestTimeoutMs')}
              value={draft.polling.requestTimeoutMs}
              min={1000}
              onChange={val => setDraft(prev => prev === null ? prev : updateConfigSection(prev, 'polling', { requestTimeoutMs: val }))}
            />
          </label>

          <label className={css.field}>
            <span className={css.fieldLabel}>{t('field.operationTimeoutMs')}</span>
            <NumericInput
              className={css.input}
              ariaLabel={t('field.operationTimeoutMs')}
              value={draft.polling.operationTimeoutMs}
              min={1000}
              onChange={val => setDraft(prev => prev === null ? prev : updateConfigSection(prev, 'polling', { operationTimeoutMs: val }))}
            />
          </label>
        </div>
      </DisclosureCard>

      {/* 5. Retry Policy */}
      <DisclosureCard
        id="retry"
        title={t('section.retry')}
        subtitle={t('section.retry.desc')}
        icon={<RotateCwIcon size={16} />}
        open={cardsOpen.retry ?? false}
        onToggle={() => onToggleCard('retry')}
        toggleTitle={cardsOpen.retry ? t('action.collapse') : t('action.expand')}
        badge={
          <span className={`${css.cardBadge} ${css.badgeNeutral}`}>
            {draft.retry.maxAttempts} {t('unit.attempts')}
          </span>
        }
        action={
          <button
            type="button"
            className={css.resetButton}
            title={t('action.resetSection')}
            onClick={() => setDraft(prev => (prev === null ? prev : resetConfigSection(prev, 'retry')))}
          >
            <RotateCcwIcon size={11} className={css.resetIcon} />
            <span>{t('action.resetSection')}</span>
          </button>
        }
      >
        <div className={css.row}>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('field.retryMaxAttempts')}</span>
            <NumericInput
              className={css.input}
              ariaLabel={t('field.retryMaxAttempts')}
              title={t('field.retryMaxAttempts')}
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
              ariaLabel={t('field.retryBaseDelayMs')}
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
              ariaLabel={t('field.retryMaxDelayMs')}
              min={1}
              max={300000}
              value={draft.retry.maxDelayMs}
              onChange={val => setDraft(prev => prev === null ? prev : updateConfigSection(prev, 'retry', { maxDelayMs: val }))}
            />
          </label>
        </div>
      </DisclosureCard>

      {/* 6. Output Limits */}
      <DisclosureCard
        id="output"
        title={t('section.output')}
        subtitle={t('section.output.desc')}
        icon={<FileTextIcon size={16} />}
        open={cardsOpen.output ?? false}
        onToggle={() => onToggleCard('output')}
        toggleTitle={cardsOpen.output ? t('action.collapse') : t('action.expand')}
        badge={
          <span className={`${css.cardBadge} ${css.badgeNeutral}`}>
            {Math.round(draft.output.maxInlineChars / 1000)}k {t('unit.chars')} · {draft.output.maxInlineImages} {t('unit.images')}
          </span>
        }
        action={
          <button
            type="button"
            className={css.resetButton}
            title={t('action.resetSection')}
            onClick={() => setDraft(prev => (prev === null ? prev : resetConfigSection(prev, 'output')))}
          >
            <RotateCcwIcon size={11} className={css.resetIcon} />
            <span>{t('action.resetSection')}</span>
          </button>
        }
      >
        <div className={css.row}>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('field.maxInlineChars')}</span>
            <NumericInput
              className={css.input}
              ariaLabel={t('field.maxInlineChars')}
              min={1024}
              max={1000000}
              value={draft.output.maxInlineChars}
              onChange={val => setDraft(prev => prev === null ? prev : updateConfigSection(prev, 'output', { maxInlineChars: val }))}
            />
          </label>

          <label className={css.field}>
            <span className={css.fieldLabel}>{t('field.maxInlineImages')}</span>
            <NumericInput
              className={css.input}
              ariaLabel={t('field.maxInlineImages')}
              title={t('field.maxInlineImages')}
              min={MIN_INLINE_IMAGE_BUDGET}
              max={MAX_INLINE_IMAGE_BUDGET}
              value={draft.output.maxInlineImages}
              onChange={val => setDraft(prev => prev === null ? prev : updateConfigSection(prev, 'output', { maxInlineImages: val }))}
            />
          </label>
        </div>
      </DisclosureCard>

      {/* 7. Security Limits */}
      <DisclosureCard
        id="limits"
        title={t('section.limits')}
        subtitle={t('section.limits.desc')}
        icon={<ShieldCheckIcon size={16} />}
        open={cardsOpen.limits ?? false}
        onToggle={() => onToggleCard('limits')}
        toggleTitle={cardsOpen.limits ? t('action.collapse') : t('action.expand')}
        badge={
          <span className={`${css.cardBadge} ${css.badgeNeutral}`}>
            {t('badge.readOnly')}
          </span>
        }
      >
        <span className={css.fieldHint} role="status" style={{ marginBottom: '8px', display: 'block' }}>
          {t('section.limits.restartHint')}
        </span>

        <fieldset disabled className={css.fieldsetDisabled}>
          <div className={css.row}>
            <label className={css.field}>
              <span className={css.fieldLabel}>{t('field.maxFileBytes')}</span>
              <NumericInput
                className={css.input}
                ariaLabel={t('field.maxFileBytes')}
                disabled
                title={t('section.limits.restartHint')}
                min={1}
                value={draft.limits.maxFileBytes}
                onChange={() => {}}
              />
            </label>
          </div>

          <div className={css.row}>
            <label className={css.field}>
              <span className={css.fieldLabel}>{t('field.maxApiResponseBytes')}</span>
              <NumericInput
                className={css.input}
                ariaLabel={t('field.maxApiResponseBytes')}
                disabled
                title={t('section.limits.restartHint')}
                min={1}
                value={draft.limits.maxApiResponseBytes}
                onChange={() => {}}
              />
            </label>
          </div>

          <div className={css.row}>
            <label className={css.field}>
              <span className={css.fieldLabel}>{t('field.maxZipDownloadBytes')}</span>
              <NumericInput
                className={css.input}
                ariaLabel={t('field.maxZipDownloadBytes')}
                disabled
                title={t('section.limits.restartHint')}
                min={1}
                value={draft.limits.maxZipDownloadBytes}
                onChange={() => {}}
              />
            </label>
          </div>

          <div className={css.row}>
            <label className={css.field}>
              <span className={css.fieldLabel}>{t('field.maxZipEntries')}</span>
              <NumericInput
                className={css.input}
                ariaLabel={t('field.maxZipEntries')}
                disabled
                title={t('section.limits.restartHint')}
                min={1}
                value={draft.limits.maxZipEntries}
                onChange={() => {}}
              />
            </label>
          </div>

          <div className={css.row}>
            <label className={css.field}>
              <span className={css.fieldLabel}>{t('field.maxZipEntryBytes')}</span>
              <NumericInput
                className={css.input}
                ariaLabel={t('field.maxZipEntryBytes')}
                disabled
                title={t('section.limits.restartHint')}
                min={1}
                value={draft.limits.maxZipEntryBytes}
                onChange={() => {}}
              />
            </label>
          </div>

          <div className={css.row}>
            <label className={css.field}>
              <span className={css.fieldLabel}>{t('field.maxZipTotalBytes')}</span>
              <NumericInput
                className={css.input}
                ariaLabel={t('field.maxZipTotalBytes')}
                disabled
                title={t('section.limits.restartHint')}
                min={1}
                value={draft.limits.maxZipTotalBytes}
                onChange={() => {}}
              />
            </label>
          </div>

          <div className={css.row}>
            <label className={css.field}>
              <span className={css.fieldLabel}>{t('field.maxZipCompressionRatio')}</span>
              <NumericInput
                className={css.input}
                ariaLabel={t('field.maxZipCompressionRatio')}
                disabled
                title={t('section.limits.restartHint')}
                min={1}
                value={draft.limits.maxZipCompressionRatio}
                onChange={() => {}}
              />
            </label>
          </div>
        </fieldset>
      </DisclosureCard>
    </>
  )
}
