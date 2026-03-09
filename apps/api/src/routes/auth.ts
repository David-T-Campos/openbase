import { randomUUID } from 'crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type Redis from 'ioredis'
import { z } from 'zod'
import type { ProjectAccessService } from '../access/ProjectAccessService.js'
import { assertRouteProjectPermission, assertRouteProjectUser } from '../access/routePermissions.js'
import type { AuthService } from '../auth/AuthService.js'
import type { IndexManager } from '../database/IndexManager.js'
import { authMiddleware } from '../middleware/auth.js'
import type { OperationsLogService } from '../ops/OperationsLogService.js'
import type { ProjectService } from '../projects/ProjectService.js'

const ACCESS_TOKEN_COOKIE = 'openbase_access_token'
const REFRESH_TOKEN_COOKIE = 'openbase_refresh_token'
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60
const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60
const OAUTH_STATE_TTL_SECONDS = 600

const signUpSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    metadata: z.record(z.unknown()).optional(),
})

const adminCreateUserSchema = signUpSchema

const signInSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
    mfa_code: z.string().optional(),
})

const magicLinkSchema = z.object({
    email: z.string().email(),
})

const emailConfirmationSchema = z.object({
    token: z.string().min(1),
})

const passwordResetRequestSchema = z.object({
    email: z.string().email(),
})

const passwordResetSchema = z.object({
    token: z.string().min(1),
    password: z.string().min(8),
})

const refreshSchema = z.object({
    refresh_token: z.string().min(1).optional(),
})

const oauthStartSchema = z.object({
    redirectTo: z.string().url().optional(),
})

const totpVerifySchema = z.object({
    enrollment_token: z.string().min(1),
    code: z.string().min(6),
})

const totpChallengeSchema = z.object({
    challenge_token: z.string().min(1),
    code: z.string().min(6),
})

const updateUserSchema = z.object({
    disabled: z.boolean().optional(),
    reason: z.string().max(280).optional(),
})

interface OAuthConfig {
    google: { enabled: boolean; clientId?: string; clientSecret?: string }
    github: { enabled: boolean; clientId?: string; clientSecret?: string }
}

