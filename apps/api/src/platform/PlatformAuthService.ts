import jwt from 'jsonwebtoken'
import type Redis from 'ioredis'

interface PlatformTokenPayload {
    sub: string
    email: string
    role: 'platform_user'
    type: 'platform_access' | 'platform_refresh'
    iat?: number
    exp?: number
}

export class PlatformAuthService {
    constructor(
        private readonly redis: Redis,
        private readonly jwtSecret: string
    ) { }

    issueSession(user: { id: string; email: string }): {
        access_token: string
        refresh_token: string
        expires_at?: number
    } {
        const accessToken = jwt.sign(
            { sub: user.id, email: user.email, role: 'platform_user', type: 'platform_access' },
            this.jwtSecret,
            { expiresIn: '1h' }
        )

        const refreshToken = jwt.sign(
            { sub: user.id, email: user.email, role: 'platform_user', type: 'platform_refresh' },
            this.jwtSecret,
            { expiresIn: '30d' }
        )

        const decoded = jwt.decode(accessToken) as { exp?: number } | null

        return {
            access_token: accessToken,
            refresh_token: refreshToken,
            expires_at: decoded?.exp ? decoded.exp * 1000 : undefined,
        }
    }

    async refreshSession(refreshToken: string): Promise<{
        access_token: string
        refresh_token: string
        expires_at?: number
    }> {
        const revoked = await this.redis.get(`platform:revoked:${refreshToken}`)
        if (revoked) {
            throw new Error('Refresh token has been revoked')
        }

        const payload = jwt.verify(refreshToken, this.jwtSecret) as PlatformTokenPayload
        if (payload.type !== 'platform_refresh' || payload.role !== 'platform_user') {
            throw new Error('Invalid refresh token')
        }

        await this.redis.setex(`platform:revoked:${refreshToken}`, 30 * 24 * 60 * 60, '1')
        return this.issueSession({ id: payload.sub, email: payload.email })
    }

    async signOut(refreshToken?: string | null): Promise<void> {
        if (!refreshToken) {
            return
        }

        await this.redis.setex(`platform:revoked:${refreshToken}`, 30 * 24 * 60 * 60, '1')
    }
}
