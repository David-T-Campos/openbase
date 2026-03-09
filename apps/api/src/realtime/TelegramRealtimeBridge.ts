import type { Project } from '@openbase/core'
import { safeJsonParse } from '@openbase/core'
import type { EventedStorageProvider } from '@openbase/telegram'
import { ProjectService } from '../projects/ProjectService.js'
import { TelegramSessionPool } from '../telegram/TelegramSessionPool.js'
import { RealtimeService } from './RealtimeService.js'

export class TelegramRealtimeBridge {
    private readonly providers = new Map<string, EventedStorageProvider>()

    constructor(
        private readonly sessionPool: TelegramSessionPool,
        private readonly projectService: ProjectService,
        private readonly realtimeService: RealtimeService
    ) { }

    async start(): Promise<void> {
        const projects = await this.projectService.getAllProjects()
        for (const project of projects) {
            await this.registerProject(project)
        }
    }

    async registerProject(project: Project): Promise<void> {
        this.realtimeService.registerProject(
            project.id,
            Object.fromEntries(
                Object.entries(project.channelMap).map(([table, channel]) => [table, channel.id])
            )
        )

        if (Object.keys(project.channelMap).length === 0 || this.providers.has(project.id)) {
            return
        }

        try {
            const sessionString = this.projectService.decryptSession(project)
            const provider = await this.sessionPool.getProjectProvider(project, sessionString)

            const channels = Object.values(project.channelMap)
            provider.addNewMessageHandler(channels, (channelId, messageId, text) => {
                const row = safeJsonParse<Record<string, unknown>>(text)
                if (!row || row.__type) {
                    return
                }
                const table = this.findTableName(project, channelId)
                if (!table) return

                this.realtimeService.broadcastChange(
                    project.id,
                    table,
                    'INSERT',
                    { _msgId: messageId, ...row },
                    null
                )
            })

            provider.addEditedMessageHandler(channels, (channelId, messageId, text) => {
                const row = safeJsonParse<Record<string, unknown>>(text)
                if (!row || row.__type) {
                    return
                }
                const table = this.findTableName(project, channelId)
                if (!table) return

                this.realtimeService.broadcastChange(
                    project.id,
                    table,
                    'UPDATE',
                    { _msgId: messageId, ...row },
                    null
                )
            })

            provider.addDeletedMessageHandler(channels, (channelId, messageIds) => {
                const table = this.findTableName(project, channelId)
                if (!table) return

                for (const messageId of messageIds) {
                    this.realtimeService.broadcastChange(
                        project.id,
                        table,
                        'DELETE',
                        null,
                        { _msgId: messageId }
                    )
                }
            })

            this.providers.set(project.id, provider)
        } catch {
            // Realtime bridge is best-effort; API-local broadcasts still function.
        }
    }

    async close(): Promise<void> {
        this.providers.clear()
    }

    private findTableName(project: Project, channelId: string): string | null {
        for (const [table, channel] of Object.entries(project.channelMap)) {
            if (channel.id === channelId) {
                return table
            }
        }
        return null
    }
}
