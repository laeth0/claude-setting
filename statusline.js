#!/usr/bin/env node
const { execSync } = require('child_process');

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const MAGENTA = '\x1b[35m';
const CYAN = '\x1b[36m';
const GRAY = '\x1b[90m';

const SEP = `  ${GRAY}│${RESET}  `;
const NA = `${GRAY}—${RESET}`; // em dash, shown whenever a field has no data yet

function colorForPct(pct) {
  if (pct >= 90) return RED;
  if (pct >= 70) return YELLOW;
  return GREEN;
}

// Always returns a renderable string: colored percentage, or NA placeholder.
function fmtPct(pct) {
  if (pct === null || pct === undefined) return NA;
  const n = Math.round(pct);
  return `${BOLD}${colorForPct(n)}${n}%${RESET}`;
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
  if (!ms) return NA;
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h${m}m`;
  if (m > 0) return `${m}m${s}s`;
  return `${s}s`;
}

function fmtUsd(n) {
  if (n === null || n === undefined) return NA;
  return `${YELLOW}$${n.toFixed(2)}${RESET}`;
}

function fmtK(n) {
  if (n === null || n === undefined) return null;
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return `${n}`;
}

// Richer git state: branch, ahead/behind vs upstream, staged/modified/untracked counts.
function getGitState(cwd) {
  try {
    const out = execSync('git status --porcelain --branch', {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1000,
    }).toString();
    const lines = out.split('\n').filter(Boolean);
    if (!lines.length || !lines[0].startsWith('##')) return null;

    const branchLine = lines[0].slice(3);
    const branch = branchLine.split('...')[0].split(' ')[0];
    const aheadMatch = branchLine.match(/ahead (\d+)/);
    const behindMatch = branchLine.match(/behind (\d+)/);
    const ahead = aheadMatch ? parseInt(aheadMatch[1], 10) : 0;
    const behind = behindMatch ? parseInt(behindMatch[1], 10) : 0;

    let staged = 0, modified = 0, untracked = 0;
    for (let i = 1; i < lines.length; i++) {
      const code = lines[i].slice(0, 2);
      if (code === '??') { untracked++; continue; }
      if (code[0] !== ' ') staged++;
      if (code[1] !== ' ') modified++;
    }

    return { branch, ahead, behind, staged, modified, untracked };
  } catch (e) {
    return null;
  }
}

// label value with a dim, lowercase label so values pop against it
function labeled(label, value, labelColor = GRAY) {
  return `${labelColor}${label}${RESET} ${value}`;
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

  const git = getGitState(cwd);
  let branch = git?.branch || data.worktree?.branch || '';

  // --- Line 1: identity — model, session, mode, directory, git ---
  const line1 = [];
  line1.push(`${BOLD}${CYAN}${model}${RESET}`);

  line1.push(labeled('session', data.session_name ? data.session_name : NA));

  const flags = [];
  if (data.effort?.level) flags.push(data.effort.level);
  if (data.thinking?.enabled) flags.push('think');
  if (data.fast_mode) flags.push('fast');
  line1.push(labeled('mode', flags.length ? flags.join(', ') : `${GRAY}standard${RESET}`));

  line1.push(`${BOLD}${BLUE}${dirName}${RESET}`);

  let gitVal = NA;
  if (branch) {
    gitVal = `${MAGENTA}${branch}${RESET}`;
    if (git) {
      const bits = [];
      if (git.ahead) bits.push(`${GREEN}↑${git.ahead}${RESET}`);
      if (git.behind) bits.push(`${RED}↓${git.behind}${RESET}`);
      if (git.staged) bits.push(`${GREEN}+${git.staged}${RESET}`);
      if (git.modified) bits.push(`${YELLOW}~${git.modified}${RESET}`);
      if (git.untracked) bits.push(`${GRAY}?${git.untracked}${RESET}`);
      if (bits.length) gitVal += ` ${bits.join(' ')}`;
    }
  }
  line1.push(labeled('git', gitVal));

  // --- Line 2: limits — context window (with token counts), token threshold, 5h and 7d rate limits ---
  const line2 = [];
  const ctxPctRaw = data.context_window?.used_percentage;
  const ctxUsed = data.context_window?.total_input_tokens;
  const ctxSize = data.context_window?.context_window_size;
  let ctxVal = fmtPct(ctxPctRaw);
  if (ctxPctRaw !== null && ctxPctRaw !== undefined && ctxUsed != null && ctxSize != null) {
    ctxVal += ` ${GRAY}${fmtK(ctxUsed)}/${fmtK(ctxSize)}${RESET}`;
  }
  line2.push(labeled('ctx', ctxVal));
  line2.push(labeled('200k+', data.exceeds_200k_tokens ? `${BOLD}${RED}yes${RESET}` : `${GRAY}no${RESET}`));

  const fiveHour = data.rate_limits?.five_hour;
  const fiveHourPct = fmtPct(fiveHour?.used_percentage);
  const fiveHourResets = fmtResetsAt(fiveHour?.resets_at);
  line2.push(labeled('5h', `${fiveHourPct}${fiveHourResets ? ` ${GRAY}resets ${fiveHourResets}${RESET}` : ''}`));

  const sevenDay = data.rate_limits?.seven_day;
  const sevenDayPct = fmtPct(sevenDay?.used_percentage);
  const sevenDayResets = fmtResetsAt(sevenDay?.resets_at);
  line2.push(labeled('7d', `${sevenDayPct}${sevenDayResets ? ` ${GRAY}resets ${sevenDayResets}${RESET}` : ''}`));

  // --- Line 3: session — cost, elapsed time, lines changed ---
  const line3 = [];
  line3.push(labeled('cost', fmtUsd(data.cost?.total_cost_usd)));
  line3.push(labeled('time', fmtDuration(data.cost?.total_duration_ms)));
  const added = data.cost?.total_lines_added;
  const removed = data.cost?.total_lines_removed;
  line3.push(labeled('diff', `${GREEN}+${added || 0}${RESET} ${RED}-${removed || 0}${RESET}`));

  // --- Line 4: context — worktree, PR/MR, agent, vim mode, output style ---
  const line4 = [];
  line4.push(labeled('wt', data.worktree?.name ? data.worktree.name : NA));

  if (data.pr?.number) {
    const kind = data.pr.kind === 'mr' ? 'MR' : 'PR';
    const state = data.pr.review_state ? ` ${GRAY}(${data.pr.review_state})${RESET}` : '';
    line4.push(labeled('pr', `${BOLD}${BLUE}${kind}#${data.pr.number}${RESET}${state}`));
  } else {
    line4.push(labeled('pr', NA));
  }

  line4.push(labeled('agent', data.agent?.name ? data.agent.name : NA));
  line4.push(labeled('vim', data.vim?.mode ? `${BOLD}${MAGENTA}${data.vim.mode}${RESET}` : NA));
  line4.push(labeled('style', data.output_style?.name ? data.output_style.name : NA));

  const lines = [line1, line2, line3, line4].map((segs) => segs.join(SEP));
  process.stdout.write(lines.join('\n'));
});
