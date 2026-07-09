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
      type      TEXT NOT NULL CHECK(type IN ('rss','wechat','podcast','obsidian','twitter')),
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
  // 扩展 sources.type 支持 obsidian（SQLite 不能 ALTER CHECK，重建表）
  const srcCols = (db.prepare(`PRAGMA table_info(sources)`).all() as { name: string }[]).map(c => c.name)
  const needRebuild = !srcCols.includes('_type_migrated')
  if (needRebuild) {
    const typeCheck = (db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='sources'`).get() as { sql: string } | undefined)?.sql || ''
    if (!typeCheck.includes('twitter')) {
      db.exec(`
        ALTER TABLE sources RENAME TO sources_old;
        CREATE TABLE sources (
          id        INTEGER PRIMARY KEY AUTOINCREMENT,
          name      TEXT NOT NULL,
          type      TEXT NOT NULL CHECK(type IN ('rss','wechat','podcast','obsidian','twitter')),
          url       TEXT NOT NULL UNIQUE,
          enabled   INTEGER NOT NULL DEFAULT 1,
          last_fetched_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO sources SELECT * FROM sources_old;
        DROP TABLE sources_old;
      `)
    }
  }

  // articles.title NOT NULL → NULL（支持 Twitter 无标题推文）
  // SQLite 不能 ALTER COLUMN，检查当前定义是否需要重建
  // 修复知识库扩展表的外键引用（历史迁移残留 articles_old2）
  const brokenTables = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND sql LIKE '%articles_old%'`).all() as { name: string }[]).map(r => r.name)
  if (brokenTables.length > 0) {
    db.pragma('foreign_keys = OFF')
    for (const tbl of brokenTables) {
      const oldSql = (db.prepare(`SELECT sql FROM sqlite_master WHERE name=?`).get(tbl) as { sql: string }).sql
      const newSql = oldSql.replace(/REFERENCES "articles_old\d*"\(id\)/g, 'REFERENCES articles(id)')
                           .replace(`CREATE TABLE ${tbl}`, `CREATE TABLE ${tbl}_fixed`)
      db.exec(`ALTER TABLE ${tbl} RENAME TO ${tbl}_bak; ${newSql}; INSERT INTO ${tbl}_fixed SELECT * FROM ${tbl}_bak; DROP TABLE ${tbl}_bak; ALTER TABLE ${tbl}_fixed RENAME TO ${tbl};`)
    }
    db.pragma('foreign_keys = ON')
  }

  const articleSql = (db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='articles'`).get() as { sql: string } | undefined)?.sql || ''
  if (articleSql.includes('title                TEXT NOT NULL') || articleSql.includes('sources_old')) {
    db.pragma('foreign_keys = OFF')
    db.exec(`
      ALTER TABLE articles RENAME TO articles_old;
      CREATE TABLE articles (
        id                   INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id            INTEGER NOT NULL REFERENCES sources(id),
        guid                 TEXT NOT NULL,
        title                TEXT,
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
      INSERT INTO articles SELECT * FROM articles_old;
      DROP TABLE articles_old;
    `)
    db.pragma('foreign_keys = ON')
  }

  const cols = (db.prepare(`PRAGMA table_info(articles)`).all() as { name: string }[]).map(c => c.name)
  if (!cols.includes('audio_url')) {
    db.exec(`ALTER TABLE articles ADD COLUMN audio_url TEXT`)
  }
  if (!cols.includes('transcription_status')) {
    db.exec(`ALTER TABLE articles ADD COLUMN transcription_status TEXT NOT NULL DEFAULT 'none'`)
  }
  if (!cols.includes('transcription')) {
    db.exec(`ALTER TABLE articles ADD COLUMN transcription TEXT`)
  }
  if (!cols.includes('transcription_task_id')) {
    db.exec(`ALTER TABLE articles ADD COLUMN transcription_task_id TEXT`)
  }

  // 草稿表
  db.exec(`
    CREATE TABLE IF NOT EXISTS drafts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      title      TEXT NOT NULL DEFAULT '无标题',
      content    TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  // 配置表（优先级高于 .env.local）
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  // 知识库索引扩展表（幂等建表）
  db.exec(`
    -- 市场/地区参考表
    CREATE TABLE IF NOT EXISTS markets (
      code       TEXT PRIMARY KEY,  -- CN_A / CN_HK / US / EU / JP / SG
      name       TEXT NOT NULL,
      currency   TEXT NOT NULL,     -- CNY / HKD / USD / EUR / JPY / SGD
      regulatory TEXT              -- CSRC / SFC / SEC / ESMA / FSA / MAS
    );

    INSERT OR IGNORE INTO markets VALUES
      ('CN_A',  'A股',    'CNY', 'CSRC'),
      ('CN_HK', '港股',   'HKD', 'SFC'),
      ('US',    '美股',   'USD', 'SEC'),
      ('EU',    '欧洲',   'EUR', 'ESMA'),
      ('JP',    '日本',   'JPY', 'FSA'),
      ('SG',    '新加坡', 'SGD', 'MAS');

    -- 文章与市场的多对多关系
    CREATE TABLE IF NOT EXISTS article_markets (
      article_id  INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      market_code TEXT    NOT NULL REFERENCES markets(code),
      is_primary  INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (article_id, market_code)
    );

    -- 文章元数据（AI 处理结果 + 分类维度）
    CREATE TABLE IF NOT EXISTS article_meta (
      article_id     INTEGER PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
      -- AI 处理结果
      summary_ai     TEXT,           -- AI 生成的摘要
      key_points     TEXT,           -- JSON array of strings
      language       TEXT DEFAULT 'zh',
      -- 分类维度
      content_type   TEXT CHECK(content_type IN (
                       'news','analysis','education','opinion',
                       'data_report','strategy_note'
                     )),
      time_horizon   TEXT CHECK(time_horizon IN ('short','medium','long','timeless')),
      signal_type    TEXT CHECK(signal_type IN ('bullish','bearish','neutral')),
      sector         TEXT,           -- technology / finance / energy / consumer / healthcare / macro
      institution    TEXT,           -- 作者所属机构
      platform       TEXT,           -- wechat / substack / podcast / rss
      -- RAG 向量
      embedding      BLOB,
      -- 时效性：0-1，content_type=education 固定为 1，news 随时间衰减
      freshness_score REAL DEFAULT 1.0,
      processed_at   TEXT
    );

    -- 标签系统
    CREATE TABLE IF NOT EXISTS tags (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL UNIQUE,
      category   TEXT,  -- topic / factor / sector / strategy / other
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS article_tags (
      article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      tag_id     INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      source     TEXT NOT NULL DEFAULT 'ai'  CHECK(source IN ('ai','manual')),
      confidence REAL DEFAULT 1.0,
      PRIMARY KEY (article_id, tag_id)
    );

    -- 引用（合规性）
    CREATE TABLE IF NOT EXISTS article_citations (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      article_id      INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      citation_type   TEXT NOT NULL CHECK(citation_type IN ('external','internal')),
      citation_text   TEXT,
      citation_url    TEXT,
      citation_date   TEXT,
      ref_article_id  INTEGER REFERENCES articles(id)  -- internal 反链
    );

    -- 资产提及（合规 + 适当性）
    CREATE TABLE IF NOT EXISTS article_assets (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      article_id       INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      asset_type       TEXT NOT NULL CHECK(asset_type IN (
                         'stock','bond','fund','etf','futures',
                         'option','crypto','commodity','forex','index','other'
                       )),
      asset_code       TEXT,          -- 000001.SZ / AAPL / BTC-USD
      asset_name       TEXT,
      market_code      TEXT REFERENCES markets(code),
      sentiment        TEXT CHECK(sentiment IN ('bullish','bearish','neutral')),
      is_visible       INTEGER NOT NULL DEFAULT 1,  -- 0=隐藏（合规屏蔽）
      confidence       REAL DEFAULT 0.8,            -- 模型识别置信度
      verified         INTEGER NOT NULL DEFAULT 0,  -- 人工核验
      suitability_level TEXT CHECK(suitability_level IN ('R1','R2','R3','R4','R5'))
    );

    -- 因子标注（因子投资专用）
    CREATE TABLE IF NOT EXISTS article_factors (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      article_id       INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      factor_name      TEXT NOT NULL CHECK(factor_name IN (
                         'value','momentum','quality','size',
                         'low_vol','macro','carry','growth','other'
                       )),
      factor_direction TEXT CHECK(factor_direction IN ('positive','negative','neutral')),
      confidence       REAL DEFAULT 0.8
    );

    -- 文章关联关系
    CREATE TABLE IF NOT EXISTS article_relations (
      article_id         INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      related_article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      relation_type      TEXT NOT NULL CHECK(relation_type IN (
                           'same_topic','same_asset','same_author',
                           'same_factor','confirms','contradicts'
                         )),
      score              REAL DEFAULT 1.0,
      PRIMARY KEY (article_id, related_article_id, relation_type)
    );

    -- 常用索引（幂等）
    CREATE INDEX IF NOT EXISTS idx_article_meta_content_type ON article_meta(content_type);
    CREATE INDEX IF NOT EXISTS idx_article_meta_time_horizon ON article_meta(time_horizon);
    CREATE INDEX IF NOT EXISTS idx_article_factors_name      ON article_factors(factor_name);
    CREATE INDEX IF NOT EXISTS idx_article_assets_code       ON article_assets(asset_code);
    CREATE INDEX IF NOT EXISTS idx_article_tags_tag          ON article_tags(tag_id);
  `)

  // article_meta 深度总结扩展列（skill：自媒体内容总结及打标）
  const metaCols = (db.prepare(`PRAGMA table_info(article_meta)`).all() as { name: string }[]).map(c => c.name)
  if (!metaCols.includes('section_outline')) db.exec(`ALTER TABLE article_meta ADD COLUMN section_outline TEXT`)
  if (!metaCols.includes('golden_quotes'))   db.exec(`ALTER TABLE article_meta ADD COLUMN golden_quotes TEXT`)
  if (!metaCols.includes('word_count'))      db.exec(`ALTER TABLE article_meta ADD COLUMN word_count INTEGER`)
  if (!metaCols.includes('reading_minutes')) db.exec(`ALTER TABLE article_meta ADD COLUMN reading_minutes INTEGER`)
}

// 读取配置：DB 优先，fallback 到 env
export function getSetting(key: string, fallback?: string): string | undefined {
  const db = getDb()
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? process.env[key] ?? fallback
}
