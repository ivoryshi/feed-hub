import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export async function GET() {
  const db = getDb()
  const drafts = db.prepare(`
    SELECT id, title, substr(content, 1, 100) as preview, created_at, updated_at
    FROM drafts ORDER BY updated_at DESC
  `).all()
  return NextResponse.json(drafts)
}

export async function POST(req: NextRequest) {
  const { title, content } = await req.json()
  const db = getDb()
  const result = db.prepare(`
    INSERT INTO drafts (title, content) VALUES (?, ?)
  `).run(title || '无标题', content || '')
  const draft = db.prepare('SELECT * FROM drafts WHERE id = ?').get(result.lastInsertRowid)
  return NextResponse.json(draft, { status: 201 })
}
