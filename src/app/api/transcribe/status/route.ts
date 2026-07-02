import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export async function GET(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: '缺少 id' }, { status: 400 })

  const db = getDb()
  const row = db.prepare('SELECT transcription_status, content FROM articles WHERE id = ?').get(id) as {
    transcription_status: string; content: string | null
  } | undefined

  if (!row) return NextResponse.json({ error: '不存在' }, { status: 404 })
  return NextResponse.json({ status: row.transcription_status, has_content: !!row.content })
}
