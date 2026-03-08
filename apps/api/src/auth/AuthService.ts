/**
 * AuthService — User authentication and JWT management.
 */

import { randomBytes, randomUUID } from 'crypto'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import type Redis from 'ioredis'
import type { StorageProvider } from '@openbase/telegram'
import type { AuthResult, JWTPayload, TableSchema, UserIdentity, UserRecord } from '@openbase/core'
import { AuthError, ConflictError } from '@openbase/core'
import type { IndexManager } from '../database/IndexManager.js'
import { QueryEngine } from '../database/QueryEngine.js'
import type { EncryptionService } from '../encryption/EncryptionService.js'
import { generateTotpSecret, generateTotpUri, verifyTotp } from './totp.js'

const BCRYPT_ROUNDS = 12
const ACCESS_TOKEN_EXPIRY = '1h'
const REFRESH_TOKEN_EXPIRY = '7d'

export interface ProjectAuthChallengeResult {
    mfaRequired: true
    challengeToken: string
    user: AuthResult['user']
}

const USERS_SCHEMA: TableSchema = {
    tableName: '__users__',
    columns: [
        { name: 'id', type: 'uuid', required: true, unique: true },
        { name: 'email', type: 'text', required: true, unique: true },
        { name: 'password_hash', type: 'text' },
        { name: 'created_at', type: 'timestamp' },
        { name: 'updated_at', type: 'timestamp' },
        { name: 'confirmed_at', type: 'timestamp' },
        { name: 'role', type: 'text' },
        { name: 'metadata', type: 'json' },
        { name: 'identities', type: 'json' },
        { name: 'refresh_token_version', type: 'number' },
        { name: 'totp_secret_encrypted', type: 'text' },
        { name: 'totp_enabled', type: 'boolean' },
        { name: 'mfa_enrolled_at', type: 'timestamp' },
    ],
    indexes: ['email', 'id'],
}

export class AuthService {
    constructor(
        private readonly redis: Redis,
        private readonly jwtSecret: string,
        private readonly encryptionService?: EncryptionService,
        private readonly masterKey?: Buffer
    ) { }

    async signUp(
        projectId: string,
        usersChannel: string | { id: string; accessHash: string },
        email: string,
        password: string,
        storageProvider: StorageProvider,
        indexManager: IndexManager,
        metadata: Record<string, unknown> = {}
    ): Promise<AuthResult> {
        const queryEngine = this.createUsersQueryEngine(storageProvider, indexManager)
        const existing = await queryEngine.select('__users__', usersChannel, {
            filters: [{ column: 'email', operator: 'eq', value: email }],
        })

        if (existing.length > 0) {
            throw new ConflictError('User already exists')
        }

        const userRecord = await this.buildUserRecord(email, metadata, password)

        const inserted = await queryEngine.insert('__users__', usersChannel, this.toRowRecord(userRecord))
        await this.indexUser(indexManager, userRecord, inserted._msgId)

        return {
            user: this.toAuthUser(userRecord),
            session: this.issueTokenPair({
                sub: userRecord.id,
                email: userRecord.email,
                role: userRecord.role,
                projectId,
            }),
        }
    }

    async signIn(
        projectId: string,
        usersChannel: string | { id: string; accessHash: string },
        email: string,
        password: string,
        storageProvider: StorageProvider,
        indexManager: IndexManager,
        options: { mfaCode?: string } = {}
    ): Promise<AuthResult | ProjectAuthChallengeResult> {
        const queryEngine = this.createUsersQueryEngine(storageProvider, indexManager)
        const users = await queryEngine.select('__users__', usersChannel, {
            filters: [{ column: 'email', operator: 'eq', value: email }],
        })

        if (users.length === 0) {
            throw new AuthError('Invalid credentials', 'INVALID_CREDENTIALS')
        }

        const user = users[0] as unknown as UserRecord & { _msgId: number }
        if (!user.password_hash) {
            throw new AuthError('Password sign-in is not enabled for this user', 'PASSWORD_DISABLED')
        }

        const valid = await bcrypt.compare(password, user.password_hash)
        if (!valid) {
            throw new AuthError('Invalid credentials', 'INVALID_CREDENTIALS')
        }

        if (user.totp_enabled) {
            if (!options.mfaCode) {
                const challengeToken = await this.createTotpChallenge(projectId, user)
                return {
                    mfaRequired: true,
                    challengeToken,
                    user: this.toAuthUser(user),
                }
            }

            this.assertEncryptionReady()
            const secret = this.encryptionService!.decryptFromString(user.totp_secret_encrypted!, this.masterKey!)
            if (!verifyTotp(secret, options.mfaCode)) {
                throw new AuthError('Invalid MFA code', 'INVALID_MFA_CODE')
            }
        }

        return {
            user: this.toAuthUser(user),
            session: this.issueTokenPair({
                sub: user.id,
                email: user.email,
                role: user.role,
                projectId,
            }),
        }
    }

