import Database from 'better-sqlite3'
import { mkdirSync } from 'fs'
import { dirname } from 'path'

export interface PlatformUser {
    id: string
    email: string
    passwordHash: string
    createdAt: string
}

export class PlatformUserRepository {
    private db: Database.Database | null = null
    private readonly dbPath: string

    constructor(dbPath: string = './data/platform.db') {
        this.dbPath = dbPath
        this.open()
    }

    private open(): void {
        mkdirSync(dirname(this.dbPath), { recursive: true })

        this.db = new Database(this.dbPath)
        this.db.pragma('journal_mode = WAL')
        this.db.pragma('synchronous = NORMAL')
        this.db.pragma('busy_timeout = 5000')

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS platform_users (
                id TEXT PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        `)
    }

    private get connection(): Database.Database {
        if (!this.db) {
            this.open()
        }

        return this.db!
    }

    async findByEmail(email: string): Promise<PlatformUser | null> {
        const row = this.connection
            .prepare(`
                SELECT id, email, password_hash, created_at
                FROM platform_users
                WHERE email = ?
            `)
            .get(email) as
            | { id: string; email: string; password_hash: string; created_at: string }
            | undefined

        if (!row) {
            return null
        }

        return {
            id: row.id,
            email: row.email,
            passwordHash: row.password_hash,
            createdAt: row.created_at,
        }
    }

    async findById(id: string): Promise<PlatformUser | null> {
        const row = this.connection
            .prepare(`
                SELECT id, email, password_hash, created_at
                FROM platform_users
                WHERE id = ?
            `)
            .get(id) as
            | { id: string; email: string; password_hash: string; created_at: string }
            | undefined

        if (!row) {
            return null
        }

        return {
            id: row.id,
            email: row.email,
            passwordHash: row.password_hash,
            createdAt: row.created_at,
        }
    }

    async createUser(user: PlatformUser): Promise<void> {
        this.connection
            .prepare(`
                INSERT INTO platform_users (id, email, password_hash, created_at)
                VALUES (?, ?, ?, ?)
            `)
            .run(user.id, user.email, user.passwordHash, user.createdAt)
    }

    async close(): Promise<void> {
        this.db?.close()
        this.db = null
    }

    async reopen(): Promise<void> {
        if (!this.db) {
            this.open()
        }
    }
}
