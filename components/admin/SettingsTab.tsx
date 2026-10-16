'use client'

// "Pay via WorldFirst" panel. The manifest settingsTabs entry sets host
// "shop.payments", so this renders inside admin > Shop > Payments alongside
// Stripe and PayPal rather than as a top-level Settings tab. Credentials are
// stored as environment variables through the core-managed /api/admin/env route
// (declared via requiredEnvVars); everything else here is this module's own
// stored settings.
//
// The environment picker deliberately does NOT go through /api/admin/env. An
// environment variable written there only reaches the running server at the
// next deployment, so the panel would re-read the old value the moment it
// reloaded and put the dropdown straight back - a save that looked like a
// failure. Being a stored setting, it applies immediately.
//
// Every colour here is a semantic variable or an admin class.
import { useEffect, useState } from 'react'
import { SettingsHeaderActions, SettingsHeaderStatus } from '@/components/admin/SettingsHeaderActions'

type Environment = 'sandbox' | 'production'
type CredentialField = 'clientId' | 'privateKey' | 'publicKey'

const MAX_DESCRIPTION = 64

const ENVIRONMENTS: Array<{ id: Environment; label: string; hint: string }> = [
  { id: 'sandbox', label: 'Sandbox', hint: 'Test payments only. No real money moves, and real customers cannot pay.' },
  { id: 'production', label: 'Production', hint: 'Real payments from real customers, into your real WorldFirst account.' },
]

type FieldDef = { field: CredentialField; label: string; placeholder: string; multiline: boolean; help: string }

const FIELDS: FieldDef[] = [
  {
    field: 'clientId',
    label: 'Client ID',
    placeholder: '••••••••',
    multiline: false,
    help: 'The partner Client ID WorldFirst issued when your account was set up for their Pay Solution API. It identifies your shop on every request.',
  },
  {
    field: 'privateKey',
    label: 'Your private key',
    placeholder: '-----BEGIN PRIVATE KEY-----',
    multiline: true,
    help: 'The 2048-bit RSA private key whose public half you gave WorldFirst. It signs every request, so WorldFirst knows it really came from your shop. Paste the whole thing, including the BEGIN and END lines. It is stored with your hosting and never in your database.',
  },
  {
    field: 'publicKey',
    label: 'WorldFirst’s public key (recommended)',
    placeholder: '-----BEGIN PUBLIC KEY-----',
    multiline: true,
    help: 'WorldFirst’s support team issues this. With it, every reply from WorldFirst is checked to really be from them. Without it the shop still works, but replies are trusted on the strength of the secure connection alone.',
  },
]

// Must match worldFirstEnvVarNames() in lib/env.ts.
const ENV_VAR_SUFFIX: Record<CredentialField, string> = {
  clientId: 'CLIENT_ID',
  privateKey: 'PRIVATE_KEY',
  publicKey: 'PUBLIC_KEY',
}

function envVarName(environment: Environment, field: CredentialField): string {
  const prefix = environment === 'sandbox' ? 'WORLDFIRST_SANDBOX_' : 'WORLDFIRST_'
  return `${prefix}${ENV_VAR_SUFFIX[field]}`
}

type Status = {
  environment: string
  clientIdSet?: boolean
  privateKeySet?: boolean
  publicKeySet?: boolean
  apiAddressSet?: boolean
  webhookUrl?: string
  webhookReachable?: boolean
  configured: boolean
  connected?: boolean
  error?: string
}

type Settings = {
  enabled: boolean
  paymentDescription: string
  environment: Environment
  apiBaseUrlSandbox: string
  apiBaseUrlProduction: string
  keyVersionSandbox: string
  keyVersionProduction: string
  acceptedCurrencies: string[]
}

