import type { FastifyRequest } from 'fastify'
import type { ProjectPermission } from '@openbase/core'
import { ForbiddenError } from '@openbase/core'
import type { AuthService } from '../auth/AuthService.js'
import type { ProjectService } from '../projects/ProjectService.js'
import type { ProjectAccessService } from './ProjectAccessService.js'

interface AssertProjectPermissionOptions {
    permission: ProjectPermission
    allowProjectUsers?: boolean
    allowServiceRole?: boolean
    requireProjectUser?: boolean
}

export async function assertRouteProjectPermission(
    projectService: ProjectService,
    projectAccessService: ProjectAccessService,
    authService: AuthService,
    request: FastifyRequest<{ Params: Record<string, string> }>,
    options: AssertProjectPermissionOptions
) {
    const project = await projectService.getProject(request.params.projectId)
    const user = request.user

    if (!user) {
        throw new ForbiddenError('Authentication required')
    }

    if (user.role === 'platform_user') {
        return (await projectAccessService.assertPlatformPermission(project.id, user, options.permission)).project
    }

    if (options.allowServiceRole !== false && user.role === 'service_role' && user.projectId === project.id) {
        return project
    }

    if (options.allowProjectUsers !== false && user.projectId === project.id) {
        const active = await authService.isSessionActive(user)
        if (!active) {
            throw new ForbiddenError('Session has been revoked')
        }

        if (options.requireProjectUser && !user.sub) {
            throw new ForbiddenError('A project user session is required')
        }

        return project
    }

    throw new ForbiddenError('You do not have access to this project')
}

export async function assertRouteProjectUser(
    projectService: ProjectService,
    projectAccessService: ProjectAccessService,
    authService: AuthService,
    request: FastifyRequest<{ Params: Record<string, string> }>
) {
    const project = await assertRouteProjectPermission(
        projectService,
        projectAccessService,
        authService,
        request,
        {
            permission: 'auth.read',
            allowServiceRole: false,
            requireProjectUser: true,
        }
    )

    if (request.user?.role === 'platform_user') {
        throw new ForbiddenError('A project user session is required')
    }

    return project
}
