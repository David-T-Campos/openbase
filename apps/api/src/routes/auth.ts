/**
 * Auth Routes — Project authentication endpoints.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify'
import { randomUUID } from 'crypto'
import { z } from 'zod'
import type Redis from 'ioredis'
import { ForbiddenError } from '@openbase/core'
import type { AuthService } from '../auth/AuthService.js'
import type { IndexManager } from '../database/IndexManager.js'
import { authMiddleware } from '../middleware/auth.js'
import type { ProjectService } from '../projects/ProjectService.js'

const signUpSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    metadata: z.record(z.unknown()).optional(),
})

const signInSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
    mfa_code: z.string().optional(),
})

const magicLinkSchema = z.object({
    email: z.string().email(),
})

const refreshSchema = z.object({
    refresh_token: z.string().min(1),
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

interface OAuthConfig {
    google: { enabled: boolean; clientId?: string; clientSecret?: string }
    github: { enabled: boolean; clientId?: string; clientSecret?: string }
}

export function registerAuthRoutes(
    app: FastifyInstance,
    redis: Redis,
    authService: AuthService,
    projectService: ProjectService,
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
                const result = await authService.signUp(
                    project.id,
                    project.usersChannel,
                    body.email,
                    body.password,
                    provider,
                    getIndexManager(project.id),
                    body.metadata
                )

                return reply.status(201).send(result)
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
                    return reply.send({
                        mfa_required: true,
                        challenge_token: result.challengeToken,
                        user: result.user,
                    })
                }

                return reply.send(result)
            })
        }
    )

    app.post<{ Params: { projectId: string } }>(
        '/api/v1/:projectId/auth/signout',
        async (request, reply) => {
            const body = request.body as { refresh_token?: string }
            if (body.refresh_token) {
                await authService.signOut(body.refresh_token)
            }

            return reply.send({ data: { message: 'Signed out' } })
        }
    )

    app.post<{ Params: { projectId: string } }>(
        '/api/v1/:projectId/auth/magic-link',
        async (request, reply) => {
            const { projectId } = request.params
            const body = magicLinkSchema.parse(request.body)

            await authService.sendMagicLink(body.email, projectId, sendEmail, dashboardUrl)
            return reply.send({ data: { message: 'Magic link sent' } })
        }
    )

    app.post<{ Params: { projectId: string } }>(
        '/api/v1/:projectId/auth/refresh',
        async (request, reply) => {
            const body = refreshSchema.parse(request.body)
            const session = await authService.refreshSession(body.refresh_token)
            return reply.send({ data: { session } })
        }
    )

    app.get<{ Params: { projectId: string }; Querystring: { token?: string; type?: string } }>(
        '/api/v1/:projectId/auth/callback',
        async (request, reply) => {
            const { projectId } = request.params
            const { token, type } = request.query as { token?: string; type?: string }

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

                const redirectUrl = new URL('/auth/callback', dashboardUrl)
                redirectUrl.searchParams.set('projectId', project.id)
                redirectUrl.searchParams.set('access_token', result.session.access_token)
                if (result.session.refresh_token) {
                    redirectUrl.searchParams.set('refresh_token', result.session.refresh_token)
                }

                return reply.redirect(redirectUrl.toString())
            })
        }
    )

    app.get<{ Params: { projectId: string } }>(
        '/api/v1/:projectId/auth/providers',
        { preHandler: [authMiddleware] },
        async (request, reply) => {
            await assertProjectAccess(projectService, request)

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

                const state = randomUUID()
                await redis.setex(
                    `oauth:${state}`,
                    600,
                    JSON.stringify({
                    projectId,
                    provider,
                    redirectTo: body.redirectTo || `${dashboardUrl}/auth/callback`,
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

            const savedState = JSON.parse(oauthState) as { projectId: string; provider: 'google' | 'github'; redirectTo: string }
            if (savedState.projectId !== projectId || savedState.provider !== provider) {
                return reply.status(400).send({ error: { message: 'OAuth state mismatch' } })
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

                const redirectUrl = new URL(savedState.redirectTo)
                redirectUrl.searchParams.set('projectId', project.id)
                redirectUrl.searchParams.set('access_token', result.session.access_token)
                if (result.session.refresh_token) {
                    redirectUrl.searchParams.set('refresh_token', result.session.refresh_token)
                }

                return reply.redirect(redirectUrl.toString())
            })
        }
    )

    app.post<{ Params: { projectId: string } }>(
        '/api/v1/:projectId/auth/mfa/totp/enroll',
        { preHandler: [authMiddleware] },
        async (request, reply) => {
            const project = await assertProjectAccess(projectService, request)
            if (!request.user?.sub || request.user.projectId !== project.id) {
                throw new ForbiddenError('A project user session is required')
            }

            return projectService.withProjectStorageRecord(project, async (_project, provider) => {
                const { enrollmentToken, secret, uri } = await authService.beginTotpEnrollment(
                    project.id,
                    project.usersChannel,
                    request.user!.sub!,
                    provider,
                    getIndexManager(project.id)
                )

                return reply.send({ data: { enrollment_token: enrollmentToken, secret, uri } })
            })
        }
    )

    app.post<{ Params: { projectId: string } }>(
        '/api/v1/:projectId/auth/mfa/totp/verify',
        { preHandler: [authMiddleware] },
        async (request, reply) => {
            const project = await assertProjectAccess(projectService, request)
            const body = totpVerifySchema.parse(request.body)

            return projectService.withProjectStorageRecord(project, async (_project, provider) => {
                await authService.verifyTotpEnrollment(
                    body.enrollment_token,
                    body.code,
                    project.usersChannel,
                    provider,
                    getIndexManager(project.id)
                )

                return reply.send({ data: { enabled: true } })
            })
        }
    )

    app.post<{ Params: { projectId: string } }>(
        '/api/v1/:projectId/auth/mfa/totp/challenge',
        async (request, reply) => {
            const body = totpChallengeSchema.parse(request.body)
            const session = await authService.verifyTotpChallenge(body.challenge_token, body.code)
            return reply.send({ data: { session } })
        }
    )

    app.get<{ Params: { projectId: string } }>(
        '/api/v1/:projectId/auth/user',
        { preHandler: [authMiddleware] },
        async (request, reply) => {
            const project = await assertProjectAccess(projectService, request)

            if (!request.user?.sub || request.user.projectId !== project.id) {
                throw new ForbiddenError('A project user session is required')
            }

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
            const project = await assertProjectAdminAccess(projectService, request)

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
}

async function assertProjectAccess(
    projectService: ProjectService,
    request: FastifyRequest<{ Params: Record<string, string> }>
) {
    const project = await projectService.getProject(request.params.projectId)
    const user = request.user

    if (!user) {
        throw new ForbiddenError('Authentication required')
    }

    if (user.role === 'platform_user' && user.sub === project.ownerId) {
        return project
    }

    if (user.projectId === project.id) {
        return project
    }

    throw new ForbiddenError('You do not have access to this project')
}

async function assertProjectAdminAccess(
    projectService: ProjectService,
    request: FastifyRequest<{ Params: Record<string, string> }>
) {
    const project = await assertProjectAccess(projectService, request)

    if (request.user?.role === 'platform_user' || request.user?.role === 'service_role') {
        return project
    }

    throw new ForbiddenError('Administrative access required')
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
    const userProfile = await userResponse.json() as { id: number; login: string; name?: string; avatar_url?: string; email?: string | null }
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
