import type { ReactNode } from 'react'
import { CacheSection } from './CacheSection.js'
import { LimitsSection } from './LimitsSection.js'
import { MaintenanceSection } from './MaintenanceSection.js'

export function StorageTab({ visible }: { readonly visible: boolean }): ReactNode {
  return (
    <>
      <CacheSection />
      <MaintenanceSection visible={visible} />
      <LimitsSection />
    </>
  )
}
