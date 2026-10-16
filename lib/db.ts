// This module's own table. Raw SQL rather than Prisma models, like every other
// module: the schema is created by migrations/, not by core's client.
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/db/prisma'

export type WfpPayment = {
  // Doubles as the payToRequestId sent to WorldFirst.
  id: string
  orderId: string
  orderNumber: string
  payToId: string | null
  checkoutUrl: string | null
  status: string
  // A decimal string, for the same reason ShpOrder.total is one - it comes out
  // of NUMERIC and the two are compared by the same code.
  amount: string
  currency: string
  returnPath: string | null
  createdAt: Date
}

function mapPayment(r: Record<string, unknown>): WfpPayment {
  return {
    id: r.id as string,
    orderId: r.order_id as string,
    orderNumber: r.order_number as string,
    payToId: (r.pay_to_id as string | null) ?? null,
    checkoutUrl: (r.checkout_url as string | null) ?? null,
    status: r.status as string,
    amount: (r.amount as { toString(): string }).toString(),
    currency: r.currency as string,
    returnPath: (r.return_path as string | null) ?? null,
    createdAt: r.created_at as Date,
  }
}

/** Written BEFORE the call to WorldFirst goes out, so the id it is sent under
 *  already exists if the call times out. */
export async function createWfpPayment(input: {
  orderId: string
  orderNumber: string
  amount: number
  currency: string
  returnPath?: string | null
}): Promise<WfpPayment> {
  const id = randomUUID()
  await prisma.$executeRaw`
    INSERT INTO "wfp_payments" (
      "id", "order_id", "order_number", "status", "amount", "currency", "return_path", "created_at", "updated_at"
    ) VALUES (
      ${id}, ${input.orderId}, ${input.orderNumber}, 'WAIT_PAY', ${input.amount}, ${input.currency}, ${input.returnPath ?? null},
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `
  const row = await getWfpPaymentById(id)
  if (!row) throw new Error('Failed to create wfp_payments row')
  return row
}

export async function getWfpPaymentById(id: string): Promise<WfpPayment | null> {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT * FROM "wfp_payments" WHERE "id" = ${id} LIMIT 1
  `
  const row = rows[0]
  return row ? mapPayment(row) : null
}

/** The most recent attempt against this order. There can be more than one: a
 *  shopper who abandons the cashier page and comes back gets a fresh payment. */
export async function getWfpPaymentByOrderId(orderId: string): Promise<WfpPayment | null> {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT * FROM "wfp_payments" WHERE "order_id" = ${orderId} ORDER BY "created_at" DESC LIMIT 1
  `
  const row = rows[0]
  return row ? mapPayment(row) : null
}

export async function updateWfpPayment(
  id: string,
  patch: { status?: string; payToId?: string; checkoutUrl?: string },
): Promise<void> {
  if (patch.status !== undefined) {
    await prisma.$executeRaw`UPDATE "wfp_payments" SET "status" = ${patch.status}, "updated_at" = CURRENT_TIMESTAMP WHERE "id" = ${id}`
  }
  if (patch.payToId !== undefined) {
    await prisma.$executeRaw`UPDATE "wfp_payments" SET "pay_to_id" = ${patch.payToId}, "updated_at" = CURRENT_TIMESTAMP WHERE "id" = ${id}`
  }
  if (patch.checkoutUrl !== undefined) {
    await prisma.$executeRaw`UPDATE "wfp_payments" SET "checkout_url" = ${patch.checkoutUrl}, "updated_at" = CURRENT_TIMESTAMP WHERE "id" = ${id}`
  }
}
