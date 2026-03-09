import { apiErrorPayloadSchema } from '@openbase/core'
import type { ApiErrorPayload } from '@openbase/core'
import { z } from 'zod'

export async function parseApiEnvelope<TSchema extends z.ZodTypeAny>(
    response: Response,
    schema: TSchema
): Promise<{
    data: z.infer<TSchema> | null
    error: ApiErrorPayload | null
    meta?: Record<string, unknown>
}> {
    const payload = await response.json()
    const parsed = z.object({
        data: schema.nullable(),
        error: apiErrorPayloadSchema.nullable(),
        meta: z.record(z.unknown()).optional(),
    }).parse(payload)

    if (parsed.error) {
        return {
            data: null,
            error: parsed.error,
            meta: parsed.meta,
        }
    }

    return {
        data: parsed.data,
        error: null,
        meta: parsed.meta,
    }
}
