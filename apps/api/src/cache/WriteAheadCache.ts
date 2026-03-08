/**
 * WriteAheadCache — Redis-backed write-ahead log for Telegram downtime resilience
 *
 * Queues write operations when Telegram is unavailable, and flushes
 * them when connectivity is restored. Also provides a read cache.
 */

import type Redis from 'ioredis'
import type { PendingOperation } from '@openbase/core'

export class WriteAheadCache {
    constructor(private redis: Redis) { }

    /**
     * Queue a write operation for later execution.
     */
    async queueWrite(projectId: string, operation: PendingOperation): Promise<void> {
        await this.redis.lpush(`wal:${projectId}`, JSON.stringify(operation))
    }

    /**
     * Get the count of pending operations.
     */
    async pendingCount(projectId: string): Promise<number> {
        return this.redis.llen(`wal:${projectId}`)
    }

    /**
     * Flush all queued operations for a project.
     * @param executor - A function that executes a single pending operation
     */
    async flushQueue(
        projectId: string,
        executor: (op: PendingOperation) => Promise<void>
    ): Promise<{ succeeded: number; failed: number }> {
        let succeeded = 0
        let failed = 0

        while (true) {
            const item = await this.redis.rpop(`wal:${projectId}`)
            if (!item) break

            try {
                const op = JSON.parse(item) as PendingOperation
                await executor(op)
                succeeded++
            } catch {
                // Push failed ops back to the front of the queue
                await this.redis.rpush(`wal:${projectId}`, item)
                failed++
                break // Stop on first failure
            }
        }

        return { succeeded, failed }
    }

    /**
     * Cache a read result with TTL.
     */
    async cachedRead<T>(
        key: string,
        ttlSeconds: number,
        fetch: () => Promise<T>
    ): Promise<T> {
        const cached = await this.redis.get(`read:${key}`)
        if (cached) return JSON.parse(cached) as T

        const result = await fetch()
        await this.redis.setex(`read:${key}`, ttlSeconds, JSON.stringify(result))
        return result
    }

    /**
     * Invalidate a cached read.
     */
    async invalidateCache(key: string): Promise<void> {
        await this.redis.del(`read:${key}`)
    }

    /**
     * Invalidate all cached reads matching a pattern.
     */
    async invalidateCachePattern(pattern: string): Promise<void> {
        const keys = await this.redis.keys(`read:${pattern}`)
        if (keys.length > 0) {
            await this.redis.del(...keys)
        }
    }
}
