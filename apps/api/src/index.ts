import 'dotenv/config'

import { createApp } from './app.js'

async function bootstrap(): Promise<void> {
    const context = await createApp()

    const shutdown = async (): Promise<void> => {
        context.app.log.info('Shutting down...')
        await context.close()
        process.exit(0)
    }

    process.on('SIGTERM', shutdown)
    process.on('SIGINT', shutdown)

    await context.app.listen({ port: context.config.PORT, host: '0.0.0.0' })
    context.app.log.info(`OpenBase API running on port ${context.config.PORT}`)
}

bootstrap().catch(error => {
    console.error(error)
    process.exit(1)
})
