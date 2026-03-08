/**
 * WorkerPool — Round-robin dispatch of Telegram operations across multiple workers.
 *
 * Each project can have up to 20 worker bots. When one worker
 * hits a FLOOD_WAIT, it backs off and the next worker picks up.
 */

import { WorkerPoolExhaustedError } from '@openbase/core'

/** A single worker with cooldown state */
export class TelegramWorker {
    private cooldownUntil = 0

    constructor(public readonly id: string) { }

    /** Check if this worker is on cooldown */
    isOnCooldown(): boolean {
        return Date.now() < this.cooldownUntil
    }

    /** Set a cooldown period for this worker */
    setCooldown(ms: number): void {
        this.cooldownUntil = Date.now() + ms
    }

    /** Time remaining on cooldown (ms) */
    cooldownRemaining(): number {
        return Math.max(0, this.cooldownUntil - Date.now())
    }
}

export class WorkerPool {
    private workers: TelegramWorker[] = []
    private currentIndex = 0

    constructor(workerCount: number = 1) {
        for (let i = 0; i < workerCount; i++) {
            this.workers.push(new TelegramWorker(`worker-${i}`))
        }
    }

    /**
     * Add a worker to the pool.
     */
    addWorker(id: string): void {
        this.workers.push(new TelegramWorker(id))
    }

    /**
     * Dispatch an operation to the next available worker.
     * Handles FLOOD_WAIT errors by cooling down the worker and retrying with the next.
     */
    async dispatch<T>(operation: (worker: TelegramWorker) => Promise<T>): Promise<T> {
        const maxAttempts = this.workers.length
        let attempts = 0

        while (attempts < maxAttempts) {
            const worker = this.workers[this.currentIndex % this.workers.length]
            this.currentIndex++

            if (worker.isOnCooldown()) {
                attempts++
                continue
            }

            try {
                return await operation(worker)
            } catch (error: unknown) {
                const err = error as Error
                const floodMatch = err.message?.match(/FLOOD_WAIT_(\d+)/)

                if (floodMatch) {
                    const waitSeconds = parseInt(floodMatch[1], 10)
                    worker.setCooldown(waitSeconds * 1000)
                    attempts++
                    continue
                }

                throw error
            }
        }

        throw new WorkerPoolExhaustedError()
    }

    /** Get the number of available (non-cooldown) workers */
    get availableWorkers(): number {
        return this.workers.filter(w => !w.isOnCooldown()).length
    }

    /** Get total worker count */
    get totalWorkers(): number {
        return this.workers.length
    }

    /** Get status of all workers */
    getStatus(): Array<{ id: string; available: boolean; cooldownRemaining: number }> {
        return this.workers.map(w => ({
            id: w.id,
            available: !w.isOnCooldown(),
            cooldownRemaining: w.cooldownRemaining(),
        }))
    }
}
