import type { ProviderConfig } from '../config/model.js'
import { SelfHostedLegacyV2Provider } from './self-hosted-legacy-v2/index.js'
import { SelfHostedV1Provider } from './self-hosted-v1/index.js'
import { OfficialV4Provider } from './official-v4/index.js'
import type { MinerUProvider } from './contract.js'

export type ProviderFactory = (config: ProviderConfig) => MinerUProvider

type ProviderFactories = {
  readonly [Type in ProviderConfig['type']]: (config: Extract<ProviderConfig, { type: Type }>) => MinerUProvider
}

const providerFactories: ProviderFactories = {
  'self-hosted-v1': config => new SelfHostedV1Provider(config),
  'self-hosted-legacy-v2': config => new SelfHostedLegacyV2Provider(config),
  'official-v4': config => new OfficialV4Provider(config),
}

/** Build the protocol adapter for one validated provider profile. */
export const createProvider: ProviderFactory = config => {
  // The discriminator selects the factory for this exact config variant.
  const create = providerFactories[config.type] as ProviderFactory
  return create(config)
}