    async refreshSession(refreshToken: string): Promise<AuthResult['session']> {
        const isRevoked = await this.redis.get(`revoked:${refreshToken}`)
        if (isRevoked) {
            throw new AuthError('Refresh token has been revoked', 'TOKEN_REVOKED')
        }

        try {
            const payload = jwt.verify(refreshToken, this.jwtSecret) as JWTPayload
            if (payload.type !== 'refresh' || !payload.sub || !payload.projectId) {
                throw new AuthError('Invalid refresh token', 'INVALID_TOKEN')
            }

            await this.redis.setex(`revoked:${refreshToken}`, 7 * 24 * 60 * 60, '1')

            return this.issueTokenPair({
                sub: payload.sub,
                email: payload.email,
                role: payload.role,
                projectId: payload.projectId,
            })
        } catch (error) {
            if (error instanceof AuthError) throw error
            throw new AuthError('Invalid refresh token', 'INVALID_TOKEN')
        }
    }

    async signOut(refreshToken: string): Promise<void> {
        await this.redis.setex(`revoked:${refreshToken}`, 7 * 24 * 60 * 60, '1')
    }

    async sendMagicLink(
        email: string,
        projectId: string,
        sendEmail: (to: string, subject: string, html: string) => Promise<void>,
        dashboardUrl: string
    ): Promise<void> {
        const token = randomBytes(32).toString('hex')

        await this.redis.setex(
            `magic:${token}`,
            900,
            JSON.stringify({ email, projectId })
        )

        const callbackUrl = `${dashboardUrl}/auth/callback?token=${token}&type=magiclink&projectId=${projectId}`

        await sendEmail(
            email,
            'Your OpenBase magic link',
            `
              <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
                <h2>Sign in to OpenBase</h2>
                <p>Click the button below to sign in. This link expires in 15 minutes.</p>
                <a href="${callbackUrl}"
                   style="display: inline-block; padding: 12px 24px; background: #3ecf8e;
                          color: #08100b; text-decoration: none; border-radius: 8px;">
                  Sign in
                </a>
              </div>
            `
        )
    }

    async verifyMagicLink(
        token: string,
        usersChannel: string | { id: string; accessHash: string },
        storageProvider: StorageProvider,
        indexManager: IndexManager
    ): Promise<AuthResult> {
        const data = await this.redis.get(`magic:${token}`)
        if (!data) {
            throw new AuthError('Magic link expired or invalid', 'MAGIC_LINK_EXPIRED')
        }

        const { email, projectId } = JSON.parse(data) as { email: string; projectId: string }
        await this.redis.del(`magic:${token}`)

        const queryEngine = this.createUsersQueryEngine(storageProvider, indexManager)
        const users = await queryEngine.select('__users__', usersChannel, {
            filters: [{ column: 'email', operator: 'eq', value: email }],
        })

        let user: UserRecord

        if (users.length > 0) {
            user = users[0] as unknown as UserRecord
        } else {
            user = await this.buildUserRecord(email, {}, undefined)
            const inserted = await queryEngine.insert('__users__', usersChannel, this.toRowRecord(user))
            await this.indexUser(indexManager, user, inserted._msgId)
        }

        return {
            user: this.toAuthUser(user),
            session: this.issueTokenPair({
                sub: user.id,
                email: user.email,
                role: user.role,
                projectId,
            }),
        }
    }

    async signInWithOAuth(
        projectId: string,
        usersChannel: string | { id: string; accessHash: string },
        storageProvider: StorageProvider,
        indexManager: IndexManager,
        provider: 'google' | 'github',
        identity: { providerUserId: string; email: string; metadata?: Record<string, unknown> }
    ): Promise<AuthResult> {
        const queryEngine = this.createUsersQueryEngine(storageProvider, indexManager)
        const users = await queryEngine.select('__users__', usersChannel, {
            filters: [{ column: 'email', operator: 'eq', value: identity.email }],
            limit: 1,
        })

        let user: UserRecord
        let messageId: number | undefined

        if (users.length === 0) {
            user = await this.buildUserRecord(identity.email, identity.metadata ?? {}, undefined, [
                {
                    provider,
                    providerUserId: identity.providerUserId,
                    email: identity.email,
                    linkedAt: new Date().toISOString(),
                },
            ])
            const inserted = await queryEngine.insert('__users__', usersChannel, this.toRowRecord(user))
            messageId = inserted._msgId
            await this.indexUser(indexManager, user, inserted._msgId)
        } else {
            const existing = users[0] as unknown as UserRecord & { _msgId: number }
            const identities = [...(existing.identities || [])]
            if (!identities.find(candidate => candidate.provider === provider && candidate.providerUserId === identity.providerUserId)) {
                identities.push({
                    provider,
                    providerUserId: identity.providerUserId,
                    email: identity.email,
                    linkedAt: new Date().toISOString(),
                })
            }

            const updatedRows = await queryEngine.updateRows(
                '__users__',
                usersChannel,
                this.toRowRecord({
                    identities,
                    metadata: { ...(existing.metadata || {}), ...(identity.metadata || {}) },
                    confirmed_at: existing.confirmed_at || new Date().toISOString(),
                }),
                [this.toRowRecord(existing)]
            )

            user = updatedRows[0] as unknown as UserRecord
            messageId = existing._msgId
        }

        if (messageId !== undefined) {
            await this.indexUser(indexManager, user, messageId)
        }

        return {
            user: this.toAuthUser(user),
            session: this.issueTokenPair({
                sub: user.id,
                email: user.email,
                role: user.role,
                projectId,
            }),
        }
    }

