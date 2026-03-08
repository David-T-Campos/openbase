/**
 * RealtimeService — WebSocket bridge between Telegram events and client subscriptions.
 *
 * Uses Socket.io to manage WebSocket connections. When a new message
 * (row) appears in a Telegram channel, it's broadcast to all subscribed clients.
 */

import { Server, Socket } from 'socket.io'
import type { Server as HttpServer } from 'http'
import jwt from 'jsonwebtoken'
import type { JWTPayload, RealtimePayload } from '@openbase/core'

export class RealtimeService {
    private io: Server
    private channelToTable: Map<string, { projectId: string; tableName: string }> = new Map()

    constructor(
        httpServer: HttpServer,
        private jwtSecret: string
    ) {
        this.io = new Server(httpServer, {
            path: '/realtime/v1',
            cors: {
                origin: '*',
                methods: ['GET', 'POST'],
            },
        })

        this.setupConnectionHandler()
    }

    /**
     * Register a project's channel→table mapping for realtime events.
     */
    registerProject(
        projectId: string,
        channelMap: Record<string, string> // tableName → channelId
    ): void {
        for (const [tableName, channelId] of Object.entries(channelMap)) {
            this.channelToTable.set(channelId, { projectId, tableName })
        }
    }

    /**
     * Broadcast a change event to subscribed clients (called by API routes).
     */
    broadcastChange(
        projectId: string,
        tableName: string,
        eventType: 'INSERT' | 'UPDATE' | 'DELETE',
        newRow: Record<string, unknown> | null,
        oldRow: Record<string, unknown> | null
    ): void {
        const payload: RealtimePayload = {
            schema: 'public',
            table: tableName,
            commit_timestamp: new Date().toISOString(),
            eventType,
            new: newRow,
            old: oldRow,
        }

        this.io.to(`project:${projectId}:table:${tableName}`).emit(eventType, payload)
        this.io.to(`project:${projectId}:table:${tableName}:*`).emit('*', payload)
    }

    /**
     * Set up WebSocket connection handler.
     */
    private setupConnectionHandler(): void {
        this.io.on('connection', (socket: Socket) => {
            // Subscribe to table events
            socket.on('subscribe', (data: { projectId: string; table: string; event: string; token: string }) => {
                // Verify JWT
                try {
                    const payload = jwt.verify(data.token, this.jwtSecret) as JWTPayload
                    if (payload.role !== 'platform_user' && payload.projectId !== data.projectId) {
                        socket.emit('error', { message: 'Token does not match project' })
                        return
                    }
                } catch {
                    socket.emit('error', { message: 'Invalid token' })
                    return
                }

                const room = `project:${data.projectId}:table:${data.table}${data.event === '*' ? ':*' : ''}`
                socket.join(room)
                socket.emit('subscribed', { room })
            })

            // Unsubscribe
            socket.on('unsubscribe', (data: { projectId: string; table: string }) => {
                socket.leave(`project:${data.projectId}:table:${data.table}`)
                socket.leave(`project:${data.projectId}:table:${data.table}:*`)
            })

            // Presence tracking
            socket.on('presence', (data: { projectId: string; userId: string; status: string }) => {
                this.io
                    .to(`project:${data.projectId}:presence`)
                    .emit('presence_update', {
                        userId: data.userId,
                        status: data.status,
                        timestamp: Date.now(),
                    })
            })

            // Broadcast channel (user-to-user messaging)
            socket.on('broadcast', (data: {
                projectId: string
                channel: string
                event: string
                payload: unknown
            }) => {
                socket
                    .to(`project:${data.projectId}:broadcast:${data.channel}`)
                    .emit('broadcast', { channel: data.channel, event: data.event, payload: data.payload })
            })

            // Join presence/broadcast rooms
            socket.on('join_presence', (data: { projectId: string; token: string }) => {
                try {
                    const payload = jwt.verify(data.token, this.jwtSecret) as JWTPayload
                    if (payload.role !== 'platform_user' && payload.projectId !== data.projectId) {
                        throw new Error('Invalid token')
                    }
                    socket.join(`project:${data.projectId}:presence`)
                } catch {
                    socket.emit('error', { message: 'Invalid token' })
                }
            })

            socket.on('join_broadcast', (data: { projectId: string; channel: string; token: string }) => {
                try {
                    const payload = jwt.verify(data.token, this.jwtSecret) as JWTPayload
                    if (payload.role !== 'platform_user' && payload.projectId !== data.projectId) {
                        throw new Error('Invalid token')
                    }
                    socket.join(`project:${data.projectId}:broadcast:${data.channel}`)
                } catch {
                    socket.emit('error', { message: 'Invalid token' })
                }
            })
        })
    }

    /**
     * Get the Socket.io server instance.
     */
    getIO(): Server {
        return this.io
    }
}
