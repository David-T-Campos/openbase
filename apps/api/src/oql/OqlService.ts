import type {
    JWTPayload,
    OqlAggregateFunction,
    OqlQueryResult,
    OqlResultColumn,
    Project,
    TableSchema,
} from '@openbase/core'
import { ValidationError } from '@openbase/core'
import { applyRLS, findPolicy } from '../middleware/index.js'
import type { EncryptionService } from '../encryption/EncryptionService.js'
import { IndexManager, buildProjectQueryEngine } from '../database/index.js'
import type { ProjectService } from '../projects/ProjectService.js'
import type {
    OqlCondition,
    OqlExpressionValue,
    OqlProjection,
    OqlReference,
    ParsedOqlQuery,
    OqlJoin,
    OqlOrder,
} from './OqlParser.js'
import { parseOqlQuery } from './OqlParser.js'

type OqlContextRow = Record<string, Record<string, unknown> | null>

export class OqlService {
    constructor(
        private readonly projectService: ProjectService,
        private readonly getIndexManager: (projectId: string) => IndexManager,
        private readonly encryptionService: EncryptionService,
        private readonly masterKey: Buffer
    ) {}

    async execute(project: Project, user: JWTPayload | null, query: string): Promise<OqlQueryResult> {
        const startedAt = Date.now()
        const parsed = parseOqlQuery(query)
        const schemas = await this.projectService.getSchemas(project.id)

        this.assertTableExists(schemas, parsed.from.table)
        for (const join of parsed.joins) {
            this.assertTableExists(schemas, join.table)
        }

        return this.projectService.withProjectStorageRecord(project, async (_project, provider) => {
            const rowCache = new Map<string, Record<string, unknown>[]>()

            const loadRows = async (tableName: string): Promise<Record<string, unknown>[]> => {
                if (rowCache.has(tableName)) {
                    return rowCache.get(tableName) || []
                }

                const schema = schemas[tableName]
                const channel = project.channelMap[tableName]
                if (!channel) {
                    throw new ValidationError(`Table "${tableName}" is not mapped to a storage channel`)
                }

                const queryEngine = buildProjectQueryEngine(
                    provider,
                    this.getIndexManager(project.id),
                    schema,
                    this.encryptionService,
                    this.masterKey
                )

                let rows = await queryEngine.select(tableName, channel)
                if (!canBypassRls(user, project)) {
                    rows = applyRLS(rows, findPolicy(schema.rls, 'SELECT'), user)
                }

                rowCache.set(tableName, rows)
                return rows
            }

            let contexts: OqlContextRow[] = (await loadRows(parsed.from.table)).map(row => ({
                [parsed.from.alias]: row,
            }))

            for (const join of parsed.joins) {
                const joinRows = await loadRows(join.table)
                contexts = this.applyJoin(contexts, join, joinRows)
            }

            if (parsed.where) {
                const whereCondition = parsed.where
                contexts = contexts.filter(context => this.evaluateCondition(whereCondition, context))
            }

            const result = this.buildResult(parsed, contexts)
            return {
                ...result,
                query,
                durationMs: Date.now() - startedAt,
                sourceTables: [parsed.from.table, ...parsed.joins.map(join => join.table)],
            }
        })
    }

    private buildResult(parsed: ParsedOqlQuery, contexts: OqlContextRow[]): OqlQueryResult {
        const hasAggregates = parsed.select.some(item => item.type === 'aggregate')
        const requiresGrouping = hasAggregates || parsed.groupBy.length > 0

        const rows = requiresGrouping
            ? this.projectGroupedRows(parsed, contexts)
            : this.projectFlatRows(parsed, contexts)

        const orderedRows = this.applyOrdering(rows, parsed.orderBy)
        const limitedRows = parsed.limit !== undefined ? orderedRows.slice(0, parsed.limit) : orderedRows
        const columns = buildColumns(parsed, limitedRows)

        return {
            query: '',
            columns,
            rows: limitedRows,
            rowCount: limitedRows.length,
            durationMs: 0,
            sourceTables: [],
        }
    }

    private projectFlatRows(parsed: ParsedOqlQuery, contexts: OqlContextRow[]): Record<string, unknown>[] {
        return contexts.map(context => this.projectContext(parsed.select, context))
    }

