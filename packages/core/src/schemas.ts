import { z } from 'zod'

export const telegramChannelRefSchema = z.object({
    id: z.string(),
    accessHash: z.string(),
})

export const userIdentitySchema = z.object({
    provider: z.enum(['email', 'google', 'github']),
    providerUserId: z.string(),
    email: z.string().optional(),
    linkedAt: z.string(),
})

export const authUserSchema = z.object({
    id: z.string(),
    email: z.string().email(),
    role: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
    identities: z.array(userIdentitySchema).optional(),
    totp_enabled: z.boolean().optional(),
    confirmed_at: z.string().nullable().optional(),
    disabled_at: z.string().nullable().optional(),
    disabled_reason: z.string().nullable().optional(),
    last_sign_in_at: z.string().nullable().optional(),
})

export const authSessionSchema = z.object({
    access_token: z.string(),
    refresh_token: z.string().optional(),
    expires_at: z.number().optional(),
})

export const authResultSchema = z.object({
    user: authUserSchema,
    session: authSessionSchema,
})

export const bucketPermissionSchema = z.object({
    public: z.boolean().optional(),
    roles: z.array(z.string()).optional(),
    userIds: z.array(z.string()).optional(),
})

export const storageRuleSchema = z.object({
    effect: z.enum(['allow', 'deny']),
    actions: z.array(z.enum(['read', 'write', 'delete'])).min(1),
    expression: z.string().min(1),
})

export const storageObjectPolicySchema = z.object({
    public: z.boolean().optional(),
    read: bucketPermissionSchema.optional(),
    write: bucketPermissionSchema.optional(),
    delete: bucketPermissionSchema.optional(),
    rules: z.array(storageRuleSchema).optional(),
})

export const storageObjectMetadataSchema = z.object({
    contentType: z.string(),
    size: z.number(),
    createdAt: z.number(),
    updatedAt: z.number(),
    tags: z.record(z.string()).optional(),
    customMetadata: z.record(z.string()).optional(),
})

export const storageObjectRecordSchema = z.object({
    path: z.string(),
    size: z.number(),
    mimeType: z.string(),
    createdAt: z.number(),
    updatedAt: z.number(),
    uploadedBy: z.string().nullable(),
    metadata: storageObjectMetadataSchema,
    policy: storageObjectPolicySchema.nullable().optional(),
})

export const resumableUploadSessionSchema = z.object({
    id: z.string(),
    projectId: z.string(),
    bucket: z.string(),
    path: z.string(),
    uploadUrl: z.string().url(),
    statusUrl: z.string().url(),
    completeUrl: z.string().url(),
    chunkSize: z.number(),
    uploadedBytes: z.number(),
    totalSize: z.number().optional(),
    expiresAt: z.string(),
    createdAt: z.string(),
    completed: z.boolean(),
})

export const bucketPolicySchema = z.object({
    public: z.boolean(),
    allowedMimeTypes: z.array(z.string()).optional(),
    maxFileSize: z.number().optional(),
    read: bucketPermissionSchema.optional(),
    write: bucketPermissionSchema.optional(),
    delete: bucketPermissionSchema.optional(),
    rules: z.array(storageRuleSchema).optional(),
})

export const webhookConfigSchema = z.object({
    id: z.string(),
    url: z.string().url(),
    secret: z.string(),
    events: z.array(z.enum(['INSERT', 'UPDATE', 'DELETE'])),
    enabled: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
    lastDeliveryAt: z.string().nullable().optional(),
    lastSuccessAt: z.string().nullable().optional(),
    lastFailureAt: z.string().nullable().optional(),
    lastFailureReason: z.string().nullable().optional(),
    lastStatusCode: z.number().nullable().optional(),
    totalDeliveries: z.number().optional(),
    totalSuccesses: z.number().optional(),
    totalFailures: z.number().optional(),
    consecutiveFailures: z.number().optional(),
    lastReplayAt: z.string().nullable().optional(),
})

export const requestLogEntrySchema = z.object({
    id: z.string(),
    method: z.string(),
    path: z.string(),
    projectId: z.string(),
    statusCode: z.number(),
    durationMs: z.number(),
    timestamp: z.string(),
})

