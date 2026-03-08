import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'

export interface PlatformUser {
    id: string
    email: string
    passwordHash: string
    createdAt: string
}

export class PlatformUserRepository {
    private db!: SqlJsDatabase
    private readonly dbPath: string
    private readonly ready: Promise<void>

    constructor(dbPath: string = './data/platform.db') {
        this.dbPath = dbPath
        this.ready = this.init()
    }

    async findByEmail(email: string): Promise<PlatformUser | null> {
        await this.ensureReady()
        const result = this.db.exec(
            'SELECT id, email, password_hash, created_at FROM platform_users WHERE email = ?',
            [email]
        )

        if (!result.length || !result[0].values.length) {
            return null
        }

        const [id, userEmail, passwordHash, createdAt] = result[0].values[0] as [string, string, string, string]
        return { id, email: userEmail, passwordHash, createdAt }
    }

    async findById(id: string): Promise<PlatformUser | null> {
        await this.ensureReady()
        const result = this.db.exec(
            'SELECT id, email, password_hash, created_at FROM platform_users WHERE id = ?',
            [id]
        )

        if (!result.length || !result[0].values.length) {
            return null
        }

        const [userId, email, passwordHash, createdAt] = result[0].values[0] as [string, string, string, string]
        return { id: userId, email, passwordHash, createdAt }
    }

    async createUser(user: PlatformUser): Promise<void> {
        await this.ensureReady()
        this.db.run(
            'INSERT INTO platform_users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)',
            [user.id, user.email, user.passwordHash, user.createdAt]
        )
        this.persist()
    }

    private async init(): Promise<void> {
        const SQL = await initSqlJs()
        mkdirSync(dirname(this.dbPath), { recursive: true })

        if (existsSync(this.dbPath)) {
            this.db = new SQL.Database(readFileSync(this.dbPath))
        } else {
            this.db = new SQL.Database()
        }

        this.db.run(`
            CREATE TABLE IF NOT EXISTS platform_users (
                id TEXT PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        `)

        this.persist()
    }

    private async ensureReady(): Promise<void> {
        await this.ready
    }

    private persist(): void {
        writeFileSync(this.dbPath, Buffer.from(this.db.export()))
    }
}
