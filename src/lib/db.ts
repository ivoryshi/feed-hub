import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

const DB_PATH = path.join(process.cwd(), 'data', 'feed-hub.db')

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (_db) return _db

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })
  _db = new Database(DB_PATH)
  _db.pragma('journal_mode = WAL')
  _db.pragma('foreign_keys = ON')

  initSchema(_db)
  migrate(_db)
  return _db
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sources (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      name      TEXT NOT NULL,
      type      TEXT NOT NULL CHECK(type IN ('rss','wechat','podcast')),
      url       TEXT NOT NULL UNIQUE,
      enabled   INTEGER NOT NULL DEFAULT 1,
      last_fetched_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS articles (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id            INTEGER NOT NULL REFERENCES sources(id),
      guid                 TEXT NOT NULL,
      title                TEXT NOT NULL,
      url                  TEXT,
      summary              TEXT,
      content              TEXT,
      author               TEXT,
      published_at         TEXT,
      fetched_at           TEXT NOT NULL DEFAULT (datetime('now')),
      audio_url            TEXT,
      transcription_status TEXT NOT NULL DEFAULT 'none',
      UNIQUE(source_id, guid)
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
      title,
      summary,
      content,
      content=articles,
      content_rowid=id
    );

    CREATE TRIGGER IF NOT EXISTS articles_ai AFTER INSERT ON articles BEGIN
      INSERT INTO articles_fts(rowid, title, summary, content)
      VALUES (new.id, new.title, COALESCE(new.summary,''), COALESCE(new.content,''));
    END;

    CREATE TRIGGER IF NOT EXISTS articles_ad AFTER DELETE ON articles BEGIN
      INSERT INTO articles_fts(articles_fts, rowid, title, summary, content)
      VALUES ('delete', old.id, old.title, COALESCE(old.summary,''), COALESCE(old.content,''));
    END;
  `)
}

// 对已有数据库做字段补丁
function migrate(db: Database.Database) {
  const cols = (db.prepare(`PRAGMA table_info(articles)`).all() as { name: string }[]).map(c => c.name)
  if (!cols.includes('audio_url')) {
    db.exec(`ALTER TABLE articles ADD COLUMN audio_url TEXT`)
  }
  if (!cols.includes('transcription_status')) {
    db.exec(`ALTER TABLE articles ADD COLUMN transcription_status TEXT NOT NULL DEFAULT 'none'`)
  }

  // 允许 sources.type 包含 podcast（旧约束只有 rss/wechat）
  // SQLite 不支持 ALTER CONSTRAINT，靠应用层校验即可，DB 层不再强制
}
