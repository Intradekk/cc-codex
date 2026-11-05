// Claude Code status line:
// subscription: 🤖 model (effort) | 🌿 branch | heat: 5m | 5h: 10% (42m) | ctx: 75k/1M
// API:          🤖 model (effort) | 🌿 branch | cache: 83% | cost: $0.031 | ctx: 75k/1M
//
// Subscription sessions report rate-limit windows; API sessions do not, so the
// 5-hour window is replaced by the session's spend. DeepSeek needs its own path:
// Claude Code stamps Anthropic's 5m cache TTL on it (DeepSeek's cache is
// automatic, best-effort, with no published TTL) and prices unknown models with
// a Claude fallback rate, so cost here is summed from the transcripts at
// DeepSeek's own rates.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const PURPLE = '\x1b[38;5;135m';
const GREEN = '\x1b[38;5;114m';
const ORANGE = '\x1b[38;5;208m';
const YELLOW = '\x1b[38;5;220m';
const RED = '\x1b[38;5;196m';
const GRAY = '\x1b[38;5;244m';
const RESET = '\x1b[0m';

const input = JSON.parse(await new Promise((resolve) => {
  let data = '';
  process.stdin.on('data', (chunk) => (data += chunk));
  process.stdin.on('end', () => resolve(data || '{}'));
}));

const read = (file) => {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
};

