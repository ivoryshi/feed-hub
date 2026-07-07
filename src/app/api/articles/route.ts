import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const sourceId = searchParams.get('source_id')
  const tagId = searchParams.get('tag_id')
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '20')
  const offset = (page - 1) * limit

  const db = getDb()

  const conditions: string[] = []
  const args: unknown[] = []

  if (sourceId) {
    conditions.push('a.source_id = ?')
    args.push(sourceId)
  }
  if (tagId) {
    conditions.push('EXISTS (SELECT 1 FROM article_tags at WHERE at.article_id = a.id AND at.tag_id = ?)')
    args.push(tagId)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const articles = db.prepare(`
    SELECT a.id, a.title, a.url, a.summary,
           CASE WHEN s.type = 'podcast' THEN a.content ELSE NULL END as content,
           a.transcription, a.author, a.published_at, a.fetched_at,
           a.audio_url, a.transcription_status,
           s.name as source_name, s.type as source_type,
           m.summary_ai, m.content_type, m.time_horizon, m.signal_type,
           m.sector, m.processed_at,
           (SELECT GROUP_CONCAT(factor_name || ':' || factor_direction)
            FROM article_factors WHERE article_id = a.id) as factors_raw
    FROM articles a
    JOIN sources s ON s.id = a.source_id
    LEFT JOIN article_meta m ON m.article_id = a.id
    ${where}
    ORDER BY COALESCE(a.published_at, a.fetched_at) DESC
    LIMIT ? OFFSET ?
  `).all(...args, limit, offset)

  const total = (db.prepare(`
    SELECT COUNT(*) as n FROM articles a ${where}
  `).get(...args) as { n: number }).n

  return NextResponse.json({ articles, total, page, limit })
}
