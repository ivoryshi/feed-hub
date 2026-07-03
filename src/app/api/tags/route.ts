import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export async function GET() {
  const db = getDb()

  const tags = db.prepare(`
    SELECT t.id, t.name, t.category, COUNT(at.article_id) as count
    FROM tags t
    JOIN article_tags at ON at.tag_id = t.id
    GROUP BY t.id
    ORDER BY count DESC, t.name ASC
  `).all()

  return NextResponse.json(tags)
}
