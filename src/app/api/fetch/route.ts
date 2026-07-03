import { NextRequest, NextResponse } from 'next/server'
import { fetchSource, fetchAllSources } from '@/lib/fetcher'

export async function GET() {
  const results = await fetchAllSources()
  const total = results.reduce((s, r) => s + r.inserted, 0)
  return NextResponse.json({ ok: true, total_inserted: total, sources: results })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const sourceId = body?.source_id

  if (sourceId) {
    const result = await fetchSource(Number(sourceId))
    return NextResponse.json(result)
  }

  const results = await fetchAllSources()
  return NextResponse.json(results)
}
