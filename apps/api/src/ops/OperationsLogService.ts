import type Redis from 'ioredis'
import type { OperationLogEntry } from '@openbase/core'

const GLOBAL_LOG_KEY = 'ops:global'

export class OperationsLogService {
    constructor(private readonly redis: Redis) { }

    async record(entry: OperationLogEntry): Promise<void> {
        const projectKey = entry.projectId ? this.getProjectKey(entry.projectId) : null
        const serialized = JSON.stringify(entry)
        const multi = this.redis.multi()

        multi.lpush(GLOBAL_LOG_KEY, serialized)
        multi.ltrim(GLOBAL_LOG_KEY, 0, 499)
        multi.expire(GLOBAL_LOG_KEY, 7 * 24 * 60 * 60)

        if (projectKey) {
            multi.lpush(projectKey, serialized)
            multi.ltrim(projectKey, 0, 299)
            multi.expire(projectKey, 7 * 24 * 60 * 60)
        }

        await multi.exec()
    }

    async listGlobal(limit: number = 100): Promise<OperationLogEntry[]> {
        return this.readList(GLOBAL_LOG_KEY, limit)
    }

    async listProject(projectId: string, limit: number = 100): Promise<OperationLogEntry[]> {
        return this.readList(this.getProjectKey(projectId), limit)
    }

    async cleanupProject(projectId: string): Promise<void> {
        await this.redis.del(this.getProjectKey(projectId))
    }

    private async readList(key: string, limit: number): Promise<OperationLogEntry[]> {
        const items = await this.redis.lrange(key, 0, Math.max(0, limit - 1))
        return items
            .map(item => {
                try {
                    return JSON.parse(item) as OperationLogEntry
                } catch {
                    return null
                }
            })
            .filter((item): item is OperationLogEntry => item !== null)
    }

    private getProjectKey(projectId: string): string {
        return `ops:project:${projectId}`
    }
}
