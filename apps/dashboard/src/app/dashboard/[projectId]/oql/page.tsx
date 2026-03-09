'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { Binary, Clock3, Database, History, Play, Sparkles } from 'lucide-react'
import { z } from 'zod'
import { authenticatedFetch, readApiEnvelope } from '../../../../lib/platformApi'

interface TableInfo {
    name: string
    columns: Array<{
        name: string
        type: string
    }>
}

interface OqlResult {
    query: string
    columns: Array<{
        key: string
        label: string
        source: string | null
        aggregate?: string | null
    }>
    rows: Array<Record<string, unknown>>
    rowCount: number
    durationMs: number
    sourceTables: string[]
}

const tablesSchema = z.array(z.object({
    name: z.string(),
    columns: z.array(z.object({
        name: z.string(),
        type: z.string(),
    })).default([]),
}))

const oqlResultSchema = z.object({
    query: z.string(),
    columns: z.array(z.object({
        key: z.string(),
        label: z.string(),
        source: z.string().nullable(),
        aggregate: z.string().nullable().optional(),
    })),
    rows: z.array(z.record(z.unknown())),
    rowCount: z.number(),
    durationMs: z.number(),
    sourceTables: z.array(z.string()),
})

const HISTORY_LIMIT = 12
const KEYWORDS = [
    'from',
    'select',
    'where',
    'join',
    'left join',
    'group by',
    'order by',
    'limit',
    'count',
    'sum',
    'avg',
    'min',
    'max',
    'and',
    'or',
    'like',
    'ilike',
    'in',
    'is',
    'asc',
    'desc',
]

