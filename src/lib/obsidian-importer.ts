import fs from 'fs'
import path from 'path'
import { getDb } from './db'

const VAULT_CLIPPINGS = path.join(
  process.env.HOME || '/Users/samshi',
  'Desktop/My Vault/Clippings'
)

// 解析 YAML frontmatter（简单实现，不引入额外依赖）
function parseFrontmatter(raw: string): { meta: Record<string, unknown>; body: string } {
  if (!raw.startsWith('---')) return { meta: {}, body: raw }

  const end = raw.indexOf('\n---', 4)
  if (end === -1) return { meta: {}, body: raw }

  const yamlBlock = raw.slice(4, end).trim()
  const body = raw.slice(end + 4).trim()
  const meta: Record<string, unknown> = {}

  let currentKey = ''
  let inArray = false
  const arrayValues: string[] = []

  for (const line of yamlBlock.split('\n')) {
    // 数组项
    if (inArray && line.match(/^\s+-\s+/)) {
      const val = line.replace(/^\s+-\s+/, '').trim().replace(/^"|"$/g, '')
      arrayValues.push(val)
      continue
    }
    // 结束数组
    if (inArray && !line.match(/^\s+-\s+/)) {
      meta[currentKey] = arrayValues.slice()
      arrayValues.length = 0
      inArray = false
    }

    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue

    const key = line.slice(0, colonIdx).trim()
    const rest = line.slice(colonIdx + 1).trim()

    if (rest === '') {
      currentKey = key
      inArray = true
      continue
    }

    meta[key] = rest.replace(/^"|"$/g, '')
  }

  if (inArray && currentKey) meta[currentKey] = arrayValues.slice()

  return { meta, body }
}

// [[肖小跑]] → 肖小跑
function parseAuthor(authors: unknown): string | null {
  if (!authors) return null
  const list = Array.isArray(authors) ? authors : [authors]
  return list
    .map((a: unknown) => String(a).replace(/^\[\[|\]\]$/g, '').trim())
    .filter(Boolean)
    .join(', ') || null
}

export async function importObsidianClippings(): Promise<{ inserted: number; skipped: number; errors: string[] }> {
  const db = getDb()

  // 确保有 obsidian 类型的 source
  let source = db.prepare("SELECT id FROM sources WHERE type = 'obsidian' LIMIT 1").get() as { id: number } | undefined
  if (!source) {
    const result = db.prepare(`
      INSERT INTO sources (name, type, url, enabled)
      VALUES ('Obsidian Clippings', 'obsidian', ?, 1)
    `).run(VAULT_CLIPPINGS)
    source = { id: Number(result.lastInsertRowid) }
  }

  const sourceId = source.id

  let files: string[]
  try {
    files = fs.readdirSync(VAULT_CLIPPINGS).filter(f => f.endsWith('.md'))
  } catch {
    return { inserted: 0, skipped: 0, errors: [`Cannot read vault: ${VAULT_CLIPPINGS}`] }
  }

  // 重建 sources 表后外键索引可能失效，临时关闭后恢复
  db.pragma('foreign_keys = OFF')

  const now = new Date().toISOString()
  const insert = db.prepare(`
    INSERT OR IGNORE INTO articles
      (source_id, guid, title, url, summary, content, author, published_at, fetched_at)
    VALUES
      (@source_id, @guid, @title, @url, @summary, @content, @author, @published_at, @fetched_at)
  `)

  let inserted = 0
  let skipped = 0
  const errors: string[] = []

  for (const filename of files) {
    const filepath = path.join(VAULT_CLIPPINGS, filename)
    try {
      const raw = fs.readFileSync(filepath, 'utf-8')
      const { meta, body } = parseFrontmatter(raw)

      // 必须含 clippings tag
      const tags = Array.isArray(meta.tags) ? meta.tags as string[] : []
      if (!tags.some(t => String(t).toLowerCase() === 'clippings')) {
        skipped++
        continue
      }

      const title = String(meta.title || filename.replace('.md', '')).trim()
      const url = meta.source ? String(meta.source).trim() : null
      const author = parseAuthor(meta.author)
      const summary = meta.description ? String(meta.description).trim() : null

      const rawDate = meta.published || meta.created
      const published_at = rawDate
        ? (() => { try { return new Date(String(rawDate)).toISOString() } catch { return null } })()
        : null

      // guid 用文件名，稳定不变
      const guid = filename

      const result = insert.run({
        source_id: sourceId,
        guid,
        title,
        url,
        summary,
        content: body,
        author,
        published_at,
        fetched_at: now,
      })

      if (result.changes > 0) inserted++
      else skipped++
    } catch (e) {
      errors.push(`${filename}: ${String(e)}`)
    }
  }

  db.pragma('foreign_keys = ON')
  db.prepare(`UPDATE sources SET last_fetched_at = datetime('now') WHERE id = ?`).run(sourceId)

  return { inserted, skipped, errors }
}
