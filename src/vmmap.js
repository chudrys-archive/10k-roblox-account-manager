'use strict';
// A small stand-in for Sysinternals VMMap: walks a client's address space with VirtualQueryEx and totals what is committed
// by kind (private, image, mapped) and by protection, plus the biggest private blocks. Plain Windows data, no game offsets.
// It cannot split private memory into heap, stack or managed memory: that needs heap walking and symbols.
const { execFile } = require('child_process');

const CS = `
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
public static class IramVm {
  [StructLayout(LayoutKind.Sequential)]
  public struct MBI { public ulong BaseAddress; public ulong AllocationBase; public uint AllocationProtect; public uint Align1; public ulong RegionSize; public uint State; public uint Protect; public uint Type; public uint Align2; }
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll")] static extern UIntPtr VirtualQueryEx(IntPtr h, UIntPtr addr, out MBI mbi, UIntPtr len);
  static string Mb(ulong b) { return (b / 1048576.0).ToString("0.0", CultureInfo.InvariantCulture); }
  public static string Scan(int pid) {
    IntPtr h = OpenProcess(0x0400, false, pid);
    if (h == IntPtr.Zero) return "{\\"pid\\":" + pid + ",\\"error\\":\\"access denied\\"}";
    ulong priv = 0, image = 0, mapped = 0, reserved = 0, rw = 0, rwx = 0, ro = 0, other = 0, largest = 0;
    int regions = 0, privRegions = 0;
    List<ulong[]> top = new List<ulong[]>();
    ulong addr = 0; MBI m; UIntPtr len = (UIntPtr)Marshal.SizeOf(typeof(MBI));
    int guard = 0;
    while (guard++ < 3000000 && VirtualQueryEx(h, (UIntPtr)addr, out m, len) != UIntPtr.Zero) {
      ulong size = m.RegionSize;
      if (size == 0) break;
      if (m.State == 0x1000) {
        regions++;
        if (m.Type == 0x20000) {
          priv += size; privRegions++;
          uint p = m.Protect & 0xFF;
          if (p == 0x04 || p == 0x08) rw += size;
          else if (p == 0x40 || p == 0x80) rwx += size;
          else if (p == 0x02 || p == 0x10 || p == 0x20) ro += size;
          else other += size;
          if (size > largest) largest = size;
          if (top.Count < 10 || size > top[top.Count - 1][0]) {
            top.Add(new ulong[] { size, m.BaseAddress, m.Protect });
            top.Sort(delegate(ulong[] a, ulong[] b) { return b[0].CompareTo(a[0]); });
            if (top.Count > 10) top.RemoveAt(10);
          }
        }
        else if (m.Type == 0x1000000) image += size;
        else if (m.Type == 0x40000) mapped += size;
      } else if (m.State == 0x2000) reserved += size;
      ulong next = m.BaseAddress + size;
      if (next <= addr) break;
      addr = next;
      if (addr >= 0x7FFFFFFF0000UL) break;
    }
    CloseHandle(h);
    StringBuilder sb = new StringBuilder();
    sb.Append("{\\"pid\\":" + pid + ",\\"privateMB\\":" + Mb(priv) + ",\\"readWriteMB\\":" + Mb(rw) + ",\\"execWriteMB\\":" + Mb(rwx) + ",\\"readOnlyMB\\":" + Mb(ro) + ",\\"otherPrivateMB\\":" + Mb(other));
    sb.Append(",\\"imageMB\\":" + Mb(image) + ",\\"mappedMB\\":" + Mb(mapped) + ",\\"reservedMB\\":" + Mb(reserved));
    sb.Append(",\\"regions\\":" + regions + ",\\"privateRegions\\":" + privRegions + ",\\"largestPrivateMB\\":" + Mb(largest) + ",\\"top\\":[");
    for (int i = 0; i < top.Count; i++) {
      if (i > 0) sb.Append(",");
      sb.Append("{\\"baseHex\\":\\"0x" + top[i][1].ToString("X") + "\\",\\"mb\\":" + Mb(top[i][0]) + ",\\"protect\\":" + top[i][2] + "}");
    }
    sb.Append("]}");
    return sb.ToString();
  }
}
`;

const PS = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
${CS}
'@
$ids = @(%PIDS%)
$out = @()
foreach ($id in $ids) { $out += [IramVm]::Scan($id) }
'[' + ($out -join ',') + ']'
`;

/** Pure: the script for a list of pids (only positive integers are accepted). */
function buildScript(pids) {
  const ids = (pids || []).map((p) => Math.trunc(Number(p))).filter((n) => Number.isInteger(n) && n > 0 && n < 2 ** 31);
  return PS.replace('%PIDS%', ids.join(','));
}

/** Pure: script output -> rows. Anything unparsable gives []. */
function parseOutput(text) {
  try {
    const v = JSON.parse(String(text).trim());
    return (Array.isArray(v) ? v : [v]).filter((x) => x && Number.isFinite(x.pid));
  } catch { return []; }
}

const FIELDS = ['privateMB', 'readWriteMB', 'execWriteMB', 'readOnlyMB', 'imageMB', 'mappedMB', 'reservedMB', 'regions', 'largestPrivateMB'];

/** Pure: per-pid change between two maps ({at, rows}), per minute. Only pids present in both. */
function diffMaps(a, b) {
  const minutes = Math.max(0.001, (b.at - a.at) / 60e3);
  const byPid = new Map(a.rows.filter((r) => !r.error).map((r) => [r.pid, r]));
  const out = [];
  for (const r of b.rows) {
    const o = byPid.get(r.pid);
    if (!o || r.error) continue;
    const d = { pid: r.pid, minutes: Math.round(minutes * 10) / 10 };
    for (const f of FIELDS) d[f + 'PerMin'] = Math.round(((r[f] - o[f]) / minutes) * 10) / 10;
    out.push(d);
  }
  return out;
}

function collect(pids, { run = execFile } = {}) {
  return new Promise((resolve) => {
    const ids = (pids || []).filter((p) => Number.isInteger(p) && p > 0);
    if (!ids.length) return resolve({ at: Date.now(), rows: [] });
    run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', buildScript(ids)], { windowsHide: true, timeout: 90000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      resolve({ at: Date.now(), rows: err ? [] : parseOutput(stdout), error: err ? err.message : '' });
    });
  });
}

module.exports = { buildScript, parseOutput, diffMaps, collect, FIELDS };
