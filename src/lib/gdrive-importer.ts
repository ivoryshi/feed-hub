import { google } from 'googleapis'
import { getDb, getSetting } from './db'

// 复用 obsidian-importer 的解析逻辑
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
    if (inArray && line.match(/^\s+-\s+/)) {
      arrayValues.push(line.replace(/^\s+-\s+/, '').trim().replace(/^"|"$/g, ''))
      continue
    }
    if (inArray && !line.match(/^\s+-\s+/)) {
      meta[currentKey] = arrayValues.slice()
      arrayValues.length = 0
      inArray = false
    }
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue
    const key = line.slice(0, colonIdx).trim()
    const rest = line.slice(colonIdx + 1).trim()
    if (rest === '') { currentKey = key; inArray = true; continue }
    meta[key] = rest.replace(/^"|"$/g, '')
  }
  if (inArray && currentKey) meta[currentKey] = arrayValues.slice()
  return { meta, body }
}

function parseAuthor(authors: unknown): string | null {
  if (!authors) return null
  const list = Array.isArray(authors) ? authors : [authors]
  return list.map((a: unknown) => String(a).replace(/^\[\[|\]\]$/g, '').trim()).filter(Boolean).join(', ') || null
}

function getAuthClient() {
  const credJson = getSetting('GOOGLE_SERVICE_ACCOUNT_JSON')
  if (!credJson) return null
  try {
    const creds = JSON.parse(credJson)
    return new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    })
  } catch {
    return null
  }
}

export async function importFromGoogleDrive(): Promise<{ inserted: number; skipped: number; errors: string[] }> {
  const folderId = getSetting('GDRIVE_CLIPPINGS_FOLDER_ID')
  if (!folderId) return { inserted: 0, skipped: 0, errors: ['GDRIVE_CLIPPINGS_FOLDER_ID not set'] }

  const auth = getAuthClient()
  if (!auth) return { inserted: 0, skipped: 0, errors: ['GOOGLE_SERVICE_ACCOUNT_JSON not set or invalid'] }

  const drive = google.drive({ version: 'v3', auth })
  const db = getDb()

  let source = db.prepare("SELECT id FROM sources WHERE type = 'obsidian' LIMIT 1").get() as { id: number } | undefined
  if (!source) {
    const result = db.prepare(`INSERT INTO sources (name, type, url, enabled) VALUES ('Obsidian Clippings', 'obsidian', 'gdrive', 1)`).run()
    source = { id: Number(result.lastInsertRowid) }
  }
  const sourceId = source.id

  // 列出文件夹内所有 .md 文件
  let files: { id: string; name: string }[] = []
  try {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and name contains '.md' and trashed = false`,
      fields: 'files(id, name)',
      pageSize: 500,
    })
    files = (res.data.files || []) as { id: string; name: string }[]
  } catch (e) {
    return { inserted: 0, skipped: 0, errors: [`Drive list error: ${String(e)}`] }
  }

  db.pragma('foreign_keys = OFF')
  const insert = db.prepare(`
    INSERT OR IGNORE INTO articles (source_id, guid, title, url, summary, content, author, published_at, fetched_at)
    VALUES (@source_id, @guid, @title, @url, @summary, @content, @author, @published_at, @fetched_at)
  `)

  let inserted = 0, skipped = 0
  const errors: string[] = []
  const now = new Date().toISOString()

  for (const file of files) {
    try {
      const res = await drive.files.get({ fileId: file.id!, alt: 'media' }, { responseType: 'text' })
      const raw = res.data as string
      const { meta, body } = parseFrontmatter(raw)

      const tags = Array.isArray(meta.tags) ? meta.tags as string[] : []
      if (!tags.some(t => String(t).toLowerCase() === 'clippings')) { skipped++; continue }

      const title = String(meta.title || file.name!.replace('.md', '')).trim()
      const url = meta.source ? String(meta.source).trim() : null
      const author = parseAuthor(meta.author)
      const summary = meta.description ? String(meta.description).trim() : null
      const rawDate = meta.published || meta.created
      const published_at = rawDate
        ? (() => { try { return new Date(String(rawDate)).toISOString() } catch { return null } })()
        : null

      const result = insert.run({ source_id: sourceId, guid: file.name!, title, url, summary, content: body, author, published_at, fetched_at: now })
      if (result.changes > 0) inserted++
      else skipped++
    } catch (e) {
      errors.push(`${file.name}: ${String(e)}`)
    }
  }

  db.pragma('foreign_keys = ON')
  db.prepare(`UPDATE sources SET last_fetched_at = datetime('now') WHERE id = ?`).run(sourceId)
  return { inserted, skipped, errors }
}