    async beginTotpEnrollment(
        projectId: string,
        usersChannel: string | { id: string; accessHash: string },
        userId: string,
        storageProvider: StorageProvider,
        indexManager: IndexManager
    ): Promise<{ enrollmentToken: string; secret: string; uri: string }> {
        this.assertEncryptionReady()

        const user = await this.getUserRecord(usersChannel, userId, storageProvider, indexManager)
        if (!user) {
            throw new AuthError('User not found', 'USER_NOT_FOUND')
        }

        const secret = generateTotpSecret()
        const encryptedSecret = this.encryptionService!.encryptToString(secret, this.masterKey!)
        const enrollmentToken = randomUUID()

        await this.redis.setex(
            `totp:enroll:${enrollmentToken}`,
            900,
            JSON.stringify({
                projectId,
                userId,
                secret: encryptedSecret,
            })
        )

        return {
            enrollmentToken,
            secret,
            uri: generateTotpUri(secret, user.email),
        }
    }

    async verifyTotpEnrollment(
        enrollmentToken: string,
        code: string,
        usersChannel: string | { id: string; accessHash: string },
        storageProvider: StorageProvider,
        indexManager: IndexManager
    ): Promise<void> {
        this.assertEncryptionReady()
        const enrollment = await this.redis.get(`totp:enroll:${enrollmentToken}`)
        if (!enrollment) {
            throw new AuthError('MFA enrollment expired', 'MFA_ENROLLMENT_EXPIRED')
        }

        const data = JSON.parse(enrollment) as { userId: string; secret: string }
        const secret = this.encryptionService!.decryptFromString(data.secret, this.masterKey!)
        if (!verifyTotp(secret, code)) {
            throw new AuthError('Invalid MFA code', 'INVALID_MFA_CODE')
        }

        const queryEngine = this.createUsersQueryEngine(storageProvider, indexManager)
        const users = await queryEngine.select('__users__', usersChannel, {
            filters: [{ column: 'id', operator: 'eq', value: data.userId }],
            limit: 1,
        })

        if (users.length === 0) {
            throw new AuthError('User not found', 'USER_NOT_FOUND')
        }

        const existing = users[0]
        await queryEngine.updateRows(
            '__users__',
            usersChannel,
            this.toRowRecord({
                totp_secret_encrypted: data.secret,
                totp_enabled: true,
                mfa_enrolled_at: new Date().toISOString(),
            }),
            [existing as Record<string, unknown>]
        )

        await this.redis.del(`totp:enroll:${enrollmentToken}`)
    }

    async verifyTotpChallenge(challengeToken: string, code: string): Promise<AuthResult['session']> {
        const challenge = await this.redis.get(`totp:challenge:${challengeToken}`)
        if (!challenge) {
            throw new AuthError('MFA challenge expired', 'MFA_CHALLENGE_EXPIRED')
        }

        const data = JSON.parse(challenge) as {
            projectId: string
            userId: string
            email: string
            role: string
            secret: string
        }

        this.assertEncryptionReady()
        const secret = this.encryptionService!.decryptFromString(data.secret, this.masterKey!)
        if (!verifyTotp(secret, code)) {
            throw new AuthError('Invalid MFA code', 'INVALID_MFA_CODE')
        }

        await this.redis.del(`totp:challenge:${challengeToken}`)

        return this.issueTokenPair({
            sub: data.userId,
            email: data.email,
            role: data.role,
            projectId: data.projectId,
        })
    }

    verifyToken(token: string): JWTPayload {
        try {
            return jwt.verify(token, this.jwtSecret) as JWTPayload
        } catch {
            throw new AuthError('Invalid or expired token', 'INVALID_TOKEN')
        }
    }

