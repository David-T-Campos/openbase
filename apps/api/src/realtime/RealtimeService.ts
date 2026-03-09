import type { Server as HttpServer } from 'http'
import type { JWTPayload, RealtimePayload, RLSPolicy } from '@openbase/core'
import { Server, Socket } from 'socket.io'
import jwt from 'jsonwebtoken'
import { checkRLSForRow, findPolicy } from '../middleware/rls.js'
import type { ProjectService } from '../projects/ProjectService.js'

interface RealtimeOptions {
    allowedOrigins?: Set<string>
}

interface TableSubscription {
    room: string
    projectId: string
    table: string
    eventType: 'INSERT' | 'UPDATE' | 'DELETE' | '*'
    user: JWTPayload
    selectPolicy?: RLSPolicy
    bypassRLS: boolean
}

export class RealtimeService {
    private io: Server
    private channelToTable: Map<string, { projectId: string; tableName: string }> = new Map()
    private subscriptions = new Map<string, Map<string, TableSubscription>>()

    constructor(
        httpServer: HttpServer,
        private readonly jwtSecret: string,
        private readonly projectService: ProjectService,
        options: RealtimeOptions = {}
    ) {
        this.io = new Server(httpServer, {
            path: '/realtime/v1',
            cors: {
                origin: (origin, callback) => {
                    if (!origin || !options.allowedOrigins || options.allowedOrigins.has(origin)) {
                        callback(null, true)
                        return
                    }

                    callback(null, false)
                },
                methods: ['GET', 'POST'],
                credentials: true,
            },
        })

        this.setupConnectionHandler()
    }

    registerProject(
        projectId: string,
        channelMap: Record<string, string>
    ): void {
        for (const [tableName, channelId] of Object.entries(channelMap)) {
            this.channelToTable.set(channelId, { projectId, tableName })
        }
    }

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

