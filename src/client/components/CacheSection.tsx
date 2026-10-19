import type { ReactNode } from 'react'
import { PathLabel } from '@deepseek-ai/dsh-client-ui-primitives'
import { updateConfigSection } from '../helpers.js'
import { useSettings } from '../settings-context.js'
import { NUMBER_FIELDS } from '../units.js'
import { NumberField, Row, Section, SwitchRow } from './Field.js'
import css from './Storage.module.css'

export function CacheSection(): ReactNode {
  const { settings, t } = useSettings()
  const { storage } = settings.state.draft
  return (
    <Section name="cache" title={t('section.cache')}>
      <SwitchRow
        id="mineru-cache-enabled"
        label={t('field.cacheEnabled')}
        hint={t('field.cacheEnabled.hint')}
        checked={storage.cacheEnabled}
        onChange={cacheEnabled => { settings.edit(config => updateConfigSection(config, 'storage', { cacheEnabled })) }}
      />
      <NumberField spec={NUMBER_FIELDS.stagingTtl} />
      <Row id="mineru-storage-root" label={t('field.storageRoot')} hint={t('field.storageRoot.hint')} labelsControl={false}>
        <span className={css.path}><PathLabel path={storage.storageRoot} /></span>
      </Row>
    </Section>
  )
}
