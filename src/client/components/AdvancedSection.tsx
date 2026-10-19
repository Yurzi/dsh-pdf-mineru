import { useState, type ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { hasAdvancedDefaults, resetAdvancedSettings } from '../helpers.js'
import { useSettings } from '../settings-context.js'
import { NUMBER_FIELDS } from '../units.js'
import { CardFooter, NumberField, Section } from './Field.js'

const ADVANCED_FIELDS = [
  NUMBER_FIELDS.pollInterval,
  NUMBER_FIELDS.requestTimeout,
  NUMBER_FIELDS.retryAttempts,
  NUMBER_FIELDS.retryDelay,
  NUMBER_FIELDS.maxChars,
  NUMBER_FIELDS.maxImages,
]

export function AdvancedSection(): ReactNode {
  const { settings, t } = useSettings()
  const [open, setOpen] = useState(false)
  return (
    <Section name="advanced" title={t('section.advanced')} collapsible={{ open, onToggle: () => { setOpen(value => !value) } }}>
      {ADVANCED_FIELDS.map(spec => <NumberField key={spec.id} spec={spec} />)}
      <CardFooter id="mineru-restore-defaults-hint" hint={t('restoreDefaults.hint')}>
        <Button
          variant="outline"
          size="sm"
          aria-describedby="mineru-restore-defaults-hint"
          disabled={hasAdvancedDefaults(settings.state.draft)}
          onClick={() => { settings.edit(resetAdvancedSettings) }}
        >
          {t('action.restoreDefaults')}
        </Button>
      </CardFooter>
    </Section>
  )
}