/**
 * SDK Types
 */

/** Result from any SDK operation */
export interface QueryResult<T = Record<string, unknown>> {
    data: T | T[] | null
    error: { message: string; code?: string } | null
    count?: number
}

/** Auth result */
export interface AuthResult {
    user: {
        id: string
        email: string
        role?: string
        metadata?: Record<string, unknown>
        identities?: Array<{
            provider: 'email' | 'google' | 'github'
            providerUserId: string
            email?: string
            linkedAt: string
        }>
        totp_enabled?: boolean
    }
    session: {
        access_token: string
        refresh_token?: string
        expires_at?: number
    }
}

/** Realtime payload */
export interface RealtimePayload<T = Record<string, unknown>> {
    schema: string
    table: string
    commit_timestamp: string
    eventType: 'INSERT' | 'UPDATE' | 'DELETE' | '*'
    new: T | null
    old: T | null
}

/** Realtime subscription */
export interface RealtimeSubscription {
    unsubscribe: () => void
}

/** Query filter */
export interface QueryFilter {
    column: string
    operator: string
    value: unknown
}

export interface UpsertOptions {
    onConflict?: string | string[]
}

/** Upload options */
export interface UploadOptions {
    contentType?: string
    upsert?: boolean
}

/** Transform options */
export interface TransformOptions {
    width?: number
    height?: number
    format?: 'webp' | 'png' | 'jpeg' | 'avif'
    quality?: number
}
