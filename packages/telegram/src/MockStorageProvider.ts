import type { FileRef, GetMessagesOptions, TelegramChannelRef, TelegramMessage } from '@openbase/core'
import { StorageProviderError } from '@openbase/core'
import type { EventedStorageProvider } from './StorageProvider.js'

type ChannelInput = TelegramChannelRef | string

interface MockChannelRecord {
    ref: TelegramChannelRef
    name: string
}

interface MockMessageRecord {
    id: number
    channelId: string
    text: string
    date: number
    kind: 'message' | 'file'
}

interface MockFileRecord {
    ref: FileRef
    data: Buffer
}

interface NewMessageSubscription {
    ownerId: number
    channelIds: Set<string>
    handler: (channelId: string, messageId: number, text: string) => void
}

interface DeletedMessageSubscription {
    ownerId: number
    channelIds: Set<string>
    handler: (channelId: string, messageIds: number[]) => void
}

interface StoredMessageSubscription {
    channels: ChannelInput[]
    handler: (channelId: string, messageId: number, text: string) => void
}

interface StoredDeleteSubscription {
    channels: ChannelInput[]
    handler: (channelId: string, messageIds: number[]) => void
}

export class MockStorageProvider implements EventedStorageProvider {
    private static nextProviderId = 1
    private static nextChannelId = 1
    private static nextAccessHash = 1000
    private static nextMessageId = 1
    private static channels = new Map<string, MockChannelRecord>()
    private static messages = new Map<string, MockMessageRecord[]>()
    private static files = new Map<number, MockFileRecord>()
    private static newMessageSubscriptions: NewMessageSubscription[] = []
    private static editedMessageSubscriptions: NewMessageSubscription[] = []
    private static deletedMessageSubscriptions: DeletedMessageSubscription[] = []

    static reset(): void {
        MockStorageProvider.nextProviderId = 1
        MockStorageProvider.nextChannelId = 1
        MockStorageProvider.nextAccessHash = 1000
        MockStorageProvider.nextMessageId = 1
        MockStorageProvider.channels.clear()
        MockStorageProvider.messages.clear()
        MockStorageProvider.files.clear()
        MockStorageProvider.newMessageSubscriptions = []
        MockStorageProvider.editedMessageSubscriptions = []
        MockStorageProvider.deletedMessageSubscriptions = []
    }

    private readonly providerId = MockStorageProvider.nextProviderId++
    private connected = false
    private readonly newMessageSubscriptions: StoredMessageSubscription[] = []
    private readonly editedMessageSubscriptions: StoredMessageSubscription[] = []
    private readonly deletedMessageSubscriptions: StoredDeleteSubscription[] = []

    async connect(_sessionString: string): Promise<void> {
        if (this.connected) {
            return
        }

        this.connected = true
        this.attachStoredSubscriptions()
    }

    async disconnect(): Promise<void> {
        this.connected = false
        MockStorageProvider.newMessageSubscriptions = MockStorageProvider.newMessageSubscriptions
            .filter(subscription => subscription.ownerId !== this.providerId)
        MockStorageProvider.editedMessageSubscriptions = MockStorageProvider.editedMessageSubscriptions
            .filter(subscription => subscription.ownerId !== this.providerId)
        MockStorageProvider.deletedMessageSubscriptions = MockStorageProvider.deletedMessageSubscriptions
            .filter(subscription => subscription.ownerId !== this.providerId)
    }

    isConnected(): boolean {
        return this.connected
    }

    async createChannel(name: string): Promise<TelegramChannelRef> {
        this.requireConnected()

        const ref: TelegramChannelRef = {
            id: String(MockStorageProvider.nextChannelId++),
            accessHash: String(MockStorageProvider.nextAccessHash++),
        }

        MockStorageProvider.channels.set(ref.id, { ref, name })
        MockStorageProvider.messages.set(ref.id, [])

        return ref
    }

    async deleteChannel(channel: ChannelInput): Promise<void> {
        this.requireConnected()

        const resolved = this.resolveChannel(channel)
        const messages = MockStorageProvider.messages.get(resolved.id) ?? []

        for (const message of messages) {
            if (message.kind === 'file') {
                MockStorageProvider.files.delete(message.id)
            }
        }

        MockStorageProvider.channels.delete(resolved.id)
        MockStorageProvider.messages.delete(resolved.id)
    }

