import type { FastifyReply, FastifyRequest } from 'fastify'
import type { JWTPayload } from '@openbase/core'
import jwt from 'jsonwebtoken'

declare module 'fastify' {
    interface FastifyRequest {
        user?: JWTPayload
    }
}

const ACCESS_TOKEN_COOKIE = 'openbase_access_token'

export function getRequestToken(request: FastifyRequest): string | null {
    const authHeader = request.headers.authorization
    if (authHeader?.startsWith('Bearer ')) {
        return authHeader.slice(7)
    }

    const cookieToken = getCookieValue(request, ACCESS_TOKEN_COOKIE)
    if (cookieToken) {
        return cookieToken
    }

    const apiKey = request.headers.apikey
    if (typeof apiKey === 'string' && apiKey.length > 0) {
        return apiKey
    }

    return null
}

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

    const payload = verifyRequestToken(token)
    if (!payload) {
        return reply.status(401).send({
            error: { message: 'Invalid or expired token', code: 'INVALID_TOKEN' },
        })
    }

    if (payload.type === 'refresh') {
        return reply.status(401).send({
            error: { message: 'Refresh tokens cannot be used as bearer tokens', code: 'INVALID_TOKEN_TYPE' },
        })
    }

    request.user = payload
}

export async function optionalAuthMiddleware(
    request: FastifyRequest,
    _reply: FastifyReply
): Promise<void> {
    const token = getRequestToken(request)
    if (!token) {
        return
    }

    const payload = verifyRequestToken(token)
    if (!payload || payload.type === 'refresh') {
        return
    }

    request.user = payload
}

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

export async function platformAuthMiddleware(
    request: FastifyRequest,
    reply: FastifyReply
): Promise<void> {
    await authMiddleware(request, reply)
    if (reply.sent) {
        return
    }

    if (request.user?.role !== 'platform_user' || !request.user.sub) {
        return reply.status(403).send({
            error: { message: 'Platform user token required', code: 'FORBIDDEN' },
        })
    }
}

function verifyRequestToken(token: string): JWTPayload | null {
    try {
        return jwt.verify(token, process.env.JWT_SECRET!) as JWTPayload
    } catch {
        return null
    }
}

function getCookieValue(request: FastifyRequest, name: string): string | null {
    const header = request.headers.cookie
    if (!header) {
        return null
    }

    for (const part of header.split(';')) {
        const [rawKey, ...rawValue] = part.trim().split('=')
        if (rawKey !== name) {
            continue
        }

        return decodeURIComponent(rawValue.join('='))
    }

    return null
}
