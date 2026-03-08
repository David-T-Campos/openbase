/**
 * Project Routes — Project CRUD and management.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { platformAuthMiddleware } from '../middleware/auth.js'
import type { RequestLogService } from '../logs/RequestLogService.js'
import type { ProjectService } from '../projects/ProjectService.js'
import type { WarmupService } from '../warmup/WarmupService.js'
import type { WebhookService } from '../webhooks/WebhookService.js'

const createProjectSchema = z.object({
    name: z.string().min(1).max(100),
    telegramSession: z.string().min(1),
})

const updateProjectSchema = z.object({
    name: z.string().min(1).max(100).optional(),
})

const createWebhookSchema = z.object({
    url: z.string().url(),
    enabled: z.boolean().default(true),
    events: z.array(z.enum(['INSERT', 'UPDATE', 'DELETE'])).min(1),
    secret: z.string().optional(),
})

const updateWebhookSchema = createWebhookSchema.partial()

export function registerProjectRoutes(
    app: FastifyInstance,
    projectService: ProjectService,
    warmupService: WarmupService,
    requestLogService: RequestLogService,
    webhookService: WebhookService
): void {
    app.post(
        '/api/v1/projects',
        { preHandler: [platformAuthMiddleware] },
        async (request, reply) => {
            const body = createProjectSchema.parse(request.body)
            const project = await projectService.createProject(
                request.user!.sub!,
                body.name,
                body.telegramSession
            )

            return reply.status(201).send({
                data: {
                    id: project.id,
                    name: project.name,
                    status: project.status,
                    warmupDaysRemaining: project.warmupDaysRemaining,
                    anonKey: project.anonKey,
                    serviceRoleKey: project.serviceRoleKey,
                    createdAt: project.createdAt,
                },
            })
        }
    )

    app.get(
        '/api/v1/projects',
        { preHandler: [platformAuthMiddleware] },
        async (request, reply) => {
            const projects = await projectService.getProjectsByOwner(request.user!.sub!)

            return reply.send({
                data: projects.map(project => ({
                    id: project.id,
                    name: project.name,
                    status: project.status,
                    warmupDaysRemaining: project.warmupDaysRemaining,
                    createdAt: project.createdAt,
                })),
            })
        }
    )

    app.get<{ Params: { projectId: string } }>(
        '/api/v1/projects/:projectId',
        { preHandler: [platformAuthMiddleware] },
        async (request, reply) => {
            const project = await assertProjectOwner(projectService, request)

            return reply.send({
                data: {
                    id: project.id,
                    name: project.name,
                    status: project.status,
                    warmupDaysRemaining: project.warmupDaysRemaining,
                    channelMap: project.channelMap,
                    buckets: project.buckets,
                    bucketPolicies: project.bucketPolicies,
                    createdAt: project.createdAt,
                },
            })
        }
    )

    app.put<{ Params: { projectId: string } }>(
        '/api/v1/projects/:projectId',
        { preHandler: [platformAuthMiddleware] },
        async (request, reply) => {
            const project = await assertProjectOwner(projectService, request)
            const body = updateProjectSchema.parse(request.body)
            const updated = await projectService.updateProject(project.id, body)

            return reply.send({ data: { id: updated.id, name: updated.name } })
        }
    )

    app.delete<{ Params: { projectId: string } }>(
        '/api/v1/projects/:projectId',
        { preHandler: [platformAuthMiddleware] },
        async (request, reply) => {
            const project = await assertProjectOwner(projectService, request)
            await webhookService.cleanupProject(project.id)
            await projectService.deleteProject(project.id)
            return reply.send({ data: { message: 'Project deleted' } })
        }
    )

    app.get<{ Params: { projectId: string } }>(
        '/api/v1/projects/:projectId/keys',
        { preHandler: [platformAuthMiddleware] },
        async (request, reply) => {
            const project = await assertProjectOwner(projectService, request)
            return reply.send({
                data: {
                    anonKey: project.anonKey,
                    serviceRoleKey: project.serviceRoleKey,
                },
            })
        }
    )

    app.get<{ Params: { projectId: string } }>(
        '/api/v1/projects/:projectId/status',
        { preHandler: [platformAuthMiddleware] },
        async (request, reply) => {
            const project = await assertProjectOwner(projectService, request)
            const warmupStatus = await warmupService.getStatus(project.id)

            if (!warmupStatus) {
                return reply.send({
                    data: {
                        status: project.status,
                        daysCompleted: project.status === 'active' ? 7 : 0,
                        daysRequired: 7,
                        daysRemaining: project.warmupDaysRemaining ?? 0,
                        percentComplete: project.status === 'active' ? 100 : 0,
                    },
                })
            }

            return reply.send({ data: warmupStatus })
        }
    )

    app.get<{ Params: { projectId: string } }>(
        '/api/v1/projects/:projectId/logs',
        { preHandler: [platformAuthMiddleware] },
        async (request, reply) => {
            const project = await assertProjectOwner(projectService, request)
            const logs = await requestLogService.list(project.id, 100)
            return reply.send({ data: logs })
        }
    )

    app.get<{ Params: { projectId: string } }>(
        '/api/v1/projects/:projectId/webhooks',
        { preHandler: [platformAuthMiddleware] },
        async (request, reply) => {
            const project = await assertProjectOwner(projectService, request)
            const webhooks = await webhookService.listConfigs(project.id)
            return reply.send({ data: webhooks })
        }
    )

    app.post<{ Params: { projectId: string } }>(
        '/api/v1/projects/:projectId/webhooks',
        { preHandler: [platformAuthMiddleware] },
        async (request, reply) => {
            const project = await assertProjectOwner(projectService, request)
            const body = createWebhookSchema.parse(request.body)
            const webhook = await webhookService.createConfig(project.id, body)
            return reply.status(201).send({ data: webhook })
        }
    )

    app.put<{ Params: { projectId: string; webhookId: string } }>(
        '/api/v1/projects/:projectId/webhooks/:webhookId',
        { preHandler: [platformAuthMiddleware] },
        async (request, reply) => {
            const project = await assertProjectOwner(projectService, request)
            const body = updateWebhookSchema.parse(request.body)
            const webhook = await webhookService.updateConfig(project.id, request.params.webhookId, body)

            if (!webhook) {
                return reply.status(404).send({ error: { message: 'Webhook not found' } })
            }

            return reply.send({ data: webhook })
        }
    )

    app.delete<{ Params: { projectId: string; webhookId: string } }>(
        '/api/v1/projects/:projectId/webhooks/:webhookId',
        { preHandler: [platformAuthMiddleware] },
        async (request, reply) => {
            const project = await assertProjectOwner(projectService, request)
            const deleted = await webhookService.deleteConfig(project.id, request.params.webhookId)
            if (!deleted) {
                return reply.status(404).send({ error: { message: 'Webhook not found' } })
            }

            return reply.send({ data: { message: 'Webhook deleted' } })
        }
    )

    app.get('/health', async (_request, reply) => {
        return reply.send({
            status: 'ok',
            timestamp: new Date().toISOString(),
            version: '0.1.0',
        })
    })
}

async function assertProjectOwner(
    projectService: ProjectService,
    request: FastifyRequest<{ Params: { projectId: string } }>
) {
    return projectService.assertOwner(request.params.projectId, request.user!.sub!)
}
