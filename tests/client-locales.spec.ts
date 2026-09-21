import { describe, expect, it } from 'vitest'
import { en, zh } from '../src/client/locales.js'

describe('settings localization', () => {
  it('provides matching non-empty English and Chinese labels', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
    for (const dictionary of [en, zh]) {
      for (const [key, value] of Object.entries(dictionary)) {
        expect(value.trim(), key).not.toBe('')
        expect(value, key).not.toBe(key)
      }
    }
  })
})
