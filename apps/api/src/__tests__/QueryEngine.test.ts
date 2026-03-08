/**
 * QueryEngine — Unit Tests
 *
 * Tests the in-memory filter logic using a mock StorageProvider.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryEngine } from '../database/QueryEngine.js'
import type { IndexManager } from '../database/IndexManager.js'
import type { StorageProvider } from '@openbase/telegram'
import type { TableSchema, TelegramMessage } from '@openbase/core'

// Mock StorageProvider
function createMockStorage(messages: TelegramMessage[]): StorageProvider {
    return {
        getMessages: vi.fn().mockResolvedValue(messages),
        getMessage: vi.fn().mockImplementation((_channelId: string, id: number) => {
            const msg = messages.find(m => m.id === id)
            return Promise.resolve(msg?.text || null)
        }),
        sendMessage: vi.fn().mockResolvedValue(1),
        editMessage: vi.fn().mockResolvedValue(undefined),
        deleteMessage: vi.fn().mockResolvedValue(undefined),
        createChannel: vi.fn().mockResolvedValue('channel-1'),
        deleteChannel: vi.fn().mockResolvedValue(undefined),
        uploadFile: vi.fn(),
        downloadFile: vi.fn(),
        deleteFile: vi.fn(),
        connect: vi.fn(),
        disconnect: vi.fn(),
        isConnected: vi.fn().mockReturnValue(true),
    }
}

// Mock IndexManager
function createMockIndexManager(): IndexManager {
    return {
        addIndex: vi.fn(),
        addIndexBatch: vi.fn(),
        lookup: vi.fn().mockReturnValue([]),
        lookupAll: vi.fn().mockReturnValue([]),
        removeIndex: vi.fn(),
        updateIndex: vi.fn(),
        dropTable: vi.fn(),
        close: vi.fn(),
    } as unknown as IndexManager
}

const testSchema: TableSchema = {
    tableName: 'posts',
    columns: [
        { name: 'id', type: 'uuid', required: true },
        { name: 'title', type: 'text', required: true },
        { name: 'views', type: 'number' },
        { name: 'published', type: 'boolean' },
        { name: 'created_at', type: 'timestamp' },
        { name: 'tags', type: 'json' },
    ],
    indexes: ['id'],
}

const sampleMessages: TelegramMessage[] = [
    { id: 1, text: JSON.stringify({ id: 'a1', title: 'Hello World', views: 100, published: true, created_at: '2024-01-01' }), date: 1 },
    { id: 2, text: JSON.stringify({ id: 'a2', title: 'Second Post', views: 50, published: false, created_at: '2024-01-02' }), date: 2 },
    { id: 3, text: JSON.stringify({ id: 'a3', title: 'Advanced Guide', views: 200, published: true, created_at: '2024-01-03' }), date: 3 },
    { id: 4, text: JSON.stringify({ id: 'a4', title: 'Draft Post', views: 0, published: false, created_at: '2024-01-04' }), date: 4 },
    { id: 5, text: JSON.stringify({ id: 'a5', title: 'Hello Again', views: 75, published: true, created_at: '2024-01-05' }), date: 5 },
]

describe('QueryEngine', () => {
    let storage: StorageProvider
    let indexManager: IndexManager
    let engine: QueryEngine

    beforeEach(() => {
        storage = createMockStorage(sampleMessages)
        indexManager = createMockIndexManager()
        engine = new QueryEngine(storage, indexManager, testSchema)
    })

    describe('select', () => {
        it('should return all rows when no filters', async () => {
            const rows = await engine.select('posts', 'ch1', {})
            expect(rows).toHaveLength(5)
        })

        it('should filter with eq operator', async () => {
            const rows = await engine.select('posts', 'ch1', {
                filters: [{ column: 'published', operator: 'eq', value: true }],
            })
            expect(rows).toHaveLength(3)
            expect(rows.every(r => r.published === true)).toBe(true)
        })

        it('should filter with neq operator', async () => {
            const rows = await engine.select('posts', 'ch1', {
                filters: [{ column: 'published', operator: 'neq', value: true }],
            })
            expect(rows).toHaveLength(2)
        })

        it('should filter with gt operator', async () => {
            const rows = await engine.select('posts', 'ch1', {
                filters: [{ column: 'views', operator: 'gt', value: 75 }],
            })
            expect(rows).toHaveLength(2)
            expect(rows.every(r => (r.views as number) > 75)).toBe(true)
        })

        it('should filter with gte operator', async () => {
            const rows = await engine.select('posts', 'ch1', {
                filters: [{ column: 'views', operator: 'gte', value: 75 }],
            })
            expect(rows).toHaveLength(3)
        })

        it('should filter with lt operator', async () => {
            const rows = await engine.select('posts', 'ch1', {
                filters: [{ column: 'views', operator: 'lt', value: 75 }],
            })
            expect(rows).toHaveLength(2)
        })

        it('should filter with lte operator', async () => {
            const rows = await engine.select('posts', 'ch1', {
                filters: [{ column: 'views', operator: 'lte', value: 75 }],
            })
            expect(rows).toHaveLength(3)
        })

        it('should filter with like operator', async () => {
            const rows = await engine.select('posts', 'ch1', {
                filters: [{ column: 'title', operator: 'like', value: '%Hello%' }],
            })
            expect(rows).toHaveLength(2)
        })

        it('should filter with ilike operator (case insensitive)', async () => {
            const rows = await engine.select('posts', 'ch1', {
                filters: [{ column: 'title', operator: 'ilike', value: '%hello%' }],
            })
            expect(rows).toHaveLength(2)
        })

        it('should filter with in operator', async () => {
            const rows = await engine.select('posts', 'ch1', {
                filters: [{ column: 'id', operator: 'in', value: ['a1', 'a3'] }],
            })
            expect(rows).toHaveLength(2)
        })

        it('should filter with multiple conditions (AND)', async () => {
            const rows = await engine.select('posts', 'ch1', {
                filters: [
                    { column: 'published', operator: 'eq', value: true },
                    { column: 'views', operator: 'gt', value: 80 },
                ],
            })
            expect(rows).toHaveLength(2)
        })

        it('should order by column ascending', async () => {
            const rows = await engine.select('posts', 'ch1', {
                orderBy: { column: 'views', ascending: true },
            })
            const views = rows.map(r => r.views as number)
            expect(views).toEqual([0, 50, 75, 100, 200])
        })

        it('should order by column descending', async () => {
            const rows = await engine.select('posts', 'ch1', {
                orderBy: { column: 'views', ascending: false },
            })
            const views = rows.map(r => r.views as number)
            expect(views).toEqual([200, 100, 75, 50, 0])
        })

        it('should apply limit', async () => {
            const rows = await engine.select('posts', 'ch1', { limit: 2 })
            expect(rows).toHaveLength(2)
        })

        it('should apply offset and limit (pagination)', async () => {
            const rows = await engine.select('posts', 'ch1', {
                orderBy: { column: 'views', ascending: false },
                offset: 1,
                limit: 2,
            })
            expect(rows).toHaveLength(2)
            expect(rows[0].views).toBe(100)
            expect(rows[1].views).toBe(75)
        })

        it('should project specific columns', async () => {
            const rows = await engine.select('posts', 'ch1', {
                select: ['title', 'views'],
                limit: 1,
            })
            expect(rows[0]).toHaveProperty('title')
            expect(rows[0]).toHaveProperty('views')
            expect(rows[0]).not.toHaveProperty('published')
            expect(rows[0]).not.toHaveProperty('id')
        })
    })

    describe('insert', () => {
        it('should send a message and update indexes', async () => {
            const result = await engine.insert('posts', 'ch1', {
                id: 'new-1',
                title: 'New Post',
                views: 0,
                published: false,
            })

            expect(result._msgId).toBeDefined()
            expect(result.title).toBe('New Post')
            expect(storage.sendMessage).toHaveBeenCalledOnce()
            expect(indexManager.updateIndex).toHaveBeenCalledOnce()
        })

        it('should apply default uuid values before validating required columns', async () => {
            const result = await engine.insert('posts', 'ch1', {
                title: 'Generated ID',
                views: 1,
                published: true,
            })

            expect(typeof result.id).toBe('string')
            expect(result.id).toBeTruthy()
            expect(storage.sendMessage).toHaveBeenCalledOnce()
        })
    })
})
