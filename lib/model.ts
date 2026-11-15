// Token Radar — the value model (radar-4). Implied value is claimed from the snapshot's
// own figures only. The base is a comps curve, fitted at runtime to the protocols that
// already have tokens AND are launches like the ones ranked: exchanges, bridges and
// staking receipts are set aside first, because their market-cap-to-TVL relation is not
// a launch valuation. Least squares on log(market cap) = a + b x log(TVL). No coefficient
// is hardcoded; two blind tests state the error honestly — a slug holdout (every 5th comp)
// and a time split (fitted on the older half of the dated comps, tested on the newer) —
// each against the flat median-ratio multiple on the same test set.
//
//   curve    = exp(a + b x ln(tvl_usd))
//   growthM  = 1 + clamp(change_7d, -50, 100)/100 x 0.6 up, x 1.2 down
//   chainM   = 0.9 + 0.02 x min(chains, 10)
//   catM     = category prior, 0.80..1.06 (stated below; categories, never names)
//   ageM     = 0.65 + 0.35 x ln(1 + min(age,1095)/90) / ln(1 + 1095/90); unknown age counts as 365 days
//   implied  = max(1, round(curve x growthM x chainM x catM x ageM))
//   band     = the middle half of the curve's misses, as a low..high range on the implied value
//   slice    = implied x 10% x $1,000 / tvl_usd (what $1,000 deposited would get if 10% of
//              the launch goes to depositors pro rata)
//   fees     = the plan's transactions x gas per transaction on its first chain (stated table)
//   net      = slice - fees - 4% T-bill yield on $1,000 over the hold
//   verdict  = FARM when net > 0, THIN when the slice beats the fees but not the yield, else SKIP
//
// The board ranks the 40 watchlist protocols plus the 160 strongest pre-token protocols
// below the floor, scored by this same function — not by raw TVL. Live-token protocols
// never enter the board; the dashboard shows their market caps separately. No protocol
// name is ever special-cased: one function scores every row.

/** One protocol of the sealed snapshot: exactly its ten fields. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The sealed snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** Every number the model runs on, stated where the dashboard can quote it. */
export interface ModelConstants {
  growth_up: number;
  growth_down: number;
  growth_floor: number;
  growth_cap: number;
  chain_base: number;
  chain_step: number;
  chain_cap: number;
  maturity_floor: number;
  maturity_span: number;
  maturity_scale_days: number;
  maturity_cap_days: number;
  unknown_age_days: number;
  category_prior: Record<string, number>;
  /** Gas per transaction by first chain, November 2026 L2-era fees, stated on the page. */
  gas_usd: Record<string, number>;
  /** Gas per transaction on a chain the table does not list. */
  gas_default: number;
  /** The risk-free rate the farm gives up: a 4% T-bill, applied to the $1,000 plan. */
  tbill_rate: number;
  /** The share of a launch the page assumes goes to depositors, pro rata. */
  depositor_share: number;
  /** The plan the verdicts are netted on, so every row's verdict is comparable. */
  plan_ticket_usd: number;
}

export const MODEL: ModelConstants = {
  growth_up: 0.6,
  growth_down: 1.2,
  growth_floor: -50,
  growth_cap: 100,
  chain_base: 0.9,
  chain_step: 0.02,
  chain_cap: 10,
  maturity_floor: 0.65,
  maturity_span: 0.35,
  maturity_scale_days: 90,
  maturity_cap_days: 1095,
  unknown_age_days: 365,
  category_prior: {
    Dexs: 1.06,
    Lending: 1.06,
    Yield: 1.04,
    RWA: 1.04,
    Derivatives: 1.03,
    CDP: 1.03,
    'Yield Aggregator': 1.03,
    Bridge: 0.88,
    'Canonical Bridge': 0.88,
    'Liquid Staking': 0.88,
    'Liquid Restaking': 0.88,
    'Restaked BTC': 0.85,
    CEX: 0.8,
  },
  gas_usd: {
    Ethereum: 2.4,
    Base: 0.06,
    Arbitrum: 0.1,
    Optimism: 0.08,
    Polygon: 0.05,
    BSC: 0.15,
    Avalanche: 0.1,
    Solana: 0.01,
    Monad: 0.02,
    Ink: 0.06,
    Sui: 0.02,
    Aptos: 0.02,
  },
  gas_default: 0.5,
  tbill_rate: 0.04,
  depositor_share: 0.1,
  plan_ticket_usd: 1000,
};

