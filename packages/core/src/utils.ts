/**
 * @openbase/core — Shared utility functions
 */

import { randomUUID, randomBytes } from 'crypto'

/**
 * Generate a new UUID v4
 */
export function generateId(): string {
    return randomUUID()
}

/**
 * Generate a cryptographically secure random hex string
 */
export function generateSecret(length: number = 32): string {
    return randomBytes(length).toString('hex')
}

/**
 * Create a timestamp in ISO 8601 format
 */
export function nowISO(): string {
    return new Date().toISOString()
}

/**
 * Safe JSON parse — returns null on failure instead of throwing
 */
export function safeJsonParse<T = unknown>(text: string): T | null {
    try {
        return JSON.parse(text) as T
    } catch {
        return null
    }
}

/**
 * Sleep for the given number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Clamp a number between min and max
 */
export function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max)
}

/**
 * Pick specific keys from an object
 */
export function pick<T extends Record<string, unknown>, K extends keyof T>(
    obj: T,
    keys: K[]
): Pick<T, K> {
    const result = {} as Pick<T, K>
    for (const key of keys) {
        if (key in obj) {
            result[key] = obj[key]
        }
    }
    return result
}

/**
 * Omit specific keys from an object
 */
export function omit<T extends Record<string, unknown>, K extends keyof T>(
    obj: T,
    keys: K[]
): Omit<T, K> {
    const result = { ...obj }
    for (const key of keys) {
        delete result[key]
    }
    return result as Omit<T, K>
}

/**
 * Retry an async operation with exponential backoff
 */
export async function retry<T>(
    fn: () => Promise<T>,
    options: { maxAttempts?: number; baseDelay?: number; maxDelay?: number } = {}
): Promise<T> {
    const { maxAttempts = 3, baseDelay = 1000, maxDelay = 30000 } = options
    let lastError: Error | undefined

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            return await fn()
        } catch (error) {
            lastError = error as Error
            if (attempt < maxAttempts - 1) {
                const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay)
                await sleep(delay + Math.random() * 1000)
            }
        }
    }

    throw lastError
}

/**
 * Chunk an array into smaller arrays of the specified size
 */
export function chunk<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = []
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size))
    }
    return chunks
}

/**
 * Sanitize a string for safe use as a channel/table name
 */
export function sanitizeName(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .replace(/__+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 64)
}

/**
 * Deep freeze an object to prevent mutations
 */
export function deepFreeze<T extends Record<string, unknown>>(obj: T): Readonly<T> {
    Object.freeze(obj)
    for (const value of Object.values(obj)) {
        if (value && typeof value === 'object' && !Object.isFrozen(value)) {
            deepFreeze(value as Record<string, unknown>)
        }
    }
    return obj
}
