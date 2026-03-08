'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { io, Socket } from 'socket.io-client'
import { Activity, Eraser, Play, Square } from 'lucide-react'
import { authenticatedFetch, getPlatformSession } from '../../../../lib/platformApi'

interface LogEntry {
    id: string
    timestamp: string
    event: string
    table: string
    data: Record<string, unknown>
}

export default function RealtimeLogsPage() {
    const params = useParams()
    const projectId = params.projectId as string

    const [logs, setLogs] = useState<LogEntry[]>([])
    const [isConnected, setIsConnected] = useState(false)
    const [tables, setTables] = useState<string[]>([])
    const [selectedTable, setSelectedTable] = useState('')
    const socketRef = useRef<Socket | null>(null)

    useEffect(() => {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
        authenticatedFetch(`${apiUrl}/api/v1/${projectId}/tables`)
            .then((response: Response) => response.json())
            .then((data: { data?: Array<{ name: string }> }) => {
                if (!Array.isArray(data.data)) return
                const names = data.data.map((table: { name: string }) => table.name)
                setTables(names)
                if (names.length > 0) setSelectedTable(names[0])
            })
            .catch(() => null)
    }, [projectId])

    const handleConnect = useCallback(() => {
        if (isConnected && socketRef.current) {
            socketRef.current.disconnect()
            socketRef.current = null
            setIsConnected(false)
            return
        }

        if (!selectedTable) return

        const token = getPlatformSession()?.accessToken
        if (!token) {
            return
        }
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
        const socket = io(apiUrl, {
            path: '/realtime/v1',
            transports: ['websocket', 'polling'],
        })

        socket.on('connect', () => {
            setIsConnected(true)
            socket.emit('subscribe', {
                projectId,
                table: selectedTable,
                event: '*',
                token,
            })
        })

        socket.on('subscribed', (data: { room: string }) => {
            setLogs(prev => [
                {
                    id: crypto.randomUUID(),
                    timestamp: new Date().toISOString(),
                    event: 'SUBSCRIBED',
                    table: selectedTable,
                    data: { room: data.room },
                },
                ...prev,
            ])
        })

        for (const eventType of ['INSERT', 'UPDATE', 'DELETE', '*']) {
            socket.on(eventType, (payload: { table: string; eventType: string; new: Record<string, unknown> | null }) => {
                setLogs(prev => [
                    {
                        id: crypto.randomUUID(),
                        timestamp: new Date().toISOString(),
                        event: payload.eventType || eventType,
                        table: payload.table,
                        data: payload.new || {},
                    },
                    ...prev,
                ].slice(0, 100))
            })
        }

        socket.on('error', (data: { message: string }) => {
            setLogs(prev => [
                {
                    id: crypto.randomUUID(),
                    timestamp: new Date().toISOString(),
                    event: 'ERROR',
                    table: '',
                    data: { message: data.message },
                },
                ...prev,
            ])
        })

        socket.on('disconnect', () => {
            setIsConnected(false)
        })

        socketRef.current = socket
    }, [isConnected, projectId, selectedTable])

    useEffect(() => {
        return () => {
            if (socketRef.current) {
                socketRef.current.disconnect()
            }
        }
    }, [])

    const eventTone = (event: string) => {
        if (event === 'INSERT') return 'text-[color:var(--success)]'
        if (event === 'UPDATE') return 'text-[color:var(--warning)]'
        if (event === 'DELETE') return 'text-[color:var(--danger)]'
        if (event === 'SUBSCRIBED') return 'text-[color:var(--accent)]'
        return 'text-[color:var(--muted)]'
    }

    return (
        <div className="shell py-8 md:py-10">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                <div>
                    <h1 className="text-3xl font-semibold tracking-[-0.04em] text-white">Realtime</h1>
                    <p className="mt-2 text-sm subtle">Subscribe to table events and inspect the live event stream.</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    {tables.length > 0 && (
                        <select
                            value={selectedTable}
                            onChange={e => setSelectedTable(e.target.value)}
                            disabled={isConnected}
                            className="select min-w-[220px] disabled:opacity-60"
                        >
                            {tables.map(table => (
                                <option key={table} value={table}>
                                    {table}
                                </option>
                            ))}
                        </select>
                    )}
                    <button
                        type="button"
                        onClick={handleConnect}
                        disabled={!selectedTable && !isConnected}
                        className={isConnected ? 'btn btn-danger' : 'btn btn-primary'}
                    >
                        {isConnected ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                        {isConnected ? 'Disconnect' : 'Connect'}
                    </button>
                </div>
            </div>

            <section className="panel mt-6 overflow-hidden">
                <div className="panel-header flex flex-col gap-4 px-6 py-4 md:flex-row md:items-center md:justify-between">
                    <div className="flex items-center gap-3">
                        <div className={`status-badge ${isConnected ? 'text-[color:var(--success)]' : 'text-[color:var(--muted)]'}`}>
                            <span className="status-dot" />
                            {isConnected ? `connected to ${selectedTable}` : 'disconnected'}
                        </div>
                        <div className="text-sm subtle">
                            {isConnected ? 'Listening for row-level changes.' : 'Waiting for a connection.'}
                        </div>
                    </div>
                    {logs.length > 0 && (
                        <button type="button" onClick={() => setLogs([])} className="btn btn-secondary">
                            <Eraser className="h-4 w-4" />
                            Clear log
                        </button>
                    )}
                </div>

                {logs.length === 0 ? (
                    <div className="empty-state">
                        <div className="max-w-md">
                            <Activity className="mx-auto h-10 w-10 text-[color:var(--accent)]" />
                            <div className="mt-4 text-xl font-semibold text-white">
                                {isConnected ? 'Waiting for events' : 'Open a realtime connection'}
                            </div>
                            <p className="mt-3 text-sm leading-7 subtle">
                                {isConnected
                                    ? 'Mutations on the selected table will appear here as they arrive.'
                                    : 'Choose a table and connect to inspect inserts, updates, deletes, and subscription messages.'}
                            </p>
                        </div>
                    </div>
                ) : (
                    <div className="max-h-[680px] overflow-y-auto">
                        {logs.map(log => (
                            <div
                                key={log.id}
                                className="grid gap-3 border-b border-[color:var(--line)] px-6 py-4 md:grid-cols-[120px_120px_160px_minmax(0,1fr)] md:items-start"
                            >
                                <div className="font-mono text-xs subtle">{new Date(log.timestamp).toLocaleTimeString()}</div>
                                <div className={`status-badge ${eventTone(log.event)}`}>
                                    <span className="status-dot" />
                                    {log.event}
                                </div>
                                <div className="font-mono text-xs subtle-strong">{log.table || '-'}</div>
                                <code className="block overflow-x-auto text-xs subtle">{JSON.stringify(log.data)}</code>
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </div>
    )
}
