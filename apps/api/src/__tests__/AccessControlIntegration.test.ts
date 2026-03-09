import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TestAppContext } from './helpers/testApp.js'
import { createTestApp } from './helpers/testApp.js'

describe('Project access control', () => {
    let context: TestAppContext

    beforeEach(async () => {
        context = await createTestApp({ listen: true })
    })

    afterEach(async () => {
        await context.close()
    })

    it('invites members, enforces role permissions, and applies custom roles', async () => {
        const owner = await signUpPlatform(context, 'owner-access@example.com')
        const member = await signUpPlatform(context, 'member-access@example.com')
        const project = await createProject(context, owner.access_token, 'Shared Project')

        const inviteResponse = await context.app.inject({
            method: 'POST',
            url: `/api/v1/projects/${project.id}/access/invitations`,
            headers: platformHeaders(owner.access_token),
            payload: {
                email: 'member-access@example.com',
                roleKey: 'viewer',
            },
        })

        expect(inviteResponse.statusCode).toBe(201)
        const invitation = readJson(inviteResponse).data as { token: string }

        const acceptResponse = await context.app.inject({
            method: 'POST',
            url: '/api/v1/projects/invitations/accept',
            headers: platformHeaders(member.access_token),
            payload: { token: invitation.token },
        })

        expect(acceptResponse.statusCode).toBe(200)

        const memberProjectResponse = await context.app.inject({
            method: 'GET',
            url: `/api/v1/projects/${project.id}`,
            headers: platformHeaders(member.access_token),
        })

        expect(memberProjectResponse.statusCode).toBe(200)
        expect(readJson(memberProjectResponse).data.access.roleKey).toBe('viewer')

        const forbiddenCreate = await context.app.inject({
            method: 'POST',
            url: `/api/v1/${project.id}/tables`,
            headers: platformHeaders(member.access_token),
            payload: {
                tableName: 'viewer_blocked',
                columns: [{ name: 'id', type: 'uuid', required: true }],
                indexes: ['id'],
            },
        })

        expect(forbiddenCreate.statusCode).toBe(403)

        const saveRoleResponse = await context.app.inject({
            method: 'POST',
            url: `/api/v1/projects/${project.id}/access/roles`,
            headers: platformHeaders(owner.access_token),
            payload: {
                key: 'ops_editor',
                name: 'Ops editor',
                permissions: ['project.read', 'tables.read', 'tables.manage', 'members.read'],
            },
        })

        expect(saveRoleResponse.statusCode).toBe(201)

        const assignRoleResponse = await context.app.inject({
            method: 'PATCH',
            url: `/api/v1/projects/${project.id}/access/members/${member.user.id}`,
            headers: platformHeaders(owner.access_token),
            payload: { roleKey: 'ops_editor' },
        })

        expect(assignRoleResponse.statusCode).toBe(200)

        const allowedCreate = await context.app.inject({
            method: 'POST',
            url: `/api/v1/${project.id}/tables`,
            headers: platformHeaders(member.access_token),
            payload: {
                tableName: 'member_created',
                columns: [{ name: 'id', type: 'uuid', required: true }],
                indexes: ['id'],
            },
        })

        expect(allowedCreate.statusCode).toBe(201)
    })
})

async function signUpPlatform(context: TestAppContext, email: string) {
    const response = await context.app.inject({
        method: 'POST',
        url: '/api/v1/platform/auth/signup',
        payload: { email, password: 'password123' },
    })

    const data = readJson(response).data
    return {
        session: data.session as { access_token: string; refresh_token: string },
        access_token: data.session.access_token as string,
        user: data.user as { id: string; email: string },
    }
}

async function createProject(context: TestAppContext, accessToken: string, name: string) {
    const response = await context.app.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: platformHeaders(accessToken),
        payload: { name, telegramSession: `session-${name}` },
    })

    return readJson(response).data as {
        id: string
        serviceRoleKey: string
    }
}

function platformHeaders(token: string) {
    return {
        Authorization: `Bearer ${token}`,
    }
}

function readJson(response: { body: string }) {
    return JSON.parse(response.body) as Record<string, any>
}
