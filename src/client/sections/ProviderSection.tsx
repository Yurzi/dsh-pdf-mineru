import type { Dispatch, SetStateAction } from 'react'
import type { MinerUConfig, OfficialV4Config, ProviderConfig, SelfHostedV2Config } from '../../config/pure.js'
import type { MinerUModel } from '../../domain/request.js'
import type { MineruKey } from '../locales.js'
import type { CredentialView } from '../helpers.js'
import { patchActiveProvider } from '../helpers.js'
import css from '../SettingsPage.module.css'

export interface ProviderSectionProps {
  readonly draft: MinerUConfig
  readonly setDraft: Dispatch<SetStateAction<MinerUConfig | null>>
  readonly activeProvider: ProviderConfig
  readonly activeCredentialRef: string | undefined
  readonly apiKeyDraft: string
  readonly setApiKeyDraft: (value: string) => void
  readonly credentialStateReady: boolean
  readonly credentialView?: CredentialView
  readonly credentialLocked: boolean
  readonly credentialInputDisabled: boolean
  readonly credentialPlaceholder: string
  readonly credentialBusy: boolean
  readonly credentialStatus: 'unavailable' | 'loading' | 'ready' | 'error'
  readonly credentialError?: string
  readonly onClearCredential: () => void
  readonly onActivateProvider: (providerId: string) => void
  readonly t: (key: MineruKey) => string
}

