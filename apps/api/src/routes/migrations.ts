import type { FastifyInstance } from 'fastify'
import { migrationDefinitionSchema } from '@openbase/core'
import { z } from 'zod'
import type { ProjectAccessService } from '../access/ProjectAccessService.js'
import { assertRouteProjectPermission } from '../access/routePermissions.js'
import type { AuthService } from '../auth/AuthService.js'
import { authMiddleware } from '../middleware/auth.js'
import type { MigrationService } from '../migrations/MigrationService.js'
import type { ProjectService } from '../projects/ProjectService.js'

const mutationSchema = migrationDefinitionSchema.extend({
    checksum: z.string().optional(),
    source: z.enum(['cli', 'dashboard', 'sdk']).optional(),
})

export function registerMigrationRoutes(
    app: FastifyInstance,
    projectService: ProjectService,
    projectAccessService: ProjectAccessService,
    authService: AuthService,
    migrationService: MigrationService
): void {
    app.get<{ Params: { projectId: string } }>(
        '/api/v1/:projectId/migrations',
        { preHandler: [authMiddleware] },
        async (request, reply) => {
            await assertRouteProjectPermission(projectService, projectAccessService, authService, request, {
                permission: 'migrations.read',
                allowProjectUsers: false,
            })
            const exportState = await migrationService.list(request.params.projectId)
            return reply.send({
                data: {
                    migrations: exportState.migrations,
                    appliedMigrations: exportState.appliedMigrations,
                },
            })
        }
    )

    app.get<{ Params: { projectId: string } }>(
        '/api/v1/:projectId/schema/export',
        { preHandler: [authMiddleware] },
        async (request, reply) => {
            await assertRouteProjectPermission(projectService, projectAccessService, authService, request, {
                permission: 'migrations.read',
                allowProjectUsers: false,
            })
            return reply.send({
                data: await migrationService.list(request.params.projectId),
            })
        }
    )

    app.post<{ Params: { projectId: string } }>(
        '/api/v1/:projectId/migrations/apply',
        { preHandler: [authMiddleware] },
        async (request, reply) => {
            await assertRouteProjectPermission(projectService, projectAccessService, authService, request, {
                permission: 'migrations.manage',
                allowProjectUsers: false,
            })
            const body = parseMutationBody(request.body)
            const state = await migrationService.apply(request.params.projectId, body)
            return reply.status(201).send({ data: state })
        }
    )

    app.post<{ Params: { projectId: string } }>(
        '/api/v1/:projectId/migrations/rollback',
        { preHandler: [authMiddleware] },
        async (request, reply) => {
            await assertRouteProjectPermission(projectService, projectAccessService, authService, request, {
                permission: 'migrations.manage',
                allowProjectUsers: false,
            })
            const body = parseMutationBody(request.body)
            const state = await migrationService.rollback(request.params.projectId, body)
            return reply.send({ data: state })
        }
    )
}

function parseMutationBody(body: unknown) {
    const parsed = mutationSchema.parse(body)
    return {
        name: parsed.name,
        description: parsed.description,
        up: parsed.up,
        down: parsed.down,
        checksum: typeof parsed.checksum === 'string' && parsed.checksum.length > 0 ? parsed.checksum : parsed.name,
        source: parsed.source ?? 'cli',
    }
}
