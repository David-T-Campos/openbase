/**
 * AuthClient — Client-side authentication operations
 */

import type { AuthResult } from './types.js'

type AuthError = { message: string }
type AuthStateEvent = 'INITIAL_SESSION' | 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED'
type AuthStateListener = (event: AuthStateEvent, session: AuthResult['session'] | null) => void
type PasswordSignInResult = AuthResult | {
    mfa_required: true
    challenge_token: string
    user: AuthResult['user']
}

export class AuthClient {
    private accessToken: string | null = null
    private refreshToken: string | null = null
    private listeners = new Set<AuthStateListener>()

    constructor(
        private projectUrl: string,
        private projectId: string,
        private apiKey: string
    ) { }

    /** Sign up with email and password */
    async signUp(credentials: {
        email: string
        password: string
        metadata?: Record<string, unknown>
    }): Promise<{ data: AuthResult | null; error: AuthError | null }> {
        const result = await this.request<AuthResult>('/auth/signup', {
            body: credentials,
        })

        if (result.data?.session) {
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
        })

        if (result.data && 'session' in result.data && result.data.session) {
            this.setSession(result.data.session, 'SIGNED_IN')
        }

        return result
    }

    /** Send a magic link email */
    async signInWithOtp(options: {
        email: string
    }): Promise<{ data: null; error: AuthError | null }> {
        const result = await this.request<{ data: { message: string } }>('/auth/magic-link', {
            body: { email: options.email },
        })

        return {
            data: null,
            error: result.error,
        }
    }

    /** Sign out */
    async signOut(): Promise<{ error: AuthError | null }> {
        if (!this.refreshToken) {
            this.clearSession()
            return { error: null }
        }

        const result = await this.request<{ data: { message: string } }>('/auth/signout', {
            body: { refresh_token: this.refreshToken },
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

        const result = await this.request<{ data?: AuthResult['user'] }>('/auth/user', {
            method: 'GET',
            useAccessToken: true,
        })

        return {
            data: { user: result.data?.data || null },
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

        const result = await this.request<{ data?: { session?: AuthResult['session'] } }>('/auth/refresh', {
            body: { refresh_token: this.refreshToken },
        })

        const session = result.data?.data?.session || null
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
        } = {}
    ): Promise<{ data: T | null; error: AuthError | null }> {
        try {
            const fetchFn = typeof globalThis.fetch !== 'undefined' ? globalThis.fetch : (await import('cross-fetch')).default
            const headers: Record<string, string> = {
                'apikey': this.apiKey,
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

            const json = await response.json() as T & { error?: AuthError }

            if (!response.ok) {
                return {
                    data: null,
                    error: json.error || { message: `HTTP ${response.status}` },
                }
            }

            return { data: json as T, error: null }
        } catch (error) {
            return {
                data: null,
                error: { message: (error as Error).message },
            }
        }
    }
}
