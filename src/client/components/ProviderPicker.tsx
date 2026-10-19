import type { ReactNode } from 'react'
import type { MinerUProviderId } from '../../config/model.js'
import type { MineruKey } from '../locales.js'
import { orderedProviders, providerTypeLabelKey } from '../helpers.js'
import { useSettings } from '../settings-context.js'
import { cx, Row } from './Field.js'
import css from './Connection.module.css'

const DESCRIPTION: { readonly [T in MinerUProviderId]: MineruKey } = {
  'official-v4': 'provider.official.desc',
  'self-hosted-v1': 'provider.v1.desc',
  'self-hosted-legacy-v2': 'provider.legacy.desc',
}

/** Native radio group: arrow keys move the selection, every profile keeps its own draft. */
export function ProviderPicker(): ReactNode {
  const { settings, t } = useSettings()
  const { draft } = settings.state
  return (
    <Row id="mineru-provider" label={t('field.provider')} stacked labelsControl={false}>
      <div role="radiogroup" aria-labelledby="mineru-provider-label" className={css.providers}>
        {orderedProviders(draft).map(provider => {
          const checked = provider.id === draft.activeProvider
          return (
            <label key={provider.id} className={cx(css.provider, checked && css.providerChecked)}>
              <input
                type="radio"
                name="mineru-provider"
                className={css.radio}
                value={provider.id}
                checked={checked}
                onChange={() => { settings.activate(provider.id) }}
              />
              <span className={css.providerTitle}>{t(providerTypeLabelKey(provider.type))}</span>
              <span className={css.providerDesc}>{t(DESCRIPTION[provider.type])}</span>
            </label>
          )
        })}
      </div>
    </Row>
  )
}
