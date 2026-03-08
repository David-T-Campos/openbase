/**
 * @openbase/core — Custom error classes
 */

/** Base error class for all OpenBase errors */
export class OpenBaseError extends Error {
    public readonly code: string
    public readonly statusCode: number

    constructor(message: string, code: string, statusCode: number = 500) {
        super(message)
        this.name = 'OpenBaseError'
        this.code = code
        this.statusCode = statusCode
        Object.setPrototypeOf(this, new.target.prototype)
    }
}

/** Authentication errors */
export class AuthError extends OpenBaseError {
    constructor(message: string, code: string = 'AUTH_ERROR') {
        super(message, code, 401)
        this.name = 'AuthError'
    }
}

/** Resource not found */
export class NotFoundError extends OpenBaseError {
    constructor(resource: string) {
        super(`${resource} not found`, 'NOT_FOUND', 404)
        this.name = 'NotFoundError'
    }
}

/** Validation errors */
export class ValidationError extends OpenBaseError {
    public readonly details: Record<string, string>[]

    constructor(message: string, details: Record<string, string>[] = []) {
        super(message, 'VALIDATION_ERROR', 400)
        this.name = 'ValidationError'
        this.details = details
    }
}

/** Rate limit exceeded */
export class RateLimitError extends OpenBaseError {
    public readonly retryAfter: number

    constructor(retryAfter: number = 60) {
        super('Rate limit exceeded', 'RATE_LIMIT', 429)
        this.name = 'RateLimitError'
        this.retryAfter = retryAfter
    }
}

/** Forbidden — authorization failure */
export class ForbiddenError extends OpenBaseError {
    constructor(message: string = 'Forbidden') {
        super(message, 'FORBIDDEN', 403)
        this.name = 'ForbiddenError'
    }
}

/** Conflict — duplicate resource */
export class ConflictError extends OpenBaseError {
    constructor(message: string = 'Resource already exists') {
        super(message, 'CONFLICT', 409)
        this.name = 'ConflictError'
    }
}

/** Storage provider errors */
export class StorageProviderError extends OpenBaseError {
    constructor(message: string) {
        super(message, 'STORAGE_PROVIDER_ERROR', 502)
        this.name = 'StorageProviderError'
    }
}

/** All workers on cooldown */
export class WorkerPoolExhaustedError extends OpenBaseError {
    constructor() {
        super('All workers on cooldown. Please try again shortly.', 'WORKER_POOL_EXHAUSTED', 503)
        this.name = 'WorkerPoolExhaustedError'
    }
}
