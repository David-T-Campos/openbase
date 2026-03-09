import Database from 'better-sqlite3'
import { mkdirSync } from 'fs'
import { dirname } from 'path'

interface IndexEntry {
    tableName: string
    columnName: string
    value: string
    messageId: number
}

export class IndexManager {
    private readonly db: Database.Database

    constructor(projectId: string, basePath: string = './data/indexes') {
        const dbPath = `${basePath}/${projectId}.sqlite`
        mkdirSync(dirname(dbPath), { recursive: true })

        this.db = new Database(dbPath)
        this.db.pragma('journal_mode = WAL')
        this.db.pragma('synchronous = NORMAL')
        this.db.pragma('busy_timeout = 5000')

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS field_index (
                table_name  TEXT NOT NULL,
                column_name TEXT NOT NULL,
                value       TEXT,
                message_id  INTEGER NOT NULL,
                PRIMARY KEY (table_name, column_name, value, message_id)
            );

            CREATE INDEX IF NOT EXISTS idx_lookup
            ON field_index(table_name, column_name, value);

            CREATE INDEX IF NOT EXISTS idx_table_msg
            ON field_index(table_name, message_id);
        `)
    }

    async addIndex(tableName: string, columnName: string, value: string, messageId: number): Promise<void> {
        this.db
            .prepare('INSERT OR REPLACE INTO field_index VALUES (?, ?, ?, ?)')
            .run(tableName, columnName, String(value), messageId)
    }

    async addIndexBatch(entries: IndexEntry[]): Promise<void> {
        const insert = this.db.prepare('INSERT OR REPLACE INTO field_index VALUES (?, ?, ?, ?)')
        const transaction = this.db.transaction((batch: IndexEntry[]) => {
            for (const entry of batch) {
                insert.run(entry.tableName, entry.columnName, String(entry.value), entry.messageId)
            }
        })

        transaction(entries)
    }

    async lookup(tableName: string, columnName: string, value: string): Promise<number[]> {
        const rows = this.db
            .prepare(`
                SELECT message_id
                FROM field_index
                WHERE table_name = ? AND column_name = ? AND value = ?
            `)
            .all(tableName, columnName, String(value)) as Array<{ message_id: number }>

        return rows.map(row => row.message_id)
    }

    async lookupAll(tableName: string): Promise<number[]> {
        const rows = this.db
            .prepare(`
                SELECT DISTINCT message_id
                FROM field_index
                WHERE table_name = ?
            `)
            .all(tableName) as Array<{ message_id: number }>

        return rows.map(row => row.message_id)
    }

    async removeIndex(tableName: string, messageId: number): Promise<void> {
        this.db
            .prepare('DELETE FROM field_index WHERE table_name = ? AND message_id = ?')
            .run(tableName, messageId)
    }

    async updateIndex(
        tableName: string,
        messageId: number,
        entries: Array<{ columnName: string; value: string }>
    ): Promise<void> {
        const clear = this.db.prepare('DELETE FROM field_index WHERE table_name = ? AND message_id = ?')
        const insert = this.db.prepare('INSERT OR REPLACE INTO field_index VALUES (?, ?, ?, ?)')
        const transaction = this.db.transaction(() => {
            clear.run(tableName, messageId)
            for (const entry of entries) {
                insert.run(tableName, entry.columnName, String(entry.value), messageId)
            }
        })

        transaction()
    }

    async dropTable(tableName: string): Promise<void> {
        this.db
            .prepare('DELETE FROM field_index WHERE table_name = ?')
            .run(tableName)
    }

    async close(): Promise<void> {
        this.db.close()
    }
}
