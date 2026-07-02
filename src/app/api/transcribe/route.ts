import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

const API_KEY = process.env.TRANSCRIPTION_API_KEY
const BASE_URL = process.env.TRANSCRIPTION_BASE_URL || 'https://api.moonshot.cn/v1'
const MODEL = process.env.TRANSCRIPTION_MODEL || 'moonshot-v1-8k'

export async function POST(req: NextRequest) {
  const { article_id } = await req.json()
  if (!article_id) return NextResponse.json({ error: '缺少 article_id' }, { status: 400 })
  if (!API_KEY) return NextResponse.json({ error: '未配置 TRANSCRIPTION_API_KEY' }, { status: 500 })

  const db = getDb()
  const article = db.prepare('SELECT * FROM articles WHERE id = ?').get(article_id) as {
    id: number; title: string; audio_url: string | null; transcription_status: string
  } | undefined

  if (!article) return NextResponse.json({ error: '文章不存在' }, { status: 404 })
  if (!article.audio_url) return NextResponse.json({ error: '该文章无音频' }, { status: 400 })
  if (article.transcription_status === 'processing') {
    return NextResponse.json({ error: '正在转写中' }, { status: 409 })
  }

  db.prepare(`UPDATE articles SET transcription_status = 'processing' WHERE id = ?`).run(article_id)

  // 异步执行，立即返回
  transcribeAsync(article_id, article.audio_url, article.title).catch(console.error)

  return NextResponse.json({ ok: true, status: 'processing' })
}

async function transcribeAsync(articleId: number, audioUrl: string, title: string) {
  const db = getDb()
  try {
    // 下载音频
    const audioRes = await fetch(audioUrl)
    if (!audioRes.ok) throw new Error(`下载音频失败: ${audioRes.status}`)
    const audioBuffer = await audioRes.arrayBuffer()

    // 上传到模型服务
    const formData = new FormData()
    const ext = audioUrl.split('.').pop()?.split('?')[0] || 'mp3'
    formData.append('file', new Blob([audioBuffer], { type: 'audio/mpeg' }), `audio.${ext}`)
    formData.append('model', MODEL)
    formData.append('language', 'zh')
    formData.append('prompt', `这是一个播客节目音频，标题：${title}`)

    const transcribeRes = await fetch(`${BASE_URL}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_KEY}` },
      body: formData,
    })

    if (!transcribeRes.ok) {
      const err = await transcribeRes.text()
      throw new Error(`转写 API 错误: ${transcribeRes.status} ${err}`)
    }

    const result = await transcribeRes.json() as { text: string }
    const transcript = result.text

    db.prepare(`
      UPDATE articles SET content = ?, transcription_status = 'done' WHERE id = ?
    `).run(transcript, articleId)

    // 更新 FTS 索引
    db.prepare(`
      INSERT INTO articles_fts(articles_fts, rowid, title, summary, content)
      VALUES ('delete', ?, '', '', '')
    `).run(articleId)
    const updated = db.prepare('SELECT title, summary, content FROM articles WHERE id = ?').get(articleId) as {
      title: string; summary: string | null; content: string | null
    }
    db.prepare(`
      INSERT INTO articles_fts(rowid, title, summary, content) VALUES (?, ?, ?, ?)
    `).run(articleId, updated.title, updated.summary || '', updated.content || '')

  } catch (e) {
    db.prepare(`UPDATE articles SET transcription_status = 'error' WHERE id = ?`).run(articleId)
    console.error('转写失败:', e)
  }
}
