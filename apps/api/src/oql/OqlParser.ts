import type { OqlAggregateFunction, OqlComparisonOperator, OqlJoinType } from '@openbase/core'

export interface OqlReference {
    raw: string
    path: string[]
}

export interface OqlLiteral {
    kind: 'literal'
    value: unknown
}

export interface OqlArrayLiteral {
    kind: 'array'
    values: unknown[]
}

export interface OqlReferenceExpression {
    kind: 'reference'
    reference: OqlReference
}

export type OqlExpressionValue = OqlLiteral | OqlArrayLiteral | OqlReferenceExpression

export interface OqlComparison {
    kind: 'comparison'
    operator: OqlComparisonOperator
    left: OqlExpressionValue
    right: OqlExpressionValue
}

export interface OqlLogicalExpression {
    kind: 'logical'
    operator: 'and' | 'or'
    left: OqlCondition
    right: OqlCondition
}

export type OqlCondition = OqlComparison | OqlLogicalExpression

export interface OqlProjectionAll {
    type: 'all'
    alias?: string
}

export interface OqlProjectionReference {
    type: 'reference'
    reference: OqlReference
    alias?: string
}

export interface OqlProjectionAggregate {
    type: 'aggregate'
    fn: OqlAggregateFunction
    arg: OqlReference | '*'
    alias?: string
}

export type OqlProjection = OqlProjectionAll | OqlProjectionReference | OqlProjectionAggregate

export interface OqlJoin {
    type: OqlJoinType
    table: string
    alias: string
    on: OqlCondition
}

export interface OqlOrder {
    reference: OqlReference
    direction: 'asc' | 'desc'
}

export interface ParsedOqlQuery {
    from: {
        table: string
        alias: string
    }
    select: OqlProjection[]
    joins: OqlJoin[]
    where?: OqlCondition
    groupBy: OqlReference[]
    orderBy: OqlOrder[]
    limit?: number
}

interface Token {
    type: 'identifier' | 'number' | 'string' | 'boolean' | 'null' | 'operator' | 'paren' | 'bracket' | 'comma' | 'star'
    value: string
}

export function parseOqlQuery(query: string): ParsedOqlQuery {
    const segments = normalizeSegments(query)
    if (segments.length === 0) {
        throw new Error('OQL query is empty')
    }

    const fromSegment = segments.shift()
    if (!fromSegment || !/^from\s+/i.test(fromSegment)) {
        throw new Error('OQL queries must start with a `from` clause')
    }

    const fromMatch = fromSegment.match(/^from\s+([a-z][a-z0-9_]*)(?:\s+(?:as\s+)?([a-z][a-z0-9_]*))?$/i)
    if (!fromMatch) {
        throw new Error('Invalid `from` clause')
    }

    const parsed: ParsedOqlQuery = {
        from: {
            table: fromMatch[1],
            alias: fromMatch[2] || fromMatch[1],
        },
        select: [],
        joins: [],
        groupBy: [],
        orderBy: [],
    }

    for (const segment of segments) {
        if (/^select\s+/i.test(segment)) {
            parsed.select = parseSelectClause(segment.replace(/^select\s+/i, ''))
            continue
        }

        if (/^(left\s+join|join)\s+/i.test(segment)) {
            parsed.joins.push(parseJoinClause(segment))
            continue
        }

        if (/^where\s+/i.test(segment)) {
            parsed.where = parseCondition(segment.replace(/^where\s+/i, ''))
            continue
        }

        if (/^group(?:\s+by)?\s+/i.test(segment)) {
            parsed.groupBy = splitTopLevel(segment.replace(/^group(?:\s+by)?\s+/i, ''))
                .map(item => parseReference(item))
            continue
        }

        if (/^(order|sort)(?:\s+by)?\s+/i.test(segment)) {
            parsed.orderBy = splitTopLevel(segment.replace(/^(order|sort)(?:\s+by)?\s+/i, ''))
                .map(item => parseOrder(item))
            continue
        }

        if (/^limit\s+/i.test(segment)) {
            const limit = Number(segment.replace(/^limit\s+/i, '').trim())
            if (!Number.isInteger(limit) || limit < 0) {
                throw new Error('Invalid `limit` clause')
            }
            parsed.limit = limit
            continue
        }

        throw new Error(`Unknown OQL clause: ${segment}`)
    }

    return parsed
}

function normalizeSegments(query: string): string[] {
    const compact = query
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .join(' ')

    return compact
        .split('|')
        .map(part => part.trim())
        .filter(Boolean)
}

function parseSelectClause(clause: string): OqlProjection[] {
    return splitTopLevel(clause).map(item => parseProjection(item))
}

