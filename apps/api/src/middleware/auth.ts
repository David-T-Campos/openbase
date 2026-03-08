/**
 * JWT Authentication Middleware
 *
 * Extracts and verifies the Bearer token from the Authorization header.
 * Attaches the decoded JWT payload to request.user.
 */

import type { FastifyRequest, FastifyReply } from 'fastify'
import jwt from 'jsonwebtoken'
import type { JWTPayload } from '@openbase/core'

// Extend FastifyRequest to include user
declare module 'fastify' {
    interface FastifyRequest {
        user?: JWTPayload
    }
}

/**
 * Extract the bearer token or apikey value from a request.
 */
export function getRequestToken(request: FastifyRequest): string | null {
    const authHeader = request.headers.authorization
    if (authHeader?.startsWith('Bearer ')) {
        return authHeader.slice(7)
    }

    const apiKey = request.headers.apikey
    if (typeof apiKey === 'string' && apiKey.length > 0) {
        return apiKey
    }

    return null
}

/**
 * Auth middleware — verifies JWT and attaches user to request.
 * For use with fastify preHandler hooks.
 */
export async function authMiddleware(
    request: FastifyRequest,
    reply: FastifyReply
): Promise<void> {
    const token = getRequestToken(request)

    if (!token) {
        return reply.status(401).send({
            error: { message: 'Missing authentication token', code: 'MISSING_TOKEN' },
        })
    }

    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET!) as JWTPayload
        request.user = payload
    } catch {
        return reply.status(401).send({
            error: { message: 'Invalid or expired token', code: 'INVALID_TOKEN' },
        })
    }
}

/**
 * Optional auth middleware — does NOT reject unauthenticated requests.
 * Attaches user if token is present and valid, otherwise user is undefined.
 */
export async function optionalAuthMiddleware(
    request: FastifyRequest,
    _reply: FastifyReply
): Promise<void> {
    const token = getRequestToken(request)
    if (!token) return

    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET!) as JWTPayload
        request.user = payload
    } catch {
        // Silently ignore invalid tokens in optional mode
    }
}

/**
 * Service role middleware — checks if the token has service_role.
 * Must be used AFTER authMiddleware.
 */
export async function serviceRoleMiddleware(
    request: FastifyRequest,
    reply: FastifyReply
): Promise<void> {
    if (!request.user) {
        return reply.status(401).send({
            error: { message: 'Authentication required', code: 'MISSING_TOKEN' },
        })
    }

    if (request.user.role !== 'service_role') {
        return reply.status(403).send({
            error: { message: 'Service role required', code: 'FORBIDDEN' },
        })
    }
}

/**
 * Platform auth middleware — only allows dashboard/platform users.
 */
export async function platformAuthMiddleware(
    request: FastifyRequest,
    reply: FastifyReply
): Promise<void> {
    await authMiddleware(request, reply)
    if (reply.sent) return

    if (request.user?.role !== 'platform_user' || !request.user.sub) {
        return reply.status(403).send({
            error: { message: 'Platform user token required', code: 'FORBIDDEN' },
        })
    }
}