const tokens = (n) => {
  if (n >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
};

// $0.031-style formatting; keeps sub-cent sessions readable.
const usd = (value) => {
  if (value < 0.001) return '<$0.001';
  return `$${value.toFixed(value < 10 ? 3 : 2)}`;
};

// The main transcript is also read for the ultracode marker; keep one copy.
let mainTranscript;
const mainTranscriptText = () => {
  if (mainTranscript === undefined) {
    mainTranscript = input.transcript_path ? read(input.transcript_path) : null;
  }
  return mainTranscript;
};

// DeepSeek's endpoint ignores Anthropic's cache TTL semantics and is priced far
// below Claude, so detect it from the base URL / model id instead of guessing.
const deepSeek = (() => {
  const baseUrl = process.env.ANTHROPIC_BASE_URL ?? '';
  try {
    const host = baseUrl ? new URL(baseUrl).hostname.toLowerCase() : '';
    if (host === 'deepseek.com' || host.endsWith('.deepseek.com')) return true;
  } catch {}
  return /deepseek/i.test(String(input.model?.id ?? ''));
})();

// DeepSeek USD per 1M tokens: cache-hit input / cache-miss input / output.
// Off-peak is exactly half of peak. Cache writes are billed at the miss rate.
// Peak = Beijing time (UTC+8), Mon-Fri 09:00-12:00 and 14:00-18:00; Chinese
// public holidays are not modelled and are billed as peak here.
const DEEPSEEK_PRICES = {
  flash: {
    peak: { hit: 0.006, miss: 0.3, out: 1.2 },
    offPeak: { hit: 0.003, miss: 0.15, out: 0.6 },
  },
  pro: {
    peak: { hit: 0.044, miss: 1.32, out: 3.96 },
    offPeak: { hit: 0.022, miss: 0.66, out: 1.98 },
  },
};

const deepseekPrices = (model) => (/pro/i.test(String(model ?? '')) ? DEEPSEEK_PRICES.pro : DEEPSEEK_PRICES.flash);

const isPeak = (timestamp) => {
  const at = Date.parse(timestamp);
  if (Number.isNaN(at)) return false;
  const beijing = new Date(at + 8 * 60 * 60 * 1000);
  const day = beijing.getUTCDay();
  const hour = beijing.getUTCHours();
  return day >= 1 && day <= 5 && ((hour >= 9 && hour < 12) || (hour >= 14 && hour < 18));
};

// The session transcript plus every subagent transcript that ran under it.
const transcriptFiles = () => {
  const files = [];
  if (input.transcript_path) files.push(input.transcript_path);
  if (input.transcript_path && input.session_id) {
    const subagents = join(dirname(input.transcript_path), input.session_id, 'subagents');
    try {
      for (const name of readdirSync(subagents)) {
        if (name.endsWith('.jsonl')) files.push(join(subagents, name));
      }
    } catch {}
  }
  return files;
};

// Sum API usage once per response (streamed chunks repeat the same message id
// and usage), including subagent calls, at the rates of the model that served it.
const deepseekCost = () => {
  const files = transcriptFiles();
  if (!files.length) return null;
  const seen = new Set();
  let total = 0;
  for (const file of files) {
    const text = file === input.transcript_path ? mainTranscriptText() : read(file);
    if (!text) continue;
    for (const line of text.split('\n')) {
      if (!line.includes('"usage"')) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      const usage = entry.message?.usage;
      if (!usage) continue;
      if (entry.sessionId && input.session_id && entry.sessionId !== input.session_id) continue;
      const key = entry.message.id ?? entry.uuid;
      if (seen.has(key)) continue;
      seen.add(key);
      const prices = deepseekPrices(entry.message.model ?? entry.requestedModel);
      const rate = isPeak(entry.timestamp) ? prices.peak : prices.offPeak;
      total += ((usage.input_tokens ?? 0) * rate.miss
        + (usage.cache_creation_input_tokens ?? 0) * rate.miss
        + (usage.cache_read_input_tokens ?? 0) * rate.hit
        + (usage.output_tokens ?? 0) * rate.out) / 1e6;
    }
  }
  return total;
};

const branch = () => {
  try {
    const cwd = input.workspace?.current_dir ?? input.cwd ?? process.cwd();
    return execFileSync('git', ['-C', cwd, 'branch', '--show-current'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null;
  } catch {
    return null;
  }
};

// stdin has no ultracode field: the transcript logs each toggle as an
// ultra_effort_* attachment; without one, fall back to the settings default.
const ultracode = () => {
  const transcript = mainTranscriptText();
  const marker = '"type":"ultra_effort_';
  const at = transcript ? transcript.lastIndexOf(marker) : -1;
  if (at >= 0) return transcript.startsWith('enter"', at + marker.length);

  const project = input.workspace?.project_dir ?? input.cwd;
  const files = [
    join(homedir(), '.claude', 'settings.json'),
    project && join(project, '.claude', 'settings.json'),
    project && join(project, '.claude', 'settings.local.json'),
  ];
  let on = false;
  for (const file of files.filter(Boolean)) {
    try {
      const value = JSON.parse(read(file) ?? '{}').ultracode;
      if (typeof value === 'boolean') on = value;
    } catch {}
  }
  return on;
};

const model = () => {
  const name = input.model?.display_name ?? input.model?.id ?? '?';
  const effort = input.effort?.level;
  if (!effort) return `🤖 ${name}`;
  return `🤖 ${name} (${ultracode() ? `${PURPLE}${effort}${RESET}` : effort})`;
};

const heat = () => {
  const cache = input.prompt_cache;
  if (!cache) return null;
  if (cache.caching_observed === false) return `cache: ${GRAY}off${RESET}`;

  // DeepSeek keeps its cache automatically for hours to days, so the 5m TTL
  // Claude Code assumes would show a false "cold" on every slow turn. Report
  // the measured cache-hit share instead of a fictitious countdown.
  if (deepSeek) {
    if (cache.hit_ratio == null) return null;
    const percent = Math.round(cache.hit_ratio * 100);
    const color = percent >= 70 ? GREEN : percent >= 40 ? YELLOW : RED;
    return `cache: ${color}${percent}%${RESET}`;
  }

  if (!cache.warm || !cache.expires_at) return `heat: ${GRAY}cold${RESET}`;
  const left = cache.expires_at - Date.now() / 1000;
  if (left <= 0) return `heat: ${GRAY}cold${RESET}`;
  const minutes = Math.ceil(left / 60);
  const color = minutes > 10 ? ORANGE : minutes > 2 ? YELLOW : RED;
  return `heat: ${color}${minutes}m${RESET}`;
};

const limitWindow = (label, limit) => {
  if (!limit || limit.used_percentage == null) return null;
  const percent = limit.used_percentage;
  const color = percent >= 80 ? RED : percent >= 50 ? YELLOW : GREEN;
  const left = limit.resets_at ? Math.max(0, Math.ceil((limit.resets_at - Date.now() / 1000) / 60)) : null;
  const reset = left == null ? '' : ` ${GRAY}(${left}m)${RESET}`;
  return `${label}: ${color}${Math.round(percent)}%${RESET}${reset}`;
};

const spendLimit = (limit) => {
  if (!limit || limit.used_percentage == null) return null;
  const percent = limit.used_percentage;
  const color = percent >= 80 ? RED : percent >= 50 ? YELLOW : GREEN;
  const money = limit.used_usd != null && limit.limit_usd != null
    ? ` ${GRAY}(${usd(limit.used_usd)}/${usd(limit.limit_usd)})${RESET}`
    : '';
  return `spend: ${color}${Math.round(percent)}%${RESET}${money}`;
};

const cost = () => {
  // Claude Code's total_cost_usd is a Claude-list-price estimate for unknown
  // third-party models, so never show it as DeepSeek spend.
  const value = deepSeek ? deepseekCost() : input.cost?.total_cost_usd;
  if (value == null) return deepSeek ? `cost: ${GRAY}-${RESET}` : null;
  const color = value >= 5 ? RED : value >= 1 ? ORANGE : GREEN;
  return `cost: ${color}${usd(value)}${RESET}`;
};

// Subscribers keep the 5h/7d windows; API sessions fall through to spend.
const limits = () => {
  const windows = input.rate_limits ?? {};
  return limitWindow('5h', windows.five_hour)
    ?? limitWindow('7d', windows.seven_day)
    ?? spendLimit(windows.spend_limit)
    ?? cost();
};

const ctx = input.context_window ?? {};
const usage = ctx.current_usage ?? {};
const used = (usage.input_tokens ?? 0)
  + (usage.cache_creation_input_tokens ?? 0)
  + (usage.cache_read_input_tokens ?? 0);
const gitBranch = branch();

const parts = [
  model(),
  gitBranch && `🌿 ${gitBranch}`,
  heat(),
  limits(),
  `ctx: ${tokens(used)}/${ctx.context_window_size ? tokens(ctx.context_window_size) : '?'}`,
];

process.stdout.write(parts.filter(Boolean).join(' | '));