        this.emitTableEvent(`project:${projectId}:table:${tableName}`, eventType, payload, newRow, oldRow)
        this.emitTableEvent(`project:${projectId}:table:${tableName}:*`, '*', payload, newRow, oldRow)
    }

    getIO(): Server {
        return this.io
    }

    private setupConnectionHandler(): void {
        this.io.on('connection', (socket: Socket) => {
            socket.on('subscribe', async (data: {
                projectId: string
                table: string
                event: 'INSERT' | 'UPDATE' | 'DELETE' | '*'
                token?: string
            }) => {
                const auth = await this.authorizeTableSubscription(data.projectId, data.table, data.token)
                if (!auth) {
                    socket.emit('error', { message: 'Invalid token or insufficient access' })
                    return
                }

                const room = `project:${data.projectId}:table:${data.table}${data.event === '*' ? ':*' : ''}`
                socket.join(room)
                this.storeSubscription(socket.id, {
                    room,
                    projectId: data.projectId,
                    table: data.table,
                    eventType: data.event,
                    user: auth.user,
                    selectPolicy: auth.selectPolicy,
                    bypassRLS: auth.bypassRLS,
                })
                socket.emit('subscribed', { room })
            })

            socket.on('unsubscribe', (data: { projectId: string; table: string }) => {
                this.removeSubscription(socket.id, `project:${data.projectId}:table:${data.table}`)
                this.removeSubscription(socket.id, `project:${data.projectId}:table:${data.table}:*`)
                socket.leave(`project:${data.projectId}:table:${data.table}`)
                socket.leave(`project:${data.projectId}:table:${data.table}:*`)
            })

            socket.on('presence', async (data: { projectId: string; userId: string; status: string; token?: string }) => {
                const payload = await this.verifyProjectToken(data.projectId, data.token)
                if (!payload) {
                    socket.emit('error', { message: 'Invalid token' })
                    return
                }

                this.io
                    .to(`project:${data.projectId}:presence`)
                    .emit('presence_update', {
                        userId: data.userId,
                        status: data.status,
                        timestamp: Date.now(),
                        actor: payload.sub,
                    })
            })

            socket.on('broadcast', async (data: {
                projectId: string
                channel: string
                event: string
                payload: unknown
                token?: string
            }) => {
                const payload = await this.verifyProjectToken(data.projectId, data.token)
                if (!payload) {
                    socket.emit('error', { message: 'Invalid token' })
                    return
                }

                socket
                    .to(`project:${data.projectId}:broadcast:${data.channel}`)
                    .emit('broadcast', {
                        channel: data.channel,
                        event: data.event,
                        payload: data.payload,
                        actor: payload.sub,
                    })
            })

            socket.on('join_presence', async (data: { projectId: string; token?: string }) => {
                const payload = await this.verifyProjectToken(data.projectId, data.token)
                if (!payload) {
                    socket.emit('error', { message: 'Invalid token' })
                    return
                }

                socket.join(`project:${data.projectId}:presence`)
                socket.data.presenceUser = payload.sub
            })

            socket.on('join_broadcast', async (data: { projectId: string; channel: string; token?: string }) => {
                const payload = await this.verifyProjectToken(data.projectId, data.token)
                if (!payload) {
                    socket.emit('error', { message: 'Invalid token' })
                    return
                }

                socket.join(`project:${data.projectId}:broadcast:${data.channel}`)
                socket.data.broadcastUser = payload.sub
            })

            socket.on('disconnect', () => {
                this.subscriptions.delete(socket.id)
            })
        })
    }

    private emitTableEvent(
        room: string,
        eventName: 'INSERT' | 'UPDATE' | 'DELETE' | '*',
        payload: RealtimePayload,
        newRow: Record<string, unknown> | null,
        oldRow: Record<string, unknown> | null
    ): void {
        const socketIds = this.io.sockets.adapter.rooms.get(room)
        if (!socketIds) {
            return
        }

        for (const socketId of socketIds) {
            const socket = this.io.sockets.sockets.get(socketId)
            const subscription = this.subscriptions.get(socketId)?.get(room)
            if (!socket || !subscription) {
                continue
            }

            if (!this.canReceiveRowEvent(subscription, newRow, oldRow)) {
                continue
            }

            socket.emit(eventName, payload)
        }
    }

    private canReceiveRowEvent(
        subscription: TableSubscription,
        newRow: Record<string, unknown> | null,
        oldRow: Record<string, unknown> | null
    ): boolean {
        if (subscription.bypassRLS || !subscription.selectPolicy) {
            return true
        }

        const rows = [newRow, oldRow].filter((row): row is Record<string, unknown> => row !== null)
        if (rows.length === 0) {
            return false
        }

        return rows.some(row => checkRLSForRow(row, subscription.selectPolicy, subscription.user))
    }

    private async authorizeTableSubscription(
        projectId: string,
        table: string,
        token: string | undefined
    ): Promise<{ user: JWTPayload; selectPolicy?: RLSPolicy; bypassRLS: boolean } | null> {
        const user = await this.verifyProjectToken(projectId, token)
        if (!user) {
            return null
        }

        const schemas = await this.projectService.getSchemas(projectId)
        const schema = schemas[table]
        if (!schema) {
            return null
        }

        const project = await this.projectService.getProject(projectId)
        const bypassRLS = user.role === 'service_role'
            || (user.role === 'platform_user' && user.sub === project.ownerId)

        return {
            user,
            selectPolicy: findPolicy(schema.rls, 'SELECT'),
            bypassRLS,
        }
    }

    private async verifyProjectToken(projectId: string, token?: string): Promise<JWTPayload | null> {
        if (!token) {
            return null
        }

        let payload: JWTPayload
        try {
            payload = jwt.verify(token, this.jwtSecret) as JWTPayload
        } catch {
            return null
        }

        if (payload.type === 'refresh') {
            return null
        }

        const project = await this.projectService.getProject(projectId)
        if (payload.role === 'platform_user') {
            return payload.sub === project.ownerId ? payload : null
        }

        return payload.projectId === projectId ? payload : null
    }

    private storeSubscription(socketId: string, subscription: TableSubscription): void {
        const existing = this.subscriptions.get(socketId) ?? new Map<string, TableSubscription>()
        existing.set(subscription.room, subscription)
        this.subscriptions.set(socketId, existing)
    }

    private removeSubscription(socketId: string, room: string): void {
        const existing = this.subscriptions.get(socketId)
        if (!existing) {
            return
        }

        existing.delete(room)
        if (existing.size === 0) {
            this.subscriptions.delete(socketId)
        }
    }
}
