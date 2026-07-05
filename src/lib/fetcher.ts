import Parser from 'rss-parser'
import { getDb } from './db'

type CustomItem = {
  'content:encoded'?: string
  enclosure?: { url?: string; type?: string }
}

const parser = new Parser<Record<string, unknown>, CustomItem>({
  customFields: {
    item: [['enclosure', 'enclosure', { keepArray: false }], 'content:encoded'],
  },
})

export async function fetchSource(sourceId: number) {
  const db = getDb()
  const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(sourceId) as {
    id: number; name: string; url: string; type: string
  } | undefined

  if (!source) throw new Error(`Source ${sourceId} not found`)

  const feed = await parser.parseURL(source.url)

  const insert = db.prepare(`
    INSERT OR IGNORE INTO articles
      (source_id, guid, title, url, summary, content, author, published_at, audio_url)
    VALUES
      (@source_id, @guid, @title, @url, @summary, @content, @author, @published_at, @audio_url)
  `)

  let inserted = 0
  const newIds: number[] = []
  const insertMany = db.transaction((items: Parameters<typeof insert>[0][]) => {
    for (const item of items) {
      const result = insert.run(item)
      if (result.changes > 0) {
        inserted++
        newIds.push(result.lastInsertRowid as number)
      }
    }
  })

  const items = (feed.items || []).slice(0, 100).map(item => {
    const audioUrl = item.enclosure?.url && item.enclosure.type?.startsWith('audio')
      ? item.enclosure.url
      : null

    // 统一转 ISO 8601，避免 RSS RFC-822 与 WeChat ISO 混排序错乱
    const rawDate = item.isoDate || item.pubDate || null
    const published_at = rawDate ? (() => {
      try { return new Date(rawDate).toISOString() } catch { return rawDate }
    })() : null

    // Twitter/X 推文无标题，用内容前 60 字兜底
    const rawTitle = item.title?.trim()
    const contentText = item.contentSnippet || item.summary || item['content:encoded'] || ''
    const title = rawTitle || contentText.replace(/<[^>]+>/g, '').slice(0, 60) || null

    return {
      source_id: source.id,
      guid: item.guid || item.link || item.title || String(Date.now()),
      title,
      url: item.link || null,
      summary: item.contentSnippet || item.summary || null,
      content: item['content:encoded'] || item.content || null,
      author: item.creator || item.author || null,
      published_at,
      audio_url: audioUrl,
    }
  })

  insertMany(items)
  db.prepare(`UPDATE sources SET last_fetched_at = datetime('now') WHERE id = ?`).run(sourceId)

  return { inserted, total: items.length, newIds }
}

export async function fetchAllSources() {
  const db = getDb()
  const sources = db.prepare('SELECT id FROM sources WHERE enabled = 1').all() as { id: number }[]

  const results = []
  for (const { id } of sources) {
    try {
      const r = await fetchSource(id)
      results.push({ id, ...r, error: null })
    } catch (e) {
      results.push({ id, inserted: 0, total: 0, error: String(e) })
    }
  }
  return results
}
