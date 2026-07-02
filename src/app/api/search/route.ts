import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q')?.trim()
  const limit = parseInt(searchParams.get('limit') || '20')

  if (!q) return NextResponse.json({ articles: [], total: 0 })

  const db = getDb()

  const articles = db.prepare(`
    SELECT a.id, a.title, a.url, a.summary, a.author, a.published_at,
           a.audio_url, a.transcription_status,
           s.name as source_name, s.type as source_type,
           snippet(articles_fts, 0, '<mark>', '</mark>', '...', 20) as title_snippet,
           snippet(articles_fts, 1, '<mark>', '</mark>', '...', 40) as summary_snippet
    FROM articles_fts
    JOIN articles a ON a.id = articles_fts.rowid
    JOIN sources s ON s.id = a.source_id
    WHERE articles_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `).all(q, limit)

  return NextResponse.json({ articles, total: articles.length, query: q })
}
