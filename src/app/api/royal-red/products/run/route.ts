import { NextRequest, NextResponse } from 'next/server'
import { PRODUCTS, runProduct } from '@/server/royal-red/products'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// GET /api/royal-red/products/run — list available products
export async function GET() {
  return NextResponse.json({
    products: Object.values(PRODUCTS).map((p) => ({ id: p.id, label: p.label, defaultPolicy: p.defaultPolicy })),
  })
}

// POST /api/royal-red/products/run — run one product through the router
// body: { product: 'flashcards'|'deck'|'resume', input: {...} }
export async function POST(req: NextRequest) {
  let body: { product?: string; input?: Record<string, unknown> } | null = null
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }
  if (!body?.product || !PRODUCTS[body.product]) {
    return NextResponse.json({ error: `product must be one of: ${Object.keys(PRODUCTS).join(', ')}` }, { status: 400 })
  }
  try {
    const receipt = await runProduct(body.product, body.input ?? {})
    return NextResponse.json(receipt, { status: receipt.verification.ok ? 200 : 422 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'product run failed' }, { status: 500 })
  }
}