    async getUser(
        usersChannel: string | { id: string; accessHash: string },
        userId: string,
        storageProvider: StorageProvider,
        indexManager: IndexManager
    ): Promise<Omit<UserRecord, 'password_hash' | 'totp_secret_encrypted'> | null> {
        const user = await this.getUserRecord(usersChannel, userId, storageProvider, indexManager)
        if (!user) return null

        const {
            password_hash: _passwordHash,
            totp_secret_encrypted: _totpSecret,
            _msgId: _messageId,
            ...safeUser
        } = user as UserRecord & { _msgId?: number }
        return safeUser
    }

    async listUsers(
        usersChannel: string | { id: string; accessHash: string },
        storageProvider: StorageProvider,
        indexManager: IndexManager
    ): Promise<Array<Omit<UserRecord, 'password_hash' | 'totp_secret_encrypted'>>> {
        const queryEngine = this.createUsersQueryEngine(storageProvider, indexManager)
        const users = await queryEngine.select('__users__', usersChannel, {
            orderBy: { column: 'created_at', ascending: false },
        })

        return users.map(user => {
            const {
                password_hash: _passwordHash,
                totp_secret_encrypted: _totpSecret,
                _msgId: _messageId,
                ...safeUser
            } = user as unknown as UserRecord & { _msgId?: number }
            return safeUser
        })
    }

    private createUsersQueryEngine(
        storageProvider: StorageProvider,
        indexManager: IndexManager
    ): QueryEngine {
        return new QueryEngine(storageProvider, indexManager, USERS_SCHEMA)
    }

    private issueTokenPair(payload: Required<Pick<JWTPayload, 'sub' | 'projectId' | 'role'>> & Pick<JWTPayload, 'email'>): AuthResult['session'] {
        const accessToken = jwt.sign(
            { ...payload, type: 'access' },
            this.jwtSecret,
            { expiresIn: ACCESS_TOKEN_EXPIRY }
        )

        const refreshToken = jwt.sign(
            { ...payload, type: 'refresh' },
            this.jwtSecret,
            { expiresIn: REFRESH_TOKEN_EXPIRY }
        )

        const decoded = jwt.decode(accessToken) as { exp: number } | null

        return {
            access_token: accessToken,
            refresh_token: refreshToken,
            expires_at: decoded?.exp ? decoded.exp * 1000 : undefined,
        }
    }

    private async buildUserRecord(
        email: string,
        metadata: Record<string, unknown>,
        password?: string,
        identities?: UserIdentity[]
    ): Promise<UserRecord> {
        const now = new Date().toISOString()
        return {
            id: randomUUID(),
            email,
            password_hash: password ? await bcrypt.hash(password, BCRYPT_ROUNDS) : '',
            created_at: now,
            updated_at: now,
            confirmed_at: now,
            role: 'authenticated',
            metadata,
            identities: identities ?? [{
                provider: 'email',
                providerUserId: email,
                email,
                linkedAt: now,
            }],
            refresh_token_version: 0,
            totp_secret_encrypted: null,
            totp_enabled: false,
            mfa_enrolled_at: null,
        }
    }

    private async indexUser(indexManager: IndexManager, user: UserRecord, messageId: number): Promise<void> {
        await Promise.all([
            indexManager.addIndex('__users__', 'email', user.email, messageId),
            indexManager.addIndex('__users__', 'id', user.id, messageId),
        ])
    }

    private toAuthUser(user: Pick<UserRecord, 'id' | 'email' | 'role' | 'metadata' | 'identities' | 'totp_enabled'>): AuthResult['user'] {
        return {
            id: user.id,
            email: user.email,
            role: user.role,
            metadata: user.metadata,
            identities: user.identities,
            totp_enabled: user.totp_enabled,
        }
    }

    private async createTotpChallenge(projectId: string, user: UserRecord): Promise<string> {
        const token = randomUUID()
        await this.redis.setex(
            `totp:challenge:${token}`,
            300,
            JSON.stringify({
                projectId,
                userId: user.id,
                email: user.email,
                role: user.role,
                secret: user.totp_secret_encrypted,
            })
        )
        return token
    }

    private async getUserRecord(
        usersChannel: string | { id: string; accessHash: string },
        userId: string,
        storageProvider: StorageProvider,
        indexManager: IndexManager
    ): Promise<(UserRecord & { _msgId?: number }) | null> {
        const queryEngine = this.createUsersQueryEngine(storageProvider, indexManager)
        const users = await queryEngine.select('__users__', usersChannel, {
            filters: [{ column: 'id', operator: 'eq', value: userId }],
            limit: 1,
        })

        if (users.length === 0) {
            return null
        }

        return users[0] as unknown as UserRecord & { _msgId?: number }
    }

    private assertEncryptionReady(): void {
        if (!this.encryptionService || !this.masterKey) {
            throw new Error('AuthService encryption support is not configured')
        }
    }

    private toRowRecord<T extends object>(value: T): Record<string, unknown> {
        return value as unknown as Record<string, unknown>
    }
}
