import { useState, type ReactNode } from 'react'
import { patchActiveProvider } from '../helpers.js'
import { useSettings } from '../settings-context.js'
import { ApiKeyField } from './ApiKeyField.js'
import { ConnectionOptions } from './ConnectionOptions.js'
import { ConnectionTest } from './ConnectionTest.js'
import { DisclosureButton, Section, TextField } from './Field.js'
import { ProviderPicker } from './ProviderPicker.js'
import css from './Connection.module.css'

export function ServiceSection(): ReactNode {
  const { settings, t } = useSettings()
  const [optionsOpen, setOptionsOpen] = useState(false)
  return (
    <Section name="service" title={t('section.service')}>
      <ProviderPicker />
      <TextField
        id="mineru-base-url"
        type="url"
        label={t('field.baseURL')}
        value={settings.provider.baseURL}
        placeholder={settings.provider.type === 'official-v4' ? 'https://mineru.net/api/v4' : 'http://localhost:8000'}
        onChange={baseURL => { settings.edit(config => patchActiveProvider(config, { baseURL })) }}
      />
      <ApiKeyField />
      <ConnectionTest />
      <div className={css.options}>
        <DisclosureButton id="mineru-connection-options" open={optionsOpen} onToggle={() => { setOptionsOpen(open => !open) }}>
          {t('section.connectionOptions')}
        </DisclosureButton>
        {optionsOpen ? <ConnectionOptions id="mineru-connection-options" /> : null}
      </div>
    </Section>
  )
}