function parseProjection(rawItem: string): OqlProjection {
    const item = rawItem.trim()
    const aliasMatch = item.match(/^(.*?)(?:\s+as\s+([a-z][a-z0-9_]*))$/i)
    const expression = aliasMatch ? aliasMatch[1].trim() : item
    const alias = aliasMatch?.[2]

    if (expression === '*') {
        return { type: 'all', alias }
    }

    const aliasWildcardMatch = expression.match(/^([a-z][a-z0-9_]*)\.\*$/i)
    if (aliasWildcardMatch) {
        return {
            type: 'all',
            alias: aliasWildcardMatch[1],
        }
    }

    const aggregateMatch = expression.match(/^(count|sum|avg|min|max)\s*\((.*)\)$/i)
    if (aggregateMatch) {
        const arg = aggregateMatch[2].trim()
        return {
            type: 'aggregate',
            fn: aggregateMatch[1].toLowerCase() as OqlAggregateFunction,
            arg: arg === '*' ? '*' : parseReference(arg),
            alias,
        }
    }

    return {
        type: 'reference',
        reference: parseReference(expression),
        alias,
    }
}

function parseJoinClause(segment: string): OqlJoin {
    const match = segment.match(/^(left\s+join|join)\s+([a-z][a-z0-9_]*)(?:\s+(?:as\s+)?([a-z][a-z0-9_]*))?\s+on\s+(.+)$/i)
    if (!match) {
        throw new Error(`Invalid join clause: ${segment}`)
    }

    return {
        type: match[1].toLowerCase().startsWith('left') ? 'left' : 'inner',
        table: match[2],
        alias: match[3] || match[2],
        on: parseCondition(match[4]),
    }
}

function parseOrder(rawItem: string): OqlOrder {
    const item = rawItem.trim()
    const match = item.match(/^(.*?)(?:\s+(asc|desc))?$/i)
    if (!match) {
        throw new Error(`Invalid order clause: ${rawItem}`)
    }

    return {
        reference: parseReference(match[1].trim()),
        direction: (match[2]?.toLowerCase() as 'asc' | 'desc' | undefined) || 'asc',
    }
}

export function parseReference(raw: string): OqlReference {
    const value = raw.trim()
    if (!value.match(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)?$/i)) {
        throw new Error(`Invalid identifier: ${raw}`)
    }

    return {
        raw: value,
        path: value.split('.'),
    }
}

function parseCondition(input: string): OqlCondition {
    const parser = new ConditionParser(tokenize(input))
    const condition = parser.parseExpression()
    if (!parser.isDone()) {
        throw new Error('Unexpected token in condition')
    }
    return condition
}

function tokenize(input: string): Token[] {
    const tokens: Token[] = []
    let index = 0

    while (index < input.length) {
        const current = input[index]

        if (/\s/.test(current)) {
            index += 1
            continue
        }

        const operator = input.slice(index).match(/^(>=|<=|!=|=|>|<)/)
        if (operator) {
            tokens.push({ type: 'operator', value: operator[1] })
            index += operator[1].length
            continue
        }

        if (current === '(' || current === ')') {
            tokens.push({ type: 'paren', value: current })
            index += 1
            continue
        }

        if (current === '[' || current === ']') {
            tokens.push({ type: 'bracket', value: current })
            index += 1
            continue
        }

        if (current === ',') {
            tokens.push({ type: 'comma', value: current })
            index += 1
            continue
        }

        if (current === '*') {
            tokens.push({ type: 'star', value: current })
            index += 1
            continue
        }

        if (current === '"' || current === '\'') {
            const quote = current
            let value = ''
            index += 1

            while (index < input.length && input[index] !== quote) {
                if (input[index] === '\\' && index + 1 < input.length) {
                    value += input[index + 1]
                    index += 2
                    continue
                }

                value += input[index]
                index += 1
            }

            if (input[index] !== quote) {
                throw new Error('Unterminated string literal')
            }

            index += 1
            tokens.push({ type: 'string', value })
            continue
        }

        const number = input.slice(index).match(/^-?\d+(?:\.\d+)?/)
        if (number) {
            tokens.push({ type: 'number', value: number[0] })
            index += number[0].length
            continue
        }

        const identifier = input.slice(index).match(/^[a-zA-Z_][a-zA-Z0-9_.]*/)
        if (identifier) {
            const normalized = identifier[0].toLowerCase()
            if (normalized === 'true' || normalized === 'false') {
                tokens.push({ type: 'boolean', value: normalized })
            } else if (normalized === 'null') {
                tokens.push({ type: 'null', value: normalized })
            } else if (['and', 'or', 'like', 'ilike', 'in', 'is'].includes(normalized)) {
                tokens.push({ type: 'operator', value: normalized })
            } else {
                tokens.push({ type: 'identifier', value: identifier[0] })
            }
            index += identifier[0].length
            continue
        }

        throw new Error(`Unexpected character in condition: ${current}`)
    }

    return tokens
}

