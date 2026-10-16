# Pay via WorldFirst for Shop

Adds **Pay via WorldFirst** as a checkout payment method in the Cactus Shop, using
[WorldFirst](https://www.worldfirst.com)'s Pay Solution (Cashier Payment) API. The
shopper is sent to WorldFirst's own hosted payment page, pays there, and is brought
straight back. The order confirms itself the moment WorldFirst reports the money is in.

- **Table prefix:** `wfp_`
- **Depends on:** the `shop` module (`>= 0.1.370`, the first version whose refund
  wording tells the truth about a method that does not send refunds itself)
- **Currencies:** GBP by default; the owner lists any others their WorldFirst account
  can receive

## What you need from WorldFirst first

The Pay Solution API is a partner integration, so WorldFirst has to set your account up
for it. They will give you, for sandbox and again for production:

1. A **Client ID**.
2. The **API address** (host) assigned to you. There is no single public one.
3. **WorldFirst's public key**, so replies can be verified (recommended).

You generate the fourth piece yourself: a 2048-bit RSA key pair. Give WorldFirst the
public half; keep the private half for this module.

```bash
openssl genrsa -out private.pem 2048
openssl rsa -in private.pem -pubout -out public.pem
```

Your IP addresses may also need whitelisting on their side. Ask WorldFirst's technical
support.

## How it works

1. At checkout the shopper picks *Pay via WorldFirst*. The module creates a cashier
   payment (`createCashierPayment`) and sends the shopper to the page WorldFirst
   returns. Nothing is written to the orders list yet: the order is drafted and only
   becomes real when the money is confirmed, so a shopper who thinks better of it
   leaves nothing behind.
2. On return, and again via WorldFirst's `notifyPayment` call, the module asks WorldFirst
   (`inquirePayment`) where the payment has got to. Only `PAY_SUCCESS`, for exactly the
   order's amount in exactly the order's currency, creates the order and marks it paid.
   The usual fulfilment (email, stock, downloads) then runs.
3. Nothing in a notification is ever believed on its own. It is a nudge to go and ask.

## Setup

1. Install the module, then open **Shop > Payments > Pay via WorldFirst**.
2. For the environment you are using, enter the **API address**, **Client ID**, your
   **private key** and WorldFirst's **public key**. The keys are stored with your
   hosting as environment variables, never in the database, and reach the running site
   at its next deployment.
3. Pick **Sandbox** or **Production** (applies immediately), tick *Offer Pay via
   WorldFirst at checkout*.

There is nothing to register: the notification address is sent to WorldFirst with every
payment. It only works on a live https site.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `WORLDFIRST_CLIENT_ID`, `WORLDFIRST_PRIVATE_KEY`, `WORLDFIRST_PUBLIC_KEY` | Production credentials |
| `WORLDFIRST_SANDBOX_CLIENT_ID`, `WORLDFIRST_SANDBOX_PRIVATE_KEY`, `WORLDFIRST_SANDBOX_PUBLIC_KEY` | Sandbox credentials |

Keys are accepted as a PEM, a PEM on one line with literal `\n`, or the bare base64 body.

## Things worth knowing

- **Refunds are recorded, not sent.** Pressing Refund in the shop takes the items off the
  order, credits the books and sends the credit note; the money goes back from your
  WorldFirst account. (WorldFirst's refund call needs refund-to details that come with
  partner onboarding.)
- **What the shopper can pay with is decided by WorldFirst's cashier page**, not by this
  module. Whether that includes a bank transfer depends on how your WorldFirst account
  is set up.
- **Unverified against a live account.** The request and response shapes follow
  WorldFirst's published Pay Solution documentation. Where the documentation is
  partner-gated (the host, the exact signing of notifications), the module is built to
  fail safe: anything it cannot read is logged and left alone, and payment state is
  always taken from a signed inquiry rather than from a notification.

## Development

Tests are vitest, run from the Cactus core checkout:

```bash
npx vitest run modules/pay-via-worldfirst-for-shop
```
