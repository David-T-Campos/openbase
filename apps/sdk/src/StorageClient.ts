/**
 * StorageClient — Client-side file storage operations
 */

import type { UploadOptions, TransformOptions } from './types.js'

export class StorageClient {
    constructor(
        private projectUrl: string,
        private projectId: string,
        private apiKey: string,
        private getAccessToken: () => string | null
    ) { }

    /** Get a reference to a storage bucket */
    from(bucket: string): StorageBucketClient {
        return new StorageBucketClient(
            this.projectUrl,
            this.projectId,
            bucket,
            this.apiKey,
            this.getAccessToken
        )
    }

    /** Create a new bucket */
    async createBucket(
        name: string,
        options?: { public?: boolean }
    ): Promise<{ data: { name: string } | null; error: { message: string } | null }> {
        try {
            const token = this.getAccessToken() || this.apiKey
            const fetchFn = typeof globalThis.fetch !== 'undefined' ? globalThis.fetch : (await import('cross-fetch')).default
            const response = await fetchFn(
                `${this.projectUrl}/api/v1/${this.projectId}/storage/buckets`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json',
                        'apikey': this.apiKey,
                    },
                    body: JSON.stringify({ name, public: options?.public || false }),
                }
            )

            const json = await response.json() as { data?: { name: string }; error?: { message: string } }
            return {
                data: json.data || null,
                error: json.error || null,
            }
        } catch (error) {
            return { data: null, error: { message: (error as Error).message } }
        }
    }
}

/**
 * Client for operations on a specific bucket
 */
class StorageBucketClient {
    constructor(
        private projectUrl: string,
        private projectId: string,
        private bucket: string,
        private apiKey: string,
        private getAccessToken: () => string | null
    ) { }

    /** Upload a file */
    async upload(
        path: string,
        file: Blob | File | Uint8Array | ArrayBuffer,
        _options?: UploadOptions
    ): Promise<{ data: { path: string } | null; error: { message: string } | null }> {
        try {
            const token = this.getAccessToken() || this.apiKey
            const formData = new FormData()

            if (file instanceof Blob) {
                formData.append('file', file, path)
            } else {
                const bytes = file instanceof ArrayBuffer ? new Uint8Array(file) : file
                formData.append('file', new Blob([bytes as BlobPart]), path)
            }

            const fetchFn = typeof globalThis.fetch !== 'undefined' ? globalThis.fetch : (await import('cross-fetch')).default
            const response = await fetchFn(
                `${this.projectUrl}/api/v1/${this.projectId}/storage/${this.bucket}/${path}`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'apikey': this.apiKey,
                        ...(Boolean(_options?.upsert) ? { 'x-upsert': 'true' } : {}),
                    },
                    body: formData,
                }
            )

            const json = await response.json() as { data?: { path: string }; error?: { message: string } }
            return {
                data: json.data || null,
                error: json.error || null,
            }
        } catch (error) {
            return { data: null, error: { message: (error as Error).message } }
        }
    }

    /** Download a file */
    async download(
        path: string,
        options?: { transform?: TransformOptions }
    ): Promise<{ data: Blob | null; error: { message: string } | null }> {
        try {
            const params = new URLSearchParams()
            if (options?.transform?.width) params.set('width', String(options.transform.width))
            if (options?.transform?.height) params.set('height', String(options.transform.height))
            if (options?.transform?.format) params.set('format', options.transform.format)

            const query = params.toString()
            const url = `${this.projectUrl}/api/v1/${this.projectId}/storage/${this.bucket}/${path}${query ? `?${query}` : ''}`

            const fetchFn = typeof globalThis.fetch !== 'undefined' ? globalThis.fetch : (await import('cross-fetch')).default
            const token = this.getAccessToken() || this.apiKey
            const response = await fetchFn(url, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'apikey': this.apiKey,
                },
            })

            if (!response.ok) {
                const json = await response.json() as { error?: { message: string } }
                return { data: null, error: json.error || { message: `HTTP ${response.status}` } }
            }

            const blob = await response.blob()
            return { data: blob, error: null }
        } catch (error) {
            return { data: null, error: { message: (error as Error).message } }
        }
    }

    /** Remove a file */
    async remove(
        paths: string[]
    ): Promise<{ data: null; error: { message: string } | null }> {
        try {
            const token = this.getAccessToken() || this.apiKey

            for (const path of paths) {
                const fetchFn = typeof globalThis.fetch !== 'undefined' ? globalThis.fetch : (await import('cross-fetch')).default
                await fetchFn(
                    `${this.projectUrl}/api/v1/${this.projectId}/storage/${this.bucket}/${path}`,
                    {
                        method: 'DELETE',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'apikey': this.apiKey,
                        },
                    }
                )
            }

            return { data: null, error: null }
        } catch (error) {
            return { data: null, error: { message: (error as Error).message } }
        }
    }

    /** List files in a path */
    async list(
        prefix?: string
    ): Promise<{ data: Array<{ path: string; size: number; mimeType: string }> | null; error: { message: string } | null }> {
        try {
            const token = this.getAccessToken() || this.apiKey
            const params = prefix ? `?prefix=${encodeURIComponent(prefix)}` : ''

            const fetchFn = typeof globalThis.fetch !== 'undefined' ? globalThis.fetch : (await import('cross-fetch')).default
            const response = await fetchFn(
                `${this.projectUrl}/api/v1/${this.projectId}/storage/${this.bucket}${params}`,
                {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'apikey': this.apiKey,
                    },
                }
            )

            const json = await response.json() as { data?: Array<{ path: string; size: number; mimeType: string }>; error?: { message: string } }
            return {
                data: json.data || null,
                error: json.error || null,
            }
        } catch (error) {
            return { data: null, error: { message: (error as Error).message } }
        }
    }

    /** Get a public URL for a file */
    getPublicUrl(path: string): { data: { publicUrl: string } } {
        return {
            data: {
                publicUrl: `${this.projectUrl}/api/v1/${this.projectId}/storage/${this.bucket}/${path}`,
            },
        }
    }

    /** Create a signed URL with expiry */
    async createSignedUrl(
        path: string,
        expiresIn: number
    ): Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }> {
        try {
            const token = this.getAccessToken() || this.apiKey
            const fetchFn = typeof globalThis.fetch !== 'undefined' ? globalThis.fetch : (await import('cross-fetch')).default
            const response = await fetchFn(
                `${this.projectUrl}/api/v1/${this.projectId}/storage/signed`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json',
                        'apikey': this.apiKey,
                    },
                    body: JSON.stringify({ bucket: this.bucket, path, expiresIn }),
                }
            )

            const json = await response.json() as { data?: { signedUrl: string }; error?: { message: string } }
            return {
                data: json.data || null,
                error: json.error || null,
            }
        } catch (error) {
            return { data: null, error: { message: (error as Error).message } }
        }
    }
}