function listWords(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

const subtleText = { color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' } as const

export function WorldFirstSettingsTab() {
  const [setVars, setSetVars] = useState<Record<string, boolean>>({})
  const [values, setValues] = useState<Record<string, string>>({})
  const [environment, setEnvironment] = useState<Environment>('sandbox')
  const [localMode, setLocalMode] = useState(false)
  const [status, setStatus] = useState<Status | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [currenciesText, setCurrenciesText] = useState('GBP')

  const [savingConn, setSavingConn] = useState(false)
  const [savedConn, setSavedConn] = useState(false)
  const [connError, setConnError] = useState('')

  const [savingSettings, setSavingSettings] = useState(false)
  const [savedSettings, setSavedSettings] = useState(false)
  const [settingsError, setSettingsError] = useState('')

  async function load() {
    try {
      const [envRes, statusRes, settingsRes] = await Promise.all([
        fetch('/api/admin/env'),
        fetch('/api/m/pay-via-worldfirst-for-shop/admin/status'),
        fetch('/api/m/pay-via-worldfirst-for-shop/admin/settings'),
      ])
      if (envRes.ok) {
        const d = await envRes.json()
        setSetVars(d.vars ?? {})
        setLocalMode(!!d.localMode)
      }
      if (statusRes.ok) setStatus((await statusRes.json()) as Status)
      if (settingsRes.ok) {
        const s = (await settingsRes.json()) as Settings
        setSettings(s)
        setCurrenciesText(s.acceptedCurrencies.join(', '))
        if (s.environment === 'production' || s.environment === 'sandbox') setEnvironment(s.environment)
      }
    } catch {
      // Sections still render with defaults.
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- delegating to an async loader; every setState in load() runs after an await, never synchronously in the effect body
    load()
  }, [])

  async function saveConnection() {
    setSavingConn(true)
    setSavedConn(false)
    setConnError('')
    try {
      // Only non-blank fields are sent, so a blank box leaves the stored value
      // alone rather than wiping it. Keys are trimmed at the ends only: the
      // line breaks inside a PEM are part of it.
      const vars = Object.entries(values)
        .map(([key, value]) => ({ key, value: value.trim() }))
        .filter((v) => v.value !== '')
      if (vars.length === 0) {
        throw new Error('Nothing to save - fill in at least one box first.')
      }
      const res = await fetch('/api/admin/env', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vars }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error ?? 'Failed to save')
      if (Array.isArray(d.skipped) && d.skipped.length > 0) {
        throw new Error(`Not stored: ${d.skipped.join(', ')}. Update the Pay via WorldFirst module to its latest version, then save again.`)
      }
      setSavedConn(true)
      setValues({})
      await load()
    } catch (err) {
      setConnError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSavingConn(false)
    }
  }

  async function patchSettings(patch: Partial<Settings>): Promise<Settings> {
    const res = await fetch('/api/m/pay-via-worldfirst-for-shop/admin/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    const d = await res.json()
    if (!res.ok) throw new Error(d.error ?? 'Failed to save')
    const saved = d as Settings
    setSettings(saved)
    setCurrenciesText(saved.acceptedCurrencies.join(', '))
    return saved
  }

  async function saveSettings(next: Partial<Settings>) {
    setSavingSettings(true)
    setSavedSettings(false)
    setSettingsError('')
    try {
      await patchSettings(next)
      setSavedSettings(true)
      await load()
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSavingSettings(false)
    }
  }

  // Which environment is live is a stored setting, so it applies at once. The
  // status panel is re-read straight afterwards because "is this connected" has
  // an entirely different answer for the other environment's credentials.
  async function chooseEnvironment(next: Environment) {
    const previous = environment
    setEnvironment(next)
    setSavingConn(true)
    setSavedConn(false)
    setConnError('')
    try {
      await patchSettings({ environment: next })
      await load()
    } catch (err) {
      setEnvironment(previous)
      setConnError(err instanceof Error ? err.message : 'Could not switch environment')
    } finally {
      setSavingConn(false)
    }
  }

  // "Saved" and "working" are two different things: a credential written through
  // /api/admin/env goes to the hosting project, and the running server carries on
  // with the old environment until the site next deploys. So a box can show
  // "(set)" while the status panel, which reads what the server can actually see,
  // still says no. Telling somebody to add a key they added a minute ago is
  // wrong; what they want is a deployment.
  function missingCredentials(): { pending: string[]; absent: string[] } {
    const env: Environment = status?.environment === 'production' ? 'production' : 'sandbox'
    const wanted: Array<{ field: CredentialField; label: string; seen: boolean }> = [
      { field: 'clientId', label: 'Client ID', seen: status?.clientIdSet !== false },
      { field: 'privateKey', label: 'private key', seen: status?.privateKeySet !== false },
    ]
    const pending: string[] = []
    const absent: string[] = []
    for (const c of wanted) {
      if (c.seen) continue
      ;(setVars[envVarName(env, c.field)] ? pending : absent).push(c.label)
    }
    return { pending, absent }
  }

  function renderCredentials(env: Environment) {
    const meta = ENVIRONMENTS.find((e) => e.id === env)
    if (!meta) return null
    const isLive = environment === env
    const addressKey = env === 'sandbox' ? 'apiBaseUrlSandbox' : 'apiBaseUrlProduction'
    const versionKey = env === 'sandbox' ? 'keyVersionSandbox' : 'keyVersionProduction'

    return (
      <div
        key={env}
        className="settings-fields"
        style={{
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-4)',
          marginBottom: 'var(--space-4)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-1)' }}>
          <strong style={{ color: 'var(--color-text)' }}>{meta.label}</strong>
          {isLive && (
            <span
              style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--color-success, var(--color-text-secondary))',
                border: '1px solid currentColor',
                borderRadius: 'var(--radius-sm)',
                padding: '0 var(--space-2)',
              }}
            >
              In use
            </span>
          )}
        </div>
        <p style={{ ...subtleText, margin: '0 0 var(--space-3)' }}>{meta.hint}</p>

        {settings && (
          <div className="field">
            <label htmlFor={`wfp-address-${env}`}>API address</label>
            <p style={{ ...subtleText, margin: '0 0 var(--space-2)' }}>
              The secure web address WorldFirst assigned to your account for this environment. They
              give each partner their own, so there is no standard one to suggest. Just the address -
              nothing after the .com or .net.
            </p>
            <input
              id={`wfp-address-${env}`}
              type="text"
              value={settings[addressKey]}
              placeholder="https://…"
              onChange={(e) => setSettings({ ...settings, [addressKey]: e.target.value })}
              onBlur={() => saveSettings({ [addressKey]: settings[addressKey] })}
            />
          </div>
        )}

        {settings && (
          <div className="field">
            <label htmlFor={`wfp-keyversion-${env}`}>Key version</label>
            <p style={{ ...subtleText, margin: '0 0 var(--space-2)' }}>
              The version number WorldFirst&apos;s developer portal shows next to the public key you
              registered for this environment. Leave it at 1 unless the portal says otherwise - a
              &quot;key not found&quot; error from WorldFirst usually means this does not match.
            </p>
            <input
              id={`wfp-keyversion-${env}`}
              type="text"
              inputMode="numeric"
              value={settings[versionKey]}
              onChange={(e) => setSettings({ ...settings, [versionKey]: e.target.value })}
              onBlur={() => saveSettings({ [versionKey]: settings[versionKey] })}
            />
          </div>
        )}

        {FIELDS.map(({ field, label, placeholder, multiline, help }) => {
          const key = envVarName(env, field)
          const placeholderText = setVars[key] ? 'Leave blank to keep current value' : placeholder
          return (
            <div className="field" key={key}>
              <label htmlFor={`wfp-${key}`}>
                {label}
                {setVars[key] && (
                  <span style={{ marginLeft: 'var(--space-2)', fontSize: 'var(--text-xs)', color: 'var(--color-success, var(--color-text-secondary))' }}>
                    (set)
                  </span>
                )}
              </label>
              <p style={{ ...subtleText, margin: '0 0 var(--space-2)' }}>{help}</p>
              {multiline ? (
                <textarea
                  id={`wfp-${key}`}
                  rows={4}
                  value={values[key] ?? ''}
                  placeholder={placeholderText}
                  onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                  autoComplete="off"
                  spellCheck={false}
                />
              ) : (
                <input
                  id={`wfp-${key}`}
                  type="password"
                  value={values[key] ?? ''}
                  placeholder={placeholderText}
                  onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                  autoComplete="off"
                />
              )}
            </div>
          )
        })}
      </div>
    )
  }

  const descriptionLeft = MAX_DESCRIPTION - (settings?.paymentDescription.length ?? 0)

  return (
    <div className="settings-masonry">
      <div className="card">
        <h2 className="card-title">Pay via WorldFirst</h2>
        <p style={{ ...subtleText, margin: '0 0 var(--space-4)' }}>
          Send shoppers to WorldFirst&apos;s own payment page to pay, and bring them straight back. The
          order confirms itself the moment WorldFirst says the money is in. Sandbox and production
          have their own keys, so each gets its own box below - fill in whichever you are using, pick
          which one the shop should use, then turn the method on. You will need to have been set up
          for WorldFirst&apos;s Pay Solution API first; their{' '}
          <a href="https://developers.worldfirst.com/" target="_blank" rel="noreferrer">
            developer centre
          </a>{' '}
          explains how.
        </p>

        {environment === 'production' ? (
          <div className="alert alert-danger">
            <strong>Production - this is real money.</strong> Every payment taken here is a real
            customer&apos;s real payment into your real account.
          </div>
        ) : (
          <div className="alert alert-warning">
            <strong>Sandbox - test payments only.</strong> Nothing here moves real money, and a real
            customer cannot pay you. Switch to Production when you are ready to trade.
          </div>
        )}

        {connError && <div className="alert alert-danger">{connError}</div>}
        {savedConn && <div className="alert alert-success">Saved. Changes take effect after the next deployment.</div>}

        {status && (
          !status.configured ? (
            (() => {
              const { pending, absent } = missingCredentials()
              return (
                <>
                  {pending.length > 0 && (
                    <div className="alert alert-warning">
                      Saved, but not live yet. The {listWords(pending)} for{' '}
                      <strong>{status.environment}</strong> {pending.length === 1 ? 'is' : 'are'} stored
                      with your hosting and will start working after the site&apos;s next deployment -
                      keys only reach the running site when it redeploys. Deploy from the
                      notification on your dashboard, then come back to this page.
                    </div>
                  )}
                  {absent.length > 0 && (
                    <div className="alert alert-warning">
                      Not connected yet - add the {listWords(absent)} for{' '}
                      <strong>{status.environment}</strong> below.
                    </div>
                  )}
                  {status.apiAddressSet === false && (
                    <div className="alert alert-warning">
                      Not connected yet - enter the API address for <strong>{status.environment}</strong> below.
                    </div>
                  )}
                  {pending.length === 0 && absent.length === 0 && status.apiAddressSet !== false && (
                    <div className="alert alert-warning">
                      Not connected yet - check the details for <strong>{status.environment}</strong> below.
                    </div>
                  )}
                </>
              )
            })()
          ) : status.connected ? (
            <div className="alert alert-success">
              Connected to WorldFirst (<strong>{status.environment}</strong>).
              {status.publicKeySet === false && ' Add WorldFirst’s public key below so their replies are verified as well.'}
            </div>
          ) : (
            <div className="alert alert-danger">
              The details are set but WorldFirst did not accept them{status.error ? `: ${status.error}` : ''}.
            </div>
          )
        )}

        <div className="field field--wide">
          <label htmlFor="wfp-environment">Which environment the shop uses</label>
          <p style={{ ...subtleText, margin: '0 0 var(--space-2)' }}>
            Saved as soon as you pick it and live straight away - no deployment needed. Make sure the
            boxes below are filled in for whichever you choose.
          </p>
          <select
            id="wfp-environment"
            value={environment}
            disabled={savingConn}
            onChange={(e) => chooseEnvironment(e.target.value === 'production' ? 'production' : 'sandbox')}
          >
            <option value="sandbox">Sandbox (testing - no real money)</option>
            <option value="production">Production (real money)</option>
          </select>
        </div>

        {localMode ? (
          <div className="alert alert-warning">
            Local development mode: set <code>WORLDFIRST_CLIENT_ID</code> and{' '}
            <code>WORLDFIRST_PRIVATE_KEY</code> (or their <code>WORLDFIRST_SANDBOX_</code> twins) in{' '}
            <code>.env.local</code> and restart the dev server.
          </div>
        ) : (
          <>
            {ENVIRONMENTS.map((e) => renderCredentials(e.id))}

            <SettingsHeaderActions>
              <SettingsHeaderStatus message={savedConn ? 'Saved. Live from the next deployment.' : null} error={connError} />
              <button className="btn btn-primary" disabled={savingConn} onClick={saveConnection}>
                {savingConn ? 'Saving…' : 'Save connection'}
              </button>
            </SettingsHeaderActions>
          </>
        )}
      </div>

      <div className="card">
        <h2 className="card-title">Payment confirmations</h2>
        <p style={{ ...subtleText, margin: '0 0 var(--space-4)' }}>
          WorldFirst tells your shop when a payment lands, so an order confirms itself even if the
          shopper closes the tab on the way back. There is nothing to register: your site sends this
          address with every payment. It only works on a live, secure site.
        </p>
        {status?.webhookReachable === false && (
          <div className="alert alert-warning">
            This site is not reachable from the internet over https, so WorldFirst cannot call it.
            Pay via WorldFirst will refuse payments here and only works on your live site.
          </div>
        )}
        <div className="field field--wide">
          <label htmlFor="wfp-webhook-url">Where WorldFirst sends confirmations</label>
          <input id="wfp-webhook-url" type="text" value={status?.webhookUrl ?? ''} readOnly onFocus={(e) => e.target.select()} />
        </div>
        <p style={subtleText}>
          If WorldFirst asks for this address when setting up your account, this is the one.
        </p>
      </div>

      <div className="card">
        <h2 className="card-title">Payment method</h2>
        <p style={{ ...subtleText, margin: '0 0 var(--space-4)' }}>
          When switched on, Pay via WorldFirst appears as a payment option at checkout (as long as the
          connection above is working).
        </p>

        {settingsError && <div className="alert alert-danger">{settingsError}</div>}
        {savedSettings && <div className="alert alert-success">Saved.</div>}

        {settings && (
          <>
            <label className="settings-check">
              <input
                type="checkbox"
                checked={settings.enabled}
                disabled={savingSettings}
                onChange={(e) => saveSettings({ enabled: e.target.checked })}
              />
              Offer Pay via WorldFirst at checkout
            </label>

            <div className="field field--wide">
              <label htmlFor="wfp-description">Payment description</label>
              <p style={{ ...subtleText, margin: '0 0 var(--space-2)' }}>
                What the shopper sees against the payment on WorldFirst&apos;s page. Leave it blank and
                they see the order number instead.
              </p>
              <input
                id="wfp-description"
                type="text"
                maxLength={MAX_DESCRIPTION}
                value={settings.paymentDescription}
                placeholder="e.g. Your shop name"
                onChange={(e) => setSettings({ ...settings, paymentDescription: e.target.value })}
                onBlur={() => saveSettings({ paymentDescription: settings.paymentDescription })}
              />
              <p
                style={{
                  ...subtleText,
                  margin: 'var(--space-1) 0 0',
                  color: descriptionLeft === 0 ? 'var(--color-warning)' : 'var(--color-text-secondary)',
                }}
              >
                {descriptionLeft === 0
                  ? 'That is the lot - WorldFirst allows no more than 64 characters.'
                  : `${descriptionLeft} character${descriptionLeft === 1 ? '' : 's'} left.`}
              </p>
            </div>

            <div className="field field--wide">
              <label htmlFor="wfp-currencies">Currencies it is offered for</label>
              <p style={{ ...subtleText, margin: '0 0 var(--space-2)' }}>
                Three-letter codes, separated by commas. Orders in any other currency will not see
                this method. Only list currencies your WorldFirst account is set up to receive.
              </p>
              <input
                id="wfp-currencies"
                type="text"
                value={currenciesText}
                placeholder="GBP"
                onChange={(e) => setCurrenciesText(e.target.value)}
                onBlur={() =>
                  saveSettings({
                    acceptedCurrencies: currenciesText.split(',').map((c) => c.trim()).filter(Boolean),
                  })
                }
              />
            </div>

            <p style={subtleText}>
              Refunds are recorded in the shop as usual, but the money itself goes back from your
              WorldFirst account - pressing Refund in the shop does not send it.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
