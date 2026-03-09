/**
 * Project Routes — Project CRUD and management.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify'
import { projectPermissionSchema } from '@openbase/core'
import { z } from 'zod'
import { platformAuthMiddleware } from '../middleware/auth.js'
import type { RequestLogService } from '../logs/RequestLogService.js'
import type { OperationsLogService } from '../ops/OperationsLogService.js'
import type { ProjectAccessService } from '../access/ProjectAccessService.js'
import type { ProjectService } from '../projects/ProjectService.js'
import type { TelegramSessionPool } from '../telegram/TelegramSessionPool.js'
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

const inviteMemberSchema = z.object({
    email: z.string().email(),
    roleKey: z.string().min(1),
})

const acceptInvitationSchema = z.object({
    token: z.string().min(1),
})

const updateMemberSchema = z.object({
    roleKey: z.string().min(1),
})

const warmupOverrideSchema = z.object({
    mode: z.enum(['default', 'paused', 'force_active']),
})

const roleSchema = z.object({
    key: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    permissions: z.array(projectPermissionSchema).min(1),
})

export function registerProjectRoutes(
    app: FastifyInstance,
    projectService: ProjectService,
    projectAccessService: ProjectAccessService,
    warmupService: WarmupService,
    requestLogService: RequestLogService,
    webhookService: WebhookService,
    operationsLogService: OperationsLogService,
    telegramSessionPool: TelegramSessionPool
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

            await operationsLogService.record({
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                projectId: project.id,
                scope: 'system',
                level: 'success',
                message: 'Project created',
                metadata: {
                    action: 'project.create',
                    ownerId: request.user!.sub!,
                    name: project.name,
                },
                timestamp: new Date().toISOString(),
            })

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
            const projects = await projectAccessService.getProjectsForUser(request.user!.sub!)

            return reply.send({
                data: projects.map(project => ({
                    id: project.id,
                    name: project.name,
                    status: project.status,
                    warmupDaysRemaining: project.warmupDaysRemaining,
                    createdAt: project.createdAt,
                    roleKey: project.ownerId === request.user!.sub! ? 'owner' : project.members?.[request.user!.sub!]?.roleKey || 'viewer',
                })),
            })
        }
    )

    app.get<{ Params: { projectId: string } }>(
        '/api/v1/projects/:projectId',
        { preHandler: [platformAuthMiddleware] },
        async (request, reply) => {
            const access = await assertProjectPermission(projectAccessService, request, 'project.read')
            const project = access.project

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
                    roles: project.roles || {},
                    membersCount: Object.keys(project.members || {}).length + 1,
                    access: {
                        roleKey: access.role.key,
                        roleName: access.role.name,
                        permissions: access.role.permissions,
                        owner: access.principal === 'owner',
                    },
                },
            })
        }
    )

    app.put<{ Params: { projectId: string } }>(
        '/api/v1/projects/:projectId',
        { preHandler: [platformAuthMiddleware] },
        async (request, reply) => {
            const project = (await assertProjectPermission(projectAccessService, request, 'settings.manage')).project
            const body = updateProjectSchema.parse(request.body)
            const updated = await projectService.updateProject(project.id, body)

            await operationsLogService.record({
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                projectId: project.id,
                scope: 'system',
                level: 'info',
                message: 'Project settings updated',
                metadata: {
                    action: 'project.update',
                    actorUserId: request.user!.sub!,
                    updates: body,
                },
                timestamp: new Date().toISOString(),
            })

            return reply.send({ data: { id: updated.id, name: updated.name } })
        }
    )

    app.delete<{ Params: { projectId: string } }>(
        '/api/v1/projects/:projectId',
        { preHandler: [platformAuthMiddleware] },
        async (request, reply) => {
            const project = (await assertProjectPermission(projectAccessService, request, 'project.delete')).project
            await webhookService.cleanupProject(project.id)
            await projectAccessService.cleanupProject(project.id)
            await projectService.deleteProject(project.id)

            await operationsLogService.record({
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                projectId: project.id,
                scope: 'security',
                level: 'warning',
                message: 'Project deleted',
                metadata: {
                    action: 'project.delete',
                    actorUserId: request.user!.sub!,
                },
                timestamp: new Date().toISOString(),
            })
            return reply.send({ data: { message: 'Project deleted' } })
        }
    )

    app.get<{ Params: { projectId: string } }>(
        '/api/v1/projects/:projectId/keys',
        { preHandler: [platformAuthMiddleware] },
        async (request, reply) => {
            const project = (await assertProjectPermission(projectAccessService, request, 'settings.manage')).project
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
            const project = (await assertProjectPermission(projectAccessService, request, 'project.read')).project
            const warmupStatus = await warmupService.getStatus(project.id)

            if (!warmupStatus) {
                return reply.send({
                    data: {
                        status: project.status,
                        daysCompleted: project.status === 'active' ? 7 : 0,
                        daysRequired: 7,
                        daysRemaining: project.warmupDaysRemaining ?? 0,
                        percentComplete: project.status === 'active' ? 100 : 0,
                        overrideMode: 'default',
                        nextScheduledAt: null,
                    },
                })
            }

            return reply.send({ data: warmupStatus })
        }
    )

    app.patch<{ Params: { projectId: string } }>(
        '/api/v1/projects/:projectId/warmup',
        { preHandler: [platformAuthMiddleware] },
        async (request, reply) => {
            const project = (await assertProjectPermission(projectAccessService, request, 'settings.manage')).project
            const body = warmupOverrideSchema.parse(request.body)
            const status = await warmupService.setOverride(project.id, body.mode)
            return reply.send({ data: status })
        }
    )

    app.post<{ Params: { projectId: string } }>(
        '/api/v1/projects/:projectId/warmup/tick',
        { preHandler: [platformAuthMiddleware] },
        async (request, reply) => {
            const project = (await assertProjectPermission(projectAccessService, request, 'settings.manage')).project
            const status = await warmupService.triggerTick(project.id)
            return reply.send({ data: status })
        }
    )

    app.get<{ Params: { projectId: string } }>(
        '/api/v1/projects/:projectId/logs',
        { preHandler: [platformAuthMiddleware] },
        async (request, reply) => {
            const project = (await assertProjectPermission(projectAccessService, request, 'logs.read')).project
            const logs = await requestLogService.list(project.id, 100)
            return reply.send({ data: logs })
        }
    )

    app.get<{ Params: { projectId: string } }>(
        '/api/v1/projects/:projectId/operations',
        { preHandler: [platformAuthMiddleware] },
        async (request, reply) => {
            const project = (await assertProjectPermission(projectAccessService, request, 'audit.read')).project
            const logs = await operationsLogService.listProject(project.id, 100)
            return reply.send({ data: logs })
        }
    )

    app.get<{ Params: { projectId: string } }>(
        '/api/v1/projects/:projectId/audit',
        { preHandler: [platformAuthMiddleware] },
        async (request, reply) => {
            const project = (await assertProjectPermission(projectAccessService, request, 'audit.read')).project
            const logs = await operationsLogService.listProject(project.id, 200)
            return reply.send({ data: logs })
        }
    )

    app.get<{ Params: { projectId: string } }>(
        '/api/v1/projects/:projectId/telegram/session',
        { preHandler: [platformAuthMiddleware] },
        async (request, reply) => {
            const project = (await assertProjectPermission(projectAccessService, request, 'settings.read')).project
            const health = telegramSessionPool.getHealth(project.id)
            return reply.send({ data: health })
        }
    )

    app.get<{ Params: { projectId: string } }>(
        '/api/v1/projects/:projectId/webhooks',
        { preHandler: [platformAuthMiddleware] },
        async (request, reply) => {
            const project = (await assertProjectPermission(projectAccessService, request, 'webhooks.read')).project
            const webhooks = await webhookService.listConfigs(project.id)
            return reply.send({ data: webhooks })
        }
    )

    app.get<{ Params: { projectId: string } }>(
        '/api/v1/projects/:projectId/webhooks/dead',
        { preHandler: [platformAuthMiddleware] },
        async (request, reply) => {
            const project = (await assertProjectPermission(projectAccessService, request, 'webhooks.read')).project
            const deadLetters = await webhookService.listDeadLetters(project.id)
            return reply.send({ data: deadLetters })
        }
    )

    app.post<{ Params: { projectId: string; deadLetterId: string } }>(
        '/api/v1/projects/:projectId/webhooks/dead/:deadLetterId/replay',
        { preHandler: [platformAuthMiddleware] },
        async (request, reply) => {
            const project = (await assertProjectPermission(projectAccessService, request, 'webhooks.manage')).project
            const replayed = await webhookService.replayDeadLetter(project.id, request.params.deadLetterId)
            if (!replayed) {
                return reply.status(404).send({ error: { message: 'Dead-letter not found' } })
            }

            return reply.send({ data: replayed })
        }
    )

    app.post<{ Params: { projectId: string } }>(
        '/api/v1/projects/:projectId/webhooks',
        { preHandler: [platformAuthMiddleware] },
        async (request, reply) => {
            const project = (await assertProjectPermission(projectAccessService, request, 'webhooks.manage')).project
            const body = createWebhookSchema.parse(request.body)
            const webhook = await webhookService.createConfig(project.id, body)
            return reply.status(201).send({ data: webhook })
        }
    )

    app.put<{ Params: { projectId: string; webhookId: string } }>(
        '/api/v1/projects/:projectId/webhooks/:webhookId',
        { preHandler: [platformAuthMiddleware] },
        async (request, reply) => {
            const project = (await assertProjectPermission(projectAccessService, request, 'webhooks.manage')).project
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
            const project = (await assertProjectPermission(projectAccessService, request, 'webhooks.manage')).project
            const deleted = await webhookService.deleteConfig(project.id, request.params.webhookId)
            if (!deleted) {
                return reply.status(404).send({ error: { message: 'Webhook not found' } })
            }

            return reply.send({ data: { message: 'Webhook deleted' } })
        }
    )

    app.get<{ Params: { projectId: string } }>(
        '/api/v1/projects/:projectId/access/roles',
        { preHandler: [platformAuthMiddleware] },
        async (request, reply) => {
            await assertProjectPermission(projectAccessService, request, 'roles.read')
            return reply.send({ data: await projectAccessService.listRoles(request.params.projectId) })
        }
    )

    app.post<{ Params: { projectId: string } }>(
        '/api/v1/projects/:projectId/access/roles',
        { preHandler: [platformAuthMiddleware] },
        async (request, reply) => {
            const body = roleSchema.parse(request.body)
            const role = await projectAccessService.upsertRole(
                request.params.projectId,
                request.user!.sub!,
                body
            )
            return reply.status(201).send({ data: role })
        }
    )

    app.delete<{ Params: { projectId: string; roleKey: string } }>(
        '/api/v1/projects/:projectId/access/roles/:roleKey',
        { preHandler: [platformAuthMiddleware] },
        async (request, reply) => {
            await projectAccessService.deleteRole(request.params.projectId, request.user!.sub!, request.params.roleKey)
            return reply.send({ data: { message: 'Role deleted' } })
        }
    )

    app.get<{ Params: { projectId: string } }>(
        '/api/v1/projects/:projectId/access/members',
        { preHandler: [platformAuthMiddleware] },
        async (request, reply) => {
            await assertProjectPermission(projectAccessService, request, 'members.read')
            return reply.send({ data: await projectAccessService.listMembers(request.params.projectId) })
        }
    )

    app.patch<{ Params: { projectId: string; userId: string } }>(
        '/api/v1/projects/:projectId/access/members/:userId',
        { preHandler: [platformAuthMiddleware] },
        async (request, reply) => {
            const body = updateMemberSchema.parse(request.body)
            const member = await projectAccessService.updateMemberRole(
                request.params.projectId,
                request.user!.sub!,
                request.params.userId,
                body.roleKey
            )
            return reply.send({ data: member })
        }
    )

    app.delete<{ Params: { projectId: string; userId: string } }>(
        '/api/v1/projects/:projectId/access/members/:userId',
        { preHandler: [platformAuthMiddleware] },
        async (request, reply) => {
            await projectAccessService.removeMember(
                request.params.projectId,
                request.user!.sub!,
                request.params.userId
            )
            return reply.send({ data: { message: 'Member removed' } })
        }
    )

    app.get<{ Params: { projectId: string } }>(
        '/api/v1/projects/:projectId/access/invitations',
        { preHandler: [platformAuthMiddleware] },
        async (request, reply) => {
            await assertProjectPermission(projectAccessService, request, 'members.read')
            return reply.send({ data: await projectAccessService.listInvitations(request.params.projectId) })
        }
    )

    app.post<{ Params: { projectId: string } }>(
        '/api/v1/projects/:projectId/access/invitations',
        { preHandler: [platformAuthMiddleware] },
        async (request, reply) => {
            const body = inviteMemberSchema.parse(request.body)
            const invitation = await projectAccessService.inviteMember(
                request.params.projectId,
                request.user!.sub!,
                body.email,
                body.roleKey
            )
            return reply.status(201).send({ data: invitation })
        }
    )

    app.delete<{ Params: { projectId: string; invitationId: string } }>(
        '/api/v1/projects/:projectId/access/invitations/:invitationId',
        { preHandler: [platformAuthMiddleware] },
        async (request, reply) => {
            const invitation = await projectAccessService.revokeInvitation(
                request.params.projectId,
                request.params.invitationId,
                request.user!.sub!
            )
            return reply.send({ data: invitation })
        }
    )

    app.post(
        '/api/v1/projects/invitations/accept',
        { preHandler: [platformAuthMiddleware] },
        async (request, reply) => {
            const body = acceptInvitationSchema.parse(request.body)
            const access = await projectAccessService.acceptInvitation(body.token, request.user!.sub!)
            return reply.send({
                data: {
                    projectId: access.project.id,
                    roleKey: access.role.key,
                    roleName: access.role.name,
                },
            })
        }
    )

}

async function assertProjectPermission(
    projectAccessService: ProjectAccessService,
    request: FastifyRequest<{ Params: { projectId: string } }>,
    permission: z.infer<typeof projectPermissionSchema>
) {
    return projectAccessService.assertPlatformPermission(request.params.projectId, request.user!, permission)
}
