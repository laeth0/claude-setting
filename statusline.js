#!/usr/bin/env node
const { execSync } = require('child_process');

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';

function colorForPct(pct) {
  if (pct >= 90) return RED;
  if (pct >= 70) return YELLOW;
  return GREEN;
}

function fmtPct(pct) {
  if (pct === null || pct === undefined) return null;
  const n = Math.round(pct);
  return `${colorForPct(n)}${n}%${RESET}`;
}

function fmtResetsAt(epochSeconds) {
  if (!epochSeconds) return '';
  const ms = epochSeconds * 1000;
  const diffMs = ms - Date.now();
  if (diffMs <= 0) return '';
  const totalMin = Math.round(diffMs / 60000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days > 0) return `${days}d${hours}h`;
  if (hours > 0) return `${hours}h${mins}m`;
  return `${mins}m`;
}

function fmtDuration(ms) {
  if (!ms) return null;
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h${m}m`;
  if (m > 0) return `${m}m${s}s`;
  return `${s}s`;
}

function fmtUsd(n) {
  if (n === null || n === undefined) return null;
  return `$${n.toFixed(2)}`;
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  let data = {};
  try { data = JSON.parse(input); } catch (e) {}

  const model = data.model?.display_name || data.model?.id || 'Claude';
  const cwd = data.workspace?.current_dir || data.cwd || process.cwd();
  const dirName = cwd.split(/[\\/]/).filter(Boolean).pop() || cwd;

  let branch = '';
  let dirty = false;
  try {
    branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1000,
    }).toString().trim();
    if (branch) {
      const status = execSync('git status --porcelain', {
        cwd,
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 1000,
      }).toString();
      dirty = status.trim().length > 0;
    }
  } catch (e) {}

  const segments = [];

  // Model + effort/thinking/fast-mode flags
  let modelSeg = `${CYAN}${model}${RESET}`;
  const flags = [];
  if (data.effort?.level) flags.push(data.effort.level);
  if (data.thinking?.enabled) flags.push('think');
  if (data.fast_mode) flags.push('fast');
  if (flags.length) modelSeg += `${DIM}(${flags.join(',')})${RESET}`;
  segments.push(modelSeg);

  // Directory + git branch/dirty state + worktree
  let dirSeg = dirName;
  if (data.worktree?.name) {
    dirSeg += ` ${DIM}[wt:${data.worktree.name}]${RESET}`;
    if (data.worktree.branch) branch = data.worktree.branch;
  }
  if (branch) dirSeg += ` ${DIM}git:${RESET}${branch}${dirty ? YELLOW + '*' + RESET : ''}`;
  segments.push(dirSeg);

  // PR / MR
  if (data.pr?.number) {
    const kind = data.pr.kind === 'mr' ? 'MR' : 'PR';
    let prSeg = `${kind}#${data.pr.number}`;
    if (data.pr.review_state) prSeg += `${DIM}(${data.pr.review_state})${RESET}`;
    segments.push(prSeg);
  }

  // Agent
  if (data.agent?.name) segments.push(`${DIM}agent:${RESET}${data.agent.name}`);

  // Context window usage
  const ctxPct = fmtPct(data.context_window?.used_percentage);
  if (ctxPct) segments.push(`ctx:${ctxPct}`);
  if (data.exceeds_200k_tokens) segments.push(`${RED}>200k${RESET}`);

  // Rate limits: 5-hour and 7-day (weekly)
  const fiveHour = data.rate_limits?.five_hour;
  if (fiveHour?.used_percentage !== undefined) {
    const pct = fmtPct(fiveHour.used_percentage);
    const resets = fmtResetsAt(fiveHour.resets_at);
    segments.push(`5h:${pct}${resets ? DIM + `(${resets})` + RESET : ''}`);
  }
  const sevenDay = data.rate_limits?.seven_day;
  if (sevenDay?.used_percentage !== undefined) {
    const pct = fmtPct(sevenDay.used_percentage);
    const resets = fmtResetsAt(sevenDay.resets_at);
    segments.push(`7h:${pct}${resets ? DIM + `(${resets})` + RESET : ''}`);
  }

  // Cost / duration / lines changed
  const cost = fmtUsd(data.cost?.total_cost_usd);
  if (cost) segments.push(cost);
  const dur = fmtDuration(data.cost?.total_duration_ms);
  if (dur) segments.push(dur);
  const added = data.cost?.total_lines_added;
  const removed = data.cost?.total_lines_removed;
  if (added || removed) {
    segments.push(`${GREEN}+${added || 0}${RESET}/${RED}-${removed || 0}${RESET}`);
  }

  // Vim mode
  if (data.vim?.mode) segments.push(`${DIM}${data.vim.mode}${RESET}`);

  // Output style (only if non-default)
  if (data.output_style?.name && data.output_style.name !== 'default') {
    segments.push(`${DIM}style:${RESET}${data.output_style.name}`);
  }

  process.stdout.write(segments.join(`  ${DIM}│${RESET}  `));
});