class ConditionParser {
    private position = 0

    constructor(private readonly tokens: Token[]) {}

    parseExpression(): OqlCondition {
        return this.parseOr()
    }

    isDone(): boolean {
        return this.position >= this.tokens.length
    }

    private parseOr(): OqlCondition {
        let expression = this.parseAnd()

        while (this.peekOperator('or')) {
            this.consume()
            expression = {
                kind: 'logical',
                operator: 'or',
                left: expression,
                right: this.parseAnd(),
            }
        }

        return expression
    }

    private parseAnd(): OqlCondition {
        let expression = this.parseComparison()

        while (this.peekOperator('and')) {
            this.consume()
            expression = {
                kind: 'logical',
                operator: 'and',
                left: expression,
                right: this.parseComparison(),
            }
        }

        return expression
    }

    private parseComparison(): OqlCondition {
        if (this.peek('paren', '(')) {
            this.consume()
            const nested = this.parseExpression()
            this.expect('paren', ')')
            return nested
        }

        const left = this.parseValue()
        const operatorToken = this.consume()
        if (!operatorToken || operatorToken.type !== 'operator') {
            throw new Error('Expected comparison operator')
        }

        const right = this.parseValue()
        return {
            kind: 'comparison',
            operator: operatorToken.value as OqlComparisonOperator,
            left,
            right,
        }
    }

    private parseValue(): OqlExpressionValue {
        const token = this.consume()
        if (!token) {
            throw new Error('Unexpected end of condition')
        }

        if (token.type === 'identifier') {
            return {
                kind: 'reference',
                reference: parseReference(token.value),
            }
        }

        if (token.type === 'number') {
            return {
                kind: 'literal',
                value: Number(token.value),
            }
        }

        if (token.type === 'string') {
            return {
                kind: 'literal',
                value: token.value,
            }
        }

        if (token.type === 'boolean') {
            return {
                kind: 'literal',
                value: token.value === 'true',
            }
        }

        if (token.type === 'null') {
            return {
                kind: 'literal',
                value: null,
            }
        }

        if (token.type === 'bracket' && token.value === '[') {
            const values: unknown[] = []
            while (!this.peek('bracket', ']')) {
                const value = this.parseValue()
                if (value.kind === 'reference' || value.kind === 'array') {
                    throw new Error('Array literals may only contain scalar values')
                }
                values.push(value.value)
                if (this.peek('comma', ',')) {
                    this.consume()
                } else {
                    break
                }
            }
            this.expect('bracket', ']')
            return {
                kind: 'array',
                values,
            }
        }

        throw new Error(`Unexpected token in condition: ${token.value}`)
    }

    private peek(type: Token['type'], value?: string): boolean {
        const token = this.tokens[this.position]
        if (!token || token.type !== type) {
            return false
        }
        return value === undefined ? true : token.value === value
    }

    private peekOperator(value: string): boolean {
        return this.peek('operator', value)
    }

    private expect(type: Token['type'], value?: string): Token {
        const token = this.consume()
        if (!token || token.type !== type || (value !== undefined && token.value !== value)) {
            throw new Error(`Expected ${value || type}`)
        }
        return token
    }

    private consume(): Token | undefined {
        const token = this.tokens[this.position]
        this.position += 1
        return token
    }
}

function splitTopLevel(input: string): string[] {
    const parts: string[] = []
    let current = ''
    let depth = 0
    let quote: '"' | '\'' | null = null

    for (let index = 0; index < input.length; index++) {
        const char = input[index]
        if (quote) {
            current += char
            if (char === quote && input[index - 1] !== '\\') {
                quote = null
            }
            continue
        }

        if (char === '"' || char === '\'') {
            quote = char
            current += char
            continue
        }

        if (char === '(' || char === '[') {
            depth += 1
            current += char
            continue
        }

        if (char === ')' || char === ']') {
            depth = Math.max(0, depth - 1)
            current += char
            continue
        }

        if (char === ',' && depth === 0) {
            if (current.trim()) {
                parts.push(current.trim())
            }
            current = ''
            continue
        }

        current += char
    }

    if (current.trim()) {
        parts.push(current.trim())
    }

    return parts
}
