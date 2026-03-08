/**
 * Row Level Security (RLS) Middleware
 *
 * Filters query results based on RLS policies defined in the table schema.
 * Service role keys bypass RLS entirely.
 */

import type { RLSPolicy, JWTPayload } from '@openbase/core'

/**
 * Apply Row Level Security policies to a set of rows.
 * Returns only the rows that the current user is allowed to see.
 *
 * @param rows - The rows to filter
 * @param policy - The RLS policy for this operation (or undefined for no policy)
 * @param user - The authenticated user's JWT payload (or null for anonymous)
 * @returns Filtered rows
 */
export function applyRLS(
    rows: Record<string, unknown>[],
    policy: RLSPolicy | undefined,
    user: JWTPayload | null
): Record<string, unknown>[] {
    // No policy = all rows visible (for service role key or tables without RLS)
    if (!policy) return rows

    return rows.filter(row => evaluatePolicy(row, policy, user))
}

/**
 * Check if a single row passes the RLS policy.
 */
export function checkRLSForRow(
    row: Record<string, unknown>,
    policy: RLSPolicy | undefined,
    user: JWTPayload | null
): boolean {
    if (!policy) return true
    return evaluatePolicy(row, policy, user)
}

/**
 * Evaluate a single RLS policy check against a row.
 *
 * Supported policy expressions:
 *   - "user_id = auth.uid()"     → row.user_id must equal JWT sub
 *   - "role = auth.role()"       → row.role must equal JWT role
 *   - "true"                     → always passes (public table)
 *   - "false"                    → always fails
 *   - "{column} = auth.uid()"    → generic column = user ID
 */
function evaluatePolicy(
    row: Record<string, unknown>,
    policy: RLSPolicy,
    user: JWTPayload | null
): boolean {
    const check = policy.check.trim()

    // Literal boolean policies
    if (check === 'true') return true
    if (check === 'false') return false

    // Parse the policy expression
    const match = check.match(/^(\w+)\s*=\s*(.+)$/)
    if (!match) return false

    const [, column, placeholder] = match
    const columnValue = row[column]

    // Evaluate placeholders
    if (placeholder.trim() === 'auth.uid()') {
        if (!user) return false
        return columnValue === user.sub
    }

    if (placeholder.trim() === 'auth.role()') {
        if (!user) return false
        return columnValue === user.role
    }

    if (placeholder.trim() === 'auth.email()') {
        if (!user) return false
        return columnValue === user.email
    }

    // Literal value comparison
    const litMatch = placeholder.trim().match(/^'(.+)'$/)
    if (litMatch) {
        return columnValue === litMatch[1]
    }

    return false
}

/**
 * Get the applicable RLS policy for a given operation.
 */
export function findPolicy(
    policies: RLSPolicy[] | undefined,
    operation: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE'
): RLSPolicy | undefined {
    if (!policies || policies.length === 0) return undefined
    return policies.find(p => p.operation === operation)
}
