'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { io, type Socket } from 'socket.io-client'
import { Database, Pencil, Plus, Radio, RefreshCw, Save, Trash2, X } from 'lucide-react'
import { authenticatedFetch, getPlatformSession } from '../../../../lib/platformApi'

interface TableInfo {
    name: string
    columns: Array<{
        name: string
        type: string
        required?: boolean
        indexed?: boolean
        encrypted?: boolean
    }>
}

interface TableRow extends Record<string, unknown> {
    _msgId?: number
}

interface RealtimePayload {
    table: string
    eventType: 'INSERT' | 'UPDATE' | 'DELETE' | '*'
    new: TableRow | null
    old: TableRow | null
}

export default function TableEditorPage() {
    const params = useParams()
    const projectId = params.projectId as string

    const [tables, setTables] = useState<TableInfo[]>([])
    const [activeTable, setActiveTable] = useState<string | null>(null)
    const [rowData, setRowData] = useState<TableRow[]>([])
    const [showCreateTable, setShowCreateTable] = useState(false)
    const [newTableName, setNewTableName] = useState('')
    const [realtimeEnabled, setRealtimeEnabled] = useState(false)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [draftOpen, setDraftOpen] = useState(false)
    const [draftJson, setDraftJson] = useState('')
    const [editingMessageId, setEditingMessageId] = useState<number | null>(null)
    const [savingDraft, setSavingDraft] = useState(false)
    const socketRef = useRef<Socket | null>(null)

    const currentTable = useMemo(
        () => tables.find(item => item.name === activeTable) || null,
        [tables, activeTable],
    )

    useEffect(() => {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

        authenticatedFetch(`${apiUrl}/api/v1/${projectId}/tables`)
            .then((response: Response) => response.json())
            .then((data: { data?: Array<{ name: string; columns?: TableInfo['columns'] }> }) => {
                if (!Array.isArray(data.data)) return
                setTables(
                    data.data.map((table: { name: string; columns?: TableInfo['columns'] }) => ({
                        name: table.name,
                        columns: table.columns || [],
                    })),
                )
            })
            .catch(() => setTables([]))
            .finally(() => setLoading(false))
    }, [projectId])

    const columnDefs = useMemo(() => {
        const schemaColumns = currentTable?.columns.map(column => ({
            field: column.name,
            headerName: column.name,
        })) || []

        if (rowData.some(row => row._msgId !== undefined)) {
            return [{ field: '_msgId', headerName: '_msgId' }, ...schemaColumns]
        }

        return schemaColumns
    }, [currentTable, rowData])

    const fetchTableData = useCallback(
        async (tableName: string) => {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

            try {
                const res = await authenticatedFetch(`${apiUrl}/api/v1/${projectId}/tables/${tableName}`)
                const data = await res.json()
                setRowData(Array.isArray(data.data) ? data.data : [])
            } catch {
                setRowData([])
            }
        },
        [projectId],
    )

    useEffect(() => {
        if (!realtimeEnabled || !activeTable) {
            socketRef.current?.disconnect()
            socketRef.current = null
            return
        }

        const token = getPlatformSession()?.accessToken
        if (!token) {
            return
        }

        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
        const socket = io(apiUrl, {
            path: '/realtime/v1',
            transports: ['websocket', 'polling'],
        })

        const applyRealtimeChange = (payload: RealtimePayload) => {
            if (payload.table !== activeTable) {
                return
            }

            setRowData(current => {
                switch (payload.eventType) {
                    case 'INSERT':
                        if (!payload.new) {
                            return current
                        }
                        {
                            const nextRow = payload.new
                            return [
                                nextRow,
                                ...current.filter(row => row._msgId !== nextRow._msgId),
                            ]
                        }
                    case 'UPDATE':
                        if (!payload.new) {
                            return current
                        }
                        {
                            const nextRow = payload.new
                            return current.map(row =>
                                row._msgId === nextRow._msgId ? nextRow : row,
                            )
                        }
                    case 'DELETE':
                        return current.filter(row => row._msgId !== payload.old?._msgId)
                    default:
                        return current
                }
            })
        }

        socket.on('connect', () => {
            socket.emit('subscribe', {
                projectId,
                table: activeTable,
                event: '*',
                token,
            })
        })

        socket.on('INSERT', applyRealtimeChange)
        socket.on('UPDATE', applyRealtimeChange)
        socket.on('DELETE', applyRealtimeChange)
        socket.on('*', applyRealtimeChange)
        socket.on('error', data => {
            setError((data as { message?: string }).message || 'Realtime connection failed')
        })

        socketRef.current = socket

        return () => {
            socket.disconnect()
            if (socketRef.current === socket) {
                socketRef.current = null
            }
        }
    }, [activeTable, projectId, realtimeEnabled])

    const handleTableClick = (tableName: string) => {
        setActiveTable(tableName)
        setDraftOpen(false)
        setEditingMessageId(null)
        void fetchTableData(tableName)
    }

    const handleCreateTable = async () => {
        if (!newTableName) return

        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

        try {
            const res = await authenticatedFetch(`${apiUrl}/api/v1/${projectId}/tables`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    tableName: newTableName,
                    columns: [
                        { name: 'id', type: 'uuid', required: true },
                        { name: 'created_at', type: 'timestamp' },
                    ],
                    indexes: ['id'],
                }),
            })

            if (!res.ok) {
                const data = await res.json()
                throw new Error(data.error?.message || 'Failed to create table')
            }

            setTables(current => [
                ...current,
                {
                    name: newTableName,
                    columns: [
                        { name: 'id', type: 'uuid', required: true },
                        { name: 'created_at', type: 'timestamp' },
                    ],
                },
            ])
            setShowCreateTable(false)
            setNewTableName('')
        } catch (err) {
            setError((err as Error).message)
        }
    }

    const openNewRowDraft = () => {
        if (!currentTable) return

        const payload = Object.fromEntries(
            currentTable.columns.map(column => [column.name, buildDefaultValue(column.name, column.type)]),
        )

        setEditingMessageId(null)
        setDraftJson(JSON.stringify(payload, null, 2))
        setDraftOpen(true)
        setError('')
    }

    const openEditRowDraft = (row: TableRow) => {
        const { _msgId: messageId, ...editableRow } = row
        setEditingMessageId(typeof messageId === 'number' ? messageId : null)
        setDraftJson(JSON.stringify(editableRow, null, 2))
        setDraftOpen(true)
        setError('')
    }

    const handleSaveDraft = async () => {
        if (!activeTable) return

        setSavingDraft(true)
        setError('')

        try {
            const payload = JSON.parse(draftJson) as Record<string, unknown>
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
            const baseUrl = `${apiUrl}/api/v1/${projectId}/tables/${activeTable}`
            const url = editingMessageId !== null ? `${baseUrl}?_msgId=eq.${editingMessageId}` : baseUrl
            const res = await authenticatedFetch(url, {
                method: editingMessageId !== null ? 'PATCH' : 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            })

            if (!res.ok) {
                const data = await res.json()
                throw new Error(data.error?.message || 'Failed to save row')
            }

            setDraftOpen(false)
            setEditingMessageId(null)
            await fetchTableData(activeTable)
        } catch (err) {
            setError((err as Error).message)
        } finally {
            setSavingDraft(false)
        }
    }

    const handleDeleteRow = async (messageId: number | undefined) => {
        if (!activeTable || messageId === undefined) return
        if (!window.confirm(`Delete row ${messageId}?`)) return

        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

        try {
            const res = await authenticatedFetch(
                `${apiUrl}/api/v1/${projectId}/tables/${activeTable}?_msgId=eq.${messageId}`,
                { method: 'DELETE' },
            )

            if (!res.ok) {
                const data = await res.json()
                throw new Error(data.error?.message || 'Failed to delete row')
            }

            setRowData(current => current.filter(row => row._msgId !== messageId))
        } catch (err) {
            setError((err as Error).message)
        }
    }

    return (
        <div className="shell py-8 md:py-10">
            <div>
                <h1 className="text-3xl font-semibold tracking-[-0.04em] text-white">Table editor</h1>
                <p className="mt-2 text-sm subtle">Browse schemas, inspect rows, edit payloads, and watch changes arrive live.</p>
            </div>

            {error && (
                <div className="mt-6 rounded-[10px] border border-[rgba(239,111,108,0.25)] bg-[rgba(239,111,108,0.08)] px-4 py-3 text-sm text-[#f0b1af]">
                    {error}
                </div>
            )}

            <section className="panel mt-6 overflow-hidden">
                <div className="panel-header flex flex-col gap-4 px-6 py-4 md:flex-row md:items-center md:justify-between">
                    <div className="flex items-center gap-3">
                        <span className="text-lg font-semibold text-white">Tables</span>
                        {activeTable && (
                            <span className="rounded-[10px] border border-[rgba(62,207,142,0.2)] bg-[rgba(62,207,142,0.08)] px-3 py-1 font-mono text-xs text-[color:var(--accent)]">
                                {activeTable}
                            </span>
                        )}
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                        <label className="inline-flex items-center gap-2 text-sm subtle">
                            <input
                                type="checkbox"
                                checked={realtimeEnabled}
                                onChange={event => setRealtimeEnabled(event.target.checked)}
                                className="h-4 w-4 rounded border-[color:var(--line)] bg-[color:var(--panel-soft)] accent-[color:var(--accent)]"
                            />
                            Realtime
                        </label>
                        <button
                            type="button"
                            onClick={() => activeTable && fetchTableData(activeTable)}
                            className="btn btn-secondary"
                        >
                            <RefreshCw className="h-4 w-4" />
                            Refresh
                        </button>
                        <button type="button" onClick={openNewRowDraft} disabled={!activeTable} className="btn btn-primary">
                            <Plus className="h-4 w-4" />
                            Add row
                        </button>
                    </div>
                </div>

                <div className="grid min-h-[620px] lg:grid-cols-[260px_minmax(0,1fr)]">
                    <aside className="border-b border-[color:var(--line)] bg-[rgba(255,255,255,0.02)] p-4 lg:border-b-0 lg:border-r">
                        <div className="mb-4 flex items-center justify-between">
                            <div className="text-xs font-medium subtle">Schema list</div>
                            <button type="button" onClick={() => setShowCreateTable(true)} className="btn btn-secondary h-9 min-h-0 px-3">
                                <Plus className="h-4 w-4" />
                            </button>
                        </div>

                        {showCreateTable && (
                            <div className="panel-soft mb-4 p-3">
                                <label htmlFor="new-table" className="label">
                                    New table
                                </label>
                                <input
                                    id="new-table"
                                    type="text"
                                    value={newTableName}
                                    onChange={event => setNewTableName(event.target.value)}
                                    onKeyDown={event => event.key === 'Enter' && void handleCreateTable()}
                                    placeholder="table_name"
                                    className="input"
                                    autoFocus
                                />
                                <div className="mt-3 flex gap-2">
                                    <button type="button" onClick={() => void handleCreateTable()} className="btn btn-primary flex-1">
                                        Create
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setShowCreateTable(false)
                                            setNewTableName('')
                                        }}
                                        className="btn btn-secondary flex-1"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        )}

                        <div className="space-y-1">
                            {loading && <p className="px-2 py-4 text-sm subtle">Loading tables...</p>}
                            {!loading && tables.length === 0 && !showCreateTable && (
                                <p className="px-2 py-4 text-sm subtle">No tables yet.</p>
                            )}

                            {tables.map(table => (
                                <button
                                    key={table.name}
                                    type="button"
                                    onClick={() => handleTableClick(table.name)}
                                    className="sidebar-link w-full"
                                    data-active={activeTable === table.name}
                                >
                                    <Database className="h-4 w-4" />
                                    {table.name}
                                </button>
                            ))}
                        </div>
                    </aside>

                    <div className="min-w-0">
                        {activeTable ? (
                            <div className="p-6">
                                {draftOpen && (
                                    <div className="panel-soft mb-6 p-4">
                                        <div className="flex items-center justify-between">
                                            <div className="text-base font-semibold text-white">
                                                {editingMessageId !== null ? `Edit row ${editingMessageId}` : 'New row'}
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setDraftOpen(false)
                                                    setEditingMessageId(null)
                                                }}
                                                className="btn btn-secondary h-9 min-h-0 px-3"
                                            >
                                                <X className="h-4 w-4" />
                                                Close
                                            </button>
                                        </div>
                                        <p className="mt-2 text-sm subtle">
                                            Edit the row payload directly. Filters use `_msgId`, so updates and deletes target the stored Telegram message.
                                        </p>
                                        <textarea
                                            value={draftJson}
                                            onChange={event => setDraftJson(event.target.value)}
                                            className="input mt-4 min-h-[240px] font-mono text-xs leading-6"
                                        />
                                        <div className="mt-4 flex gap-3">
                                            <button type="button" onClick={() => void handleSaveDraft()} disabled={savingDraft} className="btn btn-primary">
                                                <Save className="h-4 w-4" />
                                                {savingDraft ? 'Saving...' : 'Save row'}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setDraftOpen(false)
                                                    setEditingMessageId(null)
                                                }}
                                                className="btn btn-secondary"
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {rowData.length === 0 ? (
                                    <div className="empty-state">
                                        <div className="max-w-md">
                                            <Radio className="mx-auto h-10 w-10 text-[color:var(--accent)]" />
                                            <div className="mt-4 text-xl font-semibold text-white">No rows yet</div>
                                            <p className="mt-3 text-sm leading-7 subtle">
                                                Insert the first record with the add row action or create data through the API.
                                            </p>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="table-shell">
                                        <table className="data-table">
                                            <thead>
                                                <tr>
                                                    {columnDefs.map(column => (
                                                        <th key={column.field}>{column.headerName}</th>
                                                    ))}
                                                    <th>Actions</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {rowData.map(row => (
                                                    <tr key={String(row._msgId ?? crypto.randomUUID())}>
                                                        {columnDefs.map(column => (
                                                            <td key={column.field} className="font-mono text-xs text-white">
                                                                {formatValue(row[column.field])}
                                                            </td>
                                                        ))}
                                                        <td>
                                                            <div className="flex flex-wrap gap-2">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => openEditRowDraft(row)}
                                                                    className="btn btn-secondary h-9 min-h-0 px-3"
                                                                >
                                                                    <Pencil className="h-4 w-4" />
                                                                    Edit
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => void handleDeleteRow(row._msgId)}
                                                                    className="btn btn-danger h-9 min-h-0 px-3"
                                                                >
                                                                    <Trash2 className="h-4 w-4" />
                                                                    Delete
                                                                </button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="empty-state">
                                <div className="max-w-md">
                                    <Database className="mx-auto h-10 w-10 text-[color:var(--accent)]" />
                                    <div className="mt-4 text-xl font-semibold text-white">Select a table</div>
                                    <p className="mt-3 text-sm leading-7 subtle">
                                        Choose a table from the schema list to inspect its data.
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </section>
        </div>
    )
}

function buildDefaultValue(columnName: string, columnType: string): unknown {
    if (columnName === 'id' && columnType === 'uuid') {
        return crypto.randomUUID()
    }

    if (columnType === 'timestamp' && (columnName === 'created_at' || columnName === 'updated_at')) {
        return new Date().toISOString()
    }

    switch (columnType) {
        case 'number':
            return 0
        case 'boolean':
            return false
        case 'json':
            return {}
        default:
            return ''
    }
}

function formatValue(value: unknown): string {
    if (typeof value === 'string') {
        return value
    }

    if (value === null || value === undefined) {
        return ''
    }

    if (typeof value === 'object') {
        return JSON.stringify(value)
    }

    return String(value)
}
