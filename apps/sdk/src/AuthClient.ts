/**
 * AuthClient — Client-side authentication operations
 */

import { authResultSchema, authSessionSchema, authUserSchema } from '@openbase/core'
import { z } from 'zod'
import type { AuthResult } from './types.js'
import { parseApiEnvelope } from './http.js'

type AuthError = { message: string }
type AuthStateEvent = 'INITIAL_SESSION' | 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED'
type AuthStateListener = (event: AuthStateEvent, session: AuthResult['session'] | null) => void
type PasswordSignInResult = AuthResult | {
    mfa_required: true
    challenge_token: string
    user: AuthResult['user']
}
type SignUpResult = AuthResult | {
    user: AuthResult['user']
    confirmation_required: true
}

const messageSchema = z.object({
    message: z.string(),
})

const passwordSignInSchema = z.union([
    authResultSchema,
    z.object({
        mfa_required: z.literal(true),
        challenge_token: z.string(),
        user: authUserSchema,
    }),
])

const signUpSchema = z.union([
    authResultSchema,
    z.object({
        user: authUserSchema,
        confirmation_required: z.literal(true),
    }),
])

const sessionEnvelopeSchema = z.object({
    session: authSessionSchema,
})

export class AuthClient {
    private accessToken: string | null = null
    private refreshToken: string | null = null
    private listeners = new Set<AuthStateListener>()
    readonly mfa = {
        enroll: async () => {
            return this.request<{ enrollment_token: string; secret: string; uri: string }>('/auth/mfa/totp/enroll', {
                useAccessToken: true,
                schema: z.object({
                    enrollment_token: z.string(),
                    secret: z.string(),
                    uri: z.string(),
                }),
            })
        },
        verify: async (payload: { enrollment_token: string; code: string }) => {
            return this.request<{ enabled: boolean }>('/auth/mfa/totp/verify', {
                useAccessToken: true,
                body: payload,
                schema: z.object({ enabled: z.boolean() }),
            })
        },
        disable: async () => {
            return this.request<AuthResult['user']>('/auth/mfa/totp/disable', {
                useAccessToken: true,
                schema: authUserSchema,
            })
        },
    }

    constructor(
        private readonly projectUrl: string,
        private readonly projectId: string,
        private readonly apiKey: string
    ) { }

    /** Sign up with email and password */
    async signUp(credentials: {
        email: string
        password: string
        metadata?: Record<string, unknown>
    }): Promise<{ data: SignUpResult | null; error: AuthError | null }> {
        const result = await this.request<SignUpResult>('/auth/signup', {
            body: credentials,
            schema: signUpSchema,
        })

        if (result.data && 'session' in result.data && result.data.session) {
            this.setSession(result.data.session, 'SIGNED_IN')
        }

        return result
    }

    /** Sign in with email and password */
    async signInWithPassword(credentials: {
        email: string
        password: string
        mfa_code?: string
    }): Promise<{ data: PasswordSignInResult | null; error: AuthError | null }> {
        const result = await this.request<PasswordSignInResult>('/auth/signin', {
            body: credentials,
            schema: passwordSignInSchema,
        })

        if (result.data && 'session' in result.data && result.data.session) {
            this.setSession(result.data.session, 'SIGNED_IN')
        }

        return result
    }

    /** Backwards-compatible alias for password sign-in. */
    async signIn(credentials: {
        email: string
        password: string
        mfa_code?: string
    }): Promise<{ data: PasswordSignInResult | null; error: AuthError | null }> {
        return this.signInWithPassword(credentials)
    }

    /** Send a magic link email */
    async signInWithOtp(options: {
        email: string
    }): Promise<{ data: null; error: AuthError | null }> {
        const result = await this.request<{ message: string }>('/auth/magic-link', {
            body: { email: options.email },
            schema: messageSchema,
        })

        return {
            data: null,
            error: result.error,
        }
    }

    async confirmEmail(token: string): Promise<{ data: AuthResult | null; error: AuthError | null }> {
        const result = await this.request<AuthResult>('/auth/confirm', {
            body: { token },
            schema: authResultSchema,
        })

        if (result.data?.session) {
            this.setSession(result.data.session, 'SIGNED_IN')
        }

        return result
    }

    async resetPasswordForEmail(options: {
        email: string
    }): Promise<{ data: null; error: AuthError | null }> {
        const result = await this.request<{ message: string }>('/auth/password-reset/request', {
            body: options,
            schema: messageSchema,
        })

        return {
            data: null,
            error: result.error,
        }
    }

