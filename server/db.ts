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



export async function initDatabase(): Promise<Database> {
  const SQL = await initSqlJs()

  // 如果数据库文件存在，加载它
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath)
    db = new SQL.Database(buffer)
  } else {
    db = new SQL.Database()
  }

  db.run('PRAGMA foreign_keys = ON')

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
      http_client_mode TEXT DEFAULT 'fetch',
      expected_status_codes TEXT DEFAULT '200,201,204,301,302',
      expected_keyword TEXT,
      forbidden_keyword TEXT,
      komari_offline_threshold INTEGER DEFAULT 3,
      email_site_key TEXT,
      email_from_filter TEXT,
      email_subject_keyword TEXT,
      email_body_keyword TEXT,
      email_code_regex TEXT,
      email_to_email TEXT,
      email_timeout_seconds INTEGER DEFAULT 120,
      email_max_age_seconds INTEGER DEFAULT 300,
      daily_window_start TEXT,
      daily_window_end TEXT,
      webhook_url TEXT,
      webhook_content_type TEXT DEFAULT 'application/json',
      webhook_method TEXT DEFAULT 'POST',
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
      feedback_fluctuation_min INTEGER DEFAULT 0,
      feedback_fluctuation_max INTEGER DEFAULT 0,
      feedback_unit TEXT DEFAULT 'hours',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  // 确保所有必要字段都通过迁移存在
  const columns = [
    { name: 'check_interval_max', type: 'INTEGER' },
    { name: 'http_client_mode', type: 'TEXT DEFAULT "fetch"' },
    { name: 'next_check_at', type: 'TEXT' },
    { name: 'sort_order', type: 'INTEGER DEFAULT 0' },
    { name: 'tg_chat_id', type: 'TEXT' },
    { name: 'tg_server_name', type: 'TEXT' },
    { name: 'tg_offline_keywords', type: 'TEXT' },
    { name: 'tg_online_keywords', type: 'TEXT' },
    { name: 'tg_notify_chat_id', type: 'TEXT' },
    { name: 'webhook_method', type: 'TEXT DEFAULT "POST"' },
    { name: 'check_content_type', type: 'TEXT DEFAULT "application/json"' },
    { name: 'check_headers', type: 'TEXT' },
    { name: 'check_body', type: 'TEXT' },
    { name: 'feedback_linkage', type: 'INTEGER DEFAULT 0' },
    { name: 'feedback_threshold', type: 'INTEGER DEFAULT 0' },
    { name: 'feedback_fluctuation_min', type: 'INTEGER' },
    { name: 'feedback_fluctuation_max', type: 'INTEGER' },
    { name: 'feedback_unit', type: "TEXT DEFAULT 'hours'" },
    { name: 'email_site_key', type: 'TEXT' },
    { name: 'email_from_filter', type: 'TEXT' },
    { name: 'email_subject_keyword', type: 'TEXT' },
    { name: 'email_body_keyword', type: 'TEXT' },
    { name: 'email_code_regex', type: 'TEXT' },
    { name: 'email_to_email', type: 'TEXT' },
    { name: 'email_timeout_seconds', type: 'INTEGER DEFAULT 120' },
    { name: 'email_max_age_seconds', type: 'INTEGER DEFAULT 300' },
    { name: 'daily_window_start', type: 'TEXT' },
    { name: 'daily_window_end', type: 'TEXT' }
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

  // 邮件验证码规则表
  db.run(`
    CREATE TABLE IF NOT EXISTS email_rules (
      id TEXT PRIMARY KEY,
      site_key TEXT NOT NULL,
      from_filter TEXT NOT NULL,
      subject_keyword TEXT,
      body_keyword TEXT,
      code_regex TEXT NOT NULL,
      to_email TEXT,
      timeout_seconds INTEGER DEFAULT 120,
      max_age_seconds INTEGER DEFAULT 300,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS email_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_id TEXT NOT NULL,
      code TEXT NOT NULL,
      message_id TEXT,
      from_address TEXT,
      subject TEXT,
      received_at TEXT,
      used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (rule_id) REFERENCES email_rules(id) ON DELETE CASCADE
    )
  `)

  db.run(`CREATE INDEX IF NOT EXISTS idx_email_rules_site_key ON email_rules(site_key)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_email_codes_rule_id ON email_codes(rule_id)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_email_codes_received_at ON email_codes(received_at DESC)`)

  // WebTask 任务队列持久化表
  db.run(`
    CREATE TABLE IF NOT EXISTS webtasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  db.run(`CREATE INDEX IF NOT EXISTS idx_webtasks_status ON webtasks(status)`)

  const webtaskColumns = [
    { name: 'task_name', type: 'TEXT' },
    { name: 'data_json', type: 'TEXT' },
    { name: 'priority', type: 'INTEGER DEFAULT 0' },
    { name: 'target_client_id', type: 'TEXT' },
    { name: 'claimed_by', type: 'TEXT' },
    { name: 'claimed_at', type: 'TEXT' },
    { name: 'lease_until', type: 'TEXT' },
    { name: 'attempt_count', type: 'INTEGER DEFAULT 0' },
    { name: 'max_attempts', type: 'INTEGER DEFAULT 3' },
    { name: 'last_error', type: 'TEXT' },
    { name: 'finished_at', type: 'TEXT' },
    { name: 'report_success', type: 'INTEGER' },
    { name: 'result_message', type: 'TEXT' },
    { name: 'result_variables', type: 'TEXT' },
    { name: 'trace_id', type: 'TEXT' },
    { name: 'not_before', type: 'TEXT' },
    { name: 'expires_at', type: 'TEXT' },
    { name: 'dedupe_key', type: 'TEXT' },
    { name: 'updated_at', type: 'TEXT' }
  ]

  for (const col of webtaskColumns) {
    try {
      db.run(`ALTER TABLE webtasks ADD COLUMN ${col.name} ${col.type}`)
    } catch (e) {
      // 字段已存在，忽略错误
    }
  }

  try {
    db.run(
      "UPDATE webtasks SET task_name = COALESCE(task_name, json_extract(payload, '$.task')) WHERE task_name IS NULL"
    )
  } catch (e) {
    // 某些 SQLite 构建可能不支持 JSON 函数，忽略
  }
  db.run("UPDATE webtasks SET updated_at = COALESCE(updated_at, created_at)")

  db.run(`
    CREATE TABLE IF NOT EXISTS webtask_clients (
      client_id TEXT PRIMARY KEY,
      last_seen_at TEXT NOT NULL,
      connected INTEGER NOT NULL DEFAULT 0,
      user_agent TEXT,
      remote_addr TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  db.run(`CREATE INDEX IF NOT EXISTS idx_webtasks_priority ON webtasks(status, priority DESC, id ASC)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_webtasks_claim ON webtasks(status, lease_until)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_webtasks_target ON webtasks(target_client_id, status)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_webtask_clients_seen ON webtask_clients(last_seen_at DESC)`)

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

// 自动清理过期数据
export function cleanOldData(daysToKeep = 3) {
  try {
    const timeThreshold = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000).toISOString()
    
    // 清理 monitor_checks，但必须保留每个 monitor 的最后一条记录（即 MAX(id)）
    // 否则被动监控（如 webhook/cron）如果在 3 天内没有新记录，就会丢失状态变成"未知"
    db.run(`
      DELETE FROM monitor_checks 
      WHERE checked_at < ? 
      AND id NOT IN (
        SELECT MAX(id) FROM monitor_checks GROUP BY monitor_id
      )
    `, [timeThreshold])
    
    // 清理已解决的旧 incidents
    db.run(`DELETE FROM incidents WHERE resolved_at IS NOT NULL AND resolved_at < ?`, [timeThreshold])

    // 清理已完成的旧 webtasks
    db.run(`DELETE FROM webtasks WHERE status IN ('done', 'failed') AND created_at < ?`, [timeThreshold])

    // 执行 VACUUM，彻底释放删除数据留下的空白空间，压缩文件体积
    db.run('VACUUM')
    
    // 强制保存
    saveDatabase()
    console.log(`[DB Cleanup] Cleaned up records older than ${daysToKeep} days and vacuumed database.`)
  } catch (error) {
    console.error('[DB Cleanup] Error during cleanup:', error)
  }
}
