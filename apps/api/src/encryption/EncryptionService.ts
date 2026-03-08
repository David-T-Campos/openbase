/**
 * EncryptionService — AES-256-GCM encryption for sensitive data
 *
 * Used to encrypt Telegram session strings, and optionally to
 * encrypt individual table columns marked as `encrypted: true`.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'
import type { EncryptedData } from '@openbase/core'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const SALT_LENGTH = 32
const KEY_LENGTH = 32

export class EncryptionService {
    /**
     * Encrypt a plaintext string using AES-256-GCM.
     * @param data - The plaintext to encrypt
     * @param key - A 32-byte encryption key
     * @returns The ciphertext, IV, and auth tag — all base64-encoded
     */
    encrypt(data: string, key: Buffer): EncryptedData {
        const iv = randomBytes(IV_LENGTH)
        const cipher = createCipheriv(ALGORITHM, key, iv)

        let ciphertext = cipher.update(data, 'utf8', 'base64')
        ciphertext += cipher.final('base64')
        const tag = cipher.getAuthTag()

        return {
            ciphertext,
            iv: iv.toString('base64'),
            tag: tag.toString('base64'),
        }
    }

    /**
     * Decrypt a ciphertext string using AES-256-GCM.
     * @param ciphertext - Base64-encoded ciphertext
     * @param iv - Base64-encoded initialization vector
     * @param tag - Base64-encoded authentication tag
     * @param key - The same 32-byte key used for encryption
     * @returns The decrypted plaintext
     */
    decrypt(ciphertext: string, iv: string, tag: string, key: Buffer): string {
        const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64'))
        decipher.setAuthTag(Buffer.from(tag, 'base64'))

        let data = decipher.update(ciphertext, 'base64', 'utf8')
        data += decipher.final('utf8')
        return data
    }

    /**
     * Encrypt data and return as a single JSON string (convenient for storage).
     */
    encryptToString(data: string, key: Buffer): string {
        const encrypted = this.encrypt(data, key)
        return JSON.stringify(encrypted)
    }

    /**
     * Decrypt data from a JSON string produced by encryptToString.
     */
    decryptFromString(encryptedJson: string, key: Buffer): string {
        const { ciphertext, iv, tag } = JSON.parse(encryptedJson) as EncryptedData
        return this.decrypt(ciphertext, iv, tag, key)
    }

    /**
     * Derive a 32-byte encryption key from a password and salt.
     * Uses scrypt for memory-hard key derivation.
     */
    deriveKeyFromPassword(password: string, salt: Buffer): Buffer {
        return scryptSync(password, salt, KEY_LENGTH)
    }

    /**
     * Generate a random salt for key derivation.
     */
    generateSalt(): Buffer {
        return randomBytes(SALT_LENGTH)
    }

    /**
     * Derive a key from a hex-encoded master key string (from env).
     */
    keyFromHex(hexKey: string): Buffer {
        return Buffer.from(hexKey, 'hex')
    }
}
