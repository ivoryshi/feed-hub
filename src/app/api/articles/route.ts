import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const sourceId = searchParams.get('source_id')
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '20')
  const offset = (page - 1) * limit

  const db = getDb()

  const where = sourceId ? 'WHERE a.source_id = ?' : ''
  const args = sourceId ? [sourceId, limit, offset] : [limit, offset]

  const articles = db.prepare(`
    SELECT a.id, a.title, a.url, a.summary, a.author, a.published_at, a.fetched_at,
           a.audio_url, a.transcription_status,
           s.name as source_name, s.type as source_type
    FROM articles a
    JOIN sources s ON s.id = a.source_id
    ${where}
    ORDER BY COALESCE(a.published_at, a.fetched_at) DESC
    LIMIT ? OFFSET ?
  `).all(...args)

  const total = (db.prepare(`
    SELECT COUNT(*) as n FROM articles a ${where}
  `).get(...(sourceId ? [sourceId] : [])) as { n: number }).n

  return NextResponse.json({ articles, total, page, limit })
}