export function registerAuthRoutes(
    app: FastifyInstance,
    redis: Redis,
    authService: AuthService,
    projectService: ProjectService,
    projectAccessService: ProjectAccessService,
    operationsLogService: OperationsLogService,
    getIndexManager: (projectId: string) => IndexManager,
    sendEmail: (to: string, subject: string, html: string) => Promise<void>,
    dashboardUrl: string,
    apiPublicUrl: string,
    oauthConfig: OAuthConfig
): void {
    app.post<{ Params: { projectId: string } }>(
        '/api/v1/:projectId/auth/signup',
        async (request, reply) => {
            const { projectId } = request.params
            const body = signUpSchema.parse(request.body)

            return projectService.withProjectStorage(projectId, async (project, provider) => {
                if (process.env.NODE_ENV !== 'production') {
                    const result = await authService.signUp(
                        project.id,
                        project.usersChannel,
                        body.email,
                        body.password,
                        provider,
                        getIndexManager(project.id),
                        body.metadata
                    )

                    await recordProjectSecurityEvent(operationsLogService, project.id, 'success', 'Auth user signed up', {
                        action: 'auth.signup',
                        userId: result.user.id,
                        email: result.user.email,
                        mode: 'development-auto-confirm',
                    })

                    return reply.status(201).send({ data: result })
                }

                const result = await authService.registerUser(
                    project.usersChannel,
                    body.email,
                    body.password,
                    provider,
                    getIndexManager(project.id),
                    body.metadata,
                    { autoConfirm: false }
                )

                try {
                    await authService.sendEmailConfirmation(body.email, project.id, sendEmail, dashboardUrl)
                } catch (error) {
                    await authService.deleteUser(
                        project.id,
                        project.usersChannel,
                        result.user.id,
                        provider,
                        getIndexManager(project.id)
                    ).catch(() => undefined)

                    return reply.status(503).send({
                        error: {
                            message: (error as Error).message || 'Email confirmation delivery is not configured',
                            code: 'EMAIL_CONFIRMATION_NOT_CONFIGURED',
                        },
                    })
                }

                await recordProjectSecurityEvent(operationsLogService, project.id, 'info', 'Auth signup pending confirmation', {
                    action: 'auth.signup.pending_confirmation',
                    userId: result.user.id,
                    email: result.user.email,
                })

                return reply.status(201).send({
                    data: {
                        user: result.user,
                        confirmation_required: true,
                    },
                })
            })
        }
    )

    app.post<{ Params: { projectId: string } }>(
        '/api/v1/:projectId/auth/confirm',
        async (request, reply) => {
            const body = emailConfirmationSchema.parse(request.body)
            return projectService.withProjectStorage(request.params.projectId, async (project, provider) => {
                const result = await authService.confirmEmail(
                    body.token,
                    project.usersChannel,
                    provider,
                    getIndexManager(project.id)
                )

                await recordProjectSecurityEvent(operationsLogService, project.id, 'success', 'Auth email confirmed', {
                    action: 'auth.confirm',
                    userId: result.user.id,
                    email: result.user.email,
                })

                return reply.send({ data: result })
            })
        }
    )

    app.post<{ Params: { projectId: string } }>(
        '/api/v1/:projectId/auth/password-reset/request',
        async (request, reply) => {
            const body = passwordResetRequestSchema.parse(request.body)
            try {
                await authService.requestPasswordReset(body.email, request.params.projectId, sendEmail, dashboardUrl)
            } catch (error) {
                return reply.status(503).send({
                    error: {
                        message: (error as Error).message || 'Password reset email delivery is not configured',
                        code: 'PASSWORD_RESET_NOT_CONFIGURED',
                    },
                })
            }

            await recordProjectSecurityEvent(operationsLogService, request.params.projectId, 'info', 'Password reset requested', {
                action: 'auth.password_reset.request',
                email: body.email,
            })

            return reply.send({ data: { message: 'Password reset sent' } })
        }
    )

    app.post<{ Params: { projectId: string } }>(
        '/api/v1/:projectId/auth/password-reset/confirm',
        async (request, reply) => {
            const body = passwordResetSchema.parse(request.body)
            return projectService.withProjectStorage(request.params.projectId, async (project, provider) => {
                const result = await authService.resetPassword(
                    body.token,
                    body.password,
                    project.usersChannel,
                    provider,
                    getIndexManager(project.id)
                )

                await recordProjectSecurityEvent(operationsLogService, project.id, 'success', 'Password reset completed', {
                    action: 'auth.password_reset.confirm',
                    userId: result.user.id,
                    email: result.user.email,
                })

                return reply.send({ data: result })
            })
        }
    )

    app.post<{ Params: { projectId: string } }>(
        '/api/v1/:projectId/auth/signin',
        async (request, reply) => {
            const { projectId } = request.params
            const body = signInSchema.parse(request.body)

            return projectService.withProjectStorage(projectId, async (project, provider) => {
                const result = await authService.signIn(
                    project.id,
                    project.usersChannel,
                    body.email,
                    body.password,
                    provider,
                    getIndexManager(project.id),
                    { mfaCode: body.mfa_code }
                )

                if ('mfaRequired' in result) {
                    await recordProjectSecurityEvent(operationsLogService, project.id, 'info', 'Auth MFA challenge issued', {
                        action: 'auth.mfa.challenge',
                        userId: result.user.id,
                        email: result.user.email,
                    })
                    return reply.send({
                        data: {
                        mfa_required: true,
                        challenge_token: result.challengeToken,
                        user: result.user,
                        },
                    })
                }

                await recordProjectSecurityEvent(operationsLogService, project.id, 'success', 'Auth user signed in', {
                    action: 'auth.signin',
                    userId: result.user.id,
                    email: result.user.email,
                })

                return reply.send({ data: result })
            })
        }
    )

    app.post<{ Params: { projectId: string } }>(
        '/api/v1/:projectId/auth/signout',
        async (request, reply) => {
            const body = refreshSchema.parse(request.body ?? {})
            const refreshToken = body.refresh_token || getCookieValue(request, REFRESH_TOKEN_COOKIE)

            if (refreshToken) {
                await authService.signOut(refreshToken)
            }

            await recordProjectSecurityEvent(operationsLogService, request.params.projectId, 'info', 'Auth session signed out', {
                action: 'auth.signout',
            })

            clearProjectAuthCookies(reply, request.params.projectId, apiPublicUrl)
            return reply.send({ data: { message: 'Signed out' } })
        }
    )

    app.post<{ Params: { projectId: string } }>(
        '/api/v1/:projectId/auth/magic-link',
        async (request, reply) => {
            const { projectId } = request.params
            const body = magicLinkSchema.parse(request.body)

            try {
                await authService.sendMagicLink(
                    body.email,
                    projectId,
                    sendEmail,
                    dashboardUrl,
                    apiPublicUrl
                )
            } catch (error) {
                return reply.status(503).send({
                    error: {
                        message: (error as Error).message || 'Magic link email delivery is not configured',
                        code: 'MAGIC_LINK_EMAIL_NOT_CONFIGURED',
                    },
                })
            }

            await recordProjectSecurityEvent(operationsLogService, projectId, 'info', 'Magic link issued', {
                action: 'auth.magic_link.send',
                email: body.email,
            })

            return reply.send({ data: { message: 'Magic link sent' } })
        }
    )

    app.post<{ Params: { projectId: string } }>(
        '/api/v1/:projectId/auth/refresh',
        async (request, reply) => {
            const body = refreshSchema.parse(request.body ?? {})
            const refreshToken = body.refresh_token || getCookieValue(request, REFRESH_TOKEN_COOKIE)

            if (!refreshToken) {
                return reply.status(400).send({ error: { message: 'Missing refresh token' } })
            }

            const session = await authService.refreshSession(refreshToken)
            if (getCookieValue(request, REFRESH_TOKEN_COOKIE) || getCookieValue(request, ACCESS_TOKEN_COOKIE)) {
                setProjectAuthCookies(reply, request.params.projectId, apiPublicUrl, session)
            }

            await recordProjectSecurityEvent(operationsLogService, request.params.projectId, 'success', 'Auth session refreshed', {
                action: 'auth.refresh',
            })

            return reply.send({ data: { session } })
        }
    )

    app.get<{ Params: { projectId: string }; Querystring: { token?: string; type?: string; redirectTo?: string } }>(
        '/api/v1/:projectId/auth/callback',
        async (request, reply) => {
            const { projectId } = request.params
            const { token, type, redirectTo } = request.query as {
                token?: string
                type?: string
                redirectTo?: string
            }

            const trustedRedirect = resolveTrustedRedirect(redirectTo, dashboardUrl)
            if (!trustedRedirect) {
                return reply.status(400).send({ error: { message: 'Invalid redirect target' } })
            }

            if (type !== 'magiclink' || !token) {
                return reply.status(400).send({ error: { message: 'Invalid callback' } })
            }

            return projectService.withProjectStorage(projectId, async (project, provider) => {
                const result = await authService.verifyMagicLink(
                    token,
                    project.usersChannel,
                    provider,
                    getIndexManager(project.id)
                )

                setProjectAuthCookies(reply, project.id, apiPublicUrl, result.session)
                await recordProjectSecurityEvent(operationsLogService, project.id, 'success', 'Magic link verified', {
                    action: 'auth.magic_link.verify',
                    userId: result.user.id,
                    email: result.user.email,
                })
                return reply.redirect(buildProjectAuthRedirect(trustedRedirect, project.id))
            })
        }
    )

    app.get<{ Params: { projectId: string } }>(
        '/api/v1/:projectId/auth/providers',
        { preHandler: [authMiddleware] },
        async (request, reply) => {
            await assertRouteProjectPermission(projectService, projectAccessService, authService, request, {
                permission: 'auth.read',
            })

            return reply.send({
                data: [
                    { name: 'Email / Password', key: 'email', enabled: true },
                    { name: 'Magic Link', key: 'magic_link', enabled: true },
                    { name: 'Google OAuth', key: 'google', enabled: oauthConfig.google.enabled },
                    { name: 'GitHub OAuth', key: 'github', enabled: oauthConfig.github.enabled },
                    { name: 'TOTP MFA', key: 'totp', enabled: true },
                ],
            })
        }
    )

    app.post<{ Params: { projectId: string; provider: string } }>(
        '/api/v1/:projectId/auth/oauth/:provider/start',
        async (request, reply) => {
            const { projectId, provider } = request.params
            const body = oauthStartSchema.parse(request.body ?? {})

            if (provider !== 'google' && provider !== 'github') {
                return reply.status(400).send({ error: { message: 'Unsupported provider' } })
            }

            const providerSettings = oauthConfig[provider]
            if (!providerSettings.enabled || !providerSettings.clientId || !providerSettings.clientSecret) {
                return reply.status(400).send({ error: { message: `${provider} OAuth is not configured` } })
            }

            const trustedRedirect = resolveTrustedRedirect(body.redirectTo, dashboardUrl)
            if (!trustedRedirect) {
                return reply.status(400).send({ error: { message: 'Invalid redirect target' } })
            }

            const state = randomUUID()
            await redis.setex(
                `oauth:${state}`,
                OAUTH_STATE_TTL_SECONDS,
                JSON.stringify({
                    projectId,
                    provider,
                    redirectTo: trustedRedirect.toString(),
                })
            )

            const callbackUrl = `${apiPublicUrl}/api/v1/${projectId}/auth/oauth/${provider}/callback`
            const oauthUrl = provider === 'google'
                ? new URL('https://accounts.google.com/o/oauth2/v2/auth')
                : new URL('https://github.com/login/oauth/authorize')

            oauthUrl.searchParams.set('client_id', providerSettings.clientId)
            oauthUrl.searchParams.set('redirect_uri', callbackUrl)
            oauthUrl.searchParams.set('state', state)

            if (provider === 'google') {
                oauthUrl.searchParams.set('response_type', 'code')
                oauthUrl.searchParams.set('scope', 'openid email profile')
                oauthUrl.searchParams.set('access_type', 'offline')
                oauthUrl.searchParams.set('prompt', 'consent')
            } else {
                oauthUrl.searchParams.set('scope', 'read:user user:email')
            }

            return reply.send({ data: { url: oauthUrl.toString() } })
        }
    )

    app.get<{ Params: { projectId: string; provider: string }; Querystring: { code?: string; state?: string } }>(
        '/api/v1/:projectId/auth/oauth/:provider/callback',
        async (request, reply) => {
            const { projectId, provider } = request.params
            const { code, state } = request.query as { code?: string; state?: string }

            if ((provider !== 'google' && provider !== 'github') || !code || !state) {
                return reply.status(400).send({ error: { message: 'Invalid OAuth callback' } })
            }

            const oauthState = await redis.get(`oauth:${state}`)
            if (!oauthState) {
                return reply.status(400).send({ error: { message: 'OAuth session expired' } })
            }
            await redis.del(`oauth:${state}`)

            const savedState = JSON.parse(oauthState) as {
                projectId: string
                provider: 'google' | 'github'
                redirectTo: string
            }
            if (savedState.projectId !== projectId || savedState.provider !== provider) {
                return reply.status(400).send({ error: { message: 'OAuth state mismatch' } })
            }

            const trustedRedirect = resolveTrustedRedirect(savedState.redirectTo, dashboardUrl)
            if (!trustedRedirect) {
                return reply.status(400).send({ error: { message: 'Invalid redirect target' } })
            }

            const identity = await exchangeOAuthCode(
                provider,
                code,
                `${apiPublicUrl}/api/v1/${projectId}/auth/oauth/${provider}/callback`,
                oauthConfig
            )

            return projectService.withProjectStorage(projectId, async (project, providerInstance) => {
                const result = await authService.signInWithOAuth(
                    project.id,
                    project.usersChannel,
                    providerInstance,
                    getIndexManager(project.id),
                    provider,
                    identity
                )

                setProjectAuthCookies(reply, project.id, apiPublicUrl, result.session)
                await recordProjectSecurityEvent(operationsLogService, project.id, 'success', 'OAuth sign-in completed', {
                    action: 'auth.oauth.signin',
                    provider,
                    userId: result.user.id,
                    email: result.user.email,
                })
                return reply.redirect(buildProjectAuthRedirect(trustedRedirect, project.id))
            })
        }
    )

    app.post<{ Params: { projectId: string } }>(
        '/api/v1/:projectId/auth/mfa/totp/enroll',
        { preHandler: [authMiddleware] },
        async (request, reply) => {
            const project = await assertRouteProjectUser(projectService, projectAccessService, authService, request)

            return projectService.withProjectStorageRecord(project, async (_project, provider) => {
                const { enrollmentToken, secret, uri } = await authService.beginTotpEnrollment(
                    project.id,
                    project.usersChannel,
                    request.user!.sub!,
                    provider,
                    getIndexManager(project.id)
                )

                await recordProjectSecurityEvent(operationsLogService, project.id, 'info', 'MFA enrollment started', {
                    action: 'auth.mfa.enroll.start',
                    userId: request.user!.sub!,
                })

                return reply.send({ data: { enrollment_token: enrollmentToken, secret, uri } })
            })
        }
    )

    app.post<{ Params: { projectId: string } }>(
        '/api/v1/:projectId/auth/mfa/totp/verify',
        { preHandler: [authMiddleware] },
        async (request, reply) => {
            const project = await assertRouteProjectUser(projectService, projectAccessService, authService, request)
            const body = totpVerifySchema.parse(request.body)

            return projectService.withProjectStorageRecord(project, async (_project, provider) => {
                await authService.verifyTotpEnrollment(
                    body.enrollment_token,
                    body.code,
                    project.usersChannel,
                    provider,
                    getIndexManager(project.id)
                )

                await recordProjectSecurityEvent(operationsLogService, project.id, 'success', 'MFA enrollment verified', {
                    action: 'auth.mfa.enroll.verify',
                    userId: request.user!.sub!,
                })

                return reply.send({ data: { enabled: true } })
            })
        }
    )

    app.post<{ Params: { projectId: string } }>(
        '/api/v1/:projectId/auth/mfa/totp/challenge',
        async (request, reply) => {
            const body = totpChallengeSchema.parse(request.body)
            const session = await authService.verifyTotpChallenge(body.challenge_token, body.code)
            await recordProjectSecurityEvent(operationsLogService, request.params.projectId, 'success', 'MFA challenge completed', {
                action: 'auth.mfa.challenge.verify',
            })
            return reply.send({ data: { session } })
        }
    )

    app.get<{ Params: { projectId: string } }>(
        '/api/v1/:projectId/auth/user',
        { preHandler: [authMiddleware] },
        async (request, reply) => {
            const project = await assertRouteProjectUser(projectService, projectAccessService, authService, request)

            return projectService.withProjectStorageRecord(project, async (_project, provider) => {
                const user = await authService.getUser(
                    project.usersChannel,
                    request.user!.sub!,
                    provider,
                    getIndexManager(project.id)
                )

                if (!user) {
                    return reply.status(404).send({ error: { message: 'User not found' } })
                }

                return reply.send({ data: user })
            })
        }
    )

    app.get<{ Params: { projectId: string } }>(
        '/api/v1/:projectId/auth/users',
        { preHandler: [authMiddleware] },
        async (request, reply) => {
            const project = await assertRouteProjectPermission(projectService, projectAccessService, authService, request, {
                permission: 'auth.read',
                allowProjectUsers: false,
            })

            return projectService.withProjectStorageRecord(project, async (_project, provider) => {
                const users = await authService.listUsers(
                    project.usersChannel,
                    provider,
                    getIndexManager(project.id)
                )

                return reply.send({ data: users })
            })
        }
    )

    app.post<{ Params: { projectId: string } }>(
        '/api/v1/:projectId/auth/users',
        { preHandler: [authMiddleware] },
        async (request, reply) => {
            const project = await assertRouteProjectPermission(projectService, projectAccessService, authService, request, {
                permission: 'auth.manage',
                allowProjectUsers: false,
            })
            const body = adminCreateUserSchema.parse(request.body)

            return projectService.withProjectStorageRecord(project, async (_project, provider) => {
                const user = await authService.createManagedUser(
                    project.usersChannel,
                    body.email,
                    body.password,
                    provider,
                    getIndexManager(project.id),
                    body.metadata
                )

                await recordProjectSecurityEvent(operationsLogService, project.id, 'success', 'Auth user created by admin', {
                    action: 'auth.admin.create_user',
                    userId: user.id,
                    email: user.email,
                    actorUserId: request.user!.sub,
                })

                return reply.status(201).send({ data: user })
            })
        }
    )

    app.patch<{ Params: { projectId: string; userId: string } }>(
        '/api/v1/:projectId/auth/users/:userId',
        { preHandler: [authMiddleware] },
        async (request, reply) => {
            const project = await assertRouteProjectPermission(projectService, projectAccessService, authService, request, {
                permission: 'auth.manage',
                allowProjectUsers: false,
            })
            const body = updateUserSchema.parse(request.body)

            return projectService.withProjectStorageRecord(project, async (_project, provider) => {
                const user = await authService.updateUserState(
                    project.id,
                    project.usersChannel,
                    request.params.userId,
                    provider,
                    getIndexManager(project.id),
                    {
                        disabled_at: body.disabled ? new Date().toISOString() : body.disabled === false ? null : undefined,
                        disabled_reason: body.disabled ? body.reason || 'Disabled by project administrator' : body.disabled === false ? null : undefined,
                    }
                )

                await recordProjectSecurityEvent(operationsLogService, project.id, body.disabled ? 'warning' : 'success', 'Auth user state updated', {
                    action: body.disabled ? 'auth.admin.disable_user' : 'auth.admin.enable_user',
                    userId: request.params.userId,
                    actorUserId: request.user!.sub,
                })

                return reply.send({ data: user })
            })
        }
    )

    app.post<{ Params: { projectId: string; userId: string } }>(
        '/api/v1/:projectId/auth/users/:userId/confirm',
        { preHandler: [authMiddleware] },
        async (request, reply) => {
            const project = await assertRouteProjectPermission(projectService, projectAccessService, authService, request, {
                permission: 'auth.manage',
                allowProjectUsers: false,
            })

            return projectService.withProjectStorageRecord(project, async (_project, provider) => {
                const user = await authService.updateUserState(
                    project.id,
                    project.usersChannel,
                    request.params.userId,
                    provider,
                    getIndexManager(project.id),
                    { confirmed_at: new Date().toISOString() }
                )

                await recordProjectSecurityEvent(operationsLogService, project.id, 'success', 'Auth user confirmed by admin', {
                    action: 'auth.admin.confirm_user',
                    userId: request.params.userId,
                    actorUserId: request.user!.sub,
                })

                return reply.send({ data: user })
            })
        }
    )

    app.post<{ Params: { projectId: string; userId: string } }>(
        '/api/v1/:projectId/auth/users/:userId/revoke-sessions',
        { preHandler: [authMiddleware] },
        async (request, reply) => {
            await assertRouteProjectPermission(projectService, projectAccessService, authService, request, {
                permission: 'auth.manage',
                allowProjectUsers: false,
            })
            await authService.revokeUserSessions(request.params.projectId, request.params.userId)
            await recordProjectSecurityEvent(operationsLogService, request.params.projectId, 'warning', 'Auth user sessions revoked', {
                action: 'auth.admin.revoke_sessions',
                userId: request.params.userId,
                actorUserId: request.user!.sub,
            })
            return reply.send({ data: { message: 'Sessions revoked' } })
        }
    )

    app.post<{ Params: { projectId: string; userId: string } }>(
        '/api/v1/:projectId/auth/users/:userId/password-reset',
        { preHandler: [authMiddleware] },
        async (request, reply) => {
            const project = await assertRouteProjectPermission(projectService, projectAccessService, authService, request, {
                permission: 'auth.manage',
                allowProjectUsers: false,
            })

            return projectService.withProjectStorageRecord(project, async (_project, provider) => {
                const user = await authService.getUser(
                    project.usersChannel,
                    request.params.userId,
                    provider,
                    getIndexManager(project.id)
                )

                if (!user) {
                    return reply.status(404).send({ error: { message: 'User not found' } })
                }

                try {
                    await authService.requestPasswordReset(user.email, project.id, sendEmail, dashboardUrl)
                } catch (error) {
                    return reply.status(503).send({
                        error: {
                            message: (error as Error).message || 'Password reset email delivery is not configured',
                            code: 'PASSWORD_RESET_NOT_CONFIGURED',
                        },
                    })
                }

                await recordProjectSecurityEvent(operationsLogService, project.id, 'info', 'Admin-triggered password reset issued', {
                    action: 'auth.admin.password_reset',
                    userId: request.params.userId,
                    email: user.email,
                    actorUserId: request.user!.sub,
                })

                return reply.send({ data: { message: 'Password reset sent' } })
            })
        }
    )

    app.post<{ Params: { projectId: string } }>(
        '/api/v1/:projectId/auth/mfa/totp/disable',
        { preHandler: [authMiddleware] },
        async (request, reply) => {
            const project = await assertRouteProjectUser(projectService, projectAccessService, authService, request)

            return projectService.withProjectStorageRecord(project, async (_project, provider) => {
                const user = await authService.updateUserState(
                    project.id,
                    project.usersChannel,
                    request.user!.sub!,
                    provider,
                    getIndexManager(project.id),
                    {
                        totp_enabled: false,
                        totp_secret_encrypted: null,
                    }
                )

                await recordProjectSecurityEvent(operationsLogService, project.id, 'warning', 'User MFA disabled', {
                    action: 'auth.mfa.disable',
                    userId: request.user!.sub,
                })

                return reply.send({ data: user })
            })
        }
    )

    app.post<{ Params: { projectId: string; userId: string } }>(
        '/api/v1/:projectId/auth/users/:userId/mfa/totp/disable',
        { preHandler: [authMiddleware] },
        async (request, reply) => {
            const project = await assertRouteProjectPermission(projectService, projectAccessService, authService, request, {
                permission: 'auth.manage',
                allowProjectUsers: false,
            })

            return projectService.withProjectStorageRecord(project, async (_project, provider) => {
                const user = await authService.updateUserState(
                    project.id,
                    project.usersChannel,
                    request.params.userId,
                    provider,
                    getIndexManager(project.id),
                    {
                        totp_enabled: false,
                        totp_secret_encrypted: null,
                    }
                )

                await recordProjectSecurityEvent(operationsLogService, project.id, 'warning', 'Admin disabled user MFA', {
                    action: 'auth.admin.mfa.disable',
                    userId: request.params.userId,
                    actorUserId: request.user!.sub,
                })

                return reply.send({ data: user })
            })
        }
    )

    app.delete<{ Params: { projectId: string; userId: string } }>(
        '/api/v1/:projectId/auth/users/:userId',
        { preHandler: [authMiddleware] },
        async (request, reply) => {
            const project = await assertRouteProjectPermission(projectService, projectAccessService, authService, request, {
                permission: 'auth.manage',
                allowProjectUsers: false,
            })

            return projectService.withProjectStorageRecord(project, async (_project, provider) => {
                await authService.deleteUser(
                    project.id,
                    project.usersChannel,
                    request.params.userId,
                    provider,
                    getIndexManager(project.id)
                )

                await recordProjectSecurityEvent(operationsLogService, project.id, 'warning', 'Auth user deleted', {
                    action: 'auth.admin.delete_user',
                    userId: request.params.userId,
                    actorUserId: request.user!.sub,
                })

                return reply.send({ data: { message: 'User deleted' } })
            })
        }
    )
}

