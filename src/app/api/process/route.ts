import { NextRequest, NextResponse } from 'next/server'
import { processArticle } from '@/lib/processor'

export async function POST(req: NextRequest) {
  const { article_id } = await req.json()
  if (!article_id) return NextResponse.json({ error: 'article_id required' }, { status: 400 })

  try {
    const result = await processArticle(Number(article_id))
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 })
    return NextResponse.json({ ok: true, tokens: result.tokens })
  } catch (e) {
    console.error('[process] error:', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
