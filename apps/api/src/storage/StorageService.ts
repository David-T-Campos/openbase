/**
 * StorageService — File upload, download, and signed URL management.
 */

import jwt from 'jsonwebtoken'
import type { StorageProvider } from '@openbase/telegram'
import type { BucketPolicy, FileRef, TelegramChannelRef, TransformOptions, UploadOptions } from '@openbase/core'
import { ConflictError, ForbiddenError } from '@openbase/core'

interface StorageManifest {
    __type: 'STORAGE_MANIFEST'
    path: string
    bucket: string
    bucketChannel: TelegramChannelRef
    fileRef: FileRef
    uploadedBy: string | null
    createdAt: number
    size: number
    mimeType: string
}

export class StorageService {
    constructor(
        private readonly storageSecret: string,
        private readonly apiPublicUrl: string
    ) { }

    async upload(
        provider: StorageProvider,
        projectId: string,
        bucketName: string,
        bucketChannel: TelegramChannelRef,
        storageIndexChannel: TelegramChannelRef,
        path: string,
        data: Buffer,
        options: UploadOptions = {}
    ): Promise<{ path: string; publicUrl: string; fileRef: FileRef }> {
        const mimeType = options.mimeType || 'application/octet-stream'

        const existing = await this.findFile(
            provider,
            storageIndexChannel,
            bucketName,
            bucketChannel,
            path
        )

        if (existing && !options.upsert) {
            throw new ConflictError(`File "${path}" already exists in bucket "${bucketName}"`)
        }

        if (existing && options.upsert) {
            await this.deleteFile(
                provider,
                storageIndexChannel,
                existing.manifestMessageId,
                existing.fileRef
            )
        }

        const fileRef = await provider.uploadFile(bucketChannel, data, path, mimeType)

        const manifest: StorageManifest = {
            __type: 'STORAGE_MANIFEST',
            path,
            bucket: bucketName,
            bucketChannel,
            fileRef,
            uploadedBy: options.userId || null,
            createdAt: Date.now(),
            size: data.length,
            mimeType,
        }

        await provider.sendMessage(storageIndexChannel, JSON.stringify(manifest))

        return {
            path,
            publicUrl: `${this.apiPublicUrl}/api/v1/${projectId}/storage/${bucketName}/${path.split('/').map(encodeURIComponent).join('/')}`,
            fileRef,
        }
    }

    async download(
        provider: StorageProvider,
        fileRef: FileRef,
        transformOptions?: TransformOptions
    ): Promise<{ data: Buffer; mimeType: string }> {
        let data = await provider.downloadFile(fileRef)
        let mimeType = fileRef.mimeType

        if (transformOptions && this.isImage(mimeType)) {
            const transformed = await this.applyTransforms(data, transformOptions)
            data = transformed.data
            mimeType = transformed.mimeType
        }

        return { data, mimeType }
    }

    async deleteFile(
        provider: StorageProvider,
        storageIndexChannel: TelegramChannelRef,
        manifestMessageId: number,
        fileRef: FileRef
    ): Promise<void> {
        await provider.deleteFile(fileRef)
        await provider.deleteMessage(storageIndexChannel, manifestMessageId)
    }

    createSignedUrl(
        projectId: string,
        bucket: string,
        path: string,
        expiresIn: number
    ): string {
        const token = jwt.sign({ projectId, bucket, path }, this.storageSecret, { expiresIn })
        return `${this.apiPublicUrl}/api/v1/storage/signed?token=${token}`
    }

    verifySignedUrl(token: string): { projectId: string; bucket: string; path: string } {
        try {
            return jwt.verify(token, this.storageSecret) as {
                projectId: string
                bucket: string
                path: string
            }
        } catch {
            throw new ForbiddenError('Invalid or expired signed URL')
        }
    }

    async listFiles(
        provider: StorageProvider,
        storageIndexChannel: TelegramChannelRef,
        bucketName: string,
        bucketChannel: TelegramChannelRef,
        prefix?: string
    ): Promise<Array<{ path: string; size: number; mimeType: string; createdAt: number }>> {
        const manifests = await this.getManifests(provider, storageIndexChannel, bucketName, bucketChannel, prefix)
        return manifests.map(manifest => ({
            path: manifest.path,
            size: manifest.size,
            mimeType: manifest.mimeType,
            createdAt: manifest.createdAt,
        }))
    }

    async findFile(
        provider: StorageProvider,
        storageIndexChannel: TelegramChannelRef,
        bucketName: string,
        bucketChannel: TelegramChannelRef,
        path: string
    ): Promise<{
        path: string
        size: number
        mimeType: string
        createdAt: number
        fileRef: FileRef
        manifestMessageId: number
    } | null> {
        const manifests = await this.getManifests(provider, storageIndexChannel, bucketName, bucketChannel, path)
        return manifests.find(manifest => manifest.path === path) || null
    }

    async createBucket(
        provider: StorageProvider,
        name: string,
        _policy: BucketPolicy = { public: false }
    ): Promise<TelegramChannelRef> {
        return provider.createChannel(`__storage_${name}__`)
    }

    private async getManifests(
        provider: StorageProvider,
        storageIndexChannel: TelegramChannelRef,
        bucketName: string,
        bucketChannel: TelegramChannelRef,
        prefix?: string
    ): Promise<Array<{
        path: string
        size: number
        mimeType: string
        createdAt: number
        fileRef: FileRef
        manifestMessageId: number
    }>> {
        const messages = await provider.getMessages(storageIndexChannel, { limit: 500 })

        return messages
            .map(message => {
                try {
                    const manifest = JSON.parse(message.text) as StorageManifest
                    if (manifest.__type !== 'STORAGE_MANIFEST') return null
                    if (manifest.bucket !== bucketName) return null
                    if (manifest.bucketChannel.id !== bucketChannel.id) return null
                    if (prefix && !manifest.path.startsWith(prefix)) return null

                    return {
                        path: manifest.path,
                        size: manifest.size,
                        mimeType: manifest.mimeType,
                        createdAt: manifest.createdAt,
                        fileRef: manifest.fileRef,
                        manifestMessageId: message.id,
                    }
                } catch {
                    return null
                }
            })
            .filter((manifest): manifest is {
                path: string
                size: number
                mimeType: string
                createdAt: number
                fileRef: FileRef
                manifestMessageId: number
            } => manifest !== null)
    }

    private isImage(mimeType: string): boolean {
        return mimeType.startsWith('image/')
    }

    private async applyTransforms(
        data: Buffer,
        options: TransformOptions
    ): Promise<{ data: Buffer; mimeType: string }> {
        const { default: sharp } = await import('sharp')
        let transform = sharp(data)

        const width = options.width && options.width > 0 ? options.width : undefined
        const height = options.height && options.height > 0 ? options.height : undefined

        if (width || height) {
            transform = transform.resize(width, height, { fit: 'cover' })
        }

        let mimeType = 'image/png'
        if (options.format) {
            transform = transform.toFormat(options.format, { quality: options.quality || 80 })
            mimeType = `image/${options.format}`
        }

        return {
            data: await transform.toBuffer(),
            mimeType,
        }
    }
}
