// WorldFirst credentials, sourced from env vars (managed on the core admin
// settings page, like the Stripe/PayPal keys in shop). Nothing secret is stored
// in the database, because the database is included in backups.
//
// Sandbox and production credentials live in SEPARATE variables so both sets
// can be held at once and the environment choice actually swaps which set is
// live. WHICH environment is live is a stored setting (lib/settings.ts), so
// every function here takes the environment as an argument: there is no ambient
// "current" one to get wrong.
import type { WorldFirstEnvironment } from '@/modules/pay-via-worldfirst-for-shop/lib/settings'

export type { WorldFirstEnvironment }

export type WorldFirstCredentialSet = {
  // The Client-Id header on every call. Identifies the partner.
  clientId: string | null
  // The partner's own RSA private key (the one WorldFirst was given the public
  // half of). Signs every request. PEM, or the bare base64 body of one.
  privateKey: string | null
  // WorldFirst's public key, issued by their support team. Verifies the
  // signature on what they send back. Optional: without it responses are
  // accepted over TLS from the host the owner entered, and the status panel
  // says so.
  publicKey: string | null
}

export function worldFirstEnvVarNames(environment: WorldFirstEnvironment) {
  return environment === 'sandbox'
    ? {
        clientId: 'WORLDFIRST_SANDBOX_CLIENT_ID',
        privateKey: 'WORLDFIRST_SANDBOX_PRIVATE_KEY',
        publicKey: 'WORLDFIRST_SANDBOX_PUBLIC_KEY',
      }
    : {
        clientId: 'WORLDFIRST_CLIENT_ID',
        privateKey: 'WORLDFIRST_PRIVATE_KEY',
        publicKey: 'WORLDFIRST_PUBLIC_KEY',
      }
}

// Static process.env references on purpose - a computed `process.env[name]`
// lookup is not inlined by the bundler and reads as empty in some runtimes.
export function getWorldFirstCredentials(environment: WorldFirstEnvironment): WorldFirstCredentialSet {
  return environment === 'sandbox'
    ? {
        clientId: process.env.WORLDFIRST_SANDBOX_CLIENT_ID || null,
        privateKey: process.env.WORLDFIRST_SANDBOX_PRIVATE_KEY || null,
        publicKey: process.env.WORLDFIRST_SANDBOX_PUBLIC_KEY || null,
      }
    : {
        clientId: process.env.WORLDFIRST_CLIENT_ID || null,
        privateKey: process.env.WORLDFIRST_PRIVATE_KEY || null,
        publicKey: process.env.WORLDFIRST_PUBLIC_KEY || null,
      }
}

// Both halves of what signs a request are required, for the environment that is
// actually live. The public key is not: see WorldFirstCredentialSet.
export function isWorldFirstConfigured(environment: WorldFirstEnvironment): boolean {
  const creds = getWorldFirstCredentials(environment)
  return !!(creds.clientId && creds.privateKey)
}
