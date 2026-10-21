import type { ReactNode } from 'react'
import { Button, IconRefreshOutlineRegular, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import { describeProbe } from '../settings-operations.js'
import { useSettings } from '../settings-context.js'
import css from './Connection.module.css'

/** Tests the unsaved draft of the active profile; results expire when that draft or its key changes. */
export function ConnectionTest(): ReactNode {
  const { settings, t } = useSettings()
  const { state, test } = settings.probe
  const status = describeProbe(state, t)
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