    private projectGroupedRows(parsed: ParsedOqlQuery, contexts: OqlContextRow[]): Record<string, unknown>[] {
        const groups = new Map<string, OqlContextRow[]>()
        const selectItems = parsed.select.length > 0 ? parsed.select : [{ type: 'all' } satisfies OqlProjection]

        for (const context of contexts) {
            const groupKey = parsed.groupBy.length === 0
                ? '__all__'
                : JSON.stringify(parsed.groupBy.map(reference => this.resolveReference(context, reference)))

            const bucket = groups.get(groupKey) || []
            bucket.push(context)
            groups.set(groupKey, bucket)
        }

        return [...groups.values()].map(bucket => {
            const representative = bucket[0] || {}
            const row: Record<string, unknown> = {}

            for (const selectItem of selectItems) {
                if (selectItem.type === 'all') {
                    Object.assign(row, flattenContext(representative, selectItem.alias))
                    continue
                }

                if (selectItem.type === 'reference') {
                    const key = this.getProjectionKey(selectItem)
                    row[key] = this.resolveReference(representative, selectItem.reference)
                    continue
                }

                const key = this.getProjectionKey(selectItem)
                row[key] = this.computeAggregate(selectItem.fn, selectItem.arg, bucket)
            }

            return row
        })
    }

    private projectContext(selectItems: OqlProjection[], context: OqlContextRow): Record<string, unknown> {
        if (selectItems.length === 0) {
            return flattenContext(context)
        }

        const row: Record<string, unknown> = {}
        for (const selectItem of selectItems) {
            if (selectItem.type === 'all') {
                Object.assign(row, flattenContext(context, selectItem.alias))
                continue
            }

            if (selectItem.type === 'reference') {
                row[this.getProjectionKey(selectItem)] = this.resolveReference(context, selectItem.reference)
                continue
            }

            row[this.getProjectionKey(selectItem)] = this.computeAggregate(selectItem.fn, selectItem.arg, [context])
        }

        return row
    }

    private applyJoin(current: OqlContextRow[], join: OqlJoin, rows: Record<string, unknown>[]): OqlContextRow[] {
        const joined: OqlContextRow[] = []

        for (const context of current) {
            const matches = rows.filter(row => this.evaluateCondition(join.on, {
                ...context,
                [join.alias]: row,
            }))

            if (matches.length === 0) {
                if (join.type === 'left') {
                    joined.push({
                        ...context,
                        [join.alias]: null,
                    })
                }
                continue
            }

            for (const match of matches) {
                joined.push({
                    ...context,
                    [join.alias]: match,
                })
            }
        }

        return joined
    }

    private evaluateCondition(condition: OqlCondition, context: OqlContextRow): boolean {
        if (condition.kind === 'logical') {
            return condition.operator === 'and'
                ? this.evaluateCondition(condition.left, context) && this.evaluateCondition(condition.right, context)
                : this.evaluateCondition(condition.left, context) || this.evaluateCondition(condition.right, context)
        }

        const left = this.resolveExpressionValue(context, condition.left)
        const right = this.resolveExpressionValue(context, condition.right)
        return compareValues(left, right, condition.operator)
    }

    private resolveExpressionValue(context: OqlContextRow, expression: OqlExpressionValue): unknown {
        if (expression.kind === 'literal') {
            return expression.value
        }

        if (expression.kind === 'array') {
            return expression.values
        }

        return this.resolveReference(context, expression.reference)
    }

    private resolveReference(context: OqlContextRow, reference: OqlReference): unknown {
        if (reference.path.length === 2) {
            const [alias, column] = reference.path
            return context[alias]?.[column] ?? null
        }

        const [column] = reference.path
        const matches = Object.values(context)
            .filter((row): row is Record<string, unknown> => row !== null)
            .filter(row => column in row)

        if (matches.length > 1) {
            throw new ValidationError(`Ambiguous column reference "${reference.raw}"`)
        }

        return matches[0]?.[column] ?? null
    }

    private getProjectionKey(projection: Extract<OqlProjection, { type: 'reference' | 'aggregate' }>): string {
        if (projection.alias) {
            return projection.alias
        }

        if (projection.type === 'reference') {
            return projection.reference.raw
        }

        return `${projection.fn}(${projection.arg === '*' ? '*' : projection.arg.raw})`
    }

    private computeAggregate(
        fn: OqlAggregateFunction,
        arg: OqlReference | '*',
        contexts: OqlContextRow[]
    ): unknown {
        const values = arg === '*'
            ? contexts.map(() => 1)
            : contexts.map(context => this.resolveReference(context, arg))

        switch (fn) {
            case 'count':
                return arg === '*'
                    ? contexts.length
                    : values.filter(value => value !== null && value !== undefined).length
            case 'sum':
                return values.reduce<number>((sum, value) => sum + Number(value || 0), 0)
            case 'avg': {
                const numeric = values.filter(value => value !== null && value !== undefined).map(value => Number(value))
                if (numeric.length === 0) {
                    return 0
                }
                return numeric.reduce((sum, value) => sum + value, 0) / numeric.length
            }
            case 'min':
                return values.reduce((min, value) => min === undefined || compareComparable(value, min) < 0 ? value : min, undefined as unknown)
            case 'max':
                return values.reduce((max, value) => max === undefined || compareComparable(value, max) > 0 ? value : max, undefined as unknown)
            default:
                return null
        }
    }