export const MODEL_VERSION = 'radar-4';

/** The comps curve, fitted at runtime: log(market cap) = intercept + slope x log(TVL). */
export interface CompsFit {
  intercept: number;
  slope: number;
  comps: number;
  median_ratio: number;
  holdout: number;
  holdout_error: number | null;
  holdout_within3: number | null;
  holdout_within10: number | null;
  /** The flat median-ratio multiple's error on the same held-out set, for comparison. */
  flat_error: number | null;
  flat_within3: number | null;
  /** The time-split backtest: fitted on the older half of the dated comps, tested on the newer. */
  timesplit: number;
  timesplit_error: number | null;
  timesplit_within3: number | null;
  timesplit_within10: number | null;
  timesplit_flat_error: number | null;
  /** The middle half of the full fit's log-residuals, as multipliers on the curve value. */
  band_low: number;
  band_high: number;
}

/** Categories whose tokens are not launches like the ones ranked: exchange tokens,
 *  bridge tokens and staking receipts carry a different market-cap-to-TVL relation,
 *  so they are set aside before the curve is fitted. */
const NON_LAUNCH = new Set([
  'CEX',
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
]);

/** The protocols the curve is fitted on: live-token protocols that are launches. */
export function isLaunchComp(p: SnapshotProtocol): boolean {
  return p.tvl_usd > 0 && p.mcap_usd !== null && p.mcap_usd > 0 && !NON_LAUNCH.has(p.category ?? '');
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** Least squares on (ln TVL, ln market cap); the flat 0.22x multiple, as a curve, when the set cannot be fitted. */
function logFit(pairs: { tvl: number; mcap: number }[]): { a: number; b: number } {
  const n = pairs.length;
  let mx = 0, my = 0;
  for (const p of pairs) { mx += Math.log(p.tvl); my += Math.log(p.mcap); }
  mx /= n; my /= n;
  let sxy = 0, sxx = 0;
  for (const p of pairs) {
    const dx = Math.log(p.tvl) - mx, dy = Math.log(p.mcap) - my;
    sxy += dx * dy; sxx += dx * dx;
  }
  if (n < 2 || sxx === 0 || !Number.isFinite(sxx)) return { a: Math.log(0.22), b: 1 };
  const b = sxy / sxx;
  return { a: my - b * mx, b };
}

/** One backtest on a fitted curve: median absolute error, median ratio, and the
 *  share of test tokens the prediction lands within 3x and within 10x of. */
function backtest(fit: { a: number; b: number }, test: { tvl: number; mcap: number }[]): { error: number | null; ratio: number | null; within3: number | null; within10: number | null } {
  if (test.length === 0) return { error: null, ratio: null, within3: null, within10: null };
  const errs = test.map((p) => (Math.abs(Math.exp(fit.a + fit.b * Math.log(p.tvl)) - p.mcap) / p.mcap) * 100);
  const ratios = test.map((p) => Math.exp(fit.a + fit.b * Math.log(p.tvl)) / p.mcap);
  return {
    error: Math.round(median(errs) * 10) / 10,
    ratio: round4(median(ratios)),
    within3: Math.round((ratios.filter((r) => r >= 1 / 3 && r <= 3).length / ratios.length) * 1000) / 10,
    within10: Math.round((ratios.filter((r) => r >= 0.1 && r <= 10).length / ratios.length) * 1000) / 10,
  };
}

/** The comps curve from the snapshot's launch-like live-token protocols, with its
 *  blind holdout, its time-split backtest and its residual band. */
export function fitComps(snapshot: Snapshot): CompsFit {
  const comps = snapshot.protocols
    .filter(isLaunchComp)
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const pairs = comps.map((p) => ({ tvl: p.tvl_usd, mcap: p.mcap_usd! }));
  const ratio = comps.length > 0 ? median(comps.map((p) => p.mcap_usd! / p.tvl_usd)) : 0;
  const full = logFit(pairs);
  const held = pairs.filter((_, i) => i % 5 === 4);
  const train = pairs.filter((_, i) => i % 5 !== 4);
  const trainFit = logFit(train);
  const hold = backtest(trainFit, held);
  const flat = backtest({ a: Math.log(median(train.map((p) => p.mcap / p.tvl))), b: 1 }, held);
  // Time split: fitted on the comps listed before the median listing date, tested on the rest.
  const dated = comps.filter((p) => p.listed_at !== null).sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : 1));
  const cut = dated.length > 0 ? dated[Math.floor(dated.length / 2)]!.listed_at! : null;
  const splitTrain = dated.filter((p) => p.listed_at! < cut!).map((p) => ({ tvl: p.tvl_usd, mcap: p.mcap_usd! }));
  const splitTest = dated.filter((p) => p.listed_at! >= cut!).map((p) => ({ tvl: p.tvl_usd, mcap: p.mcap_usd! }));
  const splitFit = logFit(splitTrain);
  const split = backtest(splitFit, splitTest);
  const splitFlat = backtest(
    { a: Math.log(median(splitTrain.map((p) => p.mcap / p.tvl))), b: 1 },
    splitTest,
  );
  // The middle half of the full fit's log-residuals, as multipliers on the curve value.
  const residuals = pairs
    .map((p) => Math.log(p.mcap) - (full.a + full.b * Math.log(p.tvl)))
    .sort((a, b) => a - b);
  const q1 = residuals.length > 0 ? residuals[Math.floor(residuals.length / 4)]! : 0;
  const q3 = residuals.length > 0 ? residuals[Math.floor((residuals.length * 3) / 4)]! : 0;
  return {
    intercept: round4(full.a),
    slope: round4(full.b),
    comps: comps.length,
    median_ratio: round4(ratio),
    holdout: held.length,
    holdout_error: hold.error,
    holdout_within3: hold.within3,
    holdout_within10: hold.within10,
    flat_error: flat.error,
    flat_within3: flat.within3,
    timesplit: splitTest.length,
    timesplit_error: split.error,
    timesplit_within3: split.within3,
    timesplit_within10: split.within10,
    timesplit_flat_error: splitFlat.error,
    band_low: round4(Math.exp(q1)),
    band_high: round4(Math.exp(q3)),
  };
}

