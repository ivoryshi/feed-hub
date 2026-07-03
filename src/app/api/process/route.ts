import { NextRequest, NextResponse } from 'next/server'
import { processArticle } from '@/lib/processor'

export async function POST(req: NextRequest) {
  const { article_id } = await req.json()
  if (!article_id) return NextResponse.json({ error: 'article_id required' }, { status: 400 })

  const result = await processArticle(Number(article_id))
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.error === 'not found' ? 404 : 502 })

  return NextResponse.json({ ok: true, tokens: result.tokens })
}
