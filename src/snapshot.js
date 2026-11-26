'use strict';

const { execFile } = require('child_process');

// Per-process counters that explain what kind of memory or resource is growing. Plain Windows process data,
// no game offsets: private bytes, working set, pools, handles, threads, GDI and USER objects.
const PS = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -Namespace IramSnap -Name G -MemberDefinition '[DllImport("user32.dll")] public static extern uint GetGuiResources(System.IntPtr h, uint f);'
$ids = @(%PIDS%)
$out = @()
foreach ($id in $ids) {
  $p = Get-Process -Id $id
  if (-not $p) { continue }
  $out += [pscustomobject]@{
    pid = $p.Id
    workingSetMB = [math]::Round($p.WorkingSet64 / 1MB, 1)
    privateMB = [math]::Round($p.PrivateMemorySize64 / 1MB, 1)
    virtualMB = [math]::Round($p.VirtualMemorySize64 / 1MB, 1)
    pagedPoolKB = [math]::Round($p.PagedMemorySize64 / 1KB, 0)
    nonPagedPoolKB = [math]::Round($p.NonpagedSystemMemorySize64 / 1KB, 0)
    handles = $p.HandleCount
    threads = $p.Threads.Count
    gdi = [IramSnap.G]::GetGuiResources($p.Handle, 0)
    user = [IramSnap.G]::GetGuiResources($p.Handle, 1)
  }
}
ConvertTo-Json -InputObject @($out) -Compress
`;

/** Pure: builds the script for a list of pids (only integers are accepted). */
function buildScript(pids) {
  const ids = (pids || []).map((p) => Math.trunc(Number(p))).filter((n) => Number.isInteger(n) && n > 0 && n < 2 ** 31);
  return PS.replace('%PIDS%', ids.join(','));
}

/** Pure: parses the script output; anything unparsable gives []. */
function parseOutput(text) {
  try {
    const v = JSON.parse(String(text).trim());
    return (Array.isArray(v) ? v : [v]).filter((x) => x && Number.isFinite(x.pid));
  } catch { return []; }
}

/** Pure: per-pid change between two snapshots ({at, rows}). Only pids present in both. */
function diffSnapshots(a, b) {
  const minutes = Math.max(0.001, (b.at - a.at) / 60e3);
  const byPid = new Map(a.rows.map((r) => [r.pid, r]));
  const fields = ['workingSetMB', 'privateMB', 'virtualMB', 'pagedPoolKB', 'nonPagedPoolKB', 'handles', 'threads', 'gdi', 'user'];
  const out = [];
  for (const r of b.rows) {
    const o = byPid.get(r.pid);
    if (!o) continue;
    const d = { pid: r.pid, minutes: Math.round(minutes * 10) / 10 };
    for (const f of fields) { d[f] = Math.round((r[f] - o[f]) * 10) / 10; d[f + 'PerMin'] = Math.round(((r[f] - o[f]) / minutes) * 10) / 10; }
    out.push(d);
  }
  return out;
}

function collect(pids, { run = execFile } = {}) {
  return new Promise((resolve) => {
    const ids = (pids || []).filter((p) => Number.isInteger(p) && p > 0);
    if (!ids.length) return resolve({ at: Date.now(), rows: [] });
    run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', buildScript(ids)], { windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      resolve({ at: Date.now(), rows: err ? [] : parseOutput(stdout), error: err ? err.message : '' });
    });
  });
}

module.exports = { buildScript, parseOutput, diffSnapshots, collect };
