import { mkdtempSync, rmSync } from 'fs'
import type Redis from 'ioredis'
import RedisMock from 'ioredis-mock'
import { tmpdir } from 'os'
import { join } from 'path'
import { MockStorageProvider } from '@openbase/telegram'
import { createApp, type AppContext } from '../../app.js'
import { resetConfig } from '../../config.js'

interface TestAppOptions {
    listen?: boolean
}

export interface TestAppContext extends AppContext {
    baseUrl: string | null
    tempDir: string
}

export async function createTestApp(options: TestAppOptions = {}): Promise<TestAppContext> {
    MockStorageProvider.reset()
    resetConfig()

    const tempDir = mkdtempSync(join(tmpdir(), 'openbase-test-'))
    process.env.NODE_ENV = 'test'
    process.env.PORT = '3001'
    process.env.JWT_SECRET = 'test-secret-1234567890'
    process.env.STORAGE_SECRET = 'test-storage-secret-1234567890'
    process.env.REDIS_URL = 'redis://localhost:6379'
    process.env.SQLITE_BASE_PATH = tempDir.replace(/\\/g, '/')
    process.env.TELEGRAM_API_ID = '12345'
    process.env.TELEGRAM_API_HASH = 'test-hash'
    process.env.MOCK_TELEGRAM = 'true'
    process.env.SKIP_WARMUP = 'false'
    process.env.DASHBOARD_URL = 'http://127.0.0.1:3000'
    process.env.API_PUBLIC_URL = 'http://127.0.0.1:3001'
    process.env.MASTER_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

    const redis = new RedisMock() as unknown as Redis
    const context = await createApp({
        redis,
        webhookInlineProcessing: true,
        warmupQueuesEnabled: false,
    })

    let baseUrl: string | null = null
    if (options.listen) {
        await context.app.listen({ port: 0, host: '127.0.0.1' })
        const address = context.app.server.address()
        if (address && typeof address !== 'string') {
            baseUrl = `http://127.0.0.1:${address.port}`
        }
    }

    const close = async (): Promise<void> => {
        await context.close()
        rmSync(tempDir, { recursive: true, force: true })
        MockStorageProvider.reset()
        resetConfig()
    }

    return {
        ...context,
        baseUrl,
        tempDir,
        close,
    }
}
