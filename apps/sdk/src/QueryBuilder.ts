/**
 * QueryBuilder — Chainable Supabase-style query builder
 *
 * Mirrors the @supabase/supabase-js API so existing Supabase users
 * can migrate with minimal code changes.
 */

import type { QueryFilter, QueryResult, UpsertOptions } from './types.js'

type OperationType = 'select' | 'insert' | 'update' | 'delete' | 'upsert'

export class QueryBuilder<T = Record<string, unknown>> {
    private filters: QueryFilter[] = []
    private _select: string[] = []
    private _order?: { column: string; ascending: boolean }
    private _limit?: number
    private _offset?: number
    private _operation: OperationType = 'select'
    private _body: unknown = null
    private _projectId: string
    private _upsertOptions?: UpsertOptions

    constructor(
        private table: string,
        private projectUrl: string,
        private apiKey: string,
        projectId: string,
        private getAccessToken: () => string | null
    ) {
        this._projectId = projectId
    }

    // ─── SELECT ────────────────────────────────────────────────

    /** Select specific columns. Use '*' for all columns. */
    select(columns: string = '*'): this {
        this._operation = 'select'
        this._select = columns === '*' ? [] : columns.split(',').map(c => c.trim())
        return this
    }

    // ─── FILTERS ───────────────────────────────────────────────

    /** Equal */
    eq(column: string, value: unknown): this { return this.addFilter(column, 'eq', value) }

    /** Not equal */
    neq(column: string, value: unknown): this { return this.addFilter(column, 'neq', value) }

    /** Greater than */
    gt(column: string, value: unknown): this { return this.addFilter(column, 'gt', value) }

    /** Greater than or equal */
    gte(column: string, value: unknown): this { return this.addFilter(column, 'gte', value) }

    /** Less than */
    lt(column: string, value: unknown): this { return this.addFilter(column, 'lt', value) }

    /** Less than or equal */
    lte(column: string, value: unknown): this { return this.addFilter(column, 'lte', value) }

    /** Pattern match (case-sensitive) */
    like(column: string, pattern: string): this { return this.addFilter(column, 'like', pattern) }

    /** Pattern match (case-insensitive) */
    ilike(column: string, pattern: string): this { return this.addFilter(column, 'ilike', pattern) }

    /** In array */
    in(column: string, values: unknown[]): this { return this.addFilter(column, 'in', values) }

    /** Is null/boolean */
    is(column: string, value: null | boolean): this { return this.addFilter(column, 'is', value) }

    // ─── ORDERING & PAGINATION ─────────────────────────────────

    /** Order by column */
    order(column: string, options?: { ascending?: boolean }): this {
        this._order = { column, ascending: options?.ascending ?? true }
        return this
    }

    /** Limit number of rows */
    limit(count: number): this {
        this._limit = count
        return this
    }

    /** Offset/range for pagination */
    range(from: number, to: number): this {
        this._offset = from
        this._limit = to - from + 1
        return this
    }

    /** Get a single row */
    single(): Promise<QueryResult<T>> {
        this._limit = 1
        return this.execute().then(result => {
            const singleData = (result.data && Array.isArray(result.data))
                ? (result.data[0] as unknown as T) || null
                : null
            return { ...result, data: singleData } as unknown as QueryResult<T>
        })
    }

    // ─── MUTATIONS ─────────────────────────────────────────────

    /** Insert one or more rows */
    insert(data: Partial<T> | Partial<T>[]): this {
        this._operation = 'insert'
        this._body = data
        return this
    }

    /** Update rows matching filters */
    update(data: Partial<T>): this {
        this._operation = 'update'
        this._body = data
        return this
    }

    /** Delete rows matching filters */
    delete(): this {
        this._operation = 'delete'
        return this
    }

    /** Upsert (insert or update) */
    upsert(data: Partial<T> | Partial<T>[], options?: UpsertOptions): this {
        this._operation = 'upsert'
        this._body = data
        this._upsertOptions = options
        return this
    }

    // ─── EXECUTION ─────────────────────────────────────────────

    /** Make this thenable so it works with await */
    then<TResult1 = QueryResult<T[]>, TResult2 = never>(
        onfulfilled?: ((value: QueryResult<T[]>) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
    ): Promise<TResult1 | TResult2> {
        return this.execute().then(onfulfilled, onrejected)
    }

    /** Execute the built query */
    private async execute(): Promise<QueryResult<T[]>> {
        const url = this.buildUrl()
        const method = this.getMethod()
        const token = this.getAccessToken() || this.apiKey
        const headers: Record<string, string> = {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'apikey': this.apiKey,
        }

        try {
            const fetchFn = typeof globalThis.fetch !== 'undefined' ? globalThis.fetch : (await import('cross-fetch')).default
            const response = await fetchFn(url, {
                method,
                headers,
                body: this._body ? JSON.stringify(this._body) : undefined,
            })

            const json = await response.json() as { data?: T[]; error?: { message: string; code?: string }; count?: number }

            if (!response.ok) {
                return {
                    data: null,
                    error: json.error || { message: `HTTP ${response.status}` },
                    count: 0,
                }
            }

            return {
                data: json.data || null,
                error: null,
                count: json.count,
            }
        } catch (error) {
            return {
                data: null,
                error: { message: (error as Error).message, code: 'NETWORK_ERROR' },
            }
        }
    }

    // ─── INTERNAL ──────────────────────────────────────────────

    private addFilter(column: string, operator: string, value: unknown): this {
        this.filters.push({ column, operator, value })
        return this
    }

    private buildUrl(): string {
        const params = new URLSearchParams()

        if (this._select.length) {
            params.set('select', this._select.join(','))
        }

        for (const f of this.filters) {
            const value = Array.isArray(f.value)
                ? `(${(f.value as unknown[]).join(',')})`
                : f.value === null ? 'null'
                    : String(f.value)
            params.append(f.column, `${f.operator}.${value}`)
        }

        if (this._order) {
            params.set('order', `${this._order.column}.${this._order.ascending ? 'asc' : 'desc'}`)
        }

        if (this._limit !== undefined) {
            params.set('limit', String(this._limit))
        }

        if (this._offset !== undefined) {
            params.set('offset', String(this._offset))
        }

        if (this._operation === 'upsert') {
            params.set('upsert', 'true')

            if (this._upsertOptions?.onConflict) {
                const columns = Array.isArray(this._upsertOptions.onConflict)
                    ? this._upsertOptions.onConflict
                    : [this._upsertOptions.onConflict]
                params.set('on_conflict', columns.join(','))
            }
        }

        const query = params.toString()
        return `${this.projectUrl}/api/v1/${this._projectId}/tables/${this.table}${query ? `?${query}` : ''}`
    }

    private getMethod(): string {
        switch (this._operation) {
            case 'insert':
            case 'upsert':
                return 'POST'
            case 'update':
                return 'PATCH'
            case 'delete':
                return 'DELETE'
            default:
                return 'GET'
        }
    }
}
