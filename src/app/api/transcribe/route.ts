import { NextRequest, NextResponse } from 'next/server'
import { getDb, getSetting } from '@/lib/db'

const DASHSCOPE_URL = 'https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription'

export async function POST(req: NextRequest) {
  const { article_id } = await req.json()
  if (!article_id) return NextResponse.json({ error: '缺少 article_id' }, { status: 400 })
  const API_KEY = getSetting('DASHSCOPE_API_KEY')
  if (!API_KEY) return NextResponse.json({ error: '未配置 DASHSCOPE_API_KEY' }, { status: 500 })

  const db = getDb()
  const article = db.prepare('SELECT id, title, audio_url, transcription_status FROM articles WHERE id = ?').get(article_id) as {
    id: number; title: string; audio_url: string | null; transcription_status: string
  } | undefined

  if (!article) return NextResponse.json({ error: '文章不存在' }, { status: 404 })
  if (!article.audio_url) return NextResponse.json({ error: '该文章无音频' }, { status: 400 })
  if (article.transcription_status === 'processing') return NextResponse.json({ error: '正在转写中' }, { status: 409 })

  // 提交 DashScope 异步转写任务
  const res = await fetch(DASHSCOPE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      'X-DashScope-Async': 'enable',
    },
    body: JSON.stringify({
      model: 'paraformer-v2',
      input: { file_urls: [article.audio_url] },
      parameters: { language_hints: ['zh'] },
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    return NextResponse.json({ error: `DashScope 提交失败: ${res.status} ${err}` }, { status: 502 })
  }

  const data = await res.json() as { output: { task_id: string; task_status: string } }
  const taskId = data.output?.task_id
  if (!taskId) return NextResponse.json({ error: '未获取到 task_id' }, { status: 502 })

  db.prepare(`UPDATE articles SET transcription_status = 'processing', transcription_task_id = ? WHERE id = ?`).run(taskId, article_id)

  return NextResponse.json({ ok: true, task_id: taskId })
}