    async updatePassword(options: {
        token: string
        password: string
    }): Promise<{ data: AuthResult | null; error: AuthError | null }> {
        const result = await this.request<AuthResult>('/auth/password-reset/confirm', {
            body: options,
            schema: authResultSchema,
        })

        if (result.data?.session) {
            this.setSession(result.data.session, 'SIGNED_IN')
        }

        return result
    }

    /** Sign out */
    async signOut(): Promise<{ error: AuthError | null }> {
        if (!this.refreshToken) {
            this.clearSession()
            return { error: null }
        }

        const result = await this.request<{ message: string }>('/auth/signout', {
            body: { refresh_token: this.refreshToken },
            schema: messageSchema,
        })

        if (result.error) {
            return { error: result.error }
        }

        this.clearSession()
        return { error: null }
    }

    /** Get the current session */
    async getSession(): Promise<{
        data: { session: AuthResult['session'] | null }
        error: null
    }> {
        return {
            data: {
                session: this.accessToken
                    ? {
                        access_token: this.accessToken,
                        refresh_token: this.refreshToken || undefined,
                    }
                    : null,
            },
            error: null,
        }
    }

    /** Get the current user */
    async getUser(): Promise<{
        data: { user: AuthResult['user'] | null }
        error: AuthError | null
    }> {
        if (!this.accessToken) {
            return { data: { user: null }, error: { message: 'Not authenticated' } }
        }

        const result = await this.request<AuthResult['user']>('/auth/user', {
            method: 'GET',
            useAccessToken: true,
            schema: authUserSchema,
        })

        return {
            data: { user: result.data || null },
            error: result.error,
        }
    }

    /** Refresh the session */
    async refreshSession(): Promise<{
        data: { session: AuthResult['session'] | null }
        error: AuthError | null
    }> {
        if (!this.refreshToken) {
            return { data: { session: null }, error: { message: 'No refresh token' } }
        }

        const result = await this.request<{ session: AuthResult['session'] }>('/auth/refresh', {
            body: { refresh_token: this.refreshToken },
            schema: sessionEnvelopeSchema,
        })

        const session = result.data?.session || null
        if (session) {
            this.setSession(session, 'TOKEN_REFRESHED')
        }

        return {
            data: { session },
            error: result.error,
        }
    }

    /** Listen for auth state changes */
    onAuthStateChange(
        callback: AuthStateListener
    ): { data: { subscription: { unsubscribe: () => void } } } {
        this.listeners.add(callback)
        callback('INITIAL_SESSION', this.accessToken ? {
            access_token: this.accessToken,
            refresh_token: this.refreshToken || undefined,
        } : null)

        return {
            data: {
                subscription: {
                    unsubscribe: () => {
                        this.listeners.delete(callback)
                    },
                },
            },
        }
    }

    /** Get the current access token */
    getAccessToken(): string | null {
        return this.accessToken
    }

    private setSession(session: AuthResult['session'], event: AuthStateEvent): void {
        this.accessToken = session.access_token
        this.refreshToken = session.refresh_token || null
        this.emit(event, session)
    }

    private clearSession(): void {
        this.accessToken = null
        this.refreshToken = null
        this.emit('SIGNED_OUT', null)
    }

    private emit(event: AuthStateEvent, session: AuthResult['session'] | null): void {
        for (const listener of this.listeners) {
            listener(event, session)
        }
    }

    private async request<T>(
        path: string,
        options: {
            method?: 'GET' | 'POST'
            body?: unknown
            useAccessToken?: boolean
            schema: z.ZodType<T>
        }
    ): Promise<{ data: T | null; error: AuthError | null }> {
        try {
            const fetchFn = typeof globalThis.fetch !== 'undefined' ? globalThis.fetch : (await import('cross-fetch')).default
            const headers: Record<string, string> = {
                apikey: this.apiKey,
            }

            if (options.body !== undefined) {
                headers['Content-Type'] = 'application/json'
            }

            if (options.useAccessToken && this.accessToken) {
                headers.Authorization = `Bearer ${this.accessToken}`
            }

            const response = await fetchFn(
                `${this.projectUrl}/api/v1/${this.projectId}${path}`,
                {
                    method: options.method || 'POST',
                    headers,
                    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
                }
            )

            const result = await parseApiEnvelope(response, options.schema)
            return {
                data: result.data as T | null,
                error: result.error ? { message: result.error.message } : null,
            }
        } catch (error) {
            return {
                data: null,
                error: { message: (error as Error).message },
            }
        }
    }
}
