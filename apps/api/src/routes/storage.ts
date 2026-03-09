import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { BucketPermission, BucketPolicy, Project } from '@openbase/core'
import { ConflictError, ForbiddenError } from '@openbase/core'
import { z } from 'zod'
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

type BucketAction = 'read' | 'write' | 'delete'

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

            if (project.buckets[body.name]) {
                throw new ConflictError(`Bucket "${body.name}" already exists`)
            }

            return projectService.withProjectStorageRecord(project, async (_project, provider) => {
                const channel = await storageService.createBucket(provider, body.name, { public: body.public })
                const policy = storageService.createBucketPolicy({ public: body.public })

                project.buckets[body.name] = channel
                project.bucketPolicies[body.name] = policy
                await projectService.updateProject(project.id, {
                    buckets: project.buckets,
                    bucketPolicies: project.bucketPolicies,
                })

                return reply.status(201).send({
                    data: { name: body.name, channel, policy },
                })
            })
        }
    )

    app.post<{ Params: { projectId: string; bucket: string; '*': string } }>(
        '/api/v1/:projectId/storage/:bucket/*',
        { preHandler: [authMiddleware] },
        async (request, reply) => {
            const project = await getAuthorizedBucketProject(projectService, request, request.params.bucket, 'write')
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

            return projectService.withProjectStorageRecord(project, async (_project, provider) => {
                const result = await storageService.uploadStream(
                    provider,
                    project.id,
                    bucket,
                    bucketChannel,
                    project.storageIndexChannel,
                    filePath,
                    file.file,
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
            const project = await getAuthorizedBucketProject(projectService, request, request.params.bucket, 'read')
            const { bucket } = request.params
            const filePath = request.params['*']
            const bucketChannel = project.buckets[bucket]

            if (!bucketChannel) {
                return reply.status(404).send({ error: { message: `Bucket "${bucket}" not found` } })
            }

            const isPublic = getBucketPolicy(project, bucket).public === true

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
            const project = await getAuthorizedBucketProject(projectService, request, request.params.bucket, 'read')
            const { bucket } = request.params
            const { prefix } = request.query as { prefix?: string }
            const bucketChannel = project.buckets[bucket]

            if (!bucketChannel) {
                return reply.status(404).send({ error: { message: `Bucket "${bucket}" not found` } })
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
            const project = await getAuthorizedBucketProject(projectService, request, request.params.bucket, 'delete')
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
            const body = signedUrlSchema.parse(request.body)
            const project = await getAuthorizedBucketProject(projectService, request, body.bucket, 'read')

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

async function getAuthorizedBucketProject(
    projectService: ProjectService,
    request: FastifyRequest<{ Params: Record<string, string> }>,
    bucketName: string,
    action: BucketAction
): Promise<Project> {
    const project = await projectService.getProject(request.params.projectId)

    if (!project.buckets[bucketName]) {
        return project
    }

    const policy = getBucketPolicy(project, bucketName)
    if (isBucketAccessAllowed(project, policy, request.user, action)) {
        return project
    }

    throw new ForbiddenError(`You do not have ${action} access to bucket "${bucketName}"`)
}

function getBucketPolicy(project: Project, bucketName: string): BucketPolicy {
    return project.bucketPolicies[bucketName] ?? { public: false }
}

function isBucketAccessAllowed(
    project: Project,
    policy: BucketPolicy,
    user: FastifyRequest['user'],
    action: BucketAction
): boolean {
    const permission = getPermission(policy, action)

    if (action === 'read' && (permission.public === true || policy.public === true)) {
        return true
    }

    if (!user) {
        return false
    }

    if (user.role === 'platform_user') {
        if (user.sub !== project.ownerId) {
            return false
        }
    } else if (user.projectId !== project.id) {
        return false
    }

    if (permission.userIds?.includes(user.sub || '')) {
        return true
    }

    return permission.roles?.includes(user.role) === true
}

function getPermission(policy: BucketPolicy, action: BucketAction): BucketPermission {
    const permission = policy[action]
    if (permission) {
        return permission
    }

    if (action === 'read' && policy.public) {
        return { public: true, roles: ['anon', 'authenticated', 'service_role', 'platform_user'] }
    }

    return { roles: ['authenticated', 'service_role', 'platform_user'] }
}

async function assertProjectAdminAccess(
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

    if (user.projectId === project.id && user.role === 'service_role') {
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