    private applyOrdering(rows: Record<string, unknown>[], orderBy: OqlOrder[]): Record<string, unknown>[] {
        if (orderBy.length === 0) {
            return rows
        }

        return [...rows].sort((left, right) => {
            for (const order of orderBy) {
                const leftValue = resolveOrderedValue(left, order.reference)
                const rightValue = resolveOrderedValue(right, order.reference)
                const comparison = compareComparable(leftValue, rightValue)
                if (comparison !== 0) {
                    return order.direction === 'asc' ? comparison : -comparison
                }
            }

            return 0
        })
    }

    private assertTableExists(schemas: Record<string, TableSchema>, tableName: string): void {
        if (!schemas[tableName]) {
            throw new ValidationError(`Unknown table "${tableName}"`)
        }
    }
}

function flattenContext(context: OqlContextRow, alias?: string): Record<string, unknown> {
    const row: Record<string, unknown> = {}
    const entries = alias ? [[alias, context[alias] ?? null]] : Object.entries(context)

    for (const [rowAlias, value] of entries) {
        if (!value) {
            continue
        }

        for (const [column, columnValue] of Object.entries(value)) {
            row[`${rowAlias}.${column}`] = columnValue
        }
    }

    return row
}

function buildColumns(parsed: ParsedOqlQuery, rows: Record<string, unknown>[]): OqlResultColumn[] {
    if (parsed.select.length === 0) {
        return Object.keys(rows[0] || {}).map(key => ({
            key,
            label: key,
            source: null,
            aggregate: null,
        }))
    }

    const columns: OqlResultColumn[] = []
    for (const item of parsed.select) {
        if (item.type === 'all') {
            const filteredKeys = Object.keys(rows[0] || {}).filter(key => item.alias ? key.startsWith(`${item.alias}.`) : true)
            for (const key of filteredKeys) {
                columns.push({
                    key,
                    label: key,
                    source: item.alias || null,
                    aggregate: null,
                })
            }
            continue
        }

        if (item.type === 'reference') {
            columns.push({
                key: item.alias || item.reference.raw,
                label: item.alias || item.reference.raw,
                source: item.reference.path.length === 2 ? item.reference.path[0] : null,
                aggregate: null,
            })
            continue
        }

        columns.push({
            key: item.alias || `${item.fn}(${item.arg === '*' ? '*' : item.arg.raw})`,
            label: item.alias || `${item.fn}(${item.arg === '*' ? '*' : item.arg.raw})`,
            source: item.arg === '*' ? null : item.arg.path.length === 2 ? item.arg.path[0] : null,
            aggregate: item.fn,
        })
    }

    return columns
}

function compareValues(left: unknown, right: unknown, operator: string): boolean {
    switch (operator) {
        case '=':
            return left === right
        case '!=':
            return left !== right
        case '>':
            return compareComparable(left, right) > 0
        case '>=':
            return compareComparable(left, right) >= 0
        case '<':
            return compareComparable(left, right) < 0
        case '<=':
            return compareComparable(left, right) <= 0
        case 'like':
            return String(left ?? '').includes(String(right ?? '').replace(/%/g, ''))
        case 'ilike':
            return String(left ?? '').toLowerCase().includes(String(right ?? '').replace(/%/g, '').toLowerCase())
        case 'in':
            return Array.isArray(right) && right.includes(left)
        case 'is':
            return right === null ? left === null || left === undefined : left === right
        default:
            return false
    }
}

function compareComparable(left: unknown, right: unknown): number {
    const normalizedLeft = toComparable(left)
    const normalizedRight = toComparable(right)

    if (normalizedLeft === normalizedRight) {
        return 0
    }

    return normalizedLeft > normalizedRight ? 1 : -1
}

function toComparable(value: unknown): string | number | boolean {
    if (typeof value === 'number' || typeof value === 'boolean') {
        return value
    }

    if (typeof value === 'string') {
        const timestamp = Date.parse(value)
        if (!Number.isNaN(timestamp) && value.includes('T')) {
            return timestamp
        }

        return value
    }

    if (value === null || value === undefined) {
        return ''
    }

    return JSON.stringify(value)
}

function resolveOrderedValue(row: Record<string, unknown>, reference: OqlReference): unknown {
    if (reference.raw in row) {
        return row[reference.raw]
    }

    const aliasMatches = Object.keys(row).filter(key => key.endsWith(`.${reference.raw}`))
    if (aliasMatches.length === 1) {
        return row[aliasMatches[0]]
    }

    return row[reference.path[reference.path.length - 1]]
}

function canBypassRls(user: JWTPayload | null, project: Project): boolean {
    return user?.role === 'service_role' || (user?.role === 'platform_user' && user.sub === project.ownerId)
}
