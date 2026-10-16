import { generateKeyPairSync } from 'crypto'
import { describe, expect, it } from 'vitest'
import {
  buildSignatureHeader,
  buildSigningContent,
  normalisePem,
  parseSignatureHeader,
  signContent,
  verifyContent,
  verifyMessage,
} from '@/modules/pay-via-worldfirst-for-shop/lib/signature'

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

const message = {
  method: 'POST',
  path: '/amsin/api/v1/business/create',
  clientId: 'CLIENT_1',
  time: '2026-10-16T09:30:00+00:00',
  body: '{"payToRequestIds":["abc"]}',
}

function bareBody(pem: string): string {
  return pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '')
}

describe('buildSigningContent', () => {
  it('is the method and path, a newline, then client id, time and body joined by dots', () => {
    expect(buildSigningContent(message)).toBe(
      'POST /amsin/api/v1/business/create\nCLIENT_1.2026-10-16T09:30:00+00:00.{"payToRequestIds":["abc"]}',
    )
  })

  it('upper-cases the method', () => {
    expect(buildSigningContent({ ...message, method: 'post' }).startsWith('POST ')).toBe(true)
  })
})

describe('sign and verify', () => {
  const content = buildSigningContent(message)

  it('round-trips', () => {
    expect(verifyContent(content, signContent(content, privateKey), publicKey)).toBe(true)
  })

  it('refuses a body that has been altered by one character', () => {
    const signature = signContent(content, privateKey)
    expect(verifyContent(buildSigningContent({ ...message, body: '{"payToRequestIds":["abd"]}' }), signature, publicKey)).toBe(false)
  })

  it('refuses a different client id or time', () => {
    const signature = signContent(content, privateKey)
    expect(verifyContent(buildSigningContent({ ...message, clientId: 'CLIENT_2' }), signature, publicKey)).toBe(false)
    expect(verifyContent(buildSigningContent({ ...message, time: '2026-10-16T09:30:01+00:00' }), signature, publicKey)).toBe(false)
  })

  it('treats a key that will not load as a failed verification, not a crash', () => {
    expect(verifyContent(content, signContent(content, privateKey), 'not a key')).toBe(false)
  })
})

describe('normalisePem', () => {
  it('leaves a real PEM alone', () => {
    expect(normalisePem(privateKey, 'private')).toBe(privateKey.trim())
  })

  it('rebuilds a PEM whose line breaks were flattened to spaces', () => {
    const flattened = privateKey.trim().replace(/\n/g, ' ')
    const content = buildSigningContent(message)
    expect(verifyContent(content, signContent(content, flattened), publicKey)).toBe(true)
    expect(normalisePem(flattened, 'private')).toBe(privateKey.trim())
  })

  it('copes with surrounding quotes and a flattened public key', () => {
    const content = buildSigningContent(message)
    const quoted = `"${privateKey.trim().replace(/\n/g, '\\n')}"`
    const flatPublic = publicKey.trim().replace(/\n/g, ' ')
    expect(verifyContent(content, signContent(content, quoted), flatPublic)).toBe(true)
  })

  it('reads a PEM held on one line with literal \\n', () => {
    const oneLine = privateKey.trim().replace(/\n/g, '\\n')
    const content = buildSigningContent(message)
    expect(verifyContent(content, signContent(content, oneLine), publicKey)).toBe(true)
  })

  it('wraps the bare base64 body of a key', () => {
    const content = buildSigningContent(message)
    const signature = signContent(content, bareBody(privateKey))
    expect(verifyContent(content, signature, bareBody(publicKey))).toBe(true)
  })
})

describe('Signature header', () => {
  it('url-encodes the signature and parses it back', () => {
    const signature = 'ab/c+d=='
    const header = buildSignatureHeader(signature)
    expect(header).toBe('algorithm=RSA256, keyVersion=1, signature=ab%2Fc%2Bd%3D%3D')
    expect(parseSignatureHeader(header)).toEqual({ algorithm: 'RSA256', keyVersion: '1', signature })
  })

  it('splits on the first = only, so a padded base64 value survives', () => {
    expect(parseSignatureHeader('algorithm=RSA256,keyVersion=2,signature=abc==')?.signature).toBe('abc==')
  })

  it('reads the algorithm case-insensitively', () => {
    expect(parseSignatureHeader('algorithm=rsa256, signature=x')?.algorithm).toBe('RSA256')
  })

  it('refuses a missing or signature-less header', () => {
    expect(parseSignatureHeader(null)).toBeNull()
    expect(parseSignatureHeader('')).toBeNull()
    expect(parseSignatureHeader('algorithm=RSA256, keyVersion=1')).toBeNull()
  })

  it('refuses a malformed percent-escape rather than throwing', () => {
    expect(parseSignatureHeader('algorithm=RSA256, signature=%E0%A4%A')).toBeNull()
  })
})

describe('verifyMessage', () => {
  const signatureHeader = buildSignatureHeader(signContent(buildSigningContent(message), privateKey))

  it('accepts a correctly signed message', () => {
    expect(verifyMessage({ ...message, signatureHeader, publicKey })).toBe(true)
  })

  it('refuses a message with no signature header', () => {
    expect(verifyMessage({ ...message, signatureHeader: null, publicKey })).toBe(false)
  })

  it('refuses any algorithm other than RSA256', () => {
    const ecc = signatureHeader.replace('RSA256', 'ECC224')
    expect(verifyMessage({ ...message, signatureHeader: ecc, publicKey })).toBe(false)
  })
})
