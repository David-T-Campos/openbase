import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TestAppContext } from './helpers/testApp.js'
import { createTestApp } from './helpers/testApp.js'

describe('OQL and functions integrations', () => {
    let context: TestAppContext

    beforeEach(async () => {
        context = await createTestApp({ listen: true })
    })

    afterEach(async () => {
        await context.close()
    })

    it('executes OQL joins and invokes deployed functions through RPC, webhook, and cron', async () => {
        const sdkModuleUrl = new URL('../../../sdk/src/index.ts', import.meta.url)
        const sdkModule = await import(sdkModuleUrl.toString()) as {
            createClient: (projectUrl: string, anonKey: string) => any
            createAdminClient: (projectUrl: string, serviceRoleKey: string) => any
        }

        const owner = await signUpPlatform(context, 'oql-owner@example.com')
        const project = await createProject(context, owner.access_token, 'OQL and Functions')

        await createTable(context, project.id, project.serviceRoleKey, {
            tableName: 'authors',
            columns: [
                { name: 'id', type: 'uuid', required: true, unique: true },
                { name: 'name', type: 'text', required: true },
            ],
            indexes: ['id'],
        })

        await createTable(context, project.id, project.serviceRoleKey, {
            tableName: 'posts',
            columns: [
                { name: 'id', type: 'uuid', required: true, unique: true },
                { name: 'title', type: 'text', required: true },
                { name: 'status', type: 'text', required: true },
                { name: 'author_id', type: 'uuid', required: true },
            ],
            indexes: ['id', 'author_id'],
        })

        const admin = sdkModule.createAdminClient(context.baseUrl!, project.serviceRoleKey)
        const client = sdkModule.createClient(context.baseUrl!, project.anonKey)

        await admin.from('authors').insert([
            { id: 'author-1', name: 'Ada' },
            { id: 'author-2', name: 'Linus' },
        ])
        await admin.from('posts').insert([
            { id: 'post-1', title: 'Published first', status: 'published', author_id: 'author-1' },
            { id: 'post-2', title: 'Draft note', status: 'draft', author_id: 'author-1' },
            { id: 'post-3', title: 'Published second', status: 'published', author_id: 'author-2' },
        ])

        const oqlResult = await admin.oql(
            "from posts | join authors on posts.author_id = authors.id | where posts.status = 'published' | select posts.title as title, authors.name as author | order by posts.title asc | limit 10"
        )
        expect(oqlResult.error).toBeNull()
        expect(oqlResult.data?.rowCount).toBe(2)
        expect(oqlResult.data?.rows).toEqual([
            { title: 'Published first', author: 'Ada' },
            { title: 'Published second', author: 'Linus' },
        ])

        const functionSource = `export default async function handler({ db, params, request, log }) {
  const status = (params && typeof params === 'object' && 'status' in params ? params.status : undefined) || 'published'
  const result = await db.from('posts').select('title,status').eq('status', status)
  log('Fetched posts', { count: result.data?.length ?? 0, trigger: request ? 'webhook' : 'rpc' })
  return {
    trigger: request ? 'webhook' : 'rpc',
    titles: result.data?.map(row => row.title) ?? [],
  }
}`

        const saveResult = await admin.admin.functions.save({
            name: 'published-posts',
            description: 'Lists published post titles',
            runtime: 'typescript',
            source: functionSource,
            rpc: {
                enabled: true,
                access: 'authenticated',
            },
            webhook: {
                enabled: true,
                secret: 'hook-secret',
                method: 'POST',
            },
        })
        expect(saveResult.error).toBeNull()

        const deployResult = await admin.admin.functions.deploy('published-posts')
        expect(deployResult.error).toBeNull()
        expect(deployResult.data?.deployedAt).toBeTruthy()

        await client.auth.signUp({
            email: 'function-user@example.com',
            password: 'password123',
        })
        const signInResult = await client.auth.signIn({
            email: 'function-user@example.com',
            password: 'password123',
        })
        expect(signInResult.error).toBeNull()

        const rpcResult = await client.rpc('published-posts', { status: 'published' })
        expect(rpcResult.error).toBeNull()
        expect(rpcResult.data?.data).toEqual({
            trigger: 'rpc',
            titles: ['Published first', 'Published second'],
        })

        const webhookResponse = await context.app.inject({
            method: 'POST',
            url: `/api/v1/${project.id}/functions/published-posts/webhook`,
            headers: {
                'x-openbase-function-secret': 'hook-secret',
            },
            payload: { status: 'draft' },
        })
        expect(webhookResponse.statusCode).toBe(200)
        expect(readJson(webhookResponse).data.data).toEqual({
            trigger: 'webhook',
            titles: ['Draft note'],
        })

        const logsResult = await admin.admin.functions.logs('published-posts')
        expect(logsResult.error).toBeNull()
        expect(logsResult.data?.some((entry: { message: string }) => entry.message.includes('Fetched posts'))).toBe(true)

        const cronSaveResult = await admin.admin.functions.save({
            name: 'cron-publisher',
            runtime: 'typescript',
            source: `export default async function handler({ db, log }) {
  await db.from('posts').insert({ id: 'post-cron', title: 'Scheduled publish', status: 'scheduled', author_id: 'author-1' })
  log('Scheduled publish created')
  return { ok: true }
}`,
            rpc: {
                enabled: false,
                access: 'service_role',
            },
            schedule: {
                enabled: true,
                cron: '* * * * *',
            },
        })
        expect(cronSaveResult.error).toBeNull()
        await admin.admin.functions.deploy('cron-publisher')

        const cronDefinitionKey = `project:${project.id}:functions`
        const rawCronDefinition = await context.redis.hget(cronDefinitionKey, 'cron-publisher')
        expect(rawCronDefinition).toBeTruthy()

        const cronDefinition = JSON.parse(rawCronDefinition || '{}') as {
            schedule?: { nextRunAt?: string | null }
        }
        cronDefinition.schedule = {
            ...(cronDefinition.schedule || {}),
            nextRunAt: new Date(Date.now() - 1_000).toISOString(),
        }
        await context.redis.hset(cronDefinitionKey, 'cron-publisher', JSON.stringify(cronDefinition))

        await context.functionService.runSchedulesNow()
        await waitForCondition(async () => {
            const rows = await admin.from('posts').select('*').eq('id', 'post-cron')
            return rows.data?.length === 1
        })

        const cronLogs = await admin.admin.functions.logs('cron-publisher')
        expect(cronLogs.data?.some((entry: { message: string }) => entry.message.includes('Scheduled publish created'))).toBe(true)
    }, 20_000)
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

async function waitForCondition(check: () => Promise<boolean>, timeoutMs: number = 3_000): Promise<void> {
    const startedAt = Date.now()

    while (true) {
        if (await check()) {
            return
        }

        if (Date.now() - startedAt > timeoutMs) {
            throw new Error('Condition was not met before timeout')
        }

        await new Promise(resolve => setTimeout(resolve, 30))
    }
}
