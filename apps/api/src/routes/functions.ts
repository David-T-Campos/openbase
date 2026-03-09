import type { FastifyInstance } from 'fastify'
import { functionDefinitionSchema, functionInvocationResultSchema, functionLogEntrySchema } from '@openbase/core'
import { z } from 'zod'
import type { ProjectAccessService } from '../access/ProjectAccessService.js'
import { assertRouteProjectPermission } from '../access/routePermissions.js'
import type { AuthService } from '../auth/AuthService.js'
import type { FunctionService } from '../functions/FunctionService.js'
import { authMiddleware, platformAuthMiddleware } from '../middleware/auth.js'
import type { ProjectService } from '../projects/ProjectService.js'

const definitionInputSchema = z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    runtime: z.enum(['javascript', 'typescript']).optional(),
    source: z.string().min(1),
    timeoutMs: z.number().int().min(500).max(60000).optional(),
    rpc: z.object({
        enabled: z.boolean().optional(),
        access: z.enum(['public', 'authenticated', 'service_role']).optional(),
    }).optional(),
    webhook: z.object({
        enabled: z.boolean().optional(),
        secret: z.string().nullable().optional(),
        method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
    }).optional(),
    schedule: z.object({
        enabled: z.boolean().optional(),
        cron: z.string().nullable().optional(),
    }).optional(),
})

const rpcPayloadSchema = z.object({
    params: z.unknown().optional(),
})

