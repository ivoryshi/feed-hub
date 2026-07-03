import { NextRequest, NextResponse } from 'next/server'
import { fetchSource, fetchAllSources } from '@/lib/fetcher'
import { processArticles } from '@/lib/processor'

// GET — 每日 cron 调用：抓取 + 自动 AI 处理新文章
export async function GET() {
  const fetchResults = await fetchAllSources()
  const totalInserted = fetchResults.reduce((s, r) => s + r.inserted, 0)

  // 收集所有新入库的 article id
  const newIds = fetchResults.flatMap(r => r.newIds ?? [])

  let processStats = { processed: 0, failed: 0, total_tokens: 0, errors: [] as { id: number; error: string }[] }
  if (newIds.length > 0) {
    processStats = await processArticles(newIds)
  }

  return NextResponse.json({
    ok: true,
    fetch: { total_inserted: totalInserted, sources: fetchResults.length },
    process: processStats,
  })
}

// POST — 手动触发，只抓取不自动处理（保持原有行为）
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
