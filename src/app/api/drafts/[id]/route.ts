import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const db = getDb()
  const draft = db.prepare('SELECT * FROM drafts WHERE id = ?').get(params.id)
  if (!draft) return NextResponse.json({ error: '不存在' }, { status: 404 })
  return NextResponse.json(draft)
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const { title, content } = await req.json()
  const db = getDb()
  db.prepare(`
    UPDATE drafts SET title = ?, content = ?, updated_at = datetime('now') WHERE id = ?
  `).run(title, content, params.id)
  const draft = db.prepare('SELECT * FROM drafts WHERE id = ?').get(params.id)
  return NextResponse.json(draft)
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const db = getDb()
  db.prepare('DELETE FROM drafts WHERE id = ?').run(params.id)
  return NextResponse.json({ ok: true })
}
