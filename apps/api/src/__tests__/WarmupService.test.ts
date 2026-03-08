import { describe, expect, it, vi } from 'vitest'
import type { Project } from '@openbase/core'
import { EncryptionService } from '../encryption/EncryptionService.js'
import { WarmupService } from '../warmup/WarmupService.js'

vi.mock('bullmq', () => {
    class MockQueue {
        async getJob(): Promise<null> {
            return null
        }

        async add(): Promise<void> {
            return undefined
        }

        async close(): Promise<void> {
            return undefined
        }
    }

    class MockWorker {
        on(): void {
            return undefined
        }

        async close(): Promise<void> {
            return undefined
        }
    }

    return {
        Queue: MockQueue,
        Worker: MockWorker,
    }
})

class MockRedis {
    private store = new Map<string, string>()

    async get(key: string): Promise<string | null> {
        return this.store.get(key) ?? null
    }

    async set(key: string, value: string): Promise<'OK'> {
        this.store.set(key, value)
        return 'OK'
    }

    async del(key: string): Promise<number> {
        const existed = this.store.delete(key)
        return existed ? 1 : 0
    }

    async keys(pattern: string): Promise<string[]> {
        if (pattern === 'project:*') {
            return [...this.store.keys()].filter(key => key.startsWith('project:'))
        }

        return []
    }

    duplicate(): MockRedis {
        return this
    }
}

describe('WarmupService', () => {
    it('marks a project active after 7 completed ticks', async () => {
        const encryptionService = new EncryptionService()
        const masterKey = Buffer.from('a'.repeat(64), 'hex')
        const redis = new MockRedis()
        const sendMessage = vi.fn().mockResolvedValue(1)

        const providerFactory = {
            withSession: vi.fn().mockImplementation(async (_session: string, fn: (provider: { sendMessage: typeof sendMessage }) => Promise<void>) => {
                await fn({ sendMessage })
            }),
        }

        const service = new WarmupService(
            providerFactory as never,
            redis as never,
            encryptionService,
            masterKey,
            {
                enableQueue: false,
                sleep: async () => undefined,
            }
        )

        const encryptedSession = encryptionService.encryptToString('telegram-session', masterKey)
        const project: Project = {
            id: 'project-1',
            name: 'demo',
            ownerId: 'owner-1',
            telegramSessionEncrypted: encryptedSession,
            channelMap: {},
            buckets: {},
            bucketPolicies: {},
            storageIndexChannel: { id: 'storage', accessHash: '10' },
            usersChannel: { id: 'users', accessHash: '11' },
            schemaChannel: { id: 'schema', accessHash: '12' },
            commitLogChannel: { id: 'commit', accessHash: '13' },
            status: 'warming_up',
            warmupDaysRemaining: 7,
            anonKey: 'anon',
            serviceRoleKey: 'service',
            createdAt: new Date().toISOString(),
        }

        await redis.set(`project:${project.id}`, JSON.stringify(project))
        await service.startWarmup(project.id, project.commitLogChannel)

        for (let tick = 0; tick < 7; tick++) {
            await service.executeWarmupTick(project.id)
        }

        const updatedProject = JSON.parse(await redis.get(`project:${project.id}`) ?? '{}') as Project
        const status = await service.getStatus(project.id)

        expect(updatedProject.status).toBe('active')
        expect(updatedProject.warmupDaysRemaining).toBe(0)
        expect(status?.status).toBe('active')
        expect(status?.daysCompleted).toBe(7)
        expect(sendMessage).toHaveBeenCalled()
    })

    it('ignores non-project project:* keys during reconciliation', async () => {
        const encryptionService = new EncryptionService()
        const masterKey = Buffer.from('b'.repeat(64), 'hex')
        const redis = new MockRedis()

        const providerFactory = {
            withSession: vi.fn(),
        }

        const service = new WarmupService(
            providerFactory as never,
            redis as never,
            encryptionService,
            masterKey,
            {
                enableQueue: true,
            }
        )

        const encryptedSession = encryptionService.encryptToString('telegram-session', masterKey)
        const project: Project = {
            id: 'project-2',
            name: 'demo',
            ownerId: 'owner-2',
            telegramSessionEncrypted: encryptedSession,
            channelMap: {},
            buckets: {},
            bucketPolicies: {},
            storageIndexChannel: { id: 'storage', accessHash: '20' },
            usersChannel: { id: 'users', accessHash: '21' },
            schemaChannel: { id: 'schema', accessHash: '22' },
            commitLogChannel: { id: 'commit', accessHash: '23' },
            status: 'warming_up',
            warmupDaysRemaining: 7,
            anonKey: 'anon',
            serviceRoleKey: 'service',
            createdAt: new Date().toISOString(),
        }

        await redis.set(`project:${project.id}`, JSON.stringify(project))
        await redis.set(`project:${project.id}:webhooks`, JSON.stringify([]))

        await expect(service.reconcileWarmups()).resolves.toBeUndefined()
        expect(await service.getStatus(project.id)).not.toBeNull()
    })
})
