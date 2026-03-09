'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Copy, Download, FolderOpen, Link2, Plus, Trash2, Upload } from 'lucide-react'
import { authenticatedFetch } from '../../../../lib/platformApi'

interface StorageFile {
    path: string
    size: number
    mimeType: string
    createdAt: number
}

interface StorageBucket {
    name: string
    public: boolean
}

export default function StorageBrowserPage() {
    const params = useParams()
    const projectId = params.projectId as string

    const [activeBucket, setActiveBucket] = useState<string | null>(null)
    const [showCreateBucket, setShowCreateBucket] = useState(false)
    const [newBucketName, setNewBucketName] = useState('')
    const [newBucketPublic, setNewBucketPublic] = useState(false)
    const [buckets, setBuckets] = useState<StorageBucket[]>([])
    const [files, setFiles] = useState<StorageFile[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [signedUrlByPath, setSignedUrlByPath] = useState<Record<string, string>>({})

    useEffect(() => {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
        authenticatedFetch(`${apiUrl}/api/v1/projects/${projectId}`)
            .then((response: Response) => response.json())
            .then((data: {
                data?: {
                    buckets?: Record<string, unknown>
                    bucketPolicies?: Record<string, { public?: boolean }>
                }
            }) => {
                if (!data.data?.buckets) return
                const bucketPolicies = data.data.bucketPolicies || {}
                setBuckets(
                    Object.keys(data.data.buckets).map(name => ({
                        name,
                        public: bucketPolicies[name]?.public === true,
                    })),
                )
            })
            .catch(() => null)
            .finally(() => setLoading(false))
    }, [projectId])

    const fetchFiles = async (bucket: string) => {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

        try {
            const res = await authenticatedFetch(`${apiUrl}/api/v1/${projectId}/storage/${bucket}`)
            const data = await res.json()
            setFiles(data.data || [])
        } catch {
            setFiles([])
        }
    }

    const handleBucketClick = (bucket: string) => {
        setActiveBucket(bucket)
        fetchFiles(bucket)
    }

    const handleCreateBucket = async () => {
        if (!newBucketName) return
        setError('')

        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

        try {
            const res = await authenticatedFetch(`${apiUrl}/api/v1/${projectId}/storage/buckets`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ name: newBucketName, public: newBucketPublic }),
            })

            if (!res.ok) {
                const data = await res.json()
                throw new Error(data.error?.message || 'Failed to create bucket')
            }

            setBuckets([...buckets, { name: newBucketName, public: newBucketPublic }])
            setShowCreateBucket(false)
            setNewBucketName('')
            setNewBucketPublic(false)
        } catch (err) {
            setError((err as Error).message)
        }
    }

    const handleUploadFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
        if (!activeBucket || !event.target.files?.[0]) return

        const file = event.target.files[0]
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
        const formData = new FormData()
        formData.append('file', file)

        try {
            await authenticatedFetch(`${apiUrl}/api/v1/${projectId}/storage/${activeBucket}/${encodeStoragePath(file.name)}`, {
                method: 'POST',
                body: formData,
            })
            await fetchFiles(activeBucket)
        } catch {
            return
        }

        event.target.value = ''
    }

    const handleDeleteFile = async (path: string) => {
        if (!activeBucket) return

        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

        try {
            await authenticatedFetch(`${apiUrl}/api/v1/${projectId}/storage/${activeBucket}/${encodeStoragePath(path)}`, {
                method: 'DELETE',
            })
            await fetchFiles(activeBucket)
        } catch {
            return
        }
    }

    const handleDownloadFile = async (path: string) => {
        if (!activeBucket) return

        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

        try {
            const res = await authenticatedFetch(`${apiUrl}/api/v1/${projectId}/storage/${activeBucket}/${encodeStoragePath(path)}`)
            if (!res.ok) {
                throw new Error(`Failed to download ${path}`)
            }

            const blob = await res.blob()
            const url = URL.createObjectURL(blob)
            const anchor = document.createElement('a')
            anchor.href = url
            anchor.download = path.split('/').pop() || path
            document.body.appendChild(anchor)
            anchor.click()
            anchor.remove()
            URL.revokeObjectURL(url)
        } catch (err) {
            setError((err as Error).message)
        }
    }

    const handleCreateSignedUrl = async (path: string) => {
        if (!activeBucket) return

        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

        try {
            const res = await authenticatedFetch(`${apiUrl}/api/v1/${projectId}/storage/signed`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    bucket: activeBucket,
                    path,
                    expiresIn: 3600,
                }),
            })
            const data = await res.json()
            if (!res.ok || !data.data?.signedUrl) {
                throw new Error(data.error?.message || 'Failed to create signed URL')
            }

            setSignedUrlByPath(current => ({
                ...current,
                [path]: data.data.signedUrl,
            }))
            await navigator.clipboard.writeText(data.data.signedUrl)
        } catch (err) {
            setError((err as Error).message)
        }
    }

    const formatSize = (bytes: number) => {
        if (bytes < 1024) return `${bytes} B`
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    }

    return (
        <div className="shell py-8 md:py-10">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                <div>
                    <h1 className="text-3xl font-semibold tracking-[-0.04em] text-white">Storage</h1>
                    <p className="mt-2 text-sm subtle">Create buckets, browse files, and manage uploads for the project.</p>
                </div>
                <button type="button" onClick={() => setShowCreateBucket(true)} className="btn btn-primary">
                    <Plus className="h-4 w-4" />
                    New bucket
                </button>
            </div>

            {error && (
                <div className="mt-6 rounded-[10px] border border-[rgba(239,111,108,0.25)] bg-[rgba(239,111,108,0.08)] px-4 py-3 text-sm text-[#f0b1af]">
                    {error}
                </div>
            )}

            <section className="panel mt-6 overflow-hidden">
                <div className="grid min-h-[620px] lg:grid-cols-[280px_minmax(0,1fr)]">
                    <aside className="border-b border-[color:var(--line)] bg-[rgba(255,255,255,0.02)] p-4 lg:border-b-0 lg:border-r">
                        {showCreateBucket && (
                            <div className="panel-soft mb-4 p-3">
                                <label htmlFor="bucket-name" className="label">
                                    Bucket name
                                </label>
                                <input
                                    id="bucket-name"
                                    type="text"
                                    value={newBucketName}
                                    onChange={e => setNewBucketName(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleCreateBucket()}
                                    placeholder="assets"
                                    className="input"
                                />
                                <label className="mt-3 inline-flex items-center gap-2 text-sm subtle">
                                    <input
                                        type="checkbox"
                                        checked={newBucketPublic}
                                        onChange={event => setNewBucketPublic(event.target.checked)}
                                        className="h-4 w-4 rounded border-[color:var(--line)] bg-[color:var(--panel-soft)] accent-[color:var(--accent)]"
                                    />
                                    Public bucket
                                </label>
                                <div className="mt-3 flex gap-2">
                                    <button type="button" onClick={handleCreateBucket} className="btn btn-primary flex-1">
                                        Create
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setShowCreateBucket(false)
                                            setNewBucketName('')
                                        }}
                                        className="btn btn-secondary flex-1"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        )}

                        <div className="mb-4 text-xs font-medium subtle">Buckets</div>
                        <div className="space-y-1">
                            {loading && <p className="px-2 py-4 text-sm subtle">Loading buckets...</p>}
                            {!loading && buckets.length === 0 && <p className="px-2 py-4 text-sm subtle">No buckets yet.</p>}
                            {buckets.map(bucket => (
                                <button
                                    key={bucket.name}
                                    type="button"
                                    onClick={() => handleBucketClick(bucket.name)}
                                    className="sidebar-link w-full"
                                    data-active={activeBucket === bucket.name}
                                >
                                    <FolderOpen className="h-4 w-4" />
                                    {bucket.name}
                                    <span className="ml-auto text-[10px] uppercase tracking-[0.08em] subtle">
                                        {bucket.public ? 'public' : 'private'}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </aside>

                    <div className="min-w-0 p-6">
                        {activeBucket ? (
                            <>
                                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                                    <div>
                                        <div className="text-lg font-semibold text-white">{activeBucket}</div>
                                        <div className="mt-1 text-sm subtle">Files currently stored in this bucket.</div>
                                    </div>
                                    <label className="btn btn-primary cursor-pointer">
                                        <Upload className="h-4 w-4" />
                                        Upload file
                                        <input type="file" className="hidden" onChange={handleUploadFile} />
                                    </label>
                                </div>

                                {files.length === 0 ? (
                                    <div className="empty-state">
                                        <div className="max-w-md">
                                            <FolderOpen className="mx-auto h-10 w-10 text-[color:var(--accent)]" />
                                            <div className="mt-4 text-xl font-semibold text-white">No files in this bucket</div>
                                            <p className="mt-3 text-sm leading-7 subtle">
                                                Upload the first file to populate the bucket browser.
                                            </p>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="table-shell mt-6">
                                        <table className="data-table">
                                            <thead>
                                                <tr>
                                                    <th>Name</th>
                                                    <th>Size</th>
                                                    <th>Type</th>
                                                    <th>Created</th>
                                                    <th>Action</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {files.map(file => (
                                                    <tr key={file.path}>
                                                        <td className="font-mono text-xs text-white">{file.path}</td>
                                                        <td className="subtle">{formatSize(file.size)}</td>
                                                        <td className="subtle">{file.mimeType}</td>
                                                        <td className="subtle">{new Date(file.createdAt).toLocaleDateString()}</td>
                                                        <td>
                                                            <div className="flex flex-wrap gap-2">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleDownloadFile(file.path)}
                                                                    className="btn btn-secondary h-9 min-h-0 px-3"
                                                                >
                                                                    <Download className="h-4 w-4" />
                                                                    Download
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleCreateSignedUrl(file.path)}
                                                                    className="btn btn-secondary h-9 min-h-0 px-3"
                                                                >
                                                                    <Link2 className="h-4 w-4" />
                                                                    Signed URL
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleDeleteFile(file.path)}
                                                                    className="btn btn-danger h-9 min-h-0 px-3"
                                                                >
                                                                    <Trash2 className="h-4 w-4" />
                                                                    Delete
                                                                </button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}

                                {Object.keys(signedUrlByPath).length > 0 && (
                                    <div className="mt-6 space-y-3">
                                        {Object.entries(signedUrlByPath).map(([path, signedUrl]) => (
                                            <div key={path} className="panel-soft flex flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between">
                                                <div className="min-w-0">
                                                    <div className="font-mono text-xs text-white">{path}</div>
                                                    <div className="mt-1 truncate font-mono text-[11px] subtle">{signedUrl}</div>
                                                </div>
                                                <button type="button" onClick={() => navigator.clipboard.writeText(signedUrl)} className="btn btn-secondary">
                                                    <Copy className="h-4 w-4" />
                                                    Copy URL
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </>
                        ) : (
                            <div className="empty-state">
                                <div className="max-w-md">
                                    <FolderOpen className="mx-auto h-10 w-10 text-[color:var(--accent)]" />
                                    <div className="mt-4 text-xl font-semibold text-white">Select a bucket</div>
                                    <p className="mt-3 text-sm leading-7 subtle">
                                        Choose a bucket from the left rail to inspect its files and upload new assets.
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </section>
        </div>
    )
}

function encodeStoragePath(path: string): string {
    return path
        .split('/')
        .map(segment => encodeURIComponent(segment))
        .join('/')
}
