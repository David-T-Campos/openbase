import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TestAppContext } from './helpers/testApp.js'
import { createTestApp } from './helpers/testApp.js'

describe('API integrations', () => {
    let context: TestAppContext

    beforeEach(async () => {
        context = await createTestApp()
    })

    afterEach(async () => {
        vi.restoreAllMocks()
        await context.close()
    })

    it('covers auth, database CRUD, storage, and security-sensitive failures', async () => {
        const platformSession = await signUpPlatform(context, 'owner@example.com')
        const project = await createProject(context, platformSession.access_token, 'Audit Project')

        await createTable(context, project.id, project.serviceRoleKey, {
            tableName: 'tasks',
            columns: [
                { name: 'id', type: 'uuid', required: true, unique: true },
                { name: 'title', type: 'text', required: true },
                { name: 'user_id', type: 'text' },
            ],
            indexes: ['user_id'],
        })

        const signUpResponse = await context.app.inject({
            method: 'POST',
            url: `/api/v1/${project.id}/auth/signup`,
            payload: {
                email: 'alice@example.com',
                password: 'password123',
            },
        })
        expect(signUpResponse.statusCode).toBe(201)
        const signUpPayload = readJson(signUpResponse)
        expect(signUpPayload.error).toBeNull()
        expect(signUpPayload.data.user.email).toBe('alice@example.com')

        const signInResponse = await context.app.inject({
            method: 'POST',
            url: `/api/v1/${project.id}/auth/signin`,
            payload: {
                email: 'alice@example.com',
                password: 'password123',
            },
        })
        const signInPayload = readJson(signInResponse)
        const accessToken = signInPayload.data.session.access_token as string
        const refreshToken = signInPayload.data.session.refresh_token as string

        const refreshBearerResponse = await context.app.inject({
            method: 'GET',
            url: `/api/v1/${project.id}/tables`,
            headers: {
                Authorization: `Bearer ${refreshToken}`,
            },
        })
        expect(refreshBearerResponse.statusCode).toBe(401)
        expect(readJson(refreshBearerResponse).error.code).toBe('INVALID_TOKEN_TYPE')

        const oauthRedirectResponse = await context.app.inject({
            method: 'POST',
            url: `/api/v1/${project.id}/auth/oauth/google/start`,
            payload: { redirectTo: 'https://attacker.example/steal' },
        })
        expect(oauthRedirectResponse.statusCode).toBe(400)

        const insertResponse = await context.app.inject({
            method: 'POST',
            url: `/api/v1/${project.id}/tables/tasks`,
            headers: authHeaders(project.serviceRoleKey),
            payload: { title: 'first task', user_id: 'alice' },
        })
        expect(insertResponse.statusCode).toBe(201)
        expect(readJson(insertResponse).error).toBeNull()

        const countResponse = await context.app.inject({
            method: 'GET',
            url: `/api/v1/${project.id}/tables/tasks/count`,
            headers: authHeaders(project.serviceRoleKey),
        })
        expect(countResponse.statusCode).toBe(200)
        expect(readJson(countResponse).data.count).toBe(1)

        const bucketResponse = await context.app.inject({
            method: 'POST',
            url: `/api/v1/${project.id}/storage/buckets`,
            headers: authHeaders(project.serviceRoleKey),
            payload: { name: 'private-files', public: false },
        })
        expect(bucketResponse.statusCode).toBe(201)

        const uploadResponse = await context.app.inject({
            method: 'POST',
            url: `/api/v1/${project.id}/storage/private-files/reports/quarterly.txt`,
            headers: {
                ...authHeaders(accessToken),
                'content-type': 'multipart/form-data; boundary=----openbase',
            },
            payload: [
                '------openbase\r\n',
                'Content-Disposition: form-data; name="file"; filename="quarterly.txt"\r\n',
                'Content-Type: text/plain\r\n\r\n',
                'hello from storage\r\n',
                '------openbase--\r\n',
            ].join(''),
        })
        expect(uploadResponse.statusCode).toBe(201)

        const anonymousRead = await context.app.inject({
            method: 'GET',
            url: `/api/v1/${project.id}/storage/private-files/reports/quarterly.txt`,
        })
        expect(anonymousRead.statusCode).toBe(403)

        const authenticatedDownload = await context.app.inject({
            method: 'GET',
            url: `/api/v1/${project.id}/storage/private-files/reports/quarterly.txt`,
            headers: authHeaders(accessToken),
        })
        expect(authenticatedDownload.statusCode).toBe(200)
        expect(authenticatedDownload.body).toContain('hello from storage')

        const logsResponse = await context.app.inject({
            method: 'GET',
            url: `/api/v1/projects/${project.id}/logs`,
            headers: {
                Authorization: `Bearer ${platformSession.access_token}`,
            },
        })
        expect(logsResponse.statusCode).toBe(200)
        expect(Array.isArray(readJson(logsResponse).data)).toBe(true)
    })

    it('tracks webhook delivery metadata, dead letters, and replay', async () => {
        const platformSession = await signUpPlatform(context, 'hooks@example.com')
        const project = await createProject(context, platformSession.access_token, 'Hooks Project')

        await createTable(context, project.id, project.serviceRoleKey, {
            tableName: 'events',
            columns: [
                { name: 'id', type: 'uuid', required: true, unique: true },
                { name: 'payload', type: 'text', required: true },
            ],
            indexes: ['id'],
        })

        const fetchMock = vi.fn()
        fetchMock
            .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'boom' }), { status: 500, headers: { 'content-type': 'application/json' } }))
            .mockResolvedValue(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))
        vi.stubGlobal('fetch', fetchMock)

        const createWebhookResponse = await context.app.inject({
            method: 'POST',
            url: `/api/v1/projects/${project.id}/webhooks`,
            headers: {
                Authorization: `Bearer ${platformSession.access_token}`,
            },
            payload: {
                url: 'https://hooks.example/openbase',
                events: ['INSERT'],
                enabled: true,
            },
        })
        const webhook = readJson(createWebhookResponse).data

        const insertResponse = await context.app.inject({
            method: 'POST',
            url: `/api/v1/${project.id}/tables/events`,
            headers: authHeaders(project.serviceRoleKey),
            payload: { payload: 'trigger webhook' },
        })
        expect(insertResponse.statusCode).toBe(201)

        const webhookListResponse = await context.app.inject({
            method: 'GET',
            url: `/api/v1/projects/${project.id}/webhooks`,
            headers: {
                Authorization: `Bearer ${platformSession.access_token}`,
            },
        })
        const webhookState = readJson(webhookListResponse).data[0]
        expect(webhookState.totalFailures).toBe(1)
        expect(webhookState.lastFailureReason).toContain('HTTP 500')

        const deadLetterResponse = await context.app.inject({
            method: 'GET',
            url: `/api/v1/projects/${project.id}/webhooks/dead`,
            headers: {
                Authorization: `Bearer ${platformSession.access_token}`,
            },
        })
        const deadLetter = readJson(deadLetterResponse).data[0]
        expect(deadLetter.webhookId).toBe(webhook.id)

        const replayResponse = await context.app.inject({
            method: 'POST',
            url: `/api/v1/projects/${project.id}/webhooks/dead/${deadLetter.id}/replay`,
            headers: {
                Authorization: `Bearer ${platformSession.access_token}`,
            },
        })
        expect(replayResponse.statusCode).toBe(200)

        const replayedWebhookResponse = await context.app.inject({
            method: 'GET',
            url: `/api/v1/projects/${project.id}/webhooks`,
            headers: {
                Authorization: `Bearer ${platformSession.access_token}`,
            },
        })
        const replayedWebhook = readJson(replayedWebhookResponse).data[0]
        expect(replayedWebhook.lastReplayAt).toBeTruthy()

        const emptyDeadLetterResponse = await context.app.inject({
            method: 'GET',
            url: `/api/v1/projects/${project.id}/webhooks/dead`,
            headers: {
                Authorization: `Bearer ${platformSession.access_token}`,
            },
        })
        expect(readJson(emptyDeadLetterResponse).data).toHaveLength(0)
    })
})

async function signUpPlatform(context: TestAppContext, email: string) {
    const response = await context.app.inject({
        method: 'POST',
        url: '/api/v1/platform/auth/signup',
        payload: {
            email,
            password: 'password123',
        },
    })

    expect(response.statusCode).toBe(201)
    return readJson(response).data.session as { access_token: string; refresh_token: string }
}

async function createProject(context: TestAppContext, accessToken: string, name: string) {
    const response = await context.app.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
        payload: {
            name,
            telegramSession: `session-${name}`,
        },
    })

    expect(response.statusCode).toBe(201)
    return readJson(response).data as {
        id: string
        anonKey: string
        serviceRoleKey: string
    }
}

async function createTable(
    context: TestAppContext,
    projectId: string,
    serviceRoleKey: string,
    payload: Record<string, unknown>
) {
    const response = await context.app.inject({
        method: 'POST',
        url: `/api/v1/${projectId}/tables`,
        headers: authHeaders(serviceRoleKey),
        payload,
    })

    expect(response.statusCode).toBe(201)
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