    async sendMessage(channel: ChannelInput, content: string): Promise<number> {
        this.requireConnected()

        const resolved = this.resolveChannel(channel)
        const message: MockMessageRecord = {
            id: MockStorageProvider.nextMessageId++,
            channelId: resolved.id,
            text: content,
            date: Date.now(),
            kind: 'message',
        }

        MockStorageProvider.messages.get(resolved.id)?.push(message)
        this.emitNewMessage(resolved.id, message.id, content)

        return message.id
    }

    async editMessage(channel: ChannelInput, messageId: number, content: string): Promise<void> {
        this.requireConnected()

        const message = this.findMessage(channel, messageId)
        if (!message || message.kind !== 'message') {
            throw new StorageProviderError(`Message ${messageId} not found`)
        }

        message.text = content
        this.emitEditedMessage(message.channelId, message.id, content)
    }

    async deleteMessage(channel: ChannelInput, messageId: number): Promise<void> {
        this.requireConnected()

        const resolved = this.resolveChannel(channel)
        const messages = MockStorageProvider.messages.get(resolved.id)
        if (!messages) {
            throw new StorageProviderError(`Channel ${resolved.id} not found`)
        }

        const index = messages.findIndex(message => message.id === messageId && message.kind === 'message')
        if (index === -1) {
            throw new StorageProviderError(`Message ${messageId} not found`)
        }

        messages.splice(index, 1)
        this.emitDeletedMessage(resolved.id, [messageId])
    }

    async getMessage(channel: ChannelInput, messageId: number): Promise<string | null> {
        this.requireConnected()

        const message = this.findMessage(channel, messageId)
        if (!message || message.kind !== 'message') {
            return null
        }

        return message.text
    }

    async getMessages(channel: ChannelInput, options: GetMessagesOptions): Promise<TelegramMessage[]> {
        this.requireConnected()

        const resolved = this.resolveChannel(channel)
        const messages = (MockStorageProvider.messages.get(resolved.id) ?? [])
            .filter(message => message.kind === 'message')
            .filter(message => options.offsetId === undefined || message.id < options.offsetId)
            .filter(message => options.minId === undefined || message.id > options.minId)
            .filter(message => options.maxId === undefined || message.id < options.maxId)
            .sort((left, right) => right.id - left.id)
            .slice(0, options.limit ?? 100)

        return messages.map(message => ({
            id: message.id,
            text: message.text,
            date: message.date,
        }))
    }

    async uploadFile(
        channel: ChannelInput,
        data: Buffer,
        filename: string,
        mimeType: string
    ): Promise<FileRef> {
        this.requireConnected()

        const resolved = this.resolveChannel(channel)
        const messageId = MockStorageProvider.nextMessageId++

        const ref: FileRef = {
            messageId,
            channel: resolved,
            filename,
            mimeType,
            size: data.length,
        }

        MockStorageProvider.files.set(messageId, {
            ref,
            data: Buffer.from(data),
        })

        MockStorageProvider.messages.get(resolved.id)?.push({
            id: messageId,
            channelId: resolved.id,
            text: '',
            date: Date.now(),
            kind: 'file',
        })

        return ref
    }

    async downloadFile(fileRef: FileRef): Promise<Buffer> {
        this.requireConnected()

        const stored = MockStorageProvider.files.get(fileRef.messageId)
        if (!stored) {
            throw new StorageProviderError('File not found')
        }

        return Buffer.from(stored.data)
    }

    async deleteFile(fileRef: FileRef): Promise<void> {
        this.requireConnected()

        const resolved = this.resolveChannel(fileRef.channel)
        const messages = MockStorageProvider.messages.get(resolved.id)
        if (!messages) {
            throw new StorageProviderError(`Channel ${resolved.id} not found`)
        }

        MockStorageProvider.files.delete(fileRef.messageId)

        const index = messages.findIndex(message => message.id === fileRef.messageId && message.kind === 'file')
        if (index !== -1) {
            messages.splice(index, 1)
        }
    }

