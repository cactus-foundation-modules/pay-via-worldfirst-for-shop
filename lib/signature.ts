// WorldFirst's message signing (the Alipay-family scheme).
//
//   content = "<HTTP-Method> <path>\n<Client-Id>.<time>.<body>"
//   signature = base64( RSA-SHA256( content ) )
//   header   -> Signature: algorithm=RSA256, keyVersion=1, signature=<urlencoded>
//
// <time> is Request-Time on a request and Response-Time on a response. The path
// is what follows the host (/amsin/api/v1/business/create), never the full URL,
// and the body is the exact bytes sent or received: a body that has been through
// JSON.parse and back is not what was signed and will never verify.
//
// Pure functions over node:crypto, no network, no settings: everything the
// tests need to prove the scheme round-trips without a WorldFirst account.
import { createSign, createVerify } from 'crypto'

export const SIGNATURE_ALGORITHM = 'RSA256'
export const DEFAULT_KEY_VERSION = '1'

export function buildSigningContent(input: {
  method: string
  path: string
  clientId: string
  time: string
  body: string
}): string {
  return `${input.method.toUpperCase()} ${input.path}\n${input.clientId}.${input.time}.${input.body}`
}

/** Accept a key however it survived storage: a PEM as pasted, a PEM with literal
 *  "\n", a PEM whose line breaks were flattened to spaces (which is what an
 *  environment variable store can do to a multi-line value), one wrapped in
 *  quotes, or the bare base64 body. Returns a clean, 64-column PEM node:crypto
 *  can load. The label (PRIVATE KEY, RSA PRIVATE KEY, PUBLIC KEY...) is kept as
 *  written, because it says which encoding the body is. */
export function normalisePem(raw: string, kind: 'private' | 'public'): string {
  const cleaned = raw.trim().replace(/^["']|["']$/g, '').replace(/\\n/g, '\n')
  const fenced = /-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----/.exec(cleaned)
  const label = fenced?.[1] ?? (kind === 'private' ? 'PRIVATE KEY' : 'PUBLIC KEY')
  const body = (fenced?.[2] ?? cleaned).replace(/\s+/g, '')
  const lines = body.match(/.{1,64}/g) ?? []
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----`
}

export function signContent(content: string, privateKey: string): string {
  const signer = createSign('RSA-SHA256')
  signer.update(content, 'utf8')
  return signer.sign(normalisePem(privateKey, 'private'), 'base64')
}

export function buildSignatureHeader(signatureBase64: string, keyVersion: string = DEFAULT_KEY_VERSION): string {
  return `algorithm=${SIGNATURE_ALGORITHM}, keyVersion=${keyVersion}, signature=${encodeURIComponent(signatureBase64)}`
}

export type ParsedSignatureHeader = { algorithm: string; keyVersion: string | null; signature: string }

/** Splits on the FIRST "=" of each pair: a base64 signature can end in "=". The
 *  signature value is URL-decoded, since senders URL-encode it. */
export function parseSignatureHeader(header: string | null | undefined): ParsedSignatureHeader | null {
  if (!header) return null
  const fields = new Map<string, string>()
  for (const pair of header.split(',')) {
    const index = pair.indexOf('=')
    if (index <= 0) continue
    fields.set(pair.slice(0, index).trim().toLowerCase(), pair.slice(index + 1).trim())
  }
  const rawSignature = fields.get('signature')
  if (!rawSignature) return null
  let signature: string
  try {
    signature = decodeURIComponent(rawSignature)
  } catch {
    return null
  }
  return {
    algorithm: (fields.get('algorithm') ?? SIGNATURE_ALGORITHM).toUpperCase(),
    keyVersion: fields.get('keyversion') ?? null,
    signature,
  }
}

export function verifyContent(content: string, signatureBase64: string, publicKey: string): boolean {
  try {
    const verifier = createVerify('RSA-SHA256')
    verifier.update(content, 'utf8')
    return verifier.verify(normalisePem(publicKey, 'public'), signatureBase64, 'base64')
  } catch {
    // A key that will not load is a failed verification, not a crash.
    return false
  }
}

/** Verify a signed message from WorldFirst. False for anything that is not an
 *  RSA256 signature, which is the only algorithm this module speaks. */
export function verifyMessage(input: {
  method: string
  path: string
  clientId: string
  time: string
  body: string
  signatureHeader: string | null | undefined
  publicKey: string
}): boolean {
  const parsed = parseSignatureHeader(input.signatureHeader)
  if (!parsed || parsed.algorithm !== SIGNATURE_ALGORITHM) return false
  return verifyContent(buildSigningContent(input), parsed.signature, input.publicKey)
}
