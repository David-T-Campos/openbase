import { io, type Socket } from 'socket.io-client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TestAppContext } from './helpers/testApp.js'
import { createTestApp } from './helpers/testApp.js'

describe('Realtime integrations', () => {
    let context: TestAppContext

    beforeEach(async () => {
        context = await createTestApp({ listen: true })
    })

    afterEach(async () => {
        await context.close()
    })

    it('enforces project membership and row-level security across subscriptions', async () => {
        const owner = await signUpPlatform(context, 'realtime@example.com')
        const projectA = await createProject(context, owner.access_token, 'Realtime A')
        const projectB = await createProject(context, owner.access_token, 'Realtime B')

        await createTable(context, projectA.id, projectA.serviceRoleKey, {
            tableName: 'messages',
            columns: [
                { name: 'id', type: 'uuid', required: true, unique: true },
                { name: 'body', type: 'text', required: true },
                { name: 'user_id', type: 'text', required: true },
            ],
            indexes: ['user_id'],
            rls: [
                { operation: 'SELECT', check: 'user_id = auth.uid()' },
            ],
        })

        await createTable(context, projectB.id, projectB.serviceRoleKey, {
            tableName: 'messages',
            columns: [
                { name: 'id', type: 'uuid', required: true, unique: true },
                { name: 'body', type: 'text', required: true },
                { name: 'user_id', type: 'text', required: true },
            ],
            indexes: ['user_id'],
        })

        const alice = await signInUser(context, projectA.id, 'alice@example.com')
        const bob = await signInUser(context, projectA.id, 'bob@example.com')

        const aliceSocket = connectSocket(context.baseUrl!)
        const bobSocket = connectSocket(context.baseUrl!)

        const aliceInsert = waitForEvent<{ new: { user_id: string } }>(aliceSocket, 'INSERT')
        bobSocket.on('INSERT', () => undefined)

        aliceSocket.emit('subscribe', {
            projectId: projectA.id,
            table: 'messages',
            event: 'INSERT',
            token: alice.access_token,
        })

        bobSocket.emit('subscribe', {
            projectId: projectA.id,
            table: 'messages',
            event: 'INSERT',
            token: bob.access_token,
        })

        await Promise.all([
            waitForEvent(aliceSocket, 'subscribed'),
            waitForEvent(bobSocket, 'subscribed'),
        ])

        const crossProjectError = waitForEvent<{ message: string }>(aliceSocket, 'error')
        aliceSocket.emit('subscribe', {
            projectId: projectB.id,
            table: 'messages',
            event: 'INSERT',
            token: alice.access_token,
        })
        expect((await crossProjectError).message).toContain('Invalid token')

        const bobMissesEvent = waitForNoEvent(bobSocket, 'INSERT', 400)

        const insertResponse = await context.app.inject({
            method: 'POST',
            url: `/api/v1/${projectA.id}/tables/messages`,
            headers: authHeaders(projectA.serviceRoleKey),
            payload: {
                body: 'visible only to alice',
                user_id: alice.user.id,
            },
        })

        expect(insertResponse.statusCode).toBe(201)
        expect((await aliceInsert).new.user_id).toBe(alice.user.id)
        await bobMissesEvent

        aliceSocket.close()
        bobSocket.close()
    })

    it('keeps presence isolated per channel', async () => {
        const owner = await signUpPlatform(context, 'presence@example.com')
        const project = await createProject(context, owner.access_token, 'Presence Project')
        const alice = await signInUser(context, project.id, 'presence-user@example.com')

        const socket = connectSocket(context.baseUrl!)
        const channelAEvents: Array<{ channel: string; event: string }> = []
        const channelBEvents: Array<{ channel: string; event: string }> = []

        socket.on('presence_state', payload => {
            if (payload.channel === 'alpha') {
                channelAEvents.push({ channel: payload.channel, event: 'sync' })
            }
            if (payload.channel === 'beta') {
                channelBEvents.push({ channel: payload.channel, event: 'sync' })
            }
        })

        socket.on('presence_diff', payload => {
            if (payload.channel === 'alpha') {
                channelAEvents.push({ channel: payload.channel, event: 'diff' })
            }
            if (payload.channel === 'beta') {
                channelBEvents.push({ channel: payload.channel, event: 'diff' })
            }
        })

        socket.emit('join_presence', { projectId: project.id, channel: 'alpha', token: alice.access_token })
        socket.emit('join_presence', { projectId: project.id, channel: 'beta', token: alice.access_token })
        await waitForCondition(() => channelAEvents.length > 0 && channelBEvents.length > 0)

        socket.emit('presence', {
            projectId: project.id,
            channel: 'alpha',
            userId: alice.user.id,
            status: 'online',
            token: alice.access_token,
        })

        await waitForCondition(() => channelAEvents.some(event => event.event === 'diff'))
        expect(channelBEvents.some(event => event.event === 'diff')).toBe(false)

        socket.close()
    })
})

async function signUpPlatform(context: TestAppContext, email: string) {
    const response = await context.app.inject({
        method: 'POST',
        url: '/api/v1/platform/auth/signup',
        payload: { email, password: 'password123' },
    })

    return readJson(response).data.session as { access_token: string; refresh_token: string }
}

async function createProject(context: TestAppContext, accessToken: string, name: string) {
    const response = await context.app.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: { Authorization: `Bearer ${accessToken}` },
        payload: { name, telegramSession: `session-${name}` },
    })

    return readJson(response).data as {
        id: string
        serviceRoleKey: string
    }
}

async function createTable(
    context: TestAppContext,
    projectId: string,
    serviceRoleKey: string,
    payload: Record<string, unknown>
) {
    await context.app.inject({
        method: 'POST',
        url: `/api/v1/${projectId}/tables`,
        headers: authHeaders(serviceRoleKey),
        payload,
    })
}

async function signInUser(context: TestAppContext, projectId: string, email: string) {
    await context.app.inject({
        method: 'POST',
        url: `/api/v1/${projectId}/auth/signup`,
        payload: { email, password: 'password123' },
    })

    const response = await context.app.inject({
        method: 'POST',
        url: `/api/v1/${projectId}/auth/signin`,
        payload: { email, password: 'password123' },
    })

    const payload = readJson(response).data
    return {
        access_token: payload.session.access_token as string,
        user: payload.user as { id: string },
    }
}

function connectSocket(baseUrl: string): Socket {
    return io(baseUrl, {
        path: '/realtime/v1',
        transports: ['websocket'],
        autoConnect: true,
    })
}

function authHeaders(token: string) {
    return {
        Authorization: `Bearer ${token}`,
        apikey: token,
    }
}

function readJson(response: { body: string }) {
    return JSON.parse(response.body) as Record<string, any>
}

function waitForEvent<T>(socket: Socket, event: string): Promise<T> {
    return new Promise(resolve => {
        socket.once(event, payload => resolve(payload as T))
    })
}

function waitForNoEvent(socket: Socket, event: string, ms: number): Promise<void> {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            socket.off(event, onEvent)
            resolve()
        }, ms)

        const onEvent = () => {
            clearTimeout(timeout)
            reject(new Error(`Unexpected ${event} event`))
        }

        socket.once(event, onEvent)
    })
}

async function waitForCondition(check: () => boolean, timeoutMs: number = 1_000): Promise<void> {
    const started = Date.now()
    while (!check()) {
        if (Date.now() - started > timeoutMs) {
            throw new Error('Condition was not met before timeout')
        }
        await new Promise(resolve => setTimeout(resolve, 20))
    }
}
