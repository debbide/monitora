import initSqlJs from 'sql.js'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(__dirname, 'data') // root/data
const dbPath = path.join(dataDir, 'monitor.db')

console.log('Checking DB at:', dbPath)

async function run() {
    try {
        const SQL = await initSqlJs()
        if (fs.existsSync(dbPath)) {
            const buffer = fs.readFileSync(dbPath)
            const db = new SQL.Database(buffer)

            console.log('\n--- Latest 5 Monitors ---')
            const res = db.exec("SELECT name, check_type, check_interval, check_interval_max, next_check_at, created_at FROM monitors ORDER BY created_at DESC LIMIT 5")

            if (res.length > 0) {
                // console.log(res[0].columns.join(' | '))
                res[0].values.forEach(row => {
                    const obj: any = {}
                    res[0].columns.forEach((col, i) => {
                        obj[col] = row[i]
                    })
                    console.log(JSON.stringify(obj, null, 2))
                })
            } else {
                console.log("No monitors found.")
            }

            console.log('\n--- Latest 5 Checks ---')
            const resChecks = db.exec("SELECT monitor_id, status, status_code, checked_at FROM monitor_checks ORDER BY checked_at DESC LIMIT 5")
            if (resChecks.length > 0) {
                // console.log(resChecks[0].columns.join(' | '))
                resChecks[0].values.forEach(row => {
                    const obj: any = {}
                    resChecks[0].columns.forEach((col, i) => {
                        obj[col] = row[i]
                    })
                    console.log(JSON.stringify(obj, null, 2))
                })
            }
        } else {
            console.log("DB file not found!")
        }
    } catch (err) {
        console.error("Error:", err)
    }
}

run()