export const operationLogEntrySchema = z.object({
    id: z.string(),
    projectId: z.string().nullable(),
    scope: z.enum(['request', 'webhook', 'telegram', 'system', 'security']),
    level: z.enum(['info', 'success', 'warning', 'error']),
    message: z.string(),
    code: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
    timestamp: z.string(),
})

export const webhookDeadLetterSchema = z.object({
    id: z.string(),
    projectId: z.string(),
    webhookId: z.string(),
    url: z.string().url(),
    eventType: z.enum(['INSERT', 'UPDATE', 'DELETE']),
    failedAt: z.string(),
    errorMessage: z.string(),
    attempts: z.number(),
    statusCode: z.number().nullable().optional(),
    payload: z.record(z.unknown()),
})

export const telegramSessionHealthSchema = z.object({
    projectId: z.string(),
    status: z.enum(['idle', 'connecting', 'healthy', 'degraded', 'reconnecting', 'disconnected']),
    connected: z.boolean(),
    lastConnectedAt: z.string().nullable(),
    lastCheckedAt: z.string().nullable(),
    lastError: z.string().nullable(),
    reconnectCount: z.number(),
    probeChannelId: z.string().nullable(),
})

export const queueSummarySchema = z.object({
    name: z.enum(['warmup', 'webhooks']),
    enabled: z.boolean(),
    paused: z.boolean(),
    waiting: z.number(),
    active: z.number(),
    delayed: z.number(),
    failed: z.number(),
    completed: z.number(),
})

export const queueJobSnapshotSchema = z.object({
    queue: z.enum(['warmup', 'webhooks']),
    id: z.string(),
    name: z.string(),
    state: z.enum(['waiting', 'active', 'delayed', 'failed', 'completed', 'paused']),
    projectId: z.string().nullable(),
    attemptsMade: z.number(),
    attempts: z.number(),
    timestamp: z.number(),
    processedOn: z.number().nullable(),
    finishedOn: z.number().nullable(),
    delay: z.number(),
    failedReason: z.string().nullable(),
    data: z.record(z.unknown()),
})

export const warmupStatusSchema = z.object({
    status: z.string(),
    daysCompleted: z.number(),
    daysRequired: z.number(),
    daysRemaining: z.number(),
    percentComplete: z.number(),
    lastError: z.string().nullable().optional(),
    overrideMode: z.enum(['default', 'paused', 'force_active']),
    nextScheduledAt: z.string().nullable(),
})

export const backupRecordSchema = z.object({
    id: z.string(),
    createdAt: z.string(),
    trigger: z.enum(['manual', 'scheduled']),
    status: z.enum(['ready', 'failed']),
    backupPath: z.string(),
    projectCount: z.number(),
    redisKeyCount: z.number(),
    sqliteFileCount: z.number(),
    telegramManifestCount: z.number(),
    sizeBytes: z.number(),
    retentionCount: z.number(),
    error: z.string().nullable(),
    restoredAt: z.string().nullable().optional(),
    restoredBy: z.string().nullable().optional(),
})

export const backupHealthSchema = z.object({
    status: z.enum(['healthy', 'warning', 'error']),
    lastSuccessfulBackupAt: z.string().nullable(),
    lastFailedBackupAt: z.string().nullable(),
    nextScheduledBackupAt: z.string().nullable(),
    retentionCount: z.number(),
    availableBackups: z.number(),
})

export const systemHealthSnapshotSchema = z.object({
    checkedAt: z.string(),
    overallStatus: z.enum(['healthy', 'degraded', 'down']),
    uptimeSeconds: z.number(),
    redis: z.object({
        status: z.string(),
        connected: z.boolean(),
        latencyMs: z.number().nullable(),
        keyCount: z.number(),
    }),
    telegram: z.object({
        healthy: z.number(),
        degraded: z.number(),
        disconnected: z.number(),
        total: z.number(),
    }),
    backups: backupHealthSchema,
    queues: z.array(queueSummarySchema),
    projects: z.object({
        total: z.number(),
        active: z.number(),
        warmingUp: z.number(),
        warmupFailed: z.number(),
    }),
})

export const columnDefinitionSchema = z.object({
    name: z.string(),
    type: z.enum(['text', 'number', 'boolean', 'json', 'timestamp', 'uuid']),
    required: z.boolean().optional(),
    unique: z.boolean().optional(),
    default: z.unknown().optional(),
    encrypted: z.boolean().optional(),
})