export default function OqlPage() {
    const params = useParams()
    const projectId = params.projectId as string
    const textareaRef = useRef<HTMLTextAreaElement | null>(null)
    const [tables, setTables] = useState<TableInfo[]>([])
    const [query, setQuery] = useState('from  | select * | limit 25')
    const [history, setHistory] = useState<string[]>([])
    const [result, setResult] = useState<OqlResult | null>(null)
    const [running, setRunning] = useState(false)
    const [error, setError] = useState('')
    const [cursorPosition, setCursorPosition] = useState(0)
    const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0)

    useEffect(() => {
        const stored = window.localStorage.getItem(getHistoryKey(projectId))
        if (stored) {
            try {
                const parsed = JSON.parse(stored) as string[]
                if (Array.isArray(parsed)) {
                    setHistory(parsed)
                }
            } catch {
                // Ignore invalid local history.
            }
        }

        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
        authenticatedFetch(`${apiUrl}/api/v1/${projectId}/tables`)
            .then(response => readApiEnvelope(response, tablesSchema))
            .then(data => setTables(data))
            .catch(() => setTables([]))
    }, [projectId])

    useEffect(() => {
        if (!tables.length || query !== 'from  | select * | limit 25') {
            return
        }

        const firstTable = tables[0]
        if (!firstTable) {
            return
        }

        const firstColumns = firstTable.columns.slice(0, 4).map(column => `${firstTable.name}.${column.name}`).join(', ')
        setQuery(`from ${firstTable.name} | select ${firstColumns || '*'} | limit 25`)
    }, [tables, query])

    const currentWord = readCurrentWord(query, cursorPosition)
    const suggestions = useMemo(() => {
        const allSuggestions = [
            ...KEYWORDS,
            ...tables.map(table => table.name),
            ...tables.flatMap(table => table.columns.map(column => `${table.name}.${column.name}`)),
        ]

        const normalized = currentWord.toLowerCase()
        const seen = new Set<string>()
        return allSuggestions
            .filter(item => !normalized || item.toLowerCase().includes(normalized))
            .filter(item => {
                if (seen.has(item)) {
                    return false
                }
                seen.add(item)
                return true
            })
            .slice(0, 10)
    }, [currentWord, tables])

    useEffect(() => {
        setSelectedSuggestionIndex(0)
    }, [currentWord])

    const highlightedQuery = useMemo(() => highlightOql(query, tables), [query, tables])

    async function runQuery(nextQuery?: string) {
        const activeQuery = (nextQuery ?? query).trim()
        if (!activeQuery) {
            return
        }

        setRunning(true)
        setError('')

        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
            const response = await authenticatedFetch(`${apiUrl}/api/v1/${projectId}/oql`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: activeQuery }),
            })
            const payload = await readApiEnvelope(response, oqlResultSchema)
            setResult(payload as OqlResult)

            const nextHistory = [activeQuery, ...history.filter(item => item !== activeQuery)].slice(0, HISTORY_LIMIT)
            setHistory(nextHistory)
            window.localStorage.setItem(getHistoryKey(projectId), JSON.stringify(nextHistory))
        } catch (nextError) {
            setError((nextError as Error).message)
        } finally {
            setRunning(false)
        }
    }

    function applySuggestion(suggestion: string) {
        const word = readCurrentWord(query, cursorPosition)
        const start = Math.max(0, cursorPosition - word.length)
        const nextValue = `${query.slice(0, start)}${suggestion}${query.slice(cursorPosition)}`
        const nextCursor = start + suggestion.length
        setQuery(nextValue)
        setCursorPosition(nextCursor)
        requestAnimationFrame(() => {
            textareaRef.current?.focus()
            textareaRef.current?.setSelectionRange(nextCursor, nextCursor)
        })
    }

    return (
        <div className="shell py-8 md:py-10">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                    <h1 className="text-3xl font-semibold tracking-[-0.04em] text-white">OpenBase Query Language</h1>
                    <p className="mt-2 max-w-3xl text-sm leading-7 subtle">
                        Run project-wide analytical queries with OpenBase-native syntax. OQL understands joins, aggregations,
                        filters, ordering, and limits without pretending to be SQL.
                    </p>
                </div>

                <div className="flex flex-wrap gap-3 text-xs subtle">
                    <span className="status-badge">
                        <Database className="h-3.5 w-3.5" />
                        {tables.length} tables indexed
                    </span>
                    {result && (
                        <span className="status-badge">
                            <Clock3 className="h-3.5 w-3.5" />
                            {result.durationMs}ms
                        </span>
                    )}
                </div>
            </div>

            {error && (
                <div className="mt-6 rounded-[10px] border border-[rgba(239,111,108,0.25)] bg-[rgba(239,111,108,0.08)] px-4 py-3 text-sm text-[#f0b1af]">
                    {error}
                </div>
            )}

            <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
                <section className="panel overflow-hidden">
                    <div className="panel-header flex flex-col gap-4 px-6 py-4 md:flex-row md:items-center md:justify-between">
                        <div>
                            <div className="text-sm font-semibold uppercase tracking-[0.18em] text-[color:var(--accent)]">OQL editor</div>
                            <div className="mt-2 text-sm subtle">Use pipe clauses like `from`, `join`, `where`, `select`, `order by`, and `limit`.</div>
                        </div>

                        <button type="button" onClick={() => void runQuery()} disabled={running} className="btn btn-primary">
                            <Play className="h-4 w-4" />
                            {running ? 'Running...' : 'Run query'}
                        </button>
                    </div>

                    <div className="p-6">
                        <div className="oql-editor-shell">
                            <pre
                                className="oql-editor-highlight"
                                aria-hidden="true"
                                dangerouslySetInnerHTML={{ __html: `${highlightedQuery}\n` }}
                            />
                            <textarea
                                ref={textareaRef}
                                value={query}
                                onChange={event => setQuery(event.target.value)}
                                onKeyUp={event => setCursorPosition((event.target as HTMLTextAreaElement).selectionStart)}
                                onClick={event => setCursorPosition((event.target as HTMLTextAreaElement).selectionStart)}
                                onKeyDown={event => {
                                    if (suggestions.length > 0 && event.key === 'ArrowDown') {
                                        event.preventDefault()
                                        setSelectedSuggestionIndex(current => (current + 1) % suggestions.length)
                                    }

                                    if (suggestions.length > 0 && event.key === 'ArrowUp') {
                                        event.preventDefault()
                                        setSelectedSuggestionIndex(current => (current - 1 + suggestions.length) % suggestions.length)
                                    }

                                    if (suggestions.length > 0 && (event.key === 'Tab' || event.key === 'Enter')) {
                                        event.preventDefault()
                                        applySuggestion(suggestions[selectedSuggestionIndex] || suggestions[0])
                                    }

                                    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                                        event.preventDefault()
                                        void runQuery()
                                    }
                                }}
                                spellCheck={false}
                                className="oql-editor-input"
                                placeholder="from posts | select posts.id, posts.title | limit 25"
                            />
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                            {suggestions.map((suggestion, index) => (
                                <button
                                    key={suggestion}
                                    type="button"
                                    onClick={() => applySuggestion(suggestion)}
                                    className="oql-suggestion"
                                    data-active={index === selectedSuggestionIndex}
                                >
                                    {suggestion}
                                </button>
                            ))}
                        </div>

                        <div className="mt-6 grid gap-4 md:grid-cols-3">
                            <MetricCard
                                icon={Binary}
                                label="Source tables"
                                value={result ? result.sourceTables.join(', ') || 'None' : 'Run a query'}
                            />
                            <MetricCard
                                icon={Sparkles}
                                label="Columns"
                                value={result ? String(result.columns.length) : '0'}
                            />
                            <MetricCard
                                icon={Database}
                                label="Rows"
                                value={result ? String(result.rowCount) : '0'}
                            />
                        </div>

                        <div className="mt-6 panel-soft overflow-hidden">
                            <div className="border-b border-[color:var(--line)] px-4 py-3 text-sm font-semibold text-white">Results</div>
                            {result ? (
                                result.rows.length > 0 ? (
                                    <div className="table-shell">
                                        <table className="data-table">
                                            <thead>
                                                <tr>
                                                    {result.columns.map(column => (
                                                        <th key={column.key}>{column.label}</th>
                                                    ))}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {result.rows.map((row, rowIndex) => (
                                                    <tr key={rowIndex}>
                                                        {result.columns.map(column => (
                                                            <td key={column.key} className="font-mono text-xs text-white">
                                                                {formatCell(row[column.key])}
                                                            </td>
                                                        ))}
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                ) : (
                                    <div className="empty-state min-h-[220px]">
                                        <div className="max-w-sm">
                                            <Binary className="mx-auto h-10 w-10 text-[color:var(--accent)]" />
                                            <div className="mt-4 text-xl font-semibold text-white">No matching rows</div>
                                            <p className="mt-3 text-sm leading-7 subtle">The query executed successfully, but no rows matched the current filters.</p>
                                        </div>
                                    </div>
                                )
                            ) : (
                                <div className="empty-state min-h-[220px]">
                                    <div className="max-w-sm">
                                        <Play className="mx-auto h-10 w-10 text-[color:var(--accent)]" />
                                        <div className="mt-4 text-xl font-semibold text-white">Run your first OQL query</div>
                                        <p className="mt-3 text-sm leading-7 subtle">Results render here with source table metadata, duration, and typed columns.</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </section>

                <aside className="space-y-6">
                    <section className="panel p-5">
                        <div className="flex items-center gap-3">
                            <History className="h-4 w-4 text-[color:var(--accent)]" />
                            <div className="text-sm font-semibold text-white">Query history</div>
                        </div>
                        <div className="mt-4 space-y-2">
                            {history.length === 0 && <p className="text-sm subtle">Executed queries are kept locally for this project.</p>}
                            {history.map(entry => (
                                <button
                                    key={entry}
                                    type="button"
                                    onClick={() => {
                                        setQuery(entry)
                                        void runQuery(entry)
                                    }}
                                    className="w-full rounded-[10px] border border-[color:var(--line)] bg-[rgba(255,255,255,0.02)] p-3 text-left text-sm text-white transition hover:border-[rgba(62,207,142,0.28)] hover:bg-[rgba(62,207,142,0.06)]"
                                >
                                    <div className="line-clamp-3 font-mono text-xs leading-6">{entry}</div>
                                </button>
                            ))}
                        </div>
                    </section>

                    <section className="panel p-5">
                        <div className="text-sm font-semibold text-white">Schema dictionary</div>
                        <div className="mt-4 space-y-3">
                            {tables.length === 0 && <p className="text-sm subtle">Load a project schema to enable completion.</p>}
                            {tables.map(table => (
                                <div key={table.name} className="rounded-[10px] border border-[color:var(--line)] bg-[rgba(255,255,255,0.02)] p-3">
                                    <div className="font-mono text-sm text-white">{table.name}</div>
                                    <div className="mt-2 flex flex-wrap gap-2">
                                        {table.columns.map(column => (
                                            <span key={column.name} className="rounded-full border border-[color:var(--line)] px-2 py-1 font-mono text-[11px] text-[color:var(--muted-strong)]">
                                                {column.name}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                </aside>
            </div>
        </div>
    )
}

function MetricCard({
    icon: Icon,
    label,
    value,
}: {
    icon: typeof Binary
    label: string
    value: string
}) {
    return (
        <div className="panel-soft p-4">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] subtle">
                <Icon className="h-3.5 w-3.5 text-[color:var(--accent)]" />
                {label}
            </div>
            <div className="mt-3 text-sm font-medium text-white">{value}</div>
        </div>
    )
}

function getHistoryKey(projectId: string): string {
    return `openbase:oql:${projectId}:history`
}

function readCurrentWord(query: string, cursorPosition: number): string {
    const before = query.slice(0, cursorPosition)
    const match = before.match(/([a-zA-Z0-9_.-]+)$/)
    return match?.[1] || ''
}

function highlightOql(query: string, tables: TableInfo[]): string {
    const escaped = escapeHtml(query)
    const tableNames = tables.map(table => table.name).sort((left, right) => right.length - left.length)
    const columnNames = tables.flatMap(table => table.columns.map(column => `${table.name}.${column.name}`)).sort((left, right) => right.length - left.length)
    const keywordPattern = /\b(from|select|where|join|left\s+join|group\s+by|order\s+by|limit|and|or|count|sum|avg|min|max|like|ilike|in|is|asc|desc)\b/gi
    const numberPattern = /\b\d+(?:\.\d+)?\b/g
    let highlighted = escaped.replace(keywordPattern, '<span class="oql-token-keyword">$1</span>')
    highlighted = highlighted.replace(numberPattern, '<span class="oql-token-number">$&</span>')

    for (const identifier of [...tableNames, ...columnNames]) {
        const pattern = new RegExp(`\\b${escapeForRegex(identifier)}\\b`, 'g')
        highlighted = highlighted.replace(pattern, `<span class="oql-token-identifier">${identifier}</span>`)
    }

    highlighted = highlighted.replace(/("[^"]*"|'[^']*')/g, '<span class="oql-token-string">$1</span>')
    return highlighted
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
}

function escapeForRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function formatCell(value: unknown): string {
    if (value === null || value === undefined) {
        return ''
    }

    if (typeof value === 'string') {
        return value
    }

    try {
        return JSON.stringify(value)
    } catch {
        return String(value)
    }
}
