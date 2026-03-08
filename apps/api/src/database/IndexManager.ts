/**
 * IndexManager — In-process SQLite index using sql.js (pure JS, no native binaries)
 *
 * For every field marked as indexed in a table schema, maintains a
 * SQLite index that maps (table, column, value) → message IDs.
 * This avoids scanning all Telegram messages for indexed queries.
 *
 * sql.js runs SQLite compiled to WebAssembly — no native compilation needed.
 * The database is kept in memory and optionally persisted to disk.
 */

import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { dirname } from 'path'

export class IndexManager {
    private db!: SqlJsDatabase
    private dbPath: string
    private ready: Promise<void>

    /**
     * @param projectId - Used to isolate indexes per project
     * @param basePath  - Base directory for persisted SQLite files
     */
    constructor(projectId: string, basePath: string = './data/indexes') {
        this.dbPath = `${basePath}/${projectId}.sqlite`
        this.ready = this.init()
    }

    private async init(): Promise<void> {
        const SQL = await initSqlJs()

        // Ensure directory exists
        mkdirSync(dirname(this.dbPath), { recursive: true })

        // Load existing DB file if present, otherwise create fresh
        if (existsSync(this.dbPath)) {
            const fileBuffer = readFileSync(this.dbPath)
            this.db = new SQL.Database(fileBuffer)
        } else {
            this.db = new SQL.Database()
        }

        // Create index table
        this.db.run(`
            CREATE TABLE IF NOT EXISTS field_index (
                table_name  TEXT NOT NULL,
                column_name TEXT NOT NULL,
                value       TEXT,
                message_id  INTEGER NOT NULL,
                PRIMARY KEY (table_name, column_name, value, message_id)
            )
        `)

        this.db.run(`
            CREATE INDEX IF NOT EXISTS idx_lookup
            ON field_index(table_name, column_name, value)
        `)

        this.db.run(`
            CREATE INDEX IF NOT EXISTS idx_table_msg
            ON field_index(table_name, message_id)
        `)

        this.persist()
    }

    /** Persist the in-memory database back to disk. */
    private persist(): void {
        try {
            const data = this.db.export()
            writeFileSync(this.dbPath, Buffer.from(data))
        } catch {
            // Non-fatal — index lives in memory even if disk write fails
        }
    }

    /** Wait for the database to be ready before any operation. */
    private async ensureReady(): Promise<void> {
        await this.ready
    }

    // ─── Public API ──────────────────────────────────────────────

    /** Add an index entry for a field value pointing to a message ID. */
    async addIndex(tableName: string, columnName: string, value: string, messageId: number): Promise<void> {
        await this.ensureReady()
        this.db.run(
            'INSERT OR REPLACE INTO field_index VALUES (?, ?, ?, ?)',
            [tableName, columnName, String(value), messageId]
        )
        this.persist()
    }

    /** Batch-add multiple index entries. */
    async addIndexBatch(entries: Array<{ tableName: string; columnName: string; value: string; messageId: number }>): Promise<void> {
        await this.ensureReady()
        this.db.run('BEGIN')
        try {
            for (const entry of entries) {
                this.db.run(
                    'INSERT OR REPLACE INTO field_index VALUES (?, ?, ?, ?)',
                    [entry.tableName, entry.columnName, String(entry.value), entry.messageId]
                )
            }
            this.db.run('COMMIT')
        } catch (err) {
            this.db.run('ROLLBACK')
            throw err
        }
        this.persist()
    }

    /** Look up message IDs where (table, column) has the given value. */
    async lookup(tableName: string, columnName: string, value: string): Promise<number[]> {
        await this.ensureReady()
        const results = this.db.exec(
            'SELECT message_id FROM field_index WHERE table_name = ? AND column_name = ? AND value = ?',
            [tableName, columnName, String(value)]
        )
        if (!results.length || !results[0].values.length) return []
        return results[0].values.map(row => row[0] as number)
    }

    /** Look up all message IDs for a table (useful for full scans). */
    async lookupAll(tableName: string): Promise<number[]> {
        await this.ensureReady()
        const results = this.db.exec(
            'SELECT DISTINCT message_id FROM field_index WHERE table_name = ?',
            [tableName]
        )
        if (!results.length || !results[0].values.length) return []
        return results[0].values.map(row => row[0] as number)
    }

    /** Remove all index entries for a specific message in a table. */
    async removeIndex(tableName: string, messageId: number): Promise<void> {
        await this.ensureReady()
        this.db.run(
            'DELETE FROM field_index WHERE table_name = ? AND message_id = ?',
            [tableName, messageId]
        )
        this.persist()
    }

    /** Update index entries — remove old entries for a message, add new ones. */
    async updateIndex(
        tableName: string,
        messageId: number,
        entries: Array<{ columnName: string; value: string }>
    ): Promise<void> {
        await this.ensureReady()
        this.db.run('BEGIN')
        try {
            this.db.run(
                'DELETE FROM field_index WHERE table_name = ? AND message_id = ?',
                [tableName, messageId]
            )
            for (const entry of entries) {
                this.db.run(
                    'INSERT OR REPLACE INTO field_index VALUES (?, ?, ?, ?)',
                    [tableName, entry.columnName, String(entry.value), messageId]
                )
            }
            this.db.run('COMMIT')
        } catch (err) {
            this.db.run('ROLLBACK')
            throw err
        }
        this.persist()
    }

    /** Drop all indexes for a table. */
    async dropTable(tableName: string): Promise<void> {
        await this.ensureReady()
        this.db.run(
            'DELETE FROM field_index WHERE table_name = ?',
            [tableName]
        )
        this.persist()
    }

    /** Close and release the database. */
    async close(): Promise<void> {
        await this.ensureReady()
        this.persist()
        this.db.close()
    }
}