async function exchangeOAuthCode(
    provider: 'google' | 'github',
    code: string,
    callbackUrl: string,
    oauthConfig: OAuthConfig
): Promise<{ providerUserId: string; email: string; metadata?: Record<string, unknown> }> {
    if (provider === 'google') {
        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code,
                client_id: oauthConfig.google.clientId || '',
                client_secret: oauthConfig.google.clientSecret || '',
                redirect_uri: callbackUrl,
                grant_type: 'authorization_code',
            }),
        })

        const tokenJson = await tokenResponse.json() as { access_token?: string }
        const userResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
            headers: { Authorization: `Bearer ${tokenJson.access_token}` },
        })
        const profile = await userResponse.json() as { sub: string; email: string; name?: string; picture?: string }

        return {
            providerUserId: profile.sub,
            email: profile.email,
            metadata: { name: profile.name, avatar_url: profile.picture },
        }
    }

    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        },
        body: JSON.stringify({
            code,
            client_id: oauthConfig.github.clientId,
            client_secret: oauthConfig.github.clientSecret,
            redirect_uri: callbackUrl,
        }),
    })

    const tokenJson = await tokenResponse.json() as { access_token?: string }
    const userResponse = await fetch('https://api.github.com/user', {
        headers: {
            Authorization: `Bearer ${tokenJson.access_token}`,
            'User-Agent': 'OpenBase',
        },
    })
    const userProfile = await userResponse.json() as {
        id: number
        login: string
        name?: string
        avatar_url?: string
        email?: string | null
    }
    let email = userProfile.email || ''

    if (!email) {
        const emailResponse = await fetch('https://api.github.com/user/emails', {
            headers: {
                Authorization: `Bearer ${tokenJson.access_token}`,
                'User-Agent': 'OpenBase',
            },
        })
        const emails = await emailResponse.json() as Array<{ email: string; primary: boolean }>
        email = emails.find(candidate => candidate.primary)?.email || emails[0]?.email || ''
    }

    return {
        providerUserId: String(userProfile.id),
        email,
        metadata: {
            username: userProfile.login,
            name: userProfile.name,
            avatar_url: userProfile.avatar_url,
        },
    }
}