/** Early rows: pre-token protocols below the floor, taken by implied value. */
export const EARLY_ROWS = 160;

/** Live-token protocols shown apart from the board, by market cap. */
export const LIVE_ROWS = 24;

export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One ranked row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watched: boolean;
  age_days: number | null;
  implied_value_usd: number;
  /** The middle half of the curve's misses, as an implied-value range. */
  value_low_usd: number;
  value_high_usd: number;
  /** The $1,000 plan, netted: what $1,000 deposited would get, its fees, its net. */
  slice_usd: number;
  farm_fees_usd: number;
  farm_net_usd: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  model: {
    curve_value_usd: number;
    growth_pct: number;
    growth_multiplier: number;
    chain_multiplier: number;
    category_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The board row as the dashboard reads it: farm steps included, so the page never re-derives them. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  curve_value_usd: number;
  value_low_usd: number;
  value_high_usd: number;
  slice_usd: number;
  farm_fees_usd: number;
  farm_net_usd: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  growth_multiplier: number;
  chain_multiplier: number;
  category_multiplier: number;
  maturity_multiplier: number;
  watched: boolean;
  farm_steps: string[];
}

/** A protocol whose token already trades: market cap, not a model. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  fit: CompsFit;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  /** The comps the curve is fitted on, for the dashboard's scatter plot. */
  comps: { tvl: number; mcap: number }[];
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listedAt` to `asOf`, at least zero; null when the date is bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The category prior: a stated weight per category, 1.0 when unlisted. */
export function categoryMultiplier(category: string | null, model: ModelConstants): number {
  if (category === null) return 1;
  const w = model.category_prior[category];
  return typeof w === 'number' && Number.isFinite(w) ? w : 1;
}

/** The maturity curve: fast early, saturating — a year with no token earns most of it. */
export function maturityMultiplier(age: number | null, model: ModelConstants): number {
  const days = age ?? model.unknown_age_days;
  const capped = Math.min(Math.max(days, 0), model.maturity_cap_days);
  const top = Math.log(1 + model.maturity_cap_days / model.maturity_scale_days);
  return model.maturity_floor + model.maturity_span * (Math.log(1 + capped / model.maturity_scale_days) / top);
}

/** One protocol's score: every multiplier and the implied value, from snapshot figures only. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  fit: CompsFit,
): { implied: number; curve: number; growthPct: number; growthMult: number; chainMult: number; catMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const weight = growthPct >= 0 ? model.growth_up : model.growth_down;
  const growthMult = 1 + (growthPct / 100) * weight;
  const chainMult = model.chain_base + model.chain_step * Math.min(protocol.chains.length, model.chain_cap);
  const catMult = categoryMultiplier(protocol.category, model);
  const maturityMult = maturityMultiplier(age, model);
  const curve = Math.exp(fit.intercept + fit.slope * Math.log(protocol.tvl_usd));
  const implied = Math.max(1, Math.round(curve * growthMult * chainMult * catMult * maturityMult));
  return { implied, curve, growthPct, growthMult, chainMult, catMult, maturityMult, age };
}

/** A dollar amount to two decimals, for the farm plan's own numbers. */
export function money2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Gas for one transaction on a chain: the stated table, or the default. */
export function gasPerTx(chain: string, model: ModelConstants): number {
  const g = model.gas_usd[chain];
  return typeof g === 'number' && Number.isFinite(g) ? g : model.gas_default;
}

/** Transactions in a farm plan: approve + deposit, a second action, one on-chain
 *  touch every two weeks of the hold, and the unwind. */
export function farmTxCount(holdDays: number): number {
  return 4 + Math.ceil(Math.ceil(holdDays / 7) / 2);
}

/** The verdict on a $1,000 plan: the slice the deposit would earn if the launch
 *  gives depositors their pro-rata share, minus the plan's gas and the yield the
 *  thousand would have earned in a T-bill over the hold. */
export interface FarmVerdict {
  slice: number;
  fees: number;
  tbill: number;
  net: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  hold: number;
  tx: number;
}

export function farmVerdict(
  protocol: SnapshotProtocol,
  implied: number,
  age: number | null,
  watched: boolean,
  model: ModelConstants,
): FarmVerdict {
  const hold = watched ? Math.max(holdDaysFor(age), 56) : holdDaysFor(age);
  const tx = farmTxCount(hold);
  const first = protocol.chains.length > 0 ? protocol.chains[0]! : '';
  // The verdict nets the core plan on the protocol's first chain. A second chain's
  // repeat position is an extension: its gas is stated in its own step, not in the verdict.
  const fees = tx * gasPerTx(first, model);
  const slice = (implied * model.depositor_share * model.plan_ticket_usd) / protocol.tvl_usd;
  const tbill = (model.plan_ticket_usd * model.tbill_rate * hold) / 365;
  const net = slice - fees - tbill;
  const verdict = net > 0 ? 'FARM' : slice > fees ? 'THIN' : 'SKIP';
  return { slice: money2(slice), fees: money2(fees), tbill: money2(tbill), net: money2(net), verdict, hold, tx };
}

/** A name ending in a version marker is a pool of another protocol, not a launch of its own. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Records no token at all: no market cap, no CoinGecko id, no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** A protocol the early radar may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The ranked board: every watchlist slug, plus the strongest early rows, ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL, fit: CompsFit = fitComps(snapshot)): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // Early rows are picked by the model's own score, not by raw TVL.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .map((p) => ({ p, score: impliedValue(p, snapshot.as_of, model, fit).implied }))
    .sort((a, b) => b.score - a.score || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0))
    .slice(0, EARLY_ROWS)
    .map((s) => s.p);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const s = impliedValue(p, snapshot.as_of, model, fit);
    const watched = snapshot.watchlist.includes(p.slug);
    const v = farmVerdict(p, s.implied, s.age, watched, model);
    const mult = s.growthMult * s.chainMult * s.catMult * s.maturityMult;
    const low = Math.max(1, Math.round(s.curve * fit.band_low * mult));
    const high = Math.max(1, Math.round(s.curve * fit.band_high * mult));
    return { p, ...s, watched, verdict: v, low: Math.min(low, s.implied), high: Math.max(high, s.implied) };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    watched: s.watched,
    age_days: s.age,
    implied_value_usd: s.implied,
    value_low_usd: s.low,
    value_high_usd: s.high,
    slice_usd: s.verdict.slice,
    farm_fees_usd: s.verdict.fees,
    farm_net_usd: s.verdict.net,
    verdict: s.verdict.verdict,
    model: {
      curve_value_usd: Math.round(s.curve),
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      chain_multiplier: round4(s.chainMult),
      category_multiplier: round4(s.catMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age, s.watched, s.verdict, model).map(stepText),
  }));
}

/** One farm step as a single string: action, cost, time — inside the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the position and check the protocol's own page.`;
  return s;
}

function firstChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Capital for one farm position, sized to the protocol's TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** Minimum hold, from the protocol's age: younger protocols need a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** One category's farm shape: the position to open, the second qualifying move, the risk it carries. */
interface CategoryPlan {
  match: RegExp;
  core: string;
  second: string;
  risk: string;
}

/** The plan per category: `{n}` the name, `{c}` the capital, `{ch}` the chain. Two protocols in one category get the same shape; the risk line is always the category's own risk. */
const CATEGORY_PLANS: CategoryPlan[] = [
  {
    match: /\bdex/i,
    core: "Add {c} of liquidity to the main {n} pool on {ch} and keep the position open.",
    second: "Swap $10 of USDC for the other asset in the pool through {n}, so the wallet shows swaps too.",
    risk: "The pool's two assets can drift apart, so the position can lose value against holding them.",
  },
  {
    match: /lend|cdp|collateral/i,
    core: "Supply {c} of USDC to {n} on {ch} and leave the position open.",
    second: "Borrow $20 of USDC against the supply and repay half a week later, so the wallet shows both sides.",
    risk: "Borrow rates can rise, and a sharp price fall can liquidate the collateral.",
  },
  {
    match: /yield|farm|leveraged/i,
    core: "Deposit {c} into the main {n} yield vault on {ch} and keep the shares.",
    second: "Claim the vault rewards once and restake them in the same vault, so the wallet shows compounding.",
    risk: "The vault yield falls as more capital enters, and the underlying strategy can change.",
  },
  {
    match: /bridge/i,
    core: "Bridge {c} of USDC to {ch} through {n}, then use the bridged funds inside its app.",
    second: "Use the bridged funds for one swap or deposit on the destination chain, so the crossing is not the only action.",
    risk: "A bridge holds funds in transit: a contract bug or a paused route can strand them on the wrong chain.",
  },
  {
    match: /\bstak|restak/i,
    core: "Stake {c} of the chain's staking asset through {n} and hold the receipt token.",
    second: "Delegate a second, smaller stake from the same wallet a week later, so the position grows twice.",
    risk: "Staking locks the asset, and a slashing event or an unbonding delay can hold it.",
  },
  {
    match: /rwa/i,
    core: "Mint {c} of the {n} yield-bearing asset on {ch} and hold it.",
    second: "Read the backing report {n} publishes and hold the asset through one full reporting cycle.",
    risk: "The off-chain backing can be redeemed or repriced, and the token can trade away from its backing.",
  },
  {
    match: /derivative|perpetual|basis/i,
    core: "Deposit {c} of USDC as margin on {n} and open one small hedged position.",
    second: "Close the hedged position and open a fresh one a week later, so the wallet shows repeat margin use.",
    risk: "Leverage cuts both ways: a fast move can liquidate the margin.",
  },
  {
    match: /curator|allocator/i,
    core: "Deposit {c} into a {n} vault on {ch} and keep the vault shares.",
    second: "Move a small share into a second vault of the same protocol, so the wallet touches two vaults.",
    risk: "A curator's allocation can change, and a vault's underlying market can turn against the position.",
  },
  {
    match: /stable|wrapper/i,
    core: "Mint or deposit {c} of the stable asset through {n} on {ch}.",
    second: "Use the stable asset for one payment or swap on the same chain, so the wallet shows it in circulation.",
    risk: "A stable asset can depeg if its backing or its peg mechanism slips.",
  },
  {
    match: /insurance/i,
    core: "Buy {c} of cover from {n} on {ch} and keep the policy active.",
    second: "Read the cover terms on {n}'s own page and keep the policy active through one premium cycle.",
    risk: "Cover pays only for the named event, and a claim can be refused.",
  },
  {
    match: /prediction/i,
    core: "Fund {c} on {n} and take one position in a market that settles soon.",
    second: "Take a second position in a market that settles later, so the wallet is active across two settlement dates.",
    risk: "A prediction market pays only if the position settles the right way.",
  },
  {
    match: /\bchain/i,
    core: "Deposit {c} of USDC into the main {n} app on {ch} and keep the position open.",
    second: "Use a second app on the same chain with a small deposit, so the wallet shows two touchpoints.",
    risk: "A new chain's apps change fast, and an early app can be replaced.",
  },
  {
    match: /./,
    core: "Deposit {c} of USDC into {n} on {ch} and keep the position open.",
    second: "Do a second, smaller deposit a week later, so the wallet shows repeat activity, not one deposit.",
    risk: "Points are never guaranteed: the protocol can change its rewards or launch without one.",
  },
];

