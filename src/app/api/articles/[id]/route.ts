import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const db = getDb()
  const article = db.prepare(`
    SELECT a.id, a.title, a.url, a.summary,
           CASE WHEN s.type = 'podcast' THEN a.content ELSE NULL END as content,
           a.transcription, a.author, a.published_at, a.fetched_at,
           a.audio_url, a.transcription_status,
           s.name as source_name, s.type as source_type,
           m.summary_ai, m.content_type, m.time_horizon, m.signal_type,
           m.sector, m.processed_at,
           m.section_outline, m.golden_quotes, m.word_count, m.reading_minutes,
           (SELECT GROUP_CONCAT(factor_name || ':' || factor_direction)
            FROM article_factors WHERE article_id = a.id) as factors_raw,
           (SELECT GROUP_CONCAT(t.category || ':' || t.name, '||')
            FROM article_tags at JOIN tags t ON t.id = at.tag_id
            WHERE at.article_id = a.id) as tags_raw
    FROM articles a
    JOIN sources s ON s.id = a.source_id
    LEFT JOIN article_meta m ON m.article_id = a.id
    WHERE a.id = ?
  `).get(params.id)

  if (!article) return NextResponse.json({ error: '不存在' }, { status: 404 })
  return NextResponse.json(article)
}
