import type { ReactNode } from 'react'
import { AdvancedSection } from './AdvancedSection.js'
import { ParsingSection } from './ParsingSection.js'
import { ServiceSection } from './ServiceSection.js'

export function ConnectionTab(): ReactNode {
  return (
    <>
      <ServiceSection />
      <ParsingSection />
      <AdvancedSection />
    </>
  )
}
