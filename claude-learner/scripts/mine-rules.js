#!/usr/bin/env node

const { openLearnerDb, openClaudeMemDb, getProjectName } = require("./shared/db");
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const flags = {};
for (const arg of args) {
  if (arg.startsWith("--")) {
    const [key, val] = arg.slice(2).split("=");
    flags[key] = val || true;
  }
}

const project = flags.project || getProjectName();
const incremental = flags.incremental === true;
const listCandidates = flags["list-candidates"] === true;
const list = flags.list === true;
const show = flags.show;
const pause = flags.pause;
const activate = flags.activate;
const reject = flags.reject;
const prune = flags.prune === true;
const stats = flags.stats === true;
const writeClaude = flags["write-claude-md"];

async function main() {
  const learnerDb = await openLearnerDb();

  if (list) return doList(learnerDb, flags.status || "active");
  if (listCandidates) return doList(learnerDb, "candidate");
  if (show) return doShow(learnerDb, Number(show));
  if (pause) return doSetStatus(learnerDb, Number(pause), "paused");
  if (activate) return doActivateAndWrite(learnerDb, Number(activate));
  if (reject) return doReject(learnerDb, Number(reject));
  if (prune) return doPrune(learnerDb);
  if (stats) return doStats(learnerDb);
  if (writeClaude) return doWriteClaudeMd(learnerDb, writeClaude === true ? null : writeClaude);

  await doMine(learnerDb, incremental);
  learnerDb.close();
}

