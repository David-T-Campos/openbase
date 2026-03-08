/**
 * TransactionManager — Pseudo-transactions with commit/rollback semantics
 *
 * Since Telegram has no native transaction support, this implements a
 * write-ahead pattern: all operations are marked pending, and only
 * after a COMMIT record is posted are they considered visible.
 */

import { randomUUID } from 'crypto'
import type { StorageProvider } from '@openbase/telegram'

export class TransactionManager {
    constructor(private storageProvider: StorageProvider) { }

    /**
     * Run a series of operations as a pseudo-transaction.
     *
     * 1. Execute all operations (they include a txId in their JSON)
     * 2. Post a COMMIT record — only after this are rows visible
     * 3. On failure, execute rollback operations (best-effort)
     *
     * @param operations - Array of async functions to execute
     * @param rollback - Array of async functions to roll back on failure
     * @param commitChannelId - Channel where the commit record is posted
     */
    async runTransaction(
        operations: Array<() => Promise<void>>,
        rollback: Array<() => Promise<void>>,
        commitChannelId: string
    ): Promise<string> {
        const txId = randomUUID()

        try {
            // Execute all operations
            for (const op of operations) {
                await op()
            }

            // Post commit record — marks transaction as complete
            await this.storageProvider.sendMessage(
                commitChannelId,
                JSON.stringify({
                    __type: 'COMMIT',
                    txId,
                    timestamp: Date.now(),
                })
            )

            return txId
        } catch (error) {
            // Best-effort rollback
            for (const rb of rollback) {
                try {
                    await rb()
                } catch {
                    // Swallow rollback errors — best-effort
                }
            }

            // Post rollback record for transparency
            try {
                await this.storageProvider.sendMessage(
                    commitChannelId,
                    JSON.stringify({
                        __type: 'ROLLBACK',
                        txId,
                        timestamp: Date.now(),
                        error: (error as Error).message,
                    })
                )
            } catch {
                // If even the rollback record fails, just throw the original error
            }

            throw error
        }
    }
}
