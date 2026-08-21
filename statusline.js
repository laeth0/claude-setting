#!/usr/bin/env node
const { execSync } = require('child_process');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  let data = {};
  try { data = JSON.parse(input); } catch (e) {}

  const model = (data.model && data.model.display_name) || 'Claude';
  const cwd = (data.workspace && data.workspace.current_dir) || process.cwd();
  const dirName = cwd.split(/[\\/]/).filter(Boolean).pop() || cwd;

  let branch = '';
  try {
    branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
  } catch (e) {}

  const parts = [model, dirName];
  if (branch) parts.push(`git:${branch}`);

  process.stdout.write(parts.join('  '));
});