export function registerFunctionRoutes(
    app: FastifyInstance,
    projectService: ProjectService,
    projectAccessService: ProjectAccessService,
    authService: AuthService,
    functionService: FunctionService
): void {
    app.get<{ Params: { projectId: string } }>(
        '/api/v1/:projectId/functions',
        { preHandler: [authMiddleware] },
        async (request, reply) => {
            await assertRouteProjectPermission(projectService, projectAccessService, authService, request, {
                permission: 'functions.read',
                allowProjectUsers: false,
            })
            return reply.send({ data: await functionService.list(request.params.projectId) })
        }
    )

    app.get<{ Params: { projectId: string; name: string } }>(
        '/api/v1/:projectId/functions/:name/details',
        { preHandler: [authMiddleware] },
        async (request, reply) => {
            await assertRouteProjectPermission(projectService, projectAccessService, authService, request, {
                permission: 'functions.read',
                allowProjectUsers: false,
            })
            const definition = await functionService.get(request.params.projectId, request.params.name)
            if (!definition) {
                return reply.status(404).send({ error: { message: 'Function not found', code: 'NOT_FOUND' } })
            }

            return reply.send({ data: functionDefinitionSchema.parse(definition) })
        }
    )

    app.post<{ Params: { projectId: string } }>(
        '/api/v1/:projectId/functions',
        { preHandler: [authMiddleware] },
        async (request, reply) => {
            await assertRouteProjectPermission(projectService, projectAccessService, authService, request, {
                permission: 'functions.manage',
                allowProjectUsers: false,
            })
            const definition = await functionService.save(request.params.projectId, definitionInputSchema.parse(request.body), request.user?.sub)
            return reply.status(201).send({ data: functionDefinitionSchema.parse(definition) })
        }
    )

    app.post<{ Params: { projectId: string; name: string } }>(
        '/api/v1/:projectId/functions/:name/deploy',
        { preHandler: [authMiddleware] },
        async (request, reply) => {
            await assertRouteProjectPermission(projectService, projectAccessService, authService, request, {
                permission: 'functions.manage',
                allowProjectUsers: false,
            })
            const definition = await functionService.deploy(request.params.projectId, request.params.name, request.user?.sub)
            return reply.send({ data: functionDefinitionSchema.parse(definition) })
        }
    )

    app.get<{ Params: { projectId: string; name: string } }>(
        '/api/v1/:projectId/functions/:name/logs',
        { preHandler: [authMiddleware] },
        async (request, reply) => {
            await assertRouteProjectPermission(projectService, projectAccessService, authService, request, {
                permission: 'functions.read',
                allowProjectUsers: false,
            })
            const logs = await functionService.listLogs(request.params.projectId, request.params.name)
            return reply.send({ data: z.array(functionLogEntrySchema).parse(logs) })
        }
    )

    app.delete<{ Params: { projectId: string; name: string } }>(
        '/api/v1/:projectId/functions/:name',
        { preHandler: [authMiddleware] },
        async (request, reply) => {
            await assertRouteProjectPermission(projectService, projectAccessService, authService, request, {
                permission: 'functions.manage',
                allowProjectUsers: false,
            })
            await functionService.remove(request.params.projectId, request.params.name, request.user?.sub)
            return reply.send({ data: { message: 'Function deleted' } })
        }
    )

    app.get<{ Params: { projectId: string } }>(
        '/api/v1/projects/:projectId/functions',
        { preHandler: [platformAuthMiddleware] },
        async (request, reply) => {
            await projectAccessService.assertPlatformPermission(request.params.projectId, request.user!, 'functions.read')
            return reply.send({ data: await functionService.list(request.params.projectId) })
        }
    )

    app.get<{ Params: { projectId: string; name: string } }>(
        '/api/v1/projects/:projectId/functions/:name',
        { preHandler: [platformAuthMiddleware] },
        async (request, reply) => {
            await projectAccessService.assertPlatformPermission(request.params.projectId, request.user!, 'functions.read')
            const definition = await functionService.get(request.params.projectId, request.params.name)
            if (!definition) {
                return reply.status(404).send({ error: { message: 'Function not found', code: 'NOT_FOUND' } })
            }

            return reply.send({ data: functionDefinitionSchema.parse(definition) })
        }
    )

    app.post<{ Params: { projectId: string } }>(
        '/api/v1/projects/:projectId/functions',
        { preHandler: [platformAuthMiddleware] },
        async (request, reply) => {
            await projectAccessService.assertPlatformPermission(request.params.projectId, request.user!, 'functions.manage')
            const definition = await functionService.save(request.params.projectId, definitionInputSchema.parse(request.body), request.user!.sub)
            return reply.status(201).send({ data: functionDefinitionSchema.parse(definition) })
        }
    )

    app.post<{ Params: { projectId: string; name: string } }>(
        '/api/v1/projects/:projectId/functions/:name/deploy',
        { preHandler: [platformAuthMiddleware] },
        async (request, reply) => {
            await projectAccessService.assertPlatformPermission(request.params.projectId, request.user!, 'functions.manage')
            const definition = await functionService.deploy(request.params.projectId, request.params.name, request.user!.sub)
            return reply.send({ data: functionDefinitionSchema.parse(definition) })
        }
    )

    app.get<{ Params: { projectId: string; name: string } }>(
        '/api/v1/projects/:projectId/functions/:name/logs',
        { preHandler: [platformAuthMiddleware] },
        async (request, reply) => {
            await projectAccessService.assertPlatformPermission(request.params.projectId, request.user!, 'functions.read')
            const logs = await functionService.listLogs(request.params.projectId, request.params.name)
            return reply.send({ data: z.array(functionLogEntrySchema).parse(logs) })
        }
    )

    app.delete<{ Params: { projectId: string; name: string } }>(
        '/api/v1/projects/:projectId/functions/:name',
        { preHandler: [platformAuthMiddleware] },
        async (request, reply) => {
            await projectAccessService.assertPlatformPermission(request.params.projectId, request.user!, 'functions.manage')
            await functionService.remove(request.params.projectId, request.params.name, request.user!.sub)
            return reply.send({ data: { message: 'Function deleted' } })
        }
    )

    app.post<{ Params: { projectId: string; name: string } }>(
        '/api/v1/:projectId/functions/:name',
        { preHandler: [authMiddleware] },
        async (request, reply) => {
            await assertRouteProjectPermission(projectService, projectAccessService, authService, request, {
                permission: 'functions.read',
                allowProjectUsers: true,
                allowServiceRole: true,
            })
            const body = rpcPayloadSchema.parse(request.body ?? {})
            const result = await functionService.invokeRpc(request.params.projectId, request.params.name, request.user!, body.params)
            return reply.send({ data: functionInvocationResultSchema.parse(result) })
        }
    )

    app.route<{ Params: { projectId: string; name: string } }>({
        method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
        url: '/api/v1/:projectId/functions/:name/webhook',
        handler: async (request, reply) => {
            const definition = await functionService.get(request.params.projectId, request.params.name)
            if (!definition?.webhook.enabled) {
                return reply.status(404).send({ error: { message: 'Function not found', code: 'NOT_FOUND' } })
            }

            if (request.method !== definition.webhook.method) {
                return reply.status(405).send({ error: { message: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' } })
            }

            const secretHeader = request.headers['x-openbase-function-secret']
            const secret = Array.isArray(secretHeader) ? secretHeader[0] : secretHeader ?? null
            const result = await functionService.invokeWebhook(request.params.projectId, request.params.name, {
                method: request.method,
                path: request.url,
                headers: request.headers,
                query: (request.query as Record<string, string | string[] | undefined>) || {},
                body: request.body,
            }, secret)

            return reply.send({ data: functionInvocationResultSchema.parse(result) })
        },
    })
}
