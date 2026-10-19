import { createContext, useContext } from 'react'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import type { Translate } from './locales.js'
import type { ReadySettings } from './settings-controller.js'

export interface SettingsContextValue {
  readonly settings: ReadySettings
  readonly rpc: ClientConnectionRpc
  readonly t: Translate
}

export const SettingsContext = createContext<SettingsContextValue | null>(null)

/** Loaded settings, transport and translator for components below SettingsPage. */
export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext)
  if (value === null) throw new Error('useSettings must be used inside SettingsPage')
  return value
}
