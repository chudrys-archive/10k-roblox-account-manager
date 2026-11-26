'use strict';
// Script check: reads Luau/Lua scripts you run next to your clients and points at patterns that usually make a long session
// use more and more memory or CPU. It is a line-based heuristic, not a Lua parser: every finding names its line so you can look,
// and a finding is a reason to look, not proof of a leak.
const fs = require('fs');
const path = require('path');

const EXTS = new Set(['.lua', '.luau', '.txt']);
const MAX_FILES = 300;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_DEPTH = 3;

const SEVERITY_ORDER = { warn: 0, info: 1 };

/** Pure: removes comments and the contents of string literals so keywords inside them are not counted. Keeps line breaks. */
function stripCode(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '-' && src[i + 1] === '-') {
      const m = /^--\[(=*)\[/.exec(src.slice(i, i + 40));
      if (m) {
        const close = ']' + m[1] + ']';
        const end = src.indexOf(close, i + m[0].length);
        const stop = end < 0 ? n : end + close.length;
        out += src.slice(i, stop).replace(/[^\n]/g, ' ');
        i = stop;
      } else {
        while (i < n && src[i] !== '\n') i++;
      }
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') j++; j++; }
      out += c + ' '.repeat(Math.max(0, j - i - 1)) + (src[j] === c ? c : '');
      i = src[j] === c ? j + 1 : j; // an unterminated string stops at the line break
    } else if (c === '[' && /^\[=*\[/.test(src.slice(i, i + 40))) {
      const m = /^\[(=*)\[/.exec(src.slice(i, i + 40));
      const close = ']' + m[1] + ']';
      const end = src.indexOf(close, i + m[0].length);
      const stop = end < 0 ? n : end + close.length;
      out += src.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else { out += c; i++; }
  }
  return out;
}

const RULES = {
  noWait: { sev: 'warn', msg: 'A loop that never ends has no wait inside it. It freezes the client or uses a whole CPU core. Add task.wait().' },
  looseConnect: { sev: 'info', msg: 'The connection is not stored. Without a variable it cannot be disconnected later, so it lives until the client closes.' },
  connectInLoop: { sev: 'warn', msg: 'A connection is made inside a loop. Every pass adds another listener, and each one keeps its memory and runs on every event.' },
  httpInLoop: { sev: 'warn', msg: 'Downloading or compiling code inside a loop repeats the network work and keeps every compiled copy in memory.' },
  heavyScan: { sev: 'warn', msg: 'This scans every object in the game. Inside a loop it is slow and builds large temporary tables.' },
  newNoDestroy: { sev: 'warn', msg: 'Objects are created but the script never destroys or removes anything. They pile up for as long as the session runs.' },
  drawNoRemove: { sev: 'warn', msg: 'Drawing objects are created but never removed. Each one stays alive until the client closes.' },
  tableOnlyGrows: { sev: 'info', msg: 'Items are added to a table but the script never removes or clears anything. It can only get bigger.' },
  spawnInLoop: { sev: 'info', msg: 'A new thread is started on every pass of a loop. If they do not finish, they stack up.' },
  printInLoop: { sev: 'info', msg: 'Printing inside a loop fills the output log, which the client keeps in memory.' },
};

const WAIT_RE = /\b(task\.wait|wait)\s*\(|:\s*Wait\s*\(|\bcoroutine\.yield\s*\(/;

/**
 * Pure: findings for one script. Returns [{ line, rule, severity, message, text }] sorted by line.
 * `name` is only echoed into the result.
 */
function auditSource(src) {
  const code = stripCode(String(src || '')).split('\n');
  const orig = String(src || '').split('\n');
  const findings = [];
  const add = (line, rule) => findings.push({ line, rule, severity: RULES[rule].sev, message: RULES[rule].msg, text: (orig[line - 1] || '').trim().slice(0, 140) });

  // block stack: 'loop' | 'inf' (while true) | 'other'
  const stack = [];
  const loops = []; // open infinite loops: { line, hasWait }
  let news = 0, destroys = 0, draws = 0, removes = 0, inserts = 0, shrinks = 0;
  const firsts = { new: 0, draw: 0, insert: 0 };

  for (let i = 0; i < code.length; i++) {
    const ln = i + 1;
    const l = code[i];
    const inLoop = stack.some((b) => b !== 'other');

    // counters for whole-file rules
    if (/\bInstance\.new\s*\(/.test(l)) { news++; if (!firsts.new) firsts.new = ln; }
    if (/:\s*(Destroy|ClearAllChildren)\s*\(|\bDebris\s*:\s*AddItem\s*\(|\.Parent\s*=\s*nil/.test(l)) destroys++;
    if (/\bDrawing\.new\s*\(/.test(l)) { draws++; if (!firsts.draw) firsts.draw = ln; }
    if (/:\s*Remove\s*\(|:\s*Destroy\s*\(/.test(l)) removes++;
    if (/\btable\.insert\s*\(|\[\s*#\s*\w+\s*\+\s*1\s*\]\s*=/.test(l)) { inserts++; if (!firsts.insert) firsts.insert = ln; }
    if (/\btable\.(remove|clear)\s*\(|=\s*nil\b|\btable\.clone\b|table\.move\b/.test(l)) shrinks++;

    // line rules
    if (/:\s*Connect\s*\(/.test(l) || /\bConnect\s*\(\s*function/.test(l)) {
      if (inLoop) add(ln, 'connectInLoop');
      else if (!/^\s*(local\s+)?[^=\s(][^=]*=\s*[^=]/.test(l) && !/^\s*table\.insert\s*\(/.test(l) && /(Heartbeat|RenderStepped|Stepped|Changed|ChildAdded|DescendantAdded|InputBegan|PlayerAdded|CharacterAdded|Touched)\s*:\s*Connect/.test(l)) add(ln, 'looseConnect');
    }
    if (inLoop && /\bHttpGet(Async)?\s*\(|\bloadstring\s*\(|\bRequestAsync\s*\(|\brequest\s*\(\s*\{/.test(l)) add(ln, 'httpInLoop');
    if (inLoop && /\bgetgc\s*\(|\bgetinstances\s*\(|\bgetnilinstances\s*\(|:\s*GetDescendants\s*\(\s*\)/.test(l)) add(ln, 'heavyScan');
    if (inLoop && /\b(task\.spawn|spawn|coroutine\.wrap|coroutine\.create)\s*\(/.test(l)) add(ln, 'spawnInLoop');
    if (inLoop && /^\s*(print|warn)\s*\(/.test(l)) add(ln, 'printInLoop');

    // block tracking
    const lineHasWait = WAIT_RE.test(l);
    if (lineHasWait) for (const o of loops) o.hasWait = true;
    const tokens = l.match(/\b(function|do|then|repeat|until|end|while|for|if|elseif|else)\b/g) || [];
    let isLoopLine = false;
    for (let k = 0; k < tokens.length; k++) {
      const t = tokens[k];
      if (t === 'while' || t === 'for') isLoopLine = true;
      else if (t === 'repeat') { stack.push('loop'); }
      else if (t === 'do') {
        if (isLoopLine) {
          const inf = /\bwhile\s+(true|1)\s+do\b/.test(l) || /\bfor\s+[\w,\s]*=\s*[^,]+,\s*(math\.huge|1e\d+)\b/.test(l);
          stack.push(inf ? 'inf' : 'loop');
          if (inf) loops.push({ line: ln, depth: stack.length, hasWait: false });
          isLoopLine = false;
        } else stack.push('other'); // a bare do ... end block
      } else if (t === 'then' || t === 'function') stack.push('other');
      else if (t === 'end' || t === 'until') {
        const b = stack.pop();
        if (b === 'inf') { const o = loops.pop(); if (o && !o.hasWait && !lineHasWait) add(o.line, 'noWait'); }
      }
    }
  }
  for (const o of loops) if (!o.hasWait) add(o.line, 'noWait'); // never closed: still report it

  if (news >= 5 && destroys === 0) add(firsts.new, 'newNoDestroy');
  if (draws >= 3 && removes === 0) add(firsts.draw, 'drawNoRemove');
  if (inserts >= 5 && shrinks === 0) add(firsts.insert, 'tableOnlyGrows');

  const seen = new Set();
  return findings
    .filter((f) => { const k = f.line + f.rule; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.line - b.line || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

/** Lists script files under a file or folder (depth-limited, capped). Returns { files, skipped }. */
function listScripts(target) {
  const files = [];
  let skipped = 0;
  const walk = (p, depth) => {
    let st;
    try { st = fs.statSync(p); } catch { return; }
    if (st.isDirectory()) {
      if (depth > MAX_DEPTH) return;
      let names = [];
      try { names = fs.readdirSync(p); } catch { return; }
      for (const n of names) { if (n.startsWith('.') || n === 'node_modules') continue; walk(path.join(p, n), depth + 1); }
    } else if (st.isFile() && EXTS.has(path.extname(p).toLowerCase())) {
      if (st.size > MAX_BYTES || files.length >= MAX_FILES) skipped++;
      else files.push(p);
    }
  };
  walk(target, 0);
  return { files, skipped };
}

function auditPath(target) {
  const t = String(target || '').trim().replace(/^"(.*)"$/, '$1');
  if (!t) throw new Error('Enter the folder or file to check');
  if (!fs.existsSync(t)) throw new Error('That folder or file does not exist');
  const { files, skipped } = listScripts(t);
  const results = [];
  for (const f of files) {
    let text;
    try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const findings = auditSource(text);
    results.push({ file: path.relative(fs.statSync(t).isDirectory() ? t : path.dirname(t), f) || path.basename(f), lines: text.split('\n').length, findings });
  }
  const all = results.flatMap((r) => r.findings);
  return {
    checked: results.length, skipped,
    warnings: all.filter((f) => f.severity === 'warn').length, notes: all.filter((f) => f.severity === 'info').length,
    results: results.filter((r) => r.findings.length).sort((a, b) => b.findings.length - a.findings.length),
    clean: results.filter((r) => !r.findings.length).length,
  };
}

module.exports = { auditSource, auditPath, stripCode, listScripts, RULES };
