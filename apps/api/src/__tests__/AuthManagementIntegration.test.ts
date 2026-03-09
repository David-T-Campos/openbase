import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TestAppContext } from './helpers/testApp.js'
import { createTestApp } from './helpers/testApp.js'

describe('Auth management', () => {
    let context: TestAppContext

    beforeEach(async () => {
        context = await createTestApp({ listen: true })
    })

    afterEach(async () => {
        await context.close()
    })

    it('creates managed users, revokes sessions, and blocks disabled accounts', async () => {
        const owner = await signUpPlatform(context, 'owner-auth@example.com')
        const project = await createProject(context, owner.access_token, 'Auth Project')

        const createUserResponse = await context.app.inject({
            method: 'POST',
            url: `/api/v1/${project.id}/auth/users`,
            headers: platformHeaders(owner.access_token),
            payload: {
                email: 'managed-user@example.com',
                password: 'password123',
            },
        })

        expect(createUserResponse.statusCode).toBe(201)
        const managedUser = readJson(createUserResponse).data as { id: string; email: string }

        const signInResponse = await context.app.inject({
            method: 'POST',
            url: `/api/v1/${project.id}/auth/signin`,
            payload: {
                email: managedUser.email,
                password: 'password123',
            },
        })

        expect(signInResponse.statusCode).toBe(200)
        const userSession = readJson(signInResponse).data.session as { access_token: string }

        const userResponse = await context.app.inject({
            method: 'GET',
            url: `/api/v1/${project.id}/auth/user`,
            headers: projectHeaders(userSession.access_token),
        })

        expect(userResponse.statusCode).toBe(200)

        const revokeResponse = await context.app.inject({
            method: 'POST',
            url: `/api/v1/${project.id}/auth/users/${managedUser.id}/revoke-sessions`,
            headers: platformHeaders(owner.access_token),
        })

        expect(revokeResponse.statusCode).toBe(200)

        const revokedUserResponse = await context.app.inject({
            method: 'GET',
            url: `/api/v1/${project.id}/auth/user`,
            headers: projectHeaders(userSession.access_token),
        })

        expect(revokedUserResponse.statusCode).toBe(403)

        const disableResponse = await context.app.inject({
            method: 'PATCH',
            url: `/api/v1/${project.id}/auth/users/${managedUser.id}`,
            headers: platformHeaders(owner.access_token),
            payload: {
                disabled: true,
                reason: 'Security review',
            },
        })

        expect(disableResponse.statusCode).toBe(200)

        const disabledSignInResponse = await context.app.inject({
            method: 'POST',
            url: `/api/v1/${project.id}/auth/signin`,
            payload: {
                email: managedUser.email,
                password: 'password123',
            },
        })

        expect(disabledSignInResponse.statusCode).toBe(401)
        expect(readJson(disabledSignInResponse).error.code).toBe('ACCOUNT_DISABLED')
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

    return readJson(response).data as { id: string }
}

function platformHeaders(token: string) {
    return {
        Authorization: `Bearer ${token}`,
    }
}

function projectHeaders(token: string) {
    return {
        Authorization: `Bearer ${token}`,
        apikey: token,
    }
}

function readJson(response: { body: string }) {
    return JSON.parse(response.body) as Record<string, any>
}
