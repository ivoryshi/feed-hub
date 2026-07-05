import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export async function GET() {
  const db = getDb()
  const sources = db.prepare(`
    SELECT s.*, COUNT(a.id) as article_count
    FROM sources s
    LEFT JOIN articles a ON a.source_id = s.id
    GROUP BY s.id
    ORDER BY s.created_at DESC
  `).all()
  return NextResponse.json(sources)
}

export async function POST(req: NextRequest) {
  const { name, type, url } = await req.json()

  if (!name || !type || !url) {
    return NextResponse.json({ error: '缺少必填字段' }, { status: 400 })
  }
  if (!['rss', 'wechat', 'podcast', 'obsidian', 'twitter'].includes(type)) {
    return NextResponse.json({ error: 'type 只能是 rss、wechat、podcast、obsidian 或 twitter' }, { status: 400 })
  }

  const db = getDb()
  try {
    const result = db.prepare(
      'INSERT INTO sources (name, type, url) VALUES (?, ?, ?)'
    ).run(name, type, url)
    const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(result.lastInsertRowid)
    return NextResponse.json(source, { status: 201 })
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes('UNIQUE')) {
      return NextResponse.json({ error: '该 URL 已存在' }, { status: 409 })
    }
    throw e
  }
}
