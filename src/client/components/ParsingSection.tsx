import type { ReactNode } from 'react'
import { SELF_HOSTED_TIERS, type MinerUModel, type ParseMethod, type SelfHostedTier } from '../../config/model.js'
import { patchActiveProvider, PROVIDER_MODELS, updateConfigSection } from '../helpers.js'
import type { MineruKey } from '../locales.js'
import { useSettings } from '../settings-context.js'
import { visibleAdjustments } from '../settings-state.js'
import { Section, SelectField, SwitchRow } from './Field.js'

const METHOD_LABEL: { readonly [M in ParseMethod]: MineruKey } = { auto: 'parse.auto', txt: 'parse.txt', ocr: 'parse.ocr' }
const TIER_LABEL: { readonly [T in SelfHostedTier]: MineruKey } = {
  flash: 'tier.flash', basic: 'tier.basic', standard: 'tier.standard', advanced: 'tier.advanced',
}
const MODEL_LABEL: { readonly [M in MinerUModel]: MineruKey } = { pipeline: 'model.pipeline', vlm: 'model.vlm' }

export function ParsingSection(): ReactNode {
  const { settings, t } = useSettings()
  const { provider, state } = settings
  const { defaults } = state.draft

  if (provider.type === 'self-hosted-v1') {
    return (
      <Section name="parsing" title={t('section.parsing')} hint={t('section.parsing.v1')}>
        <SelectField<SelfHostedTier | ''>
          id="mineru-tier"
          label={t('field.tier')}
          hint={t('field.tier.hint')}
          value={provider.tier ?? ''}
          options={[{ value: '', label: t('tier.default') }, ...SELF_HOSTED_TIERS.map(tier => ({ value: tier, label: t(TIER_LABEL[tier]) }))]}
          onChange={tier => { settings.edit(config => patchActiveProvider(config, { tier: tier === '' ? undefined : tier })) }}
        />
        <SelectField<ParseMethod>
          id="mineru-ocr-mode"
          label={t('field.parseMethod')}
          value={provider.ocrMode}
          options={(['auto', 'txt', 'ocr'] as const).map(method => ({ value: method, label: t(METHOD_LABEL[method]) }))}
          onChange={ocrMode => { settings.edit(config => patchActiveProvider(config, { ocrMode })) }}
        />
      </Section>
    )
  }

  const official = provider.type === 'official-v4'
  const adjusted = visibleAdjustments(state)
  const models = official ? provider.models : PROVIDER_MODELS
  const methods: readonly ParseMethod[] = official ? ['auto', 'ocr'] : ['auto', 'txt', 'ocr']
  return (
    <Section name="parsing" title={t('section.parsing')}>
      <SelectField<MinerUModel>
        id="mineru-model"
        label={t('field.model')}
        note={adjusted.includes('model') ? t('adjusted.model') : undefined}
        value={defaults.model}
        options={models.map(model => ({ value: model, label: t(MODEL_LABEL[model]) }))}
        onChange={model => { settings.edit(config => updateConfigSection(config, 'defaults', { model })) }}
      />
      <SelectField<ParseMethod>
        id="mineru-parse-method"
        label={t('field.parseMethod')}
        note={adjusted.includes('parseMethod') ? t('adjusted.parseMethod') : undefined}
        value={defaults.parseMethod}
        options={methods.map(method => ({ value: method, label: t(METHOD_LABEL[method]) }))}
        onChange={parseMethod => {
          settings.edit(config => updateConfigSection(config, 'defaults', { parseMethod, ocr: parseMethod === 'ocr' }))
        }}
      />
      <SwitchRow
        id="mineru-formula"
        label={t('field.formula')}
        hint={t('field.formula.hint')}
        checked={defaults.formula}
        onChange={formula => { settings.edit(config => updateConfigSection(config, 'defaults', { formula })) }}
      />
      <SwitchRow
        id="mineru-table"
        label={t('field.table')}
        hint={t('field.table.hint')}
        checked={defaults.table}
        onChange={table => { settings.edit(config => updateConfigSection(config, 'defaults', { table })) }}
      />
    </Section>
  )
}
