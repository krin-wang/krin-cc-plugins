const initSqlJs = require("sql.js");
const path = require("path");
const fs = require("fs");
const os = require("os");

const LEARNER_DIR = path.join(os.homedir(), ".claude-learner");
const LEARNER_DB_PATH = path.join(LEARNER_DIR, "learner.db");
const CLAUDE_MEM_DB_PATH = path.join(os.homedir(), ".claude-mem", "claude-mem.db");

let _SQL = null;

function getSqlJs() {
  if (!_SQL) {
    _SQL = initSqlJs();
  }
  return _SQL;
}

function wrapDb(db, filePath) {
  return {
    prepare(sql) {
      return {
        run(...params) {
          db.run(sql, params);
          const result = { changes: db.getRowsModified() };
          if (filePath) saveDb(db, filePath);
          return result;
        },
        get(...params) {
          const stmt = db.prepare(sql);
          stmt.bind(params);
          if (stmt.step()) {
            const row = stmt.getAsObject();
            stmt.free();
            return row;
          }
          stmt.free();
          return undefined;
        },
        all(...params) {
          const rows = [];
          const stmt = db.prepare(sql);
          stmt.bind(params);
          while (stmt.step()) {
            rows.push(stmt.getAsObject());
          }
          stmt.free();
          return rows;
        },
      };
    },
    exec(sql) {
      db.exec(sql);
      if (filePath) saveDb(db, filePath);
    },
    close() {
      if (filePath) saveDb(db, filePath);
      db.close();
    },
    _raw: db,
    _path: filePath,
  };
}

function saveDb(db, filePath) {
  const data = db.export();
  fs.writeFileSync(filePath, Buffer.from(data));
}

function ensureLearnerDir() {
  if (!fs.existsSync(LEARNER_DIR)) {
    fs.mkdirSync(LEARNER_DIR, { recursive: true });
  }
}

async function openLearnerDb() {
  ensureLearnerDir();
  const SQL = await getSqlJs();
  let db;
  if (fs.existsSync(LEARNER_DB_PATH)) {
    const buf = fs.readFileSync(LEARNER_DB_PATH);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }
  const wrapped = wrapDb(db, LEARNER_DB_PATH);
  initLearnerSchema(wrapped);
  return wrapped;
}

function initLearnerSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project TEXT NOT NULL,
      rule_text TEXT NOT NULL,
      category TEXT NOT NULL,
      confidence REAL DEFAULT 0.5,
      source_observation_ids TEXT,
      files_relevant TEXT,
      created_at_epoch INTEGER NOT NULL,
      last_triggered_epoch INTEGER,
      trigger_count INTEGER DEFAULT 0,
      violation_count_before INTEGER DEFAULT 0,
      violation_count_after INTEGER DEFAULT 0,
      status TEXT DEFAULT 'candidate',
      retired_reason TEXT,
      last_mined_epoch INTEGER
    );

    CREATE TABLE IF NOT EXISTS mining_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project TEXT NOT NULL,
      ran_at_epoch INTEGER NOT NULL,
      observations_scanned INTEGER DEFAULT 0,
      candidates_found INTEGER DEFAULT 0,
      rules_created INTEGER DEFAULT 0,
      rules_updated INTEGER DEFAULT 0,
      rules_retired INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_rules_project ON rules(project);
    CREATE INDEX IF NOT EXISTS idx_rules_status ON rules(status);
    CREATE INDEX IF NOT EXISTS idx_rules_category ON rules(category);
  `);
}

function requireClaudeMem() {
  if (!fs.existsSync(CLAUDE_MEM_DB_PATH)) {
    console.error(JSON.stringify({
      error: "claude-mem not found",
      message: "claude-learner requires the claude-mem plugin (thedotmack/claude-mem). Install it first: /install claude-mem@thedotmack",
      expected_path: CLAUDE_MEM_DB_PATH,
    }));
    process.exit(1);
  }
}

async function openClaudeMemDb() {
  requireClaudeMem();
  const SQL = await getSqlJs();
  const buf = fs.readFileSync(CLAUDE_MEM_DB_PATH);
  const db = new SQL.Database(buf);
  return wrapDb(db, null);
}

function getProjectName() {
  const cwd = process.env.CWD || process.env.PWD || process.cwd();
  return path.basename(cwd);
}

module.exports = {
  LEARNER_DIR,
  LEARNER_DB_PATH,
  CLAUDE_MEM_DB_PATH,
  openLearnerDb,
  openClaudeMemDb,
  getProjectName,
};
