import { NextRequest, NextResponse } from 'next/server'
import { fetchSource, fetchAllSources } from '@/lib/fetcher'
import { processArticles } from '@/lib/processor'
import { importObsidianClippings } from '@/lib/obsidian-importer'

// GET — 每日 cron 调用：抓取 + Obsidian 导入 + 自动 AI 处理新文章
export async function GET() {
  // 1. RSS/WeChat/Podcast 抓取
  const fetchResults = await fetchAllSources()
  const totalInserted = fetchResults.reduce((s, r) => s + r.inserted, 0)
  const newIds = fetchResults.flatMap(r => r.newIds ?? [])

  // 2. Obsidian Clippings 导入
  const obsidian = await importObsidianClippings()

  let processStats = { processed: 0, failed: 0, total_tokens: 0, errors: [] as { id: number; error: string }[] }
  if (newIds.length > 0 || obsidian.inserted > 0) {
    processStats = await processArticles(newIds)
  }

  return NextResponse.json({
    ok: true,
    fetch: { total_inserted: totalInserted, sources: fetchResults.length },
    obsidian: { inserted: obsidian.inserted, skipped: obsidian.skipped },
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
