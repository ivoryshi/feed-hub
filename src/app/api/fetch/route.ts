import { NextRequest, NextResponse } from 'next/server'
import { fetchSource, fetchAllSources } from '@/lib/fetcher'

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