function resolveTrustedRedirect(redirectTo: string | undefined, dashboardUrl: string): URL | null {
    const trustedOrigin = new URL(dashboardUrl).origin
    const fallback = new URL('/auth/callback', dashboardUrl)

    if (!redirectTo) {
        return fallback
    }

    try {
        const candidate = new URL(redirectTo)
        if (candidate.origin !== trustedOrigin) {
            return null
        }

        return candidate
    } catch {
        return null
    }
}

function buildProjectAuthRedirect(redirectTo: URL, projectId: string): string {
    const redirect = new URL(redirectTo.toString())
    redirect.searchParams.delete('access_token')
    redirect.searchParams.delete('refresh_token')
    redirect.searchParams.set('projectId', projectId)
    redirect.searchParams.set('type', 'project_auth')
    return redirect.toString()
}

function setProjectAuthCookies(
    reply: FastifyReply,
    projectId: string,
    apiPublicUrl: string,
    session: { access_token: string; refresh_token?: string }
): void {
    const secure = new URL(apiPublicUrl).protocol === 'https:'
    const path = `/api/v1/${projectId}/`
    const cookies = [
        serializeCookie(ACCESS_TOKEN_COOKIE, session.access_token, {
            httpOnly: true,
            maxAge: ACCESS_TOKEN_TTL_SECONDS,
            path,
            sameSite: 'Lax',
            secure,
        }),
    ]

    if (session.refresh_token) {
        cookies.push(
            serializeCookie(REFRESH_TOKEN_COOKIE, session.refresh_token, {
                httpOnly: true,
                maxAge: REFRESH_TOKEN_TTL_SECONDS,
                path,
                sameSite: 'Lax',
                secure,
            })
        )
    }

    reply.header('Set-Cookie', cookies)
}