async function doMine(learnerDb, incremental) {
  const memDb = await openClaudeMemDb();

  let sinceEpoch = 0;
  if (incremental) {
    const lastRun = learnerDb
      .prepare("SELECT MAX(ran_at_epoch) as last FROM mining_runs WHERE project = ?")
      .get(project);
    sinceEpoch = lastRun?.last || 0;
  }

  const nowEpoch = Math.floor(Date.now() / 1000);
  let candidatesFound = 0;
  let rulesCreated = 0;
  let rulesUpdated = 0;

  const gotchas = mineGotchas(memDb, sinceEpoch);
  for (const rule of gotchas) {
    const result = upsertRule(learnerDb, rule);
    candidatesFound++;
    if (result === "created") rulesCreated++;
    if (result === "updated") rulesUpdated++;
  }

  const decisions = mineDecisions(memDb, sinceEpoch);
  for (const rule of decisions) {
    const result = upsertRule(learnerDb, rule);
    candidatesFound++;
    if (result === "created") rulesCreated++;
    if (result === "updated") rulesUpdated++;
  }

  const learned = mineLearned(memDb, sinceEpoch);
  for (const rule of learned) {
    const result = upsertRule(learnerDb, rule);
    candidatesFound++;
    if (result === "created") rulesCreated++;
    if (result === "updated") rulesUpdated++;
  }

  const patterns = mineRepeatedChanges(memDb, sinceEpoch);
  for (const rule of patterns) {
    const result = upsertRule(learnerDb, rule);
    candidatesFound++;
    if (result === "created") rulesCreated++;
    if (result === "updated") rulesUpdated++;
  }

  const rulesRetired = incremental ? 0 : autoPrune(learnerDb);

  learnerDb.prepare(`
    INSERT INTO mining_runs (project, ran_at_epoch, observations_scanned, candidates_found, rules_created, rules_updated, rules_retired)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(project, nowEpoch, gotchas.length + decisions.length + learned.length + patterns.length, candidatesFound, rulesCreated, rulesUpdated, rulesRetired);

  memDb.close();

  output({
    project,
    mode: incremental ? "incremental" : "full",
    candidates_found: candidatesFound,
    rules_created: rulesCreated,
    rules_updated: rulesUpdated,
    rules_retired: rulesRetired,
  });
}

function mineGotchas(memDb, sinceEpoch) {
  const rows = memDb
    .prepare(`
      SELECT id, project, title, facts, narrative, concepts, files_modified, created_at_epoch
      FROM observations
      WHERE concepts LIKE '%gotcha%'
        AND created_at_epoch > ?
      ORDER BY created_at_epoch DESC
      LIMIT 100
    `)
    .all(sinceEpoch);

  const rules = [];
  for (const row of rows) {
    const facts = parseFacts(row.facts);
    const gotchaFacts = facts.filter((f) => f.toLowerCase().startsWith("gotcha:"));

    if (gotchaFacts.length > 0) {
      for (const fact of gotchaFacts) {
        const ruleText = fact.replace(/^gotcha:\s*/i, "").trim();
        if (ruleText.length > 10) {
          rules.push({
            project: row.project,
            rule_text: `Watch out: ${ruleText}`,
            category: "gotcha",
            confidence: 0.8,
            source_observation_ids: [row.id],
            files_relevant: safeParseJson(row.files_modified) || [],
          });
        }
      }
    } else if (row.narrative) {
      const sentences = row.narrative.split(/\.\s+/).filter((s) => s.length > 20);
      if (sentences.length > 0) {
        rules.push({
          project: row.project,
          rule_text: `Watch out: ${sentences[0].trim()}.`,
          category: "gotcha",
          confidence: 0.6,
          source_observation_ids: [row.id],
          files_relevant: safeParseJson(row.files_modified) || [],
        });
      }
    }
  }
  return rules;
}

function mineDecisions(memDb, sinceEpoch) {
  const rows = memDb
    .prepare(`
      SELECT id, project, title, facts, narrative, concepts, files_modified, created_at_epoch
      FROM observations
      WHERE (concepts LIKE '%decision%' OR type = 'decision')
        AND created_at_epoch > ?
      ORDER BY created_at_epoch DESC
      LIMIT 50
    `)
    .all(sinceEpoch);

  const rules = [];
  for (const row of rows) {
    const facts = parseFacts(row.facts);
    const decisionFacts = facts.filter((f) => f.toLowerCase().startsWith("decision:"));

    for (const fact of decisionFacts) {
      const ruleText = fact.replace(/^decision:\s*/i, "").trim();
      if (ruleText.length > 10) {
        rules.push({
          project: row.project,
          rule_text: `Convention: ${ruleText}`,
          category: "decision",
          confidence: 0.6,
          source_observation_ids: [row.id],
          files_relevant: safeParseJson(row.files_modified) || [],
        });
      }
    }
  }
  return rules;
}

function mineLearned(memDb, sinceEpoch) {
  const rows = memDb
    .prepare(`
      SELECT id, project, learned, request, created_at_epoch
      FROM session_summaries
      WHERE learned IS NOT NULL AND learned != ''
        AND created_at_epoch > ?
      ORDER BY created_at_epoch DESC
      LIMIT 20
    `)
    .all(sinceEpoch);

  const rules = [];
  for (const row of rows) {
    const bullets = row.learned
      .split(/\n/)
      .map((l) => l.replace(/^[\s\-*]+/, "").trim())
      .filter((l) => l.length > 15);

    for (const bullet of bullets) {
      rules.push({
        project: row.project,
        rule_text: `Learned: ${bullet}`,
        category: "learned",
        confidence: 0.5,
        source_observation_ids: [],
        files_relevant: [],
      });
    }
  }
  return rules;
}

function mineRepeatedChanges(memDb, sinceEpoch) {
  const rows = memDb
    .prepare(`
      SELECT files_modified, COUNT(*) as change_count,
             GROUP_CONCAT(id) as observation_ids,
             GROUP_CONCAT(title, ' | ') as titles
      FROM observations
      WHERE type = 'change'
        AND files_modified IS NOT NULL
        AND created_at_epoch > ?
      GROUP BY files_modified
      HAVING change_count >= 2
      ORDER BY change_count DESC
      LIMIT 20
    `)
    .all(sinceEpoch);

  const rules = [];
  for (const row of rows) {
    const files = safeParseJson(row.files_modified) || [];
    const fileNames = files.map((f) => f.split("/").pop()).join(", ");
    if (fileNames) {
      rules.push({
        project: project,
        rule_text: `Frequently changed: ${fileNames} (${row.change_count} changes). Review: ${row.titles.slice(0, 200)}`,
        category: "pattern",
        confidence: 0.4,
        source_observation_ids: row.observation_ids.split(",").map(Number),
        files_relevant: files,
      });
    }
  }
  return rules;
}

function upsertRule(learnerDb, rule) {
  const existing = learnerDb
    .prepare("SELECT id, confidence, source_observation_ids FROM rules WHERE project = ? AND rule_text = ? AND status != 'retired'")
    .get(rule.project, rule.rule_text);

  if (existing) {
    const existingIds = safeParseJson(existing.source_observation_ids) || [];
    const mergedIds = [...new Set([...existingIds, ...rule.source_observation_ids])];
    const newConfidence = Math.min(1.0, existing.confidence + 0.1);

    learnerDb
      .prepare("UPDATE rules SET confidence = ?, source_observation_ids = ?, last_mined_epoch = ? WHERE id = ?")
      .run(newConfidence, JSON.stringify(mergedIds), Math.floor(Date.now() / 1000), existing.id);
    return "updated";
  }

  learnerDb
    .prepare(`
      INSERT INTO rules (project, rule_text, category, confidence, source_observation_ids, files_relevant, created_at_epoch, last_mined_epoch, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'candidate')
    `)
    .run(
      rule.project,
      rule.rule_text,
      rule.category,
      rule.confidence,
      JSON.stringify(rule.source_observation_ids),
      JSON.stringify(rule.files_relevant),
      Math.floor(Date.now() / 1000),
      Math.floor(Date.now() / 1000)
    );
  return "created";
}

function doActivateAndWrite(learnerDb, id) {
  const rule = learnerDb.prepare("SELECT * FROM rules WHERE id = ?").get(id);
  if (!rule) {
    output({ error: `Rule ${id} not found` });
    return;
  }
  learnerDb.prepare("UPDATE rules SET status = 'active' WHERE id = ?").run(id);
  output({ id, status: "active", rule_text: rule.rule_text, note: "Rule activated. Run --write-claude-md to sync active rules into CLAUDE.md" });
}

function doReject(learnerDb, id) {
  const rule = learnerDb.prepare("SELECT * FROM rules WHERE id = ?").get(id);
  if (!rule) {
    output({ error: `Rule ${id} not found` });
    return;
  }
  learnerDb.prepare("UPDATE rules SET status = 'retired', retired_reason = 'user_rejected' WHERE id = ?").run(id);
  output({ id, status: "retired", reason: "user_rejected" });
}

function doWriteClaudeMd(learnerDb, claudeMdPath) {
  const rules = learnerDb
    .prepare("SELECT id, rule_text, category, confidence FROM rules WHERE project = ? AND status = 'active' ORDER BY confidence DESC")
    .all(project);

  if (rules.length === 0) {
    output({ written: false, reason: "no active rules to write" });
    return;
  }

  const resolvedPath = claudeMdPath || path.join(process.cwd(), "CLAUDE.md");

  let existing = "";
  if (fs.existsSync(resolvedPath)) {
    existing = fs.readFileSync(resolvedPath, "utf8");
  }

  const sectionStart = "## Learned Rules (claude-learner)";
  const sectionEnd = "<!-- end-claude-learner -->";
  const date = new Date().toISOString().slice(0, 10);

  const ruleLines = rules.map((r) => `- [${r.category}] ${r.rule_text}`);
  const newSection = [
    sectionStart,
    `<!-- Updated: ${date}. Auto-managed by claude-learner. Do not edit between markers. -->`,
    ...ruleLines,
    sectionEnd,
  ].join("\n");

  const startIdx = existing.indexOf(sectionStart);
  const endIdx = existing.indexOf(sectionEnd);

  let updated;
  if (startIdx !== -1 && endIdx !== -1) {
    updated = existing.slice(0, startIdx) + newSection + existing.slice(endIdx + sectionEnd.length);
  } else {
    updated = existing.trimEnd() + "\n\n" + newSection + "\n";
  }

  fs.writeFileSync(resolvedPath, updated, "utf8");

  output({
    written: true,
    path: resolvedPath,
    rule_count: rules.length,
    rules: rules.map((r) => ({ id: r.id, category: r.category, text: r.rule_text })),
  });
}

function autoPrune(learnerDb) {
  const nowEpoch = Math.floor(Date.now() / 1000);
  const fourteenDaysAgo = nowEpoch - 14 * 86400;
  const sevenDaysAgo = nowEpoch - 7 * 86400;

  const stale = learnerDb
    .prepare(`
      UPDATE rules SET status = 'retired', retired_reason = 'auto-pruned: stale and ineffective'
      WHERE project = ?
        AND status = 'active'
        AND created_at_epoch < ?
        AND (last_triggered_epoch IS NULL OR last_triggered_epoch < ?)
        AND trigger_count >= 5
        AND violation_count_after >= violation_count_before
    `)
    .run(project, fourteenDaysAgo, sevenDaysAgo);

  return stale.changes;
}

function doList(learnerDb, status) {
  const rows = learnerDb
    .prepare("SELECT id, category, rule_text, confidence, trigger_count, last_triggered_epoch, status FROM rules WHERE project = ? AND status = ? ORDER BY confidence DESC")
    .all(project, status);

  output({ project, status, count: rows.length, rules: rows });
}

function doShow(learnerDb, id) {
  const rule = learnerDb.prepare("SELECT * FROM rules WHERE id = ?").get(id);
  if (!rule) {
    output({ error: `Rule ${id} not found` });
    return;
  }
  output(rule);
}

function doSetStatus(learnerDb, id, status) {
  learnerDb.prepare("UPDATE rules SET status = ? WHERE id = ?").run(status, id);
  output({ id, status, updated: true });
}

function doPrune(learnerDb) {
  const retired = autoPrune(learnerDb);
  output({ project, rules_retired: retired });
}

function doStats(learnerDb) {
  const total = learnerDb.prepare("SELECT COUNT(*) as c FROM rules WHERE project = ?").get(project);
  const byStatus = learnerDb.prepare("SELECT status, COUNT(*) as c FROM rules WHERE project = ? GROUP BY status").all(project);
  const byCategory = learnerDb.prepare("SELECT category, COUNT(*) as c FROM rules WHERE project = ? AND status = 'active' GROUP BY category").all(project);
  const avgConfidence = learnerDb.prepare("SELECT AVG(confidence) as avg FROM rules WHERE project = ? AND status = 'active'").get(project);
  const lastRun = learnerDb.prepare("SELECT * FROM mining_runs WHERE project = ? ORDER BY ran_at_epoch DESC LIMIT 1").get(project);

  output({ project, total: total.c, by_status: byStatus, by_category: byCategory, avg_confidence: avgConfidence?.avg, last_mining_run: lastRun });
}

function parseFacts(factsStr) {
  if (!factsStr) return [];
  const parsed = safeParseJson(factsStr);
  if (Array.isArray(parsed)) return parsed;
  return factsStr
    .split(/\n/)
    .map((l) => l.replace(/^[\s\-*]+/, "").trim())
    .filter(Boolean);
}

function safeParseJson(str) {
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function output(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
}

main();
