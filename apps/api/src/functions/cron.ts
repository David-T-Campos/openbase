const FIELD_LIMITS = [
    { min: 0, max: 59 },
    { min: 0, max: 23 },
    { min: 1, max: 31 },
    { min: 1, max: 12 },
    { min: 0, max: 6 },
] as const

export function validateCronExpression(expression: string): void {
    parseCronExpression(expression)
}

export function cronMatches(expression: string, date: Date): boolean {
    const fields = parseCronExpression(expression)
    const values = [
        date.getMinutes(),
        date.getHours(),
        date.getDate(),
        date.getMonth() + 1,
        date.getDay(),
    ]

    return fields.every((field, index) => field.has(values[index]))
}

export function nextCronMatch(expression: string, from: Date): string | null {
    parseCronExpression(expression)
    const candidate = new Date(from.getTime())
    candidate.setSeconds(0, 0)
    candidate.setMinutes(candidate.getMinutes() + 1)

    for (let iteration = 0; iteration < 60 * 24 * 30; iteration++) {
        if (cronMatches(expression, candidate)) {
            return candidate.toISOString()
        }
        candidate.setMinutes(candidate.getMinutes() + 1)
    }

    return null
}

function parseCronExpression(expression: string): Array<Set<number>> {
    const segments = expression.trim().split(/\s+/)
    if (segments.length !== 5) {
        throw new Error('Cron expressions must have 5 fields: minute hour day month weekday')
    }

    return segments.map((segment, index) => parseField(segment, FIELD_LIMITS[index]))
}

function parseField(segment: string, bounds: { min: number; max: number }): Set<number> {
    const values = new Set<number>()
    const parts = segment.split(',')

    for (const part of parts) {
        if (part === '*') {
            for (let value = bounds.min; value <= bounds.max; value++) {
                values.add(value)
            }
            continue
        }

        const stepMatch = part.match(/^\*\/(\d+)$/)
        if (stepMatch) {
            const step = Number(stepMatch[1])
            if (!Number.isInteger(step) || step <= 0) {
                throw new Error(`Invalid cron step: ${part}`)
            }

            for (let value = bounds.min; value <= bounds.max; value += step) {
                values.add(value)
            }
            continue
        }

        const rangeMatch = part.match(/^(\d+)-(\d+)$/)
        if (rangeMatch) {
            const start = Number(rangeMatch[1])
            const end = Number(rangeMatch[2])
            assertWithinBounds(start, bounds, part)
            assertWithinBounds(end, bounds, part)
            if (end < start) {
                throw new Error(`Invalid cron range: ${part}`)
            }

            for (let value = start; value <= end; value++) {
                values.add(value)
            }
            continue
        }

        const literal = Number(part)
        if (!Number.isInteger(literal)) {
            throw new Error(`Invalid cron field: ${part}`)
        }
        assertWithinBounds(literal, bounds, part)
        values.add(literal)
    }

    return values
}

function assertWithinBounds(value: number, bounds: { min: number; max: number }, raw: string): void {
    if (value < bounds.min || value > bounds.max) {
        throw new Error(`Cron field "${raw}" is outside ${bounds.min}-${bounds.max}`)
    }
}
