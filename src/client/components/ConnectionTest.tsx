import type { ReactNode } from 'react'
import { Button, IconRefreshOutlineRegular, StateDot, type StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ProbeView } from '../../contracts/probe.js'
import type { Translate } from '../locales.js'
import type { ProbeState } from '../settings-operations.js'
import { useSettings } from '../settings-context.js'
import css from './Connection.module.css'

export function probeHealthy(view: ProbeView): boolean {
  return view.available && (view.authentication === 'valid' || view.authentication === 'not-configured')
}

function describe(state: ProbeState, t: Translate): { readonly dot: StateDotState; readonly text: string; readonly details: readonly string[] } | undefined {
  switch (state.kind) {
    case 'idle': return undefined
    case 'testing': return { dot: 'ongoing', text: t('action.testing'), details: [] }
    case 'failed': return { dot: 'error', text: t('probe.failed', { message: state.message }), details: [] }
    case 'done': {
      const { view } = state
      if (!probeHealthy(view)) {
        return { dot: 'warning', text: t(view.authentication === 'invalid' ? 'probe.authInvalid' : 'probe.unavailable'), details: [] }
      }
      const details = [
        view.server_version === undefined ? '' : t('probe.version', { version: view.server_version }),
        view.available_tiers === undefined || view.available_tiers.length === 0 ? '' : t('probe.tiers', { tiers: view.available_tiers.join(', ') }),
      ].filter(Boolean)
      return { dot: 'done', text: t('probe.ok'), details }
    }
  }
}

/** Tests the unsaved draft of the active profile; results expire when that draft or its key changes. */
export function ConnectionTest(): ReactNode {
  const { settings, t } = useSettings()
  const { state, test } = settings.probe
  const status = describe(state, t)
  return (
    <div className={css.test}>
      <Button
        variant="outline"
        size="sm"
        icon={<IconRefreshOutlineRegular />}
        disabled={state.kind === 'testing'}
        onClick={() => { void test() }}
      >
        {t('action.test')}
      </Button>
      <p className={css.probe} role="status">
        {status === undefined ? null : (
          <>
            <StateDot state={status.dot} size={status.dot === 'ongoing' ? 12 : 8} />
            <span className={css.probeText}>{status.text}</span>
            {status.details.map(detail => <span key={detail} className={css.probeDetail}>{detail}</span>)}
          </>
        )}
      </p>
    </div>
  )
}
