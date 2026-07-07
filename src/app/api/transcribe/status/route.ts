import { NextRequest, NextResponse } from 'next/server'
import { getDb, getSetting } from '@/lib/db'

export async function GET(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: '缺少 id' }, { status: 400 })

  const db = getDb()
  const article = db.prepare('SELECT id, transcription_status, transcription_task_id, transcription FROM articles WHERE id = ?').get(id) as {
    id: number; transcription_status: string; transcription_task_id: string | null; transcription: string | null
  } | undefined

  if (!article) return NextResponse.json({ error: '文章不存在' }, { status: 404 })

  // 已完成或无任务直接返回
  if (article.transcription_status === 'done' || article.transcription_status === 'error' || !article.transcription_task_id) {
    return NextResponse.json({ status: article.transcription_status, transcription: article.transcription })
  }

  const API_KEY = getSetting('DASHSCOPE_API_KEY')
  if (!API_KEY) return NextResponse.json({ status: article.transcription_status })

  // 查询 DashScope 任务状态
  const res = await fetch(`https://dashscope.aliyuncs.com/api/v1/tasks/${article.transcription_task_id}`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  })

  if (!res.ok) return NextResponse.json({ status: article.transcription_status })

  const data = await res.json() as {
    output: {
      task_status: string
      results?: Array<{ transcription_url: string }>
    }
  }

  const taskStatus = data.output?.task_status

  if (taskStatus === 'Succeeded') {
    const transcriptionUrl = data.output?.results?.[0]?.transcription_url
    if (!transcriptionUrl) {
      db.prepare(`UPDATE articles SET transcription_status = 'error' WHERE id = ?`).run(article.id)
      return NextResponse.json({ status: 'error' })
    }

    // 拉取转写结果 JSON
    const txtRes = await fetch(transcriptionUrl)
    const result = await txtRes.json() as { transcripts?: Array<{ text: string }> }
    const text = result.transcripts?.map((t: { text: string }) => t.text).join('\n') || ''

    db.prepare(`UPDATE articles SET transcription = ?, transcription_status = 'done', transcription_task_id = NULL WHERE id = ?`).run(text, article.id)
    return NextResponse.json({ status: 'done', transcription: text })
  }

  if (taskStatus === 'Failed') {
    db.prepare(`UPDATE articles SET transcription_status = 'error' WHERE id = ?`).run(article.id)
    return NextResponse.json({ status: 'error' })
  }

  return NextResponse.json({ status: 'processing' })
}
