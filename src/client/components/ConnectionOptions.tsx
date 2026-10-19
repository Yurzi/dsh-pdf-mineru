import type { ReactNode } from 'react'
import { Checkbox } from '@deepseek-ai/dsh-client-ui-primitives'
import { patchActiveProvider, PROVIDER_MODELS, toggleOfficialModel } from '../helpers.js'
import { useSettings } from '../settings-context.js'
import { Row, RowGroup, SwitchRow, TextField } from './Field.js'
import css from './Connection.module.css'

/** Expert, per-profile connection fields; rendered inside the Service card's disclosure. */
export function ConnectionOptions({ id }: { readonly id: string }): ReactNode {
  const { settings, t } = useSettings()
  const { provider } = settings
  const patch = (value: Parameters<typeof patchActiveProvider>[1]) => {
    settings.edit(config => patchActiveProvider(config, value))
  }
  return (
    <RowGroup id={id}>
      <TextField
        id="mineru-api-key-env"
        label={t('field.apiKeyEnv')}
        hint={t('field.apiKeyEnv.hint')}
        value={provider.apiKeyEnv ?? ''}
        placeholder="MINERU_API_KEY"
        onChange={value => {
          // Official v4 always names a credential; self-hosted profiles may drop it.
          patch({ apiKeyEnv: provider.type === 'official-v4' ? value : value === '' ? undefined : value })
        }}
      />
      {provider.type === 'official-v4' ? (
        <Row id="mineru-models" label={t('field.models')} hint={t('field.models.hint')} labelsControl={false}>
          <div className={css.checks} role="group" aria-labelledby="mineru-models-label">
            {PROVIDER_MODELS.map(model => (
              <Checkbox
                key={model}
                label={t(model === 'vlm' ? 'model.vlm' : 'model.pipeline')}
                checked={provider.models.includes(model)}
                disabled={provider.models.length === 1 && provider.models.includes(model)}
                onChange={() => { settings.edit(config => toggleOfficialModel(config, model)) }}
              />
            ))}
          </div>
        </Row>
      ) : (
        <>
          <TextField
            id="mineru-version"
            label={t('field.version')}
            hint={t('field.version.hint')}
            value={provider.configuredVersion ?? ''}
            placeholder="4.0.10"
            onChange={value => { patch({ configuredVersion: value === '' ? undefined : value }) }}
          />
          <SwitchRow
            id="mineru-allow-http"
            label={t('field.allowHttp')}
            hint={t('field.allowHttp.hint')}
            checked={provider.allowInsecureHttp}
            onChange={allowInsecureHttp => { patch({ allowInsecureHttp }) }}
          />
        </>
      )}
      {provider.type === 'self-hosted-legacy-v2' ? (
        <>
          <TextField
            id="mineru-backend-pipeline"
            label={t('field.backendPipeline')}
            value={provider.modelMap.pipeline}
            onChange={pipeline => { patch({ modelMap: { ...provider.modelMap, pipeline } }) }}
          />
          <TextField
            id="mineru-backend-vlm"
            label={t('field.backendVlm')}
            hint={t('field.backend.hint')}
            value={provider.modelMap.vlm}
            onChange={vlm => { patch({ modelMap: { ...provider.modelMap, vlm } }) }}
          />
        </>
      ) : null}
    </RowGroup>
  )
}
