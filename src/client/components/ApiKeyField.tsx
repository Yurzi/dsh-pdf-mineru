import type { ReactNode } from 'react'
import { Button, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { PROVIDER_TRAITS } from '../../config/model.js'
import type { Translate } from '../locales.js'
import type { CredentialState } from '../settings-controller.js'
import { useSettings } from '../settings-context.js'
import { TextField } from './Field.js'

function credentialTag(state: CredentialState, t: Translate): ReactNode {
  switch (state.kind) {
    case 'loading': return <Tag tone="quiet">{t('apiKey.checking')}</Tag>
    case 'ready':
      if (!state.view.writable) return <Tag tone="outline">{t('apiKey.envOnly')}</Tag>
      return state.view.configured
        ? <Tag tone="success">{t('apiKey.stored')}</Tag>
        : <Tag tone="neutral">{t('apiKey.missing')}</Tag>
    case 'none':
    case 'failed':
      return null
  }
}

/** Secret input: typed keys stay out of the config draft and are stored on Save. */
export function ApiKeyField(): ReactNode {
  const { settings, t } = useSettings()
  const { reference, state, error, remove } = settings.credential
  const view = state.kind === 'ready' ? state.view : undefined
  const writable = view?.writable ?? true
  const required = PROVIDER_TRAITS[settings.provider.type].requiresCredential
  const hint = reference === undefined ? t('apiKey.noReference')
    : error ?? (state.kind === 'failed' ? state.message
      : !writable ? t('apiKey.readOnly')
      : t(required ? 'apiKey.hintRequired' : 'apiKey.hintOptional'))
  return (
    <TextField
      id="mineru-api-key"
      type="password"
      label={t('field.apiKey')}
      hint={hint}
      value={reference === undefined ? '' : settings.state.keyDrafts[reference] ?? ''}
      placeholder={t(view?.configured ? 'apiKey.placeholderStored' : 'apiKey.placeholderEmpty')}
      disabled={reference === undefined || !writable || settings.mutation === 'remove'}
      onChange={value => { if (reference !== undefined) settings.setKeyDraft(reference, value) }}
    >
      {credentialTag(state, t)}
      {view?.configured && view.writable
        ? <Button variant="ghost" size="sm" disabled={settings.mutation !== undefined} onClick={() => { void remove() }}>{t('action.removeKey')}</Button>
        : null}
    </TextField>
  )
}