export const projectPermissionSchema = z.enum([
    'project.read',
    'project.delete',
    'tables.read',
    'tables.write',
    'tables.manage',
    'storage.read',
    'storage.write',
    'storage.manage',
    'auth.read',
    'auth.manage',
    'webhooks.read',
    'webhooks.manage',
    'migrations.read',
    'migrations.manage',
    'logs.read',
    'audit.read',
    'settings.read',
    'settings.manage',
    'members.read',
    'members.manage',
    'roles.read',
    'roles.manage',
    'functions.read',
    'functions.manage',
])

export const projectRoleDefinitionSchema = z.object({
    key: z.string(),
    name: z.string(),
    description: z.string().optional(),
    permissions: z.array(projectPermissionSchema),
    system: z.boolean().optional(),
})

export const projectMemberSchema = z.object({
    userId: z.string(),
    email: z.string().email(),
    roleKey: z.string(),
    addedAt: z.string(),
    addedBy: z.string(),
})

export const projectInvitationSchema = z.object({
    id: z.string(),
    token: z.string(),
    projectId: z.string(),
    email: z.string().email(),
    roleKey: z.string(),
    invitedBy: z.string(),
    createdAt: z.string(),
    expiresAt: z.string(),
    acceptedAt: z.string().nullable().optional(),
    revokedAt: z.string().nullable().optional(),
})

export const rlsPolicySchema = z.object({
    operation: z.enum(['SELECT', 'INSERT', 'UPDATE', 'DELETE']),
    check: z.string(),
})

export const tableSchemaSchema = z.object({
    tableName: z.string(),
    columns: z.array(columnDefinitionSchema),
    indexes: z.array(z.string()),
    rls: z.array(rlsPolicySchema).optional(),
})

export const queryFilterSchema = z.object({
    column: z.string(),
    operator: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'in', 'is']),
    value: z.unknown(),
})

export const transactionOperationConditionSchema = z.object({
    filters: z.array(queryFilterSchema).optional(),
    ifMatchMessageIds: z.array(z.number()).optional(),
    expectedCount: z.number().int().nonnegative().optional(),
})

export const transactionOperationSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('insert'),
        table: z.string(),
        values: z.array(z.record(z.unknown())).min(1),
    }),
    z.object({
        type: z.literal('upsert'),
        table: z.string(),
        values: z.array(z.record(z.unknown())).min(1),
        onConflict: z.array(z.string()).optional(),
        condition: transactionOperationConditionSchema.optional(),
    }),
    z.object({
        type: z.literal('update'),
        table: z.string(),
        patch: z.record(z.unknown()),
        condition: transactionOperationConditionSchema.optional(),
    }),
    z.object({
        type: z.literal('delete'),
        table: z.string(),
        condition: transactionOperationConditionSchema.optional(),
    }),
])

export const transactionOperationResultSchema = z.object({
    type: z.enum(['insert', 'upsert', 'update', 'delete']),
    table: z.string(),
    count: z.number(),
    data: z.array(z.record(z.unknown())).nullable(),
})

export const transactionResultSchema = z.object({
    id: z.string(),
    projectId: z.string(),
    committedAt: z.string(),
    operations: z.array(transactionOperationResultSchema),
})

export const migrationOperationSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('create_table'),
        table: tableSchemaSchema,
    }),
    z.object({
        type: z.literal('drop_table'),
        tableName: z.string(),
    }),
    z.object({
        type: z.literal('add_column'),
        tableName: z.string(),
        column: columnDefinitionSchema,
        backfill: z.object({
            mode: z.enum(['default', 'literal']),
            value: z.unknown().optional(),
        }).optional(),
    }),
    z.object({
        type: z.literal('remove_column'),
        tableName: z.string(),
        columnName: z.string(),
    }),
    z.object({
        type: z.literal('rename_column'),
        tableName: z.string(),
        from: z.string(),
        to: z.string(),
    }),
    z.object({
        type: z.literal('change_column_type'),
        tableName: z.string(),
        columnName: z.string(),
        nextType: z.enum(['text', 'number', 'boolean', 'json', 'timestamp', 'uuid']),
    }),
    z.object({
        type: z.literal('add_index'),
        tableName: z.string(),
        columnName: z.string(),
    }),
    z.object({
        type: z.literal('remove_index'),
        tableName: z.string(),
        columnName: z.string(),
    }),
    z.object({
        type: z.literal('replace_rls'),
        tableName: z.string(),
        rls: z.array(rlsPolicySchema).optional(),
    }),
])

