import { MockStorageProvider, TelegramStorageProvider } from '@openbase/telegram'
import type { EventedStorageProvider, StorageProvider } from '@openbase/telegram'

export class TelegramProviderFactory {
    constructor(
        private readonly apiId: number | undefined,
        private readonly apiHash: string | undefined,
        private readonly useMock = false
    ) { }

    async withSession<T>(
        sessionString: string,
        fn: (provider: StorageProvider) => Promise<T>
    ): Promise<T> {
        const provider = await this.createConnectedProvider(sessionString)

        try {
            return await fn(provider)
        } finally {
            await provider.disconnect().catch(() => undefined)
        }
    }

    async createConnectedProvider(sessionString: string): Promise<EventedStorageProvider> {
        const provider = this.useMock
            ? new MockStorageProvider()
            : new TelegramStorageProvider(this.requireApiId(), this.requireApiHash())

        await provider.connect(sessionString)
        return provider
    }

    private requireApiId(): number {
        if (this.apiId === undefined) {
            throw new Error('TELEGRAM_API_ID is not configured')
        }

        return this.apiId
    }

    private requireApiHash(): string {
        if (!this.apiHash) {
            throw new Error('TELEGRAM_API_HASH is not configured')
        }

        return this.apiHash
    }
}
