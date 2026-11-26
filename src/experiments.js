'use strict';

const fs = require('fs');
const path = require('path');
const { linearSlope, WARMUP_MS } = require('./metrics');

const MIN_CLIENTS_FOR_VERDICT = 3;
const MIN_SLOPE_DIFF_MB_MIN = 3;   // growth rates closer than this are noise on this PC
const MIN_SLOPE_DIFF_RATIO = 0.25; // and so are differences under a quarter of the larger rate

const median = (a) => {
  const v = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

/**
 * Pure: turns raw samples (key -> [{t, v}] in MB) into one arm's numbers. Points inside the warm-up
 * window are ignored; a client with too little post-warm-up data gets a null slope.
 */
function summarizeArm(series, { warmupMs = WARMUP_MS } = {}) {
  const perClient = [];
  for (const [key, pts] of series) {
    if (!pts.length) continue;
    const t0 = pts[0].t;
    const use = pts.filter((p) => p.t - t0 >= warmupMs);
    perClient.push({
      key,
      points: pts.length,
      lastMB: Math.round(pts[pts.length - 1].v),
      baselineMB: use.length ? Math.round(mean(use.map((p) => p.v))) : null,
      slopeMBMin: use.length ? linearSlope(use) : null,
    });
  }
  const slopes = perClient.map((c) => c.slopeMBMin).filter((x) => x !== null);
  const bases = perClient.map((c) => c.baselineMB).filter((x) => x !== null);
  return {
    clients: perClient.length,
    measured: slopes.length,
    baselineMB: bases.length ? Math.round(median(bases)) : null,
    slopeMBMin: slopes.length ? Math.round(median(slopes) * 10) / 10 : null,
    perClient,
  };
}

/** Pure: plain-language comparison of two arms. Says "not enough data" instead of guessing. */
function compareArms(a, b) {
  if (a.measured < MIN_CLIENTS_FOR_VERDICT || b.measured < MIN_CLIENTS_FOR_VERDICT) {
    return { verdict: 'not-enough-data', text: `needs at least ${MIN_CLIENTS_FOR_VERDICT} measured clients per arm (had ${a.measured} and ${b.measured})` };
  }
  const d = b.slopeMBMin - a.slopeMBMin;
  const big = Math.max(Math.abs(a.slopeMBMin), Math.abs(b.slopeMBMin));
  const real = Math.abs(d) >= MIN_SLOPE_DIFF_MB_MIN && Math.abs(d) >= MIN_SLOPE_DIFF_RATIO * big;
  return {
    verdict: !real ? 'no-clear-difference' : d < 0 ? 'second-grows-less' : 'second-grows-more',
    slopeDeltaMBMin: Math.round(d * 10) / 10,
    baselineDeltaMB: a.baselineMB !== null && b.baselineMB !== null ? b.baselineMB - a.baselineMB : null,
    text: !real ? 'growth rates are within noise of each other' : `second arm grows ${Math.abs(Math.round(d * 10) / 10)} MB/min ${d < 0 ? 'less' : 'more'}`,
  };
}

function reportMarkdown(exp) {
  const L = [];
  L.push(`# ${exp.name}`, '');
  L.push(`Variable: ${exp.variable}. ${exp.clients} client(s) per arm, ${exp.minutes} min per arm. Started ${new Date(exp.startedAt).toISOString()}.`, '');
  L.push('| Arm | Clients measured | Baseline (MB, median) | Growth (MB/min, median) |', '| --- | --- | --- | --- |');
  for (const r of exp.results) L.push(`| ${r.label} | ${r.summary.measured}/${r.summary.clients} | ${r.summary.baselineMB ?? 'n/a'} | ${r.summary.slopeMBMin ?? 'n/a'} |`);
  if (exp.results.length >= 2) {
    L.push('');
    for (let i = 1; i < exp.results.length; i++) {
      const c = compareArms(exp.results[0].summary, exp.results[i].summary);
      L.push(`- ${exp.results[0].label} vs ${exp.results[i].label}: ${c.text}.`);
    }
  }
  L.push('', 'Private commit per client, one variable changed between arms, same accounts and game in every arm. Slopes ignore each client\'s first 5 minutes.');
  return L.join('\n') + '\n';
}

/**
 * Runs the arms one after another through an injected api, so the logic is testable without Roblox:
 *   api.apply(variable, value), api.launch(accountIds), api.sample() -> [{key, privMB}],
 *   api.closeAll() (resolves when every client is gone), api.sleep(ms), api.now().
 * The setting is restored in a finally block, whatever happens.
 */
class Experiment {
  constructor({ name, variable, arms, accountIds, minutes, api, sampleMs = 15000, dir = null, original }) {
    if (!variable || !Array.isArray(arms) || arms.length < 2) throw new Error('an experiment needs a variable and at least two arms');
    if (!Array.isArray(accountIds) || accountIds.length < 1) throw new Error('pick at least one account');
    if (!(minutes >= 1)) throw new Error('minutes must be at least 1');
    Object.assign(this, { name: name || `${variable} A/B`, variable, arms, accountIds, minutes, api, sampleMs, dir, original });
    this.state = { status: 'idle', arm: -1, phase: '', startedAt: 0, endedAt: 0, error: '' };
    this.results = [];
    this.abort = false;
  }

  view() {
    return { name: this.name, variable: this.variable, clients: this.accountIds.length, minutes: this.minutes, ...this.state, results: this.results.map((r) => ({ label: r.label, value: r.value, summary: { ...r.summary, perClient: undefined } })) };
  }

  stop() { this.abort = true; }

  async run() {
    const { api } = this;
    this.state = { status: 'running', arm: 0, phase: 'starting', startedAt: api.now(), endedAt: 0, error: '' };
    try {
      for (let i = 0; i < this.arms.length && !this.abort; i++) {
        const arm = this.arms[i];
        this.state.arm = i; this.state.phase = 'applying setting';
        await api.apply(this.variable, arm.value);
        this.state.phase = 'launching';
        await api.launch(this.accountIds);
        const series = new Map();
        const began = api.now();
        this.state.phase = 'measuring';
        while (api.now() - began < this.minutes * 60e3 && !this.abort) {
          await api.sleep(this.sampleMs);
          const t = api.now();
          for (const s of api.sample()) {
            if (!series.has(s.key)) series.set(s.key, []);
            series.get(s.key).push({ t, v: s.privMB });
          }
        }
        this.state.phase = 'closing';
        await api.closeAll();
        if (!this.abort) this.results.push({ label: arm.label, value: arm.value, summary: summarizeArm(series) });
      }
      this.state.status = this.abort ? 'stopped' : 'done';
    } catch (e) {
      this.state.status = 'failed';
      this.state.error = e.message;
    } finally {
      try { if (this.original !== undefined) await api.apply(this.variable, this.original); } catch { /* best effort */ }
      this.state.endedAt = api.now();
      this.state.phase = '';
      this.save();
    }
    return this.view();
  }

  save() {
    if (!this.dir || !this.results.length) return null;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const base = path.join(this.dir, `${new Date(this.state.startedAt).toISOString().replace(/[:.]/g, '-')}-${this.variable}`);
      const exp = { name: this.name, variable: this.variable, clients: this.accountIds.length, minutes: this.minutes, startedAt: this.state.startedAt, results: this.results };
      fs.writeFileSync(base + '.json', JSON.stringify(exp, null, 1));
      fs.writeFileSync(base + '.md', reportMarkdown(exp));
      return base;
    } catch { return null; }
  }
}

module.exports = { Experiment, summarizeArm, compareArms, reportMarkdown, MIN_CLIENTS_FOR_VERDICT };
