import { MinerUError, failure } from '../domain/errors.js'
import type { ProviderConfigId } from '../domain/ids.js'
import type { MinerUConfig, ProviderConfig } from '../config.js'
import { providerById } from '../config.js'
import { SelfHostedV2Provider } from './self-hosted-v2.js'
import { OfficialV4Provider } from './official-v4.js'
import type { MinerUProvider, ProviderOptions } from './provider.js'

export interface ResolvedProvider {
  readonly provider: MinerUProvider
  readonly config: ProviderConfig
}

export class ProviderRegistry {
  constructor(
    private readonly getConfig: () => MinerUConfig,
    private readonly options?: ProviderOptions,
  ) {}

  active(): ResolvedProvider {
    const config = this.getConfig()
    return this.resolve(config.activeProvider)
  }

  resolve(configId: ProviderConfigId): ResolvedProvider {
    const config = providerById(this.getConfig(), configId)
    if (config === undefined) {
      throw new MinerUError(failure('PROVIDER_CONFIG_MISSING', `MinerU provider config ${configId} is no longer available`))
    }
    return { config, provider: this.create(config) }
  }

  create(config: ProviderConfig): MinerUProvider {
    switch (config.type) {
      case 'self-hosted-v2':
        return new SelfHostedV2Provider(config, this.options)
      case 'official-v4':
        return new OfficialV4Provider(config, this.options)
    }
  }
}