export function ProviderSection({
  draft,
  setDraft,
  activeProvider,
  activeCredentialRef,
  apiKeyDraft,
  setApiKeyDraft,
  credentialStateReady,
  credentialView,
  credentialLocked,
  credentialInputDisabled,
  credentialPlaceholder,
  credentialBusy,
  credentialStatus,
  credentialError,
  onClearCredential,
  onActivateProvider,
  t,
}: ProviderSectionProps) {
  const toggleOfficialModel = (model: MinerUModel): void => {
    if (activeProvider.type !== 'official-v4') return
    const current = activeProvider.models
    let next: MinerUModel[]
    if (current.includes(model)) {
      if (current.length <= 1 || draft.defaults.model === model) return
      next = current.filter(m => m !== model)
    } else {
      next = [...current, model]
    }
    setDraft(prev => (prev === null ? prev : patchActiveProvider(prev, { models: next })))
  }

  return (
    <div className={css.editorGroup}>
      <h3 className={css.groupTitle}>{t('section.provider')}</h3>

      <div className={css.row}>
        <label className={css.field}>
          <span className={css.fieldLabel}>{t('field.activeProvider')}</span>
          <select
            className={css.select}
            value={draft.activeProvider}
            onChange={event => onActivateProvider(event.target.value)}
          >
            {draft.providers.map(provider => (
              <option key={provider.id} value={provider.id}>
                {t(provider.type === 'self-hosted-v2' ? 'provider.type.selfHosted' : 'provider.type.official')} — {provider.id}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className={css.row}>
        <label className={css.field}>
          <span className={css.fieldLabel}>{t('field.baseURL')}</span>
          <input
            className={css.input}
            value={activeProvider.baseURL}
            placeholder={t('field.baseURL.placeholder')}
            onChange={e => setDraft(prev => prev === null ? prev : patchActiveProvider(prev, { baseURL: e.target.value }))}
          />
        </label>

        <label className={css.field}>
          <span className={css.fieldLabel}>{t('field.apiKeyEnv')}</span>
          <input
            className={css.input}
            value={activeProvider.apiKeyEnv ?? ''}
            placeholder={t('field.apiKeyEnv.placeholder')}
            onChange={e => setDraft(prev => prev === null ? prev : patchActiveProvider(prev, { apiKeyEnv: e.target.value || undefined }))}
          />
          <span className={css.fieldHint}>{t('field.apiKeyEnv.hint')}</span>
        </label>
      </div>

      <div className={css.field}>
        <span className={css.fieldLabel}>{t('field.apiKey')}</span>
        <div className={css.credentialInputRow}>
          <input
            className={css.input}
            type="password"
            autoComplete="off"
            aria-label={t('field.apiKey')}
            value={apiKeyDraft}
            placeholder={credentialPlaceholder}
            disabled={credentialInputDisabled}
            onChange={event => setApiKeyDraft(event.target.value)}
          />
          <button
            type="button"
            className={css.secondaryButton}
            disabled={credentialInputDisabled || credentialView?.configured !== true}
            onClick={onClearCredential}
          >
            {credentialBusy ? t('action.clearingApiKey') : t('action.clearApiKey')}
          </button>
        </div>
        <span className={css.fieldHint}>
          {credentialStatus === 'loading'
            ? t('credential.loading')
            : credentialStatus === 'error'
              ? credentialError
              : activeCredentialRef === undefined
                ? t('credential.referenceRequired')
                : credentialLocked
                  ? t('credential.readOnly')
                  : credentialView?.configured === true
                    ? [t('credential.configured'), credentialView.source ? ` (${credentialView.source})` : ''].join('')
                    : t('credential.notConfigured')}
        </span>
      </div>

      {activeProvider.type === 'self-hosted-v2' && (
        <>
          <div className={css.row}>
            <label className={css.checkboxField}>
              <input
                type="checkbox"
                checked={(activeProvider as SelfHostedV2Config).allowInsecureHttp}
                onChange={e => setDraft(prev => prev === null ? prev : patchActiveProvider(prev, { allowInsecureHttp: e.target.checked }))}
              />
              <span className={css.checkboxLabel}>{t('field.allowInsecureHttp')}</span>
            </label>
          </div>

          <div className={css.row}>
            <div className={css.field}>
              <span className={css.fieldLabel}>{t('field.modelMap.pipeline')}</span>
              <input
                className={css.input}
                list="mineru-modelmap-pipeline-options"
                placeholder={t('field.modelMap.pipeline.placeholder')}
                value={(activeProvider as SelfHostedV2Config).modelMap.pipeline}
                onChange={e => {
                  const currentMap = (activeProvider as SelfHostedV2Config).modelMap
                  setDraft(prev => prev === null ? prev : patchActiveProvider(prev, { modelMap: { ...currentMap, pipeline: e.target.value } }))
                }}
              />
              <datalist id="mineru-modelmap-pipeline-options">
                <option value="pipeline">{t('field.modelMap.opt.pipeline')}</option>
              </datalist>
              <div className={css.chipGroup}>
                <button
                  type="button"
                  className={`${css.chip} ${(activeProvider as SelfHostedV2Config).modelMap.pipeline === 'pipeline' ? css.chipActive : ''}`}
                  onClick={() => {
                    const currentMap = (activeProvider as SelfHostedV2Config).modelMap
                    setDraft(prev => prev === null ? prev : patchActiveProvider(prev, { modelMap: { ...currentMap, pipeline: 'pipeline' } }))
                  }}
                >
                  <span>pipeline</span>
                  <span className={css.chipBadge}>({t('field.modelMap.chip.default')})</span>
                </button>
              </div>
              <span className={css.fieldHint}>{t('field.modelMap.pipeline.hint')}</span>
            </div>

            <div className={css.field}>
              <span className={css.fieldLabel}>{t('field.modelMap.vlm')}</span>
              <input
                className={css.input}
                list="mineru-modelmap-vlm-options"
                placeholder={t('field.modelMap.vlm.placeholder')}
                value={(activeProvider as SelfHostedV2Config).modelMap.vlm}
                onChange={e => {
                  const currentMap = (activeProvider as SelfHostedV2Config).modelMap
                  setDraft(prev => prev === null ? prev : patchActiveProvider(prev, { modelMap: { ...currentMap, vlm: e.target.value } }))
                }}
              />
              <datalist id="mineru-modelmap-vlm-options">
                <option value="hybrid-engine">{t('field.modelMap.opt.hybridEngine')}</option>
                <option value="vlm-engine">{t('field.modelMap.opt.vlmEngine')}</option>
              </datalist>
              <div className={css.chipGroup}>
                {([
                  { value: 'hybrid-engine', badge: t('field.modelMap.chip.recommended') },
                  { value: 'vlm-engine', badge: t('field.modelMap.chip.vlmEngine') },
                ] as const).map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`${css.chip} ${(activeProvider as SelfHostedV2Config).modelMap.vlm === opt.value ? css.chipActive : ''}`}
                    onClick={() => {
                      const currentMap = (activeProvider as SelfHostedV2Config).modelMap
                      setDraft(prev => prev === null ? prev : patchActiveProvider(prev, { modelMap: { ...currentMap, vlm: opt.value } }))
                    }}
                  >
                    <span>{opt.value}</span>
                    <span className={css.chipBadge}>({opt.badge})</span>
                  </button>
                ))}
              </div>
              <span className={css.fieldHint}>{t('field.modelMap.vlm.hint')}</span>
            </div>
          </div>
        </>
      )}

      {activeProvider.type === 'official-v4' && (
        <div className={css.field}>
          <span className={css.fieldLabel}>{t('field.officialModels')}</span>
          <div className={css.checkboxGroup}>
            {(['pipeline', 'vlm'] as const).map(m => (
              <label key={m} className={css.checkboxOption}>
                <input
                  type="checkbox"
                  checked={(activeProvider as OfficialV4Config).models.includes(m)}
                  disabled={draft.defaults.model === m}
                  onChange={() => toggleOfficialModel(m)}
                />
                <span>{t(m === 'pipeline' ? 'model.pipeline' : 'model.vlm')}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
