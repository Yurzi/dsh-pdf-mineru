import { MAX_INLINE_IMAGE_BUDGET, MIN_INLINE_IMAGE_BUDGET, type MinerUConfig } from '../config/model.js'
import { updateConfigSection } from './helpers.js'
import type { MineruKey } from './locales.js'

type NumericSection = 'polling' | 'retry' | 'output' | 'storage'

type NumericKey<S extends NumericSection> = {
  [K in keyof MinerUConfig[S]]: MinerUConfig[S][K] extends number ? K : never
}[keyof MinerUConfig[S]] & string

interface SpecFor<S extends NumericSection> {
  readonly id: string
  readonly section: S
  readonly key: NumericKey<S>
  readonly label: MineruKey
  readonly unit: MineruKey
  readonly hint?: MineruKey
  /** Base units per display unit, e.g. 1000 for milliseconds shown as seconds. */
  readonly scale: number
  /** Inclusive bounds in base units; may depend on sibling values. */
  readonly bounds: (config: MinerUConfig) => readonly [min: number, max: number]
}

/** One integer config value edited in a friendlier display unit. */
export type NumberFieldSpec = { [S in NumericSection]: SpecFor<S> }[NumericSection]

const positive = (): readonly [number, number] => [1, Number.MAX_SAFE_INTEGER]
const field = <S extends NumericSection>(spec: SpecFor<S>): SpecFor<S> => spec

export const NUMBER_FIELDS = {
  pollInterval: field({ id: 'mineru-poll-interval', section: 'polling', key: 'pollIntervalMs', label: 'field.pollInterval', unit: 'unit.seconds', scale: 1000, bounds: positive }),
  requestTimeout: field({ id: 'mineru-request-timeout', section: 'polling', key: 'requestTimeoutMs', label: 'field.requestTimeout', unit: 'unit.seconds', scale: 1000, bounds: positive }),
  retryAttempts: field({ id: 'mineru-retry-attempts', section: 'retry', key: 'maxAttempts', label: 'field.retryAttempts', unit: 'unit.times', scale: 1, bounds: () => [1, 10] }),
  retryDelay: field({ id: 'mineru-retry-delay', section: 'retry', key: 'baseDelayMs', label: 'field.retryDelay', unit: 'unit.ms', scale: 1, bounds: config => [1, Math.min(60_000, config.retry.maxDelayMs)] }),
  maxChars: field({ id: 'mineru-max-chars', section: 'output', key: 'maxInlineChars', label: 'field.maxChars', unit: 'unit.chars', scale: 1, bounds: () => [1024, 1_000_000] }),
  maxImages: field({ id: 'mineru-max-images', section: 'output', key: 'maxInlineImages', label: 'field.maxImages', unit: 'unit.images', scale: 1, bounds: () => [MIN_INLINE_IMAGE_BUDGET, MAX_INLINE_IMAGE_BUDGET] }),
  stagingTtl: field({ id: 'mineru-staging-ttl', section: 'storage', key: 'stagingTtlMs', label: 'field.stagingTtl', hint: 'field.stagingTtl.hint', unit: 'unit.hours', scale: 3_600_000, bounds: positive }),
} as const

export function readNumber(config: MinerUConfig, spec: NumberFieldSpec): number {
  return (config[spec.section] as unknown as Record<string, number>)[spec.key]!
}

/** Display text for a base-unit value; parseNumber(formatNumber(v)) returns v exactly for safe integers. */
export function formatNumber(base: number, scale: number): string {
  return String(base / scale)
}

/** Base-unit integer for display text, or undefined when it is not a whole base unit inside the bounds. */
export function parseNumber(text: string, scale: number, [min, max]: readonly [number, number]): number | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  const display = Number(trimmed)
  if (!Number.isFinite(display)) return undefined
  const exact = display * scale
  const base = Math.round(exact)
  if (Math.abs(exact - base) > 1e-6 * Math.max(1, Math.abs(base))) return undefined
  return Number.isSafeInteger(base) && base >= min && base <= max ? base : undefined
}

export function writeNumber(config: MinerUConfig, spec: NumberFieldSpec, base: number): MinerUConfig {
  return updateConfigSection(config, spec.section, { [spec.key]: base })
}