export const migrationDefinitionSchema = z.object({
    name: z.string(),
    description: z.string().optional(),
    up: z.array(migrationOperationSchema),
    down: z.array(migrationOperationSchema),
})

export const migrationHistoryEntrySchema = z.object({
    name: z.string(),
    description: z.string().optional(),
    checksum: z.string(),
    direction: z.enum(['up', 'down']),
    source: z.enum(['cli', 'dashboard', 'sdk']),
    appliedAt: z.string(),
    operations: z.number(),
})

export const schemaExportSchema = z.object({
    projectId: z.string(),
    projectName: z.string(),
    tables: z.record(tableSchemaSchema),
    migrations: z.array(migrationHistoryEntrySchema),
    appliedMigrations: z.array(z.string()),
})

export const oqlResultColumnSchema = z.object({
    key: z.string(),
    label: z.string(),
    source: z.string().nullable(),
    aggregate: z.enum(['count', 'sum', 'avg', 'min', 'max']).nullable().optional(),
})

export const oqlQueryResultSchema = z.object({
    query: z.string(),
    columns: z.array(oqlResultColumnSchema),
    rows: z.array(z.record(z.unknown())),
    rowCount: z.number(),
    durationMs: z.number(),
    sourceTables: z.array(z.string()),
})

export const functionRpcConfigSchema = z.object({
    enabled: z.boolean(),
    access: z.enum(['public', 'authenticated', 'service_role']),
})

export const functionWebhookConfigSchema = z.object({
    enabled: z.boolean(),
    secret: z.string().nullable(),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
})

export const functionScheduleConfigSchema = z.object({
    enabled: z.boolean(),
    cron: z.string().nullable(),
    nextRunAt: z.string().nullable().optional(),
    lastRunAt: z.string().nullable().optional(),
})

export const functionDefinitionSchema = z.object({
    name: z.string(),
    description: z.string().optional(),
    runtime: z.enum(['javascript', 'typescript']),
    source: z.string(),
    deployedSource: z.string().nullable().optional(),
    version: z.number(),
    timeoutMs: z.number(),
    createdAt: z.string(),
    updatedAt: z.string(),
    deployedAt: z.string().nullable(),
    rpc: functionRpcConfigSchema,
    webhook: functionWebhookConfigSchema,
    schedule: functionScheduleConfigSchema,
    lastInvocationAt: z.string().nullable().optional(),
    lastInvocationStatus: z.enum(['success', 'error']).nullable().optional(),
    lastInvocationError: z.string().nullable().optional(),
})

export const functionLogEntrySchema = z.object({
    id: z.string(),
    functionName: z.string(),
    trigger: z.enum(['rpc', 'webhook', 'cron']),
    level: z.enum(['info', 'error']),
    message: z.string(),
    timestamp: z.string(),
    durationMs: z.number().optional(),
    requestId: z.string().nullable().optional(),
    details: z.unknown().optional(),
})

export const functionInvocationResultSchema = z.object({
    functionName: z.string(),
    trigger: z.enum(['rpc', 'webhook', 'cron']),
    durationMs: z.number(),
    data: z.unknown(),
    logs: z.array(functionLogEntrySchema),
})

export const apiErrorPayloadSchema = z.object({
    message: z.string(),
    code: z.string(),
    details: z.unknown().optional(),
})

export function apiSuccessEnvelopeSchema<T extends z.ZodTypeAny>(dataSchema: T) {
    return z.object({
        data: dataSchema,
        error: z.null(),
        meta: z.record(z.unknown()).optional(),
    })
}

export function apiErrorEnvelopeSchema() {
    return z.object({
        data: z.null(),
        error: apiErrorPayloadSchema,
        meta: z.record(z.unknown()).optional(),
    })
}

export function apiEnvelopeSchema<T extends z.ZodTypeAny>(dataSchema: T) {
    return z.union([
        apiSuccessEnvelopeSchema(dataSchema),
        apiErrorEnvelopeSchema(),
    ])
}
