/**
 * EncryptionService — Unit Tests
 */

import { describe, it, expect } from 'vitest'
import { EncryptionService } from '../encryption/EncryptionService.js'

describe('EncryptionService', () => {
    const service = new EncryptionService()

    describe('encrypt / decrypt roundtrip', () => {
        it('should encrypt and decrypt a string', () => {
            const key = service.deriveKeyFromPassword('test-password', service.generateSalt())
            const plaintext = 'Hello, OpenBase!'

            const encrypted = service.encrypt(plaintext, key)
            expect(encrypted.ciphertext).toBeTruthy()
            expect(encrypted.iv).toBeTruthy()
            expect(encrypted.tag).toBeTruthy()
            expect(encrypted.ciphertext).not.toBe(plaintext)

            const decrypted = service.decrypt(encrypted.ciphertext, encrypted.iv, encrypted.tag, key)
            expect(decrypted).toBe(plaintext)
        })

        it('should encrypt and decrypt JSON data', () => {
            const key = service.deriveKeyFromPassword('secret123', service.generateSalt())
            const data = JSON.stringify({ user: 'alice', session: 'abc123' })

            const encrypted = service.encrypt(data, key)
            const decrypted = service.decrypt(encrypted.ciphertext, encrypted.iv, encrypted.tag, key)
            expect(JSON.parse(decrypted)).toEqual({ user: 'alice', session: 'abc123' })
        })

        it('should produce different ciphertext for same plaintext (random IV)', () => {
            const key = service.deriveKeyFromPassword('test', service.generateSalt())
            const encrypted1 = service.encrypt('same-data', key)
            const encrypted2 = service.encrypt('same-data', key)

            expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext)
            expect(encrypted1.iv).not.toBe(encrypted2.iv)
        })

        it('should fail with wrong key', () => {
            const key1 = service.deriveKeyFromPassword('key1', service.generateSalt())
            const key2 = service.deriveKeyFromPassword('key2', service.generateSalt())

            const encrypted = service.encrypt('secret', key1)
            expect(() => service.decrypt(encrypted.ciphertext, encrypted.iv, encrypted.tag, key2)).toThrow()
        })
    })

    describe('encryptToString / decryptFromString', () => {
        it('should roundtrip via JSON string', () => {
            const key = service.deriveKeyFromPassword('pwd', service.generateSalt())
            const encoded = service.encryptToString('telegram-session-string', key)

            expect(typeof encoded).toBe('string')
            expect(JSON.parse(encoded)).toHaveProperty('ciphertext')

            const decoded = service.decryptFromString(encoded, key)
            expect(decoded).toBe('telegram-session-string')
        })
    })

    describe('key derivation', () => {
        it('should derive a 32-byte key', () => {
            const salt = service.generateSalt()
            const key = service.deriveKeyFromPassword('password', salt)
            expect(key).toBeInstanceOf(Buffer)
            expect(key.length).toBe(32)
        })

        it('should produce same key with same password and salt', () => {
            const salt = service.generateSalt()
            const key1 = service.deriveKeyFromPassword('same-password', salt)
            const key2 = service.deriveKeyFromPassword('same-password', salt)
            expect(key1.equals(key2)).toBe(true)
        })

        it('should produce different keys with different salts', () => {
            const key1 = service.deriveKeyFromPassword('password', service.generateSalt())
            const key2 = service.deriveKeyFromPassword('password', service.generateSalt())
            expect(key1.equals(key2)).toBe(false)
        })
    })

    describe('keyFromHex', () => {
        it('should convert a hex string to a buffer', () => {
            const hex = 'a'.repeat(64) // 32 bytes
            const key = service.keyFromHex(hex)
            expect(key).toBeInstanceOf(Buffer)
            expect(key.length).toBe(32)
        })
    })
})
