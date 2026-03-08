/**
 * @openbase/telegram — StorageProvider Interface
 *
 * This is the critical abstraction layer. The entire harness talks to this
 * interface, NOT to Telegram directly. Swapping providers (e.g., to S3)
 * requires only implementing this interface.
 */

import type { GetMessagesOptions, TelegramChannelRef, TelegramMessage, FileRef } from '@openbase/core'

/**
 * Abstract storage provider interface.
 * All data operations go through this — channel management, message CRUD, and file operations.
 */
export interface StorageProvider {
    // ─── Channel Management ──────────────────────────────────

    /** Create a new channel/group and return its ID */
    createChannel(name: string): Promise<TelegramChannelRef>

    /** Delete a channel by ID */
    deleteChannel(channel: TelegramChannelRef | string): Promise<void>

    // ─── Message Operations (Rows) ───────────────────────────

    /** Send a message to a channel and return the message ID */
    sendMessage(channel: TelegramChannelRef | string, content: string): Promise<number>

    /** Edit an existing message in a channel */
    editMessage(channel: TelegramChannelRef | string, messageId: number, content: string): Promise<void>

    /** Delete a message from a channel */
    deleteMessage(channel: TelegramChannelRef | string, messageId: number): Promise<void>

    /** Get a single message's text by ID, or null if not found */
    getMessage(channel: TelegramChannelRef | string, messageId: number): Promise<string | null>

    /** Get multiple messages from a channel with pagination options */
    getMessages(channel: TelegramChannelRef | string, options: GetMessagesOptions): Promise<TelegramMessage[]>

    // ─── File Operations ─────────────────────────────────────

    /** Upload a file and return a reference to it */
    uploadFile(channel: TelegramChannelRef | string, data: Buffer, filename: string, mimeType: string): Promise<FileRef>

    /** Download a file by its reference */
    downloadFile(fileRef: FileRef): Promise<Buffer>

    /** Delete a file by its reference */
    deleteFile(fileRef: FileRef): Promise<void>

    // ─── Connection Management ───────────────────────────────

    /** Connect using a session string */
    connect(sessionString: string): Promise<void>

    /** Disconnect from the storage provider */
    disconnect(): Promise<void>

    /** Check if currently connected */
    isConnected(): boolean
}

export interface EventedStorageProvider extends StorageProvider {
    addNewMessageHandler(
        channels: Array<TelegramChannelRef | string>,
        handler: (channelId: string, messageId: number, text: string) => void
    ): void

    addEditedMessageHandler(
        channels: Array<TelegramChannelRef | string>,
        handler: (channelId: string, messageId: number, text: string) => void
    ): void

    addDeletedMessageHandler(
        channels: Array<TelegramChannelRef | string>,
        handler: (channelId: string, messageIds: number[]) => void
    ): void
}