/** The category's plan: the first row whose pattern the category matches. */
function planFor(p: SnapshotProtocol): CategoryPlan {
  const c = p.category ?? '';
  for (const plan of CATEGORY_PLANS) if (plan.match.test(c)) return plan;
  return CATEGORY_PLANS[CATEGORY_PLANS.length - 1]!;
}

/** Fill a plan template: {n} the name, {c} the capital, {ch} the chain. */
function fillPlan(template: string, p: SnapshotProtocol, capital: string, chain: string): string {
  return template.replaceAll('{n}', p.name).replaceAll('{c}', capital).replaceAll('{ch}', chain);
}

/** A protocol's farm plan, from its own record: open a wallet, read the verdict on a
 *  $1,000 plan, take the category's position, take a second qualifying action, hold —
 *  and end with the category's own risk line. The gas in the steps is the same gas
 *  the verdict nets on the first chain, so the plan and the verdict agree there; a
 *  second chain's repeat position states its own gas in its step. */
export function farmSteps(p: SnapshotProtocol, age: number | null, watched: boolean, v: FarmVerdict, model: ModelConstants = MODEL): FarmStep[] {
  const chain = firstChain(p);
  const capital = capitalFor(p);
  const hold = v.hold;
  const gas = gasPerTx(chain, model);
  const g2 = (n: number): string => `$${n.toFixed(2)}`;
  const plan = planFor(p);
  const money = `$${capital}`;
  const verdictLine =
    v.verdict === 'FARM'
      ? 'The plan pays after fees and the yield you give up.'
      : v.verdict === 'THIN'
        ? 'It beats the fees, but not the yield you give up.'
        : 'It does not cover the fees.';
  const steps: FarmStep[] = [
    {
      text: `Open a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline on paper.`,
      cost: `about ${g2(gas)} of gas for the first transaction`,
      time: '5 minutes',
    },
    {
      text: `Verdict on a $1,000 plan: ${v.verdict} — the slice is ${g2(v.slice)}, fees ${g2(v.fees)} and forgone yield ${g2(v.tbill)}, net ${v.net >= 0 ? '+' : '-'}$${Math.abs(v.net).toFixed(2)}. ${verdictLine}`,
      cost: 'nothing to check',
      time: '2 minutes',
    },
    {
      text: fillPlan(plan.core, p, money, chain),
      cost: `${money} of capital and about ${g2(2 * gas)} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: fillPlan(plan.second, p, money, chain),
      cost: `about ${g2(gas)} of gas`,
      time: '10 minutes',
    },
    {
      text: `Do one on-chain action every two weeks — a deposit, a borrow, a swap or a vote — so the wallet shows a pattern, not a single deposit.`,
      cost: `about ${g2(gas)} of gas each time`,
      time: '10 minutes every two weeks',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity lands in more than one snapshot.`,
      cost: `the ${money} stays in the position`,
      time: `${hold} days`,
    },
  ];
  if (p.chains.length > 1) {
    const second = p.chains[1]!;
    steps.push({
      text: `Repeat the same position on ${second} with half the capital, so the wallet is active on two of the protocol's chains.`,
      cost: `$${Math.round(capital / 2)} of capital and about ${g2(2 * gasPerTx(second, model))} of gas`,
      time: '15 minutes',
    });
  }
  if (watched) {
    steps.push({
      text: `This protocol is on the radar's watchlist — at least $50M of TVL with no token on record — so keep the action going for at least 8 weeks instead of stopping after the first month.`,
      cost: `about ${g2(gas)} of gas every two weeks`,
      time: '8 weeks',
    });
  }
  steps.push(
    {
      text: `Before you withdraw anything, open the protocol's own points or rewards page and claim only from the link it publishes there.`,
      cost: `about ${g2(gas)} of gas to unwind, and never pay to claim`,
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction hash in a farm log, so you can repeat the position or unwind it cleanly.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
    {
      text: `Risk to watch: ${plan.risk}`,
      cost: 'no fee to check',
      time: '5 minutes',
    },
  );
  return steps;
}

/** The live-token set, by market cap, for the dashboard's separate Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's dashboard form: farm steps travel with the row, never re-derived in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    curve_value_usd: row.model.curve_value_usd,
    value_low_usd: row.value_low_usd,
    value_high_usd: row.value_high_usd,
    slice_usd: row.slice_usd,
    farm_fees_usd: row.farm_fees_usd,
    farm_net_usd: row.farm_net_usd,
    verdict: row.verdict,
    growth_multiplier: row.model.growth_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    category_multiplier: row.model.category_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    watched: row.watched,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const fit = fitComps(snapshot);
  const board = buildBoard(snapshot, model, fit);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const comps = snapshot.protocols
    .filter(isLaunchComp)
    .map((p) => ({ tvl: p.tvl_usd, mcap: p.mcap_usd! }))
    .sort((a, b) => a.tvl - b.tvl);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    fit,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    comps,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape this model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
  }
  return null;
}

/** The dashboard's dataset as one script: no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
