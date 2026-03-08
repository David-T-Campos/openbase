/**
 * Storage Routes — File upload, download, and signed URL endpoints.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { ForbiddenError } from '@openbase/core'
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth.js'
import type { ProjectService } from '../projects/ProjectService.js'
import type { StorageService } from '../storage/StorageService.js'

const createBucketSchema = z.object({
    name: z.string().min(1).max(64).regex(/^[a-z][a-z0-9_-]*$/),
    public: z.boolean().optional().default(false),
})

const signedUrlSchema = z.object({
    bucket: z.string().min(1),
    path: z.string().min(1),
    expiresIn: z.number().min(1).max(604800).default(3600),
})

export function registerStorageRoutes(
    app: FastifyInstance,
    storageService: StorageService,
    projectService: ProjectService
): void {
    app.post<{ Params: { projectId: string } }>(
        '/api/v1/:projectId/storage/buckets',
        { preHandler: [authMiddleware] },
        async (request, reply) => {
            const project = await assertProjectAdminAccess(projectService, request)
            const body = createBucketSchema.parse(request.body)

            return projectService.withProjectStorageRecord(project, async (_project, provider) => {
                const channel = await storageService.createBucket(provider, body.name, { public: body.public })

                project.buckets[body.name] = channel
                project.bucketPolicies[body.name] = { public: body.public }
                await projectService.updateProject(project.id, {
                    buckets: project.buckets,
                    bucketPolicies: project.bucketPolicies,
                })

                return reply.status(201).send({
                    data: { name: body.name, channel },
                })
            })
        }
    )

    app.post<{ Params: { projectId: string; bucket: string; '*': string } }>(
        '/api/v1/:projectId/storage/:bucket/*',
        { preHandler: [authMiddleware] },
        async (request, reply) => {
            const project = await assertProjectAccess(projectService, request)
            const { bucket } = request.params
            const filePath = request.params['*']
            const bucketChannel = project.buckets[bucket]

            if (!bucketChannel) {
                return reply.status(404).send({ error: { message: `Bucket "${bucket}" not found` } })
            }

            const file = await request.file()
            if (!file) {
                return reply.status(400).send({ error: { message: 'No file provided' } })
            }

            const buffer = await file.toBuffer()

            return projectService.withProjectStorageRecord(project, async (_project, provider) => {
                const result = await storageService.upload(
                    provider,
                    project.id,
                    bucket,
                    bucketChannel,
                    project.storageIndexChannel,
                    filePath,
                    buffer,
                    {
                        mimeType: file.mimetype,
                        userId: request.user?.sub,
                        upsert: String(request.headers['x-upsert'] || '').toLowerCase() === 'true',
                    }
                )

                return reply.status(201).send({ data: result })
            })
        }
    )

    app.get<{ Params: { projectId: string; bucket: string; '*': string }; Querystring: { width?: string; height?: string; format?: string } }>(
        '/api/v1/:projectId/storage/:bucket/*',
        { preHandler: [optionalAuthMiddleware] },
        async (request, reply) => {
            const project = await projectService.getProject(request.params.projectId)
            const { bucket } = request.params
            const filePath = request.params['*']
            const bucketChannel = project.buckets[bucket]

            if (!bucketChannel) {
                return reply.status(404).send({ error: { message: `Bucket "${bucket}" not found` } })
            }

            const isPublic = project.bucketPolicies[bucket]?.public === true
            if (!isPublic) {
                await assertProjectAccess(projectService, request)
            }

            return projectService.withProjectStorageRecord(project, async (_project, provider) => {
                const fileManifest = await storageService.findFile(
                    provider,
                    project.storageIndexChannel,
                    bucket,
                    bucketChannel,
                    filePath
                )

                if (!fileManifest) {
                    return reply.status(404).send({ error: { message: 'File not found' } })
                }

                const transformOptions = getTransformOptions(request.query as {
                    width?: string
                    height?: string
                    format?: string
                })

                const { data: fileData, mimeType } = await storageService.download(
                    provider,
                    fileManifest.fileRef,
                    transformOptions
                )

                return reply
                    .header('Content-Type', mimeType)
                    .header('Content-Length', fileData.length)
                    .header('Cache-Control', isPublic ? 'public, max-age=3600' : 'private, max-age=0')
                    .send(fileData)
            })
        }
    )

    app.get<{ Params: { projectId: string; bucket: string }; Querystring: { prefix?: string } }>(
        '/api/v1/:projectId/storage/:bucket',
        { preHandler: [optionalAuthMiddleware] },
        async (request, reply) => {
            const project = await projectService.getProject(request.params.projectId)
            const { bucket } = request.params
            const { prefix } = request.query as { prefix?: string }
            const bucketChannel = project.buckets[bucket]

            if (!bucketChannel) {
                return reply.status(404).send({ error: { message: `Bucket "${bucket}" not found` } })
            }

            const isPublic = project.bucketPolicies[bucket]?.public === true
            if (!isPublic) {
                await assertProjectAccess(projectService, request)
            }

            return projectService.withProjectStorageRecord(project, async (_project, provider) => {
                const files = await storageService.listFiles(
                    provider,
                    project.storageIndexChannel,
                    bucket,
                    bucketChannel,
                    prefix
                )

                return reply.send({ data: files })
            })
        }
    )

    app.delete<{ Params: { projectId: string; bucket: string; '*': string } }>(
        '/api/v1/:projectId/storage/:bucket/*',
        { preHandler: [authMiddleware] },
        async (request, reply) => {
            const project = await assertProjectAccess(projectService, request)
            const { bucket } = request.params
            const filePath = request.params['*']
            const bucketChannel = project.buckets[bucket]

            if (!bucketChannel) {
                return reply.status(404).send({ error: { message: `Bucket "${bucket}" not found` } })
            }

            return projectService.withProjectStorageRecord(project, async (_project, provider) => {
                const fileManifest = await storageService.findFile(
                    provider,
                    project.storageIndexChannel,
                    bucket,
                    bucketChannel,
                    filePath
                )

                if (!fileManifest) {
                    return reply.status(404).send({ error: { message: 'File not found' } })
                }

                await storageService.deleteFile(
                    provider,
                    project.storageIndexChannel,
                    fileManifest.manifestMessageId,
                    fileManifest.fileRef
                )

                return reply.send({ data: { message: 'File deleted', path: filePath } })
            })
        }
    )

    app.post<{ Params: { projectId: string } }>(
        '/api/v1/:projectId/storage/signed',
        { preHandler: [authMiddleware] },
        async (request, reply) => {
            const project = await assertProjectAccess(projectService, request)
            const body = signedUrlSchema.parse(request.body)

            if (!project.buckets[body.bucket]) {
                return reply.status(404).send({ error: { message: `Bucket "${body.bucket}" not found` } })
            }

            const signedUrl = storageService.createSignedUrl(
                project.id,
                body.bucket,
                body.path,
                body.expiresIn
            )

            return reply.send({ data: { signedUrl } })
        }
    )

    app.get(
        '/api/v1/storage/signed',
        async (request, reply) => {
            const { token } = request.query as { token?: string }
            if (!token) {
                return reply.status(400).send({ error: { message: 'Missing token' } })
            }

            try {
                const payload = storageService.verifySignedUrl(token)
                const project = await projectService.getProject(payload.projectId)
                const bucketChannel = project.buckets[payload.bucket]

                if (!bucketChannel) {
                    return reply.status(404).send({ error: { message: 'Bucket not found' } })
                }

                return projectService.withProjectStorageRecord(project, async (_project, provider) => {
                    const fileManifest = await storageService.findFile(
                        provider,
                        project.storageIndexChannel,
                        payload.bucket,
                        bucketChannel,
                        payload.path
                    )

                    if (!fileManifest) {
                        return reply.status(404).send({ error: { message: 'File not found' } })
                    }

                    const { data: fileData, mimeType } = await storageService.download(
                        provider,
                        fileManifest.fileRef
                    )

                    return reply
                        .header('Content-Type', mimeType)
                        .header('Content-Length', fileData.length)
                        .header('Cache-Control', 'private, max-age=0')
                        .send(fileData)
                })
            } catch {
                return reply.status(403).send({ error: { message: 'Invalid or expired signed URL' } })
            }
        }
    )
}

async function assertProjectAccess(
    projectService: ProjectService,
    request: FastifyRequest<{ Params: Record<string, string> }>
) {
    const project = await projectService.getProject(request.params.projectId)
    const user = request.user

    if (!user) {
        throw new ForbiddenError('Authentication required')
    }

    if (user.role === 'platform_user' && user.sub === project.ownerId) {
        return project
    }

    if (user.projectId === project.id) {
        return project
    }

    throw new ForbiddenError('You do not have access to this project')
}

async function assertProjectAdminAccess(
    projectService: ProjectService,
    request: FastifyRequest<{ Params: Record<string, string> }>
) {
    const project = await assertProjectAccess(projectService, request)

    if (request.user?.role === 'platform_user' || request.user?.role === 'service_role') {
        return project
    }

    throw new ForbiddenError('Administrative access required')
}

function getTransformOptions(query: { width?: string; height?: string; format?: string }) {
    if (!query.width && !query.height && !query.format) {
        return undefined
    }

    return {
        width: query.width ? parseInt(query.width, 10) : undefined,
        height: query.height ? parseInt(query.height, 10) : undefined,
        format: query.format as 'jpeg' | 'png' | 'webp' | 'avif' | undefined,
    }
}
