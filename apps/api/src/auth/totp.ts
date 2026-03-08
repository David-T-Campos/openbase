import { createHmac, randomBytes } from 'crypto'

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function generateTotpSecret(length: number = 20): string {
    return toBase32(randomBytes(length))
}

export function generateTotpUri(secret: string, email: string, issuer: string = 'OpenBase'): string {
    return `otpauth://totp/${encodeURIComponent(`${issuer}:${email}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`
}

export function verifyTotp(secret: string, token: string, window: number = 1): boolean {
    const normalizedToken = token.replace(/\s+/g, '')
    for (let offset = -window; offset <= window; offset++) {
        if (generateTotpCode(secret, offset) === normalizedToken) {
            return true
        }
    }
    return false
}

function generateTotpCode(secret: string, offset: number): string {
    const step = Math.floor(Date.now() / 1000 / 30) + offset
    const buffer = Buffer.alloc(8)
    buffer.writeBigUInt64BE(BigInt(step))

    const key = fromBase32(secret)
    const hmac = createHmac('sha1', key).update(buffer).digest()
    const position = hmac[hmac.length - 1] & 0x0f
    const code = (
        ((hmac[position] & 0x7f) << 24)
        | ((hmac[position + 1] & 0xff) << 16)
        | ((hmac[position + 2] & 0xff) << 8)
        | (hmac[position + 3] & 0xff)
    ) % 1_000_000

    return code.toString().padStart(6, '0')
}

function toBase32(buffer: Buffer): string {
    let bits = 0
    let value = 0
    let output = ''

    for (const byte of buffer) {
        value = (value << 8) | byte
        bits += 8

        while (bits >= 5) {
            output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
            bits -= 5
        }
    }

    if (bits > 0) {
        output += BASE32_ALPHABET[(value << (5 - bits)) & 31]
    }

    return output
}

function fromBase32(input: string): Buffer {
    const normalized = input.toUpperCase().replace(/=+$/, '')
    let bits = 0
    let value = 0
    const output: number[] = []

    for (const character of normalized) {
        const index = BASE32_ALPHABET.indexOf(character)
        if (index === -1) {
            continue
        }

        value = (value << 5) | index
        bits += 5

        if (bits >= 8) {
            output.push((value >>> (bits - 8)) & 0xff)
            bits -= 8
        }
    }

    return Buffer.from(output)
}
