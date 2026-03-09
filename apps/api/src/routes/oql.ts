import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ProjectAccessService } from '../access/ProjectAccessService.js'
import { assertRouteProjectPermission } from '../access/routePermissions.js'
import type { AuthService } from '../auth/AuthService.js'
import { authMiddleware, platformAuthMiddleware } from '../middleware/auth.js'
import type { OqlService } from '../oql/OqlService.js'
import type { ProjectService } from '../projects/ProjectService.js'

const querySchema = z.object({
    query: z.string().min(1),
})

export function registerOqlRoutes(
    app: FastifyInstance,
    projectService: ProjectService,
    projectAccessService: ProjectAccessService,
    authService: AuthService,
    oqlService: OqlService
): void {
    app.post<{ Params: { projectId: string } }>(
        '/api/v1/:projectId/oql',
        { preHandler: [authMiddleware] },
        async (request, reply) => {
            const project = await assertRouteProjectPermission(projectService, projectAccessService, authService, request, {
                permission: 'tables.read',
            })
            const body = querySchema.parse(request.body)
            return reply.send({
                data: await oqlService.execute(project, request.user || null, body.query),
            })
        }
    )

    app.post<{ Params: { projectId: string } }>(
        '/api/v1/projects/:projectId/oql',
        { preHandler: [platformAuthMiddleware] },
        async (request, reply) => {
            const access = await projectAccessService.assertPlatformPermission(request.params.projectId, request.user!, 'tables.read')
            const body = querySchema.parse(request.body)
            return reply.send({
                data: await oqlService.execute(access.project, request.user || null, body.query),
            })
        }
    )
}
