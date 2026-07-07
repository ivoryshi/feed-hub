import { NextRequest, NextResponse } from 'next/server'
import { getDb, getSetting } from '@/lib/db'

// 允许前端读写的配置 key 白名单
const CONFIG_KEYS = [
  'AI_VENDOR',
  'AI_API_KEY',
  'AI_BASE_URL',
  'AI_MODEL',
  'DASHSCOPE_API_KEY',
  'GDRIVE_CLIPPINGS_FOLDER_ID',
  'GOOGLE_SERVICE_ACCOUNT_JSON',
]

export async function GET() {
  const result: Record<string, string> = {}
  const plainKeys = new Set(['AI_VENDOR', 'AI_BASE_URL', 'AI_MODEL', 'GDRIVE_CLIPPINGS_FOLDER_ID'])
  for (const key of CONFIG_KEYS) {
    const val = getSetting(key, '')
    if (!val) { result[key] = ''; continue }
    if (plainKeys.has(key)) {
      result[key] = val
    } else if (val.length > 8) {
      result[key] = '••••••••' + val.slice(-8)
    } else {
      result[key] = '••••'
    }
  }
  return NextResponse.json(result)
}

export async function POST(req: NextRequest) {
  const body = await req.json() as Record<string, string>
  const db = getDb()

  const upsert = db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `)

  const updated: string[] = []
  for (const key of CONFIG_KEYS) {
    const val = body[key]
    // 跳过空值和脱敏占位符（用户没有修改的字段）
    if (!val || val.startsWith('••••')) continue
    upsert.run(key, val)
    updated.push(key)
  }

  return NextResponse.json({ ok: true, updated })
}
