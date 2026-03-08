/**
 * RLS Middleware — Unit Tests
 */

import { describe, it, expect } from 'vitest'
import { applyRLS, findPolicy } from '../middleware/rls.js'
import type { JWTPayload, RLSPolicy } from '@openbase/core'

describe('RLS Middleware', () => {
    const testUser: JWTPayload = {
        sub: 'user-123',
        email: 'alice@test.com',
        role: 'authenticated',
        projectId: 'proj-1',
    }

    const rows = [
        { id: '1', user_id: 'user-123', title: 'Alice post' },
        { id: '2', user_id: 'user-456', title: 'Bob post' },
        { id: '3', user_id: 'user-123', title: 'Alice post 2' },
    ]

    describe('applyRLS', () => {
        it('should return all rows when no policy', () => {
            const result = applyRLS(rows, undefined, testUser)
            expect(result).toHaveLength(3)
        })

        it('should filter by user_id = auth.uid()', () => {
            const policy: RLSPolicy = { operation: 'SELECT', check: 'user_id = auth.uid()' }
            const result = applyRLS(rows, policy, testUser)
            expect(result).toHaveLength(2)
            expect(result.every(r => r.user_id === 'user-123')).toBe(true)
        })

        it('should return no rows for anonymous user', () => {
            const policy: RLSPolicy = { operation: 'SELECT', check: 'user_id = auth.uid()' }
            const result = applyRLS(rows, policy, null)
            expect(result).toHaveLength(0)
        })

        it('should handle "true" policy — all access', () => {
            const policy: RLSPolicy = { operation: 'SELECT', check: 'true' }
            const result = applyRLS(rows, policy, null)
            expect(result).toHaveLength(3)
        })

        it('should handle "false" policy — no access', () => {
            const policy: RLSPolicy = { operation: 'SELECT', check: 'false' }
            const result = applyRLS(rows, policy, testUser)
            expect(result).toHaveLength(0)
        })
    })

    describe('findPolicy', () => {
        const policies: RLSPolicy[] = [
            { operation: 'SELECT', check: 'user_id = auth.uid()' },
            { operation: 'INSERT', check: 'true' },
            { operation: 'DELETE', check: 'user_id = auth.uid()' },
        ]

        it('should find matching policy', () => {
            expect(findPolicy(policies, 'SELECT')?.check).toBe('user_id = auth.uid()')
            expect(findPolicy(policies, 'INSERT')?.check).toBe('true')
        })

        it('should return undefined for missing policy', () => {
            expect(findPolicy(policies, 'UPDATE')).toBeUndefined()
        })

        it('should return undefined for empty/undefined policies', () => {
            expect(findPolicy(undefined, 'SELECT')).toBeUndefined()
            expect(findPolicy([], 'SELECT')).toBeUndefined()
        })
    })
})
