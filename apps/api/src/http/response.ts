import type { FastifyReply } from 'fastify'
import { z } from 'zod'
import { ValidationError, apiErrorPayloadSchema, apiSuccessEnvelopeSchema } from '@openbase/core'

const apiEnvelopeOutputSchema = apiSuccessEnvelopeSchema(z.unknown().nullable()).or(
    z.object({
        data: z.null(),
        error: apiErrorPayloadSchema,
        meta: z.record(z.unknown()).optional(),
    })
)

export function sendSuccess<TSchema extends z.ZodTypeAny>(
    reply: FastifyReply,
    schema: TSchema,
    data: z.infer<TSchema>,
    options: { statusCode?: number; meta?: Record<string, unknown> } = {}
) {
    const validatedData = schema.parse(data)
    return reply
        .status(options.statusCode ?? 200)
        .send({
            data: validatedData,
            error: null,
            ...(options.meta ? { meta: options.meta } : {}),
        })
}

export function assertSuccessShape<TSchema extends z.ZodTypeAny>(
    schema: TSchema,
    data: unknown
): z.infer<TSchema> {
    return schema.parse(data)
}

export function createOutputValidator<TSchema extends z.ZodTypeAny>(schema: TSchema) {
    const envelopeSchema = apiSuccessEnvelopeSchema(schema)

    return (payload: unknown) => {
        const result = envelopeSchema.safeParse(payload)
        if (!result.success) {
            throw new ValidationError('Server response shape does not match the declared schema', result.error.issues.map(issue => ({
                path: issue.path.join('.'),
                message: issue.message,
            })))
        }

        return result.data
    }
}

export function validateOutputEnvelope(payload: unknown): {
    data: unknown
    error: z.infer<typeof apiErrorPayloadSchema> | null
    meta?: Record<string, unknown>
} {
    const result = apiEnvelopeOutputSchema.safeParse(payload)
    if (!result.success) {
        throw new ValidationError('Server response envelope is invalid', result.error.issues.map(issue => ({
            path: issue.path.join('.'),
            message: issue.message,
        })))
    }

    return {
        data: result.data.data ?? null,
        error: result.data.error ?? null,
        ...(result.data.meta ? { meta: result.data.meta } : {}),
    }
}

export function buildErrorEnvelope(error: {
    message: string
    code?: string
    details?: unknown
}): { data: null; error: z.infer<typeof apiErrorPayloadSchema> } {
    return {
        data: null,
        error: apiErrorPayloadSchema.parse({
            message: error.message,
            code: error.code || 'INTERNAL_ERROR',
            ...(error.details !== undefined ? { details: error.details } : {}),
        }),
    }
}
