import type Redis from 'ioredis'
import type { RequestLogEntry } from '@openbase/core'

export class RequestLogService {
    constructor(private redis: Redis) { }

    async record(entry: RequestLogEntry): Promise<void> {
        const key = `logs:${entry.projectId}`
        await this.redis
            .multi()
            .lpush(key, JSON.stringify(entry))
            .ltrim(key, 0, 199)
            .expire(key, 7 * 24 * 60 * 60)
            .exec()
    }

    async list(
        projectId: string,
        limit: number = 100
    ): Promise<RequestLogEntry[]> {
        const items = await this.redis.lrange(`logs:${projectId}`, 0, Math.max(0, limit - 1))
        return items
            .map(item => {
                try {
                    return JSON.parse(item) as RequestLogEntry
                } catch {
                    return null
                }
            })
            .filter((item): item is RequestLogEntry => item !== null)
    }
}
