/**
 * RealtimeClient — Socket.io client for realtime subscriptions.
 */

import { io, type Socket } from 'socket.io-client'
import type { RealtimePayload, RealtimeSubscription } from './types.js'

interface SubscriptionDescriptor {
    id: string
    table: string
    eventType: 'INSERT' | 'UPDATE' | 'DELETE' | '*'
    callback: (payload: RealtimePayload) => void
}

export class RealtimeClient {
    private socket: Socket | null = null
    private descriptors = new Map<string, SubscriptionDescriptor>()
    private broadcastHandlers = new Map<string, Set<(payload: { channel?: string; event: string; payload: unknown }) => void>>()
    private presenceHandlers = new Map<string, Set<(payload: { userId: string; status: string; timestamp: number }) => void>>()

    constructor(
        private projectUrl: string,
        private projectId: string,
        private getAccessToken: () => string | null,
        private getApiKey: () => string
    ) { }

    channel(name: string): RealtimeChannel {
        return new RealtimeChannel(name, this)
    }

    connect(): void {
        if (this.socket) return

        this.socket = io(this.projectUrl, {
            path: '/realtime/v1',
            transports: ['websocket', 'polling'],
            autoConnect: true,
        })

        this.socket.on('connect', () => {
            for (const descriptor of this.descriptors.values()) {
                this.emitSubscribe(descriptor)
            }

            for (const channel of this.broadcastHandlers.keys()) {
                this.socket?.emit('join_broadcast', {
                    projectId: this.projectId,
                    channel,
                    token: this.getAccessToken() || this.getApiKey(),
                })
            }

            if (this.presenceHandlers.size > 0) {
                this.socket?.emit('join_presence', {
                    projectId: this.projectId,
                    token: this.getAccessToken() || this.getApiKey(),
                })
            }
        })

        this.socket.onAny((eventName, payload: RealtimePayload) => {
            if (!this.isRealtimeEvent(eventName)) return

            for (const descriptor of this.descriptors.values()) {
                if (descriptor.table !== payload.table) continue
                if (descriptor.eventType !== '*' && descriptor.eventType !== eventName) continue
                descriptor.callback(payload)
            }
        })

        this.socket.on('broadcast', (payload: { channel?: string; event: string; payload: unknown }) => {
            for (const [channel, handlers] of this.broadcastHandlers.entries()) {
                if (payload.channel && payload.channel !== channel) {
                    continue
                }

                for (const handler of handlers) {
                    handler(payload)
                }
            }
        })

        this.socket.on('presence_update', (payload: { userId: string; status: string; timestamp: number }) => {
            for (const handlers of this.presenceHandlers.values()) {
                for (const handler of handlers) {
                    handler(payload)
                }
            }
        })
    }

    disconnect(): void {
        this.socket?.disconnect()
        this.socket = null
    }

    subscribeToTable(
        table: string,
        eventType: 'INSERT' | 'UPDATE' | 'DELETE' | '*',
        callback: (payload: RealtimePayload) => void
    ): RealtimeSubscription {
        this.connect()

        const id = `${table}:${eventType}:${Math.random().toString(36).slice(2)}`
        const descriptor: SubscriptionDescriptor = { id, table, eventType, callback }
        this.descriptors.set(id, descriptor)
        this.emitSubscribe(descriptor)

        return {
            unsubscribe: () => {
                this.descriptors.delete(id)
                this.socket?.emit('unsubscribe', {
                    projectId: this.projectId,
                    table,
                })
            },
        }
    }

    private emitSubscribe(descriptor: SubscriptionDescriptor): void {
        if (!this.socket?.connected) return

        this.socket.emit('subscribe', {
            projectId: this.projectId,
            table: descriptor.table,
            event: descriptor.eventType,
            token: this.getAccessToken() || this.getApiKey(),
        })
    }