function clearProjectAuthCookies(
    reply: FastifyReply,
    projectId: string,
    apiPublicUrl: string
): void {
    const secure = new URL(apiPublicUrl).protocol === 'https:'
    const path = `/api/v1/${projectId}/`

    reply.header('Set-Cookie', [
        serializeCookie(ACCESS_TOKEN_COOKIE, '', {
            httpOnly: true,
            maxAge: 0,
            path,
            sameSite: 'Lax',
            secure,
        }),
        serializeCookie(REFRESH_TOKEN_COOKIE, '', {
            httpOnly: true,
            maxAge: 0,
            path,
            sameSite: 'Lax',
            secure,
        }),
    ])
}

function serializeCookie(
    name: string,
    value: string,
    options: {
        httpOnly?: boolean
        maxAge: number
        path: string
        sameSite: 'Lax' | 'Strict' | 'None'
        secure: boolean
    }
): string {
    const parts = [
        `${name}=${encodeURIComponent(value)}`,
        `Path=${options.path}`,
        `Max-Age=${options.maxAge}`,
        `SameSite=${options.sameSite}`,
    ]

    if (options.httpOnly) {
        parts.push('HttpOnly')
    }

    if (options.secure) {
        parts.push('Secure')
    }

    return parts.join('; ')
}

function getCookieValue(request: FastifyRequest, name: string): string | undefined {
    const header = request.headers.cookie
    if (!header) {
        return undefined
    }

    for (const part of header.split(';')) {
        const [rawKey, ...rawValue] = part.trim().split('=')
        if (rawKey === name) {
            return decodeURIComponent(rawValue.join('='))
        }
    }

    return undefined
}

async function recordProjectSecurityEvent(
    operationsLogService: OperationsLogService,
    projectId: string,
    level: 'info' | 'success' | 'warning' | 'error',
    message: string,
    metadata: Record<string, unknown>
): Promise<void> {
    await operationsLogService.record({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        projectId,
        scope: 'security',
        level,
        message,
        metadata,
        timestamp: new Date().toISOString(),
    })
}
