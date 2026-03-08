/**
 * Rate Limiter — Redis sliding window counter
 *
 * Limits API requests per API key to prevent abuse.
 * Uses a sliding window counter algorithm in Redis.
 */

import type { FastifyRequest, FastifyReply } from 'fastify'
import type Redis from 'ioredis'

const DEFAULT_WINDOW_MS = 60_000 // 1 minute
const DEFAULT_MAX_REQUESTS = 100

export interface RateLimitOptions {
    windowMs?: number
    maxRequests?: number
    keyGenerator?: (request: FastifyRequest) => string
}

/**
 * Create a rate limiter middleware using Redis sliding window.
 */
export function createRateLimiter(redis: Redis, options: RateLimitOptions = {}) {
    const {
        windowMs = DEFAULT_WINDOW_MS,
        maxRequests = DEFAULT_MAX_REQUESTS,
        keyGenerator = defaultKeyGenerator,
    } = options

    return async function rateLimiter(
        request: FastifyRequest,
        reply: FastifyReply
    ): Promise<void> {
        const key = `ratelimit:${keyGenerator(request)}`
        const now = Date.now()
        const windowStart = now - windowMs

        // Sliding window using sorted sets
        const pipeline = redis.pipeline()
        pipeline.zremrangebyscore(key, 0, windowStart) // Remove old entries
        pipeline.zadd(key, now, `${now}:${Math.random()}`) // Add current request
        pipeline.zcard(key) // Count requests in window
        pipeline.pexpire(key, windowMs) // Set TTL

        const results = await pipeline.exec()
        const requestCount = results?.[2]?.[1] as number || 0

        // Set rate limit headers
        reply.header('X-RateLimit-Limit', maxRequests)
        reply.header('X-RateLimit-Remaining', Math.max(0, maxRequests - requestCount))
        reply.header('X-RateLimit-Reset', Math.ceil((now + windowMs) / 1000))

        if (requestCount > maxRequests) {
            const retryAfter = Math.ceil(windowMs / 1000)
            reply.header('Retry-After', retryAfter)
            return reply.status(429).send({
                error: {
                    message: 'Rate limit exceeded',
                    code: 'RATE_LIMIT',
                    retryAfter,
                },
            })
        }
    }
}

/**
 * Default key generator — uses API key from Authorization header or IP.
 */
function defaultKeyGenerator(request: FastifyRequest): string {
    const authHeader = request.headers.authorization
    if (authHeader) {
        // Use the first 32 chars of the token as the key
        return `token:${authHeader.slice(7, 39)}`
    }
    return `ip:${request.ip}`
}