    subscribeToBroadcast(
        channel: string,
        callback: (payload: { channel?: string; event: string; payload: unknown }) => void
    ): RealtimeSubscription {
        this.connect()

        const handlers = this.broadcastHandlers.get(channel) || new Set()
        handlers.add(callback)
        this.broadcastHandlers.set(channel, handlers)

        if (this.socket?.connected) {
            this.socket.emit('join_broadcast', {
                projectId: this.projectId,
                channel,
                token: this.getAccessToken() || this.getApiKey(),
            })
        } else {
            this.socket?.once('connect', () => {
                this.socket?.emit('join_broadcast', {
                    projectId: this.projectId,
                    channel,
                    token: this.getAccessToken() || this.getApiKey(),
                })
            })
        }

        return {
            unsubscribe: () => {
                const current = this.broadcastHandlers.get(channel)
                current?.delete(callback)
                if (current && current.size === 0) {
                    this.broadcastHandlers.delete(channel)
                }
            },
        }
    }

    subscribeToPresence(
        channel: string,
        callback: (payload: { userId: string; status: string; timestamp: number }) => void
    ): RealtimeSubscription {
        this.connect()

        const handlers = this.presenceHandlers.get(channel) || new Set()
        handlers.add(callback)
        this.presenceHandlers.set(channel, handlers)

        if (this.socket?.connected) {
            this.socket.emit('join_presence', {
                projectId: this.projectId,
                token: this.getAccessToken() || this.getApiKey(),
            })
        } else {
            this.socket?.once('connect', () => {
                this.socket?.emit('join_presence', {
                    projectId: this.projectId,
                    token: this.getAccessToken() || this.getApiKey(),
                })
            })
        }

        return {
            unsubscribe: () => {
                const current = this.presenceHandlers.get(channel)
                current?.delete(callback)
                if (current && current.size === 0) {
                    this.presenceHandlers.delete(channel)
                }
            },
        }
    }

    sendBroadcast(channel: string, event: string, payload: unknown): void {
        this.connect()
        this.socket?.emit('broadcast', {
            projectId: this.projectId,
            channel,
            event,
            payload,
        })
    }

    trackPresence(userId: string, status: string): void {
        this.connect()
        this.socket?.emit('presence', {
            projectId: this.projectId,
            userId,
            status,
        })
    }

    private isRealtimeEvent(eventName: string): eventName is 'INSERT' | 'UPDATE' | 'DELETE' | '*' {
        return eventName === 'INSERT'
            || eventName === 'UPDATE'
            || eventName === 'DELETE'
            || eventName === '*'
    }
}

export class RealtimeChannel {
    private handlers: Array<{
        table: string
        eventType: 'INSERT' | 'UPDATE' | 'DELETE' | '*'
        callback: (payload: RealtimePayload) => void
    }> = []
    private broadcastCallbacks: Array<(payload: { channel?: string; event: string; payload: unknown }) => void> = []
    private presenceCallbacks: Array<(payload: { userId: string; status: string; timestamp: number }) => void> = []

    constructor(
        private name: string,
        private client: RealtimeClient
    ) { }

    on(
        eventType: 'INSERT' | 'UPDATE' | 'DELETE' | '*',
        filter: { event: string; schema?: string; table?: string } | string,
        callback: (payload: RealtimePayload) => void
    ): this {
        const table = typeof filter === 'string' ? filter : filter.table || this.name
        this.handlers.push({ table, eventType, callback })
        return this
    }

    onBroadcast(callback: (payload: { channel?: string; event: string; payload: unknown }) => void): this {
        this.broadcastCallbacks.push(callback)
        return this
    }

    onPresence(callback: (payload: { userId: string; status: string; timestamp: number }) => void): this {
        this.presenceCallbacks.push(callback)
        return this
    }

    subscribe(): RealtimeSubscription {
        const subscriptions = this.handlers.map(handler =>
            this.client.subscribeToTable(handler.table, handler.eventType, handler.callback)
        )
        const broadcastSubscriptions = this.broadcastCallbacks.map(callback =>
            this.client.subscribeToBroadcast(this.name, callback)
        )
        const presenceSubscriptions = this.presenceCallbacks.map(callback =>
            this.client.subscribeToPresence(this.name, callback)
        )

        return {
            unsubscribe: () => {
                subscriptions.forEach(subscription => subscription.unsubscribe())
                broadcastSubscriptions.forEach(subscription => subscription.unsubscribe())
                presenceSubscriptions.forEach(subscription => subscription.unsubscribe())
            },
        }
    }

    send(event: string, payload: unknown): this {
        this.client.sendBroadcast(this.name, event, payload)
        return this
    }

    track(userId: string, status: string): this {
        this.client.trackPresence(userId, status)
        return this
    }
}
