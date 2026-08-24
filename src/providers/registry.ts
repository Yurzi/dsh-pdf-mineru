import type { MinerUJobRecord } from '../domain/job.js'
import { MinerUError, failure } from '../domain/errors.js'
import type { ProviderConfigId } from '../domain/ids.js'
import type { MinerUConfig, ProviderConfig } from '../config.js'
import { providerById } from '../config.js'
import { SelfHostedV2Provider } from './self-hosted-v2.js'
import { OfficialV4Provider } from './official-v4.js'
import type { MinerUProvider } from './provider.js'

export interface ResolvedProvider {
  readonly provider: MinerUProvider
  readonly config: ProviderConfig
}

export class ProviderRegistry {
  constructor(private readonly getConfig: () => MinerUConfig) {}

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

  async resolveForJob(job: MinerUJobRecord): Promise<ResolvedProvider> {
    const resolved = this.resolve(job.providerConfigId)
    if (resolved.provider.id !== job.providerId) {
      throw new MinerUError(failure('PROVIDER_CONFIG_MISSING', 'MinerU job provider identity no longer matches its configuration'))
    }
    const compatibility = await resolved.provider.compatibilityKey(job.request, {
      configuredVersion: 'configuredVersion' in resolved.config ? resolved.config.configuredVersion : undefined,
    })
    if (compatibility !== job.providerCompatibilityKey) {
      throw new MinerUError(failure(
        'PROVIDER_CONFIG_MISSING',
        'MinerU provider configuration changed incompatibly after this job was submitted',
      ))
    }
    return resolved
  }

  create(config: ProviderConfig): MinerUProvider {
    switch (config.type) {
      case 'self-hosted-v2':
        return new SelfHostedV2Provider(config)
      case 'official-v4':
        return new OfficialV4Provider(config)
    }
  }
}