    addNewMessageHandler(
        channels: ChannelInput[],
        handler: (channelId: string, messageId: number, text: string) => void
    ): void {
        this.requireConnected()
        this.newMessageSubscriptions.push({ channels, handler })
        this.attachNewMessageHandler(channels, handler)
    }

    addEditedMessageHandler(
        channels: ChannelInput[],
        handler: (channelId: string, messageId: number, text: string) => void
    ): void {
        this.requireConnected()
        this.editedMessageSubscriptions.push({ channels, handler })
        this.attachEditedMessageHandler(channels, handler)
    }

    addDeletedMessageHandler(
        channels: ChannelInput[],
        handler: (channelId: string, messageIds: number[]) => void
    ): void {
        this.requireConnected()
        this.deletedMessageSubscriptions.push({ channels, handler })
        this.attachDeletedMessageHandler(channels, handler)
    }

    private requireConnected(): void {
        if (!this.connected) {
            throw new StorageProviderError('Mock storage provider not connected. Call connect(sessionString) first.')
        }
    }

    private resolveChannel(channel: ChannelInput): TelegramChannelRef {
        const channelId = typeof channel === 'string' ? channel : channel.id
        const stored = MockStorageProvider.channels.get(channelId)

        if (!stored) {
            throw new StorageProviderError(`Channel ${channelId} not found`)
        }

        return stored.ref
    }

    private findMessage(channel: ChannelInput, messageId: number): MockMessageRecord | undefined {
        const resolved = this.resolveChannel(channel)
        return (MockStorageProvider.messages.get(resolved.id) ?? [])
            .find(message => message.id === messageId)
    }

    private emitNewMessage(channelId: string, messageId: number, text: string): void {
        for (const subscription of MockStorageProvider.newMessageSubscriptions) {
            if (subscription.channelIds.has(channelId)) {
                subscription.handler(channelId, messageId, text)
            }
        }
    }

    private emitEditedMessage(channelId: string, messageId: number, text: string): void {
        for (const subscription of MockStorageProvider.editedMessageSubscriptions) {
            if (subscription.channelIds.has(channelId)) {
                subscription.handler(channelId, messageId, text)
            }
        }
    }

    private emitDeletedMessage(channelId: string, messageIds: number[]): void {
        for (const subscription of MockStorageProvider.deletedMessageSubscriptions) {
            if (subscription.channelIds.has(channelId)) {
                subscription.handler(channelId, messageIds)
            }
        }
    }

    private attachStoredSubscriptions(): void {
        for (const subscription of this.newMessageSubscriptions) {
            this.attachNewMessageHandler(subscription.channels, subscription.handler)
        }

        for (const subscription of this.editedMessageSubscriptions) {
            this.attachEditedMessageHandler(subscription.channels, subscription.handler)
        }

        for (const subscription of this.deletedMessageSubscriptions) {
            this.attachDeletedMessageHandler(subscription.channels, subscription.handler)
        }
    }

    private attachNewMessageHandler(
        channels: ChannelInput[],
        handler: (channelId: string, messageId: number, text: string) => void
    ): void {
        MockStorageProvider.newMessageSubscriptions.push({
            ownerId: this.providerId,
            channelIds: new Set(channels.map(channel => this.resolveChannel(channel).id)),
            handler,
        })
    }

    private attachEditedMessageHandler(
        channels: ChannelInput[],
        handler: (channelId: string, messageId: number, text: string) => void
    ): void {
        MockStorageProvider.editedMessageSubscriptions.push({
            ownerId: this.providerId,
            channelIds: new Set(channels.map(channel => this.resolveChannel(channel).id)),
            handler,
        })
    }

    private attachDeletedMessageHandler(
        channels: ChannelInput[],
        handler: (channelId: string, messageIds: number[]) => void
    ): void {
        MockStorageProvider.deletedMessageSubscriptions.push({
            ownerId: this.providerId,
            channelIds: new Set(channels.map(channel => this.resolveChannel(channel).id)),
            handler,
        })
    }
}
