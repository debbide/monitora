import initSqlJs, { Database } from 'sql.js'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = process.env.DATA_DIR || path.join(__dirname, '../data')

// 确保数据目录存在
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true })
}

const dbPath = path.join(dataDir, 'monitor.db')

let db: Database

// 防抖保存机制：减少频繁的磁盘写入
let saveTimer: ReturnType<typeof setTimeout> | null = null
const SAVE_DEBOUNCE_MS = 1000

function debouncedSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    if (db) {
      const data = db.export()
      const buffer = Buffer.from(data)
      fs.writeFileSync(dbPath, buffer)
    }
  }, SAVE_DEBOUNCE_MS)
}

// 立即保存数据库（用于关闭时）
export function saveNow() {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (db) {
    const data = db.export()
    fs.writeFileSync(dbPath, Buffer.from(data))
    console.log('💾 数据库已保存')
  }
}

// 优雅关闭处理
function setupGracefulShutdown() {
  const shutdown = () => {
    console.log('\n🛑 正在关闭...')
    saveNow()
    process.exit(0)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

setupGracefulShutdown()

export async function initDatabase(): Promise<Database> {
  const SQL = await initSqlJs()

  // 如果数据库文件存在，加载它
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath)
    db = new SQL.Database(buffer)
  } else {
    db = new SQL.Database()
  }

  // 初始化数据库表
  db.run(`
    CREATE TABLE IF NOT EXISTS admin_credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  // 检查是否需要插入默认密码
  const result = db.exec("SELECT COUNT(*) as count FROM admin_credentials")
  if (result.length === 0 || result[0].values[0][0] === 0) {
    db.run("INSERT INTO admin_credentials (id, password_hash) VALUES (1, 'JAvlGPq9JyTdtvBO6x2llnRI1+gxwIyPqCKAn3THIKk=')")
  }

  // 系统设置表
  db.run(`
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS monitors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      check_interval INTEGER NOT NULL DEFAULT 5,
      check_interval_max INTEGER,
      check_type TEXT NOT NULL DEFAULT 'http',
      check_method TEXT NOT NULL DEFAULT 'GET',
      check_timeout INTEGER NOT NULL DEFAULT 30,
      expected_status_codes TEXT DEFAULT '200,201,204,301,302',
      expected_keyword TEXT,
      forbidden_keyword TEXT,
      komari_offline_threshold INTEGER DEFAULT 3,
      webhook_url TEXT,
      webhook_content_type TEXT DEFAULT 'application/json',
      webhook_headers TEXT,
      webhook_body TEXT,
      webhook_username TEXT,
      check_content_type TEXT DEFAULT 'application/json',
      check_headers TEXT,
      check_body TEXT,
      next_check_at TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      feedback_linkage INTEGER DEFAULT 0,
      feedback_threshold INTEGER DEFAULT 0,
      feedback_threshold_max INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  // 确保所有必要字段都通过迁移存在
  const columns = [
    { name: 'check_interval_max', type: 'INTEGER' },
    { name: 'next_check_at', type: 'TEXT' },
    { name: 'sort_order', type: 'INTEGER DEFAULT 0' },
    { name: 'tg_chat_id', type: 'TEXT' },
    { name: 'tg_server_name', type: 'TEXT' },
    { name: 'tg_offline_keywords', type: 'TEXT' },
    { name: 'tg_online_keywords', type: 'TEXT' },
    { name: 'tg_notify_chat_id', type: 'TEXT' },
    { name: 'check_content_type', type: 'TEXT DEFAULT "application/json"' },
    { name: 'check_headers', type: 'TEXT' },
    { name: 'check_body', type: 'TEXT' },
    { name: 'feedback_linkage', type: 'INTEGER DEFAULT 0' },
    { name: 'feedback_threshold', type: 'INTEGER DEFAULT 0' },
    { name: 'feedback_fluctuation_min', type: 'INTEGER' },
    { name: 'feedback_fluctuation_max', type: 'INTEGER' }
  ]

  for (const col of columns) {
    try {
      db.run(`ALTER TABLE monitors ADD COLUMN ${col.name} ${col.type}`)
    } catch (e) {
      // 字段已存在，忽略错误
    }
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS monitor_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      monitor_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('up', 'down')),
      response_time INTEGER NOT NULL,
      status_code INTEGER,
      error_message TEXT,
      checked_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (monitor_id) REFERENCES monitors(id) ON DELETE CASCADE
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS incidents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      monitor_id TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT,
      duration_seconds INTEGER,
      notified INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (monitor_id) REFERENCES monitors(id) ON DELETE CASCADE
    )
  `)

  db.run(`CREATE INDEX IF NOT EXISTS idx_monitor_checks_monitor_id ON monitor_checks(monitor_id)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_monitor_checks_checked_at ON monitor_checks(checked_at DESC)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_incidents_monitor_id ON incidents(monitor_id)`)

  // 保存数据库
  saveDatabase()

  return db
}

export function saveDatabase() {
  if (db) {
    const data = db.export()
    const buffer = Buffer.from(data)
    fs.writeFileSync(dbPath, buffer)
  }
}

export function getDb(): Database {
  return db
}

// 辅助函数：执行查询并返回所有结果
export function queryAll(sql: string, params: any[] = []): any[] {
  const stmt = db.prepare(sql)
  if (params.length > 0) {
    stmt.bind(params)
  }
  const results: any[] = []
  while (stmt.step()) {
    results.push(stmt.getAsObject())
  }
  stmt.free()
  return results
}

// 辅助函数：执行查询并返回第一个结果
export function queryFirst(sql: string, params: any[] = []): any | null {
  const results = queryAll(sql, params)
  return results.length > 0 ? results[0] : null
}

// 辅助函数：执行语句（INSERT/UPDATE/DELETE）
export function run(sql: string, params: any[] = []) {
  db.run(sql, params)
  debouncedSave() // 使用防抖保存，减少磁盘 I/O
}
