import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync } from 'fs'
import type { TestAppContext } from './helpers/testApp.js'
import { createTestApp } from './helpers/testApp.js'

describe('operator integrations', () => {
    let context: TestAppContext

    beforeEach(async () => {
        context = await createTestApp()
    })

    afterEach(async () => {
        vi.restoreAllMocks()
        await context.close()
    })

    it('creates and restores backups through the operator API', async () => {
        const session = await signUpPlatform(context, 'ops@example.com')
        const project = await createProject(context, session.access_token, 'Backup Project')

        const createBackupResponse = await context.app.inject({
            method: 'POST',
            url: '/api/v1/ops/backups',
            headers: {
                Authorization: `Bearer ${session.access_token}`,
            },
        })
        expect(createBackupResponse.statusCode).toBe(201)
        const backup = readJson(createBackupResponse).data
        expect(backup.projectCount).toBe(1)
        expect(existsSync(backup.backupPath)).toBe(true)

        const updateProjectResponse = await context.app.inject({
            method: 'PUT',
            url: `/api/v1/projects/${project.id}`,
            headers: {
                Authorization: `Bearer ${session.access_token}`,
            },
            payload: {
                name: 'Changed Project',
            },
        })
        expect(updateProjectResponse.statusCode).toBe(200)

        const restoreResponse = await context.app.inject({
            method: 'POST',
            url: `/api/v1/ops/backups/${backup.id}/restore`,
            headers: {
                Authorization: `Bearer ${session.access_token}`,
            },
        })
        expect(restoreResponse.statusCode).toBe(200)

        const restoredProjectResponse = await context.app.inject({
            method: 'GET',
            url: `/api/v1/projects/${project.id}`,
            headers: {
                Authorization: `Bearer ${session.access_token}`,
            },
        })
        expect(restoredProjectResponse.statusCode).toBe(200)
        expect(readJson(restoredProjectResponse).data.name).toBe('Backup Project')

        const systemHealthResponse = await context.app.inject({
            method: 'GET',
            url: '/api/v1/ops/system-health',
            headers: {
                Authorization: `Bearer ${session.access_token}`,
            },
        })
        expect(systemHealthResponse.statusCode).toBe(200)
        const systemHealth = readJson(systemHealthResponse).data
        expect(systemHealth.redis.connected).toBe(true)
        expect(systemHealth.backups.availableBackups).toBeGreaterThanOrEqual(1)
    })

    it('supports warmup overrides and queue inspection', async () => {
        const session = await signUpPlatform(context, 'warmup@example.com')
        const project = await createProject(context, session.access_token, 'Warmup Project')

        const initialStatusResponse = await context.app.inject({
            method: 'GET',
            url: `/api/v1/projects/${project.id}/status`,
            headers: {
                Authorization: `Bearer ${session.access_token}`,
            },
        })
        expect(initialStatusResponse.statusCode).toBe(200)
        expect(readJson(initialStatusResponse).data.overrideMode).toBe('default')

        const pauseResponse = await context.app.inject({
            method: 'PATCH',
            url: `/api/v1/projects/${project.id}/warmup`,
            headers: {
                Authorization: `Bearer ${session.access_token}`,
            },
            payload: {
                mode: 'paused',
            },
        })
        expect(pauseResponse.statusCode).toBe(200)
        expect(readJson(pauseResponse).data.overrideMode).toBe('paused')

        const forceActiveResponse = await context.app.inject({
            method: 'PATCH',
            url: `/api/v1/projects/${project.id}/warmup`,
            headers: {
                Authorization: `Bearer ${session.access_token}`,
            },
            payload: {
                mode: 'force_active',
            },
        })
        expect(forceActiveResponse.statusCode).toBe(200)
        const forcedStatus = readJson(forceActiveResponse).data
        expect(forcedStatus.status).toBe('active')
        expect(forcedStatus.percentComplete).toBe(100)

        const queuesResponse = await context.app.inject({
            method: 'GET',
            url: '/api/v1/ops/queues',
            headers: {
                Authorization: `Bearer ${session.access_token}`,
            },
        })
        expect(queuesResponse.statusCode).toBe(200)
        const queues = readJson(queuesResponse).data
        expect(queues).toHaveLength(2)
        expect(queues.every((queue: { enabled: boolean }) => queue.enabled === false)).toBe(true)

        const queueJobsResponse = await context.app.inject({
            method: 'GET',
            url: '/api/v1/ops/queues/warmup/jobs',
            headers: {
                Authorization: `Bearer ${session.access_token}`,
            },
        })
        expect(queueJobsResponse.statusCode).toBe(200)
        expect(readJson(queueJobsResponse).data).toEqual([])
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
    return readJson(response).data as { id: string }
}

function readJson(response: { body: string }) {
    return JSON.parse(response.body) as Record<string, any>
}
