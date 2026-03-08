import { createHmac, randomUUID } from 'crypto'
import { Queue, Worker } from 'bullmq'
import type Redis from 'ioredis'
import type { WebhookConfig } from '@openbase/core'

interface WebhookDeliveryJob {
    projectId: string
    webhookId: string
    eventType: 'INSERT' | 'UPDATE' | 'DELETE'
    payload: Record<string, unknown>
}

const WEBHOOK_QUEUE_NAME = 'openbase-webhooks'

export class WebhookService {
    private readonly queue: Queue<WebhookDeliveryJob>
    private readonly worker: Worker<WebhookDeliveryJob>

    constructor(
        private readonly redis: Redis
    ) {
        this.queue = new Queue<WebhookDeliveryJob>(WEBHOOK_QUEUE_NAME, {
            connection: this.redis,
        })

        this.worker = new Worker<WebhookDeliveryJob>(
            WEBHOOK_QUEUE_NAME,
            async job => {
                const config = await this.getConfig(job.data.projectId, job.data.webhookId)
                if (!config || !config.enabled) {
                    return
                }

                const body = JSON.stringify(job.data.payload)
                const signature = createHmac('sha256', config.secret).update(body).digest('hex')

                const response = await fetch(config.url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'User-Agent': 'OpenBase-Webhook/1.0',
                        'X-OpenBase-Event': job.data.eventType,
                        'X-OpenBase-Signature': signature,
                    },
                    body,
                })

                if (!response.ok) {
                    throw new Error(`Webhook responded with HTTP ${response.status}`)
                }
            },
            {
                connection: this.redis.duplicate(),
            }
        )

        this.worker.on('failed', async job => {
            if (!job) return
            await this.redis.lpush(
                `project:${job.data.projectId}:webhooks:dead`,
                JSON.stringify({
                    webhookId: job.data.webhookId,
                    failedAt: new Date().toISOString(),
                    payload: job.data.payload,
                })
            )
            await this.redis.ltrim(`project:${job.data.projectId}:webhooks:dead`, 0, 99)
        })
    }

    async listConfigs(projectId: string): Promise<WebhookConfig[]> {
        const data = await this.redis.get(`project:${projectId}:webhooks`)
        if (!data) return []
        return JSON.parse(data) as WebhookConfig[]
    }

    async createConfig(
        projectId: string,
        input: Pick<WebhookConfig, 'url' | 'events' | 'enabled'> & { secret?: string }
    ): Promise<WebhookConfig> {
        const configs = await this.listConfigs(projectId)
        const now = new Date().toISOString()
        const config: WebhookConfig = {
            id: randomUUID(),
            url: input.url,
            secret: input.secret || randomUUID().replace(/-/g, ''),
            events: input.events,
            enabled: input.enabled,
            createdAt: now,
            updatedAt: now,
            lastFailureAt: null,
            lastFailureReason: null,
        }

        configs.push(config)
        await this.redis.set(`project:${projectId}:webhooks`, JSON.stringify(configs))
        return config
    }

    async updateConfig(
        projectId: string,
        webhookId: string,
        updates: Partial<Pick<WebhookConfig, 'url' | 'events' | 'enabled' | 'secret'>>
    ): Promise<WebhookConfig | null> {
        const configs = await this.listConfigs(projectId)
        const index = configs.findIndex(config => config.id === webhookId)
        if (index === -1) {
            return null
        }

        configs[index] = {
            ...configs[index],
            ...updates,
            updatedAt: new Date().toISOString(),
        }

        await this.redis.set(`project:${projectId}:webhooks`, JSON.stringify(configs))
        return configs[index]
    }

    async deleteConfig(projectId: string, webhookId: string): Promise<boolean> {
        const configs = await this.listConfigs(projectId)
        const nextConfigs = configs.filter(config => config.id !== webhookId)
        if (nextConfigs.length === configs.length) {
            return false
        }

        await this.redis.set(`project:${projectId}:webhooks`, JSON.stringify(nextConfigs))
        return true
    }

    async enqueueDatabaseChange(
        projectId: string,
        table: string,
        eventType: 'INSERT' | 'UPDATE' | 'DELETE',
        newRow: Record<string, unknown> | null,
        oldRow: Record<string, unknown> | null
    ): Promise<void> {
        const configs = await this.listConfigs(projectId)
        const matchingConfigs = configs.filter(config => config.enabled && config.events.includes(eventType))

        await Promise.all(
            matchingConfigs.map(config =>
                this.queue.add(
                    'deliver-webhook',
                    {
                        projectId,
                        webhookId: config.id,
                        eventType,
                        payload: {
                            type: eventType,
                            projectId,
                            table,
                            timestamp: new Date().toISOString(),
                            record: newRow,
                            oldRecord: oldRow,
                        },
                    },
                    {
                        attempts: 5,
                        backoff: { type: 'exponential', delay: 30_000 },
                        removeOnComplete: 100,
                        removeOnFail: 100,
                    }
                )
            )
        )
    }

    async cleanupProject(projectId: string): Promise<void> {
        await Promise.all([
            this.redis.del(`project:${projectId}:webhooks`),
            this.redis.del(`project:${projectId}:webhooks:dead`),
        ])

        const jobs = await this.queue.getJobs(['active', 'waiting', 'delayed', 'failed', 'completed'])
        await Promise.all(
            jobs
                .filter(job => job.data.projectId === projectId)
                .map(job => job.remove().catch(() => undefined))
        )
    }

    async close(): Promise<void> {
        await this.worker.close()
        await this.queue.close()
    }

    private async getConfig(projectId: string, webhookId: string): Promise<WebhookConfig | null> {
        const configs = await this.listConfigs(projectId)
        return configs.find(config => config.id === webhookId) || null
    }
}
