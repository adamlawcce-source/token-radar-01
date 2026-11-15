// Token Radar — the value model.
//
// A protocol's implied token value is claimed from the snapshot's own figures only:
//
//   growth   = clamp(change_7d, -50, 100) per cent, 0 when unreported
//   growthM  = 1 + growth/100 x 0.6        when growth >= 0
//            = 1 + growth/100 x 1.2        when growth < 0   (a shrinking TVL is punished twice as hard)
//   chainM   = 0.9 + 0.02 x min(chains, 10)                 (more chains, more reach)
//   catM     = category prior, 0.80..1.06                  (stated below; categories, never names)
//   ageM     = 0.65 + 0.35 x ln(1 + min(age,1095)/90) / ln(1 + 1095/90)
//              age is days since listed_at; unknown age counts as 365 days
//   implied  = max(1, round(tvl_usd x 0.22 x growthM x chainM x catM x ageM))
//
// The board ranks the 40 watchlist protocols plus the 160 strongest pre-token protocols
// below the watchlist floor, scored by this same function — not by raw TVL. Live-token
// protocols never enter the board; the dashboard shows their market caps separately.
// No protocol name is ever special-cased: one function scores every row.

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
  base_multiple: number;
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
}

export const MODEL: ModelConstants = {
  base_multiple: 0.22,
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
};

export const MODEL_VERSION = 'radar-2';

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
  model: {
    base_multiple: number;
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
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
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

/** Whole days from `listedAt` to `asOf`, at least zero; null when the date is missing or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The category prior: a stated weight per category, 1.0 for any category not listed. */
export function categoryMultiplier(category: string | null, model: ModelConstants): number {
  if (category === null) return 1;
  const w = model.category_prior[category];
  return typeof w === 'number' && Number.isFinite(w) ? w : 1;
}

/** The maturity curve: fast early, saturating — a year with no token already counts for most of it. */
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
): { implied: number; growthPct: number; growthMult: number; chainMult: number; catMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const weight = growthPct >= 0 ? model.growth_up : model.growth_down;
  const growthMult = 1 + (growthPct / 100) * weight;
  const chainMult = model.chain_base + model.chain_step * Math.min(protocol.chains.length, model.chain_cap);
  const catMult = categoryMultiplier(protocol.category, model);
  const maturityMult = maturityMultiplier(age, model);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * model.base_multiple * growthMult * chainMult * catMult * maturityMult));
  return { implied, growthPct, growthMult, chainMult, catMult, maturityMult, age };
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
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // Early rows are picked by the model's own score, not by raw TVL: the radar exists to find
  // the strongest pre-token protocols below the floor, and the score is the finding.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .map((p) => ({ p, score: impliedValue(p, snapshot.as_of, model).implied }))
    .sort((a, b) => b.score - a.score || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0))
    .slice(0, EARLY_ROWS)
    .map((s) => s.p);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const s = impliedValue(p, snapshot.as_of, model);
    return { p, ...s };
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
    watched: snapshot.watchlist.includes(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: model.base_multiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      chain_multiplier: round4(s.chainMult),
      category_multiplier: round4(s.catMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age, snapshot.watchlist.includes(s.p.slug)).map(stepText),
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

/**
 * The plan per category, keyed by the words the snapshot itself uses for the category.
 * `{n}` is the protocol's name, `{c}` the capital with its dollar sign, `{ch}` the chain.
 * A category no row names falls through to the last row: the table is a starting point,
 * never a list of special cases — two protocols in one category get the same shape, and
 * the risk line is always the category's own risk, never an invented detail.
 */
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

/**
 * A protocol's farm plan, derived from its own record (category, chains, TVL, age, watchlist
 * membership). Every plan runs the same shape — open a wallet, take the category's position,
 * take a second qualifying action, show a weekly pattern, hold — and ends with the category's
 * own risk line, so the reader farms with the downside in view. Watchlist rows carry one
 * extra step: they are the radar's first tier, so the plan tells the reader to farm them
 * longer. Multi-chain protocols get a second-chain step.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, watched: boolean): FarmStep[] {
  const chain = firstChain(p);
  const capital = capitalFor(p);
  // A watchlist row's plan tells the reader to farm for at least 8 weeks, so its hold
  // must be at least 56 days too — the hold and the watchlist step used to disagree.
  const hold = watched ? Math.max(holdDaysFor(age), 56) : holdDaysFor(age);
  const gas = capital >= 150 ? 8 : 4;
  const plan = planFor(p);
  const money = `$${capital}`;
  const steps: FarmStep[] = [
    {
      text: `Open a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline on paper.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: fillPlan(plan.core, p, money, chain),
      cost: `${money} of capital and about $${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: fillPlan(plan.second, p, money, chain),
      cost: 'about $2 of gas',
      time: '10 minutes',
    },
    {
      text: `Do one qualifying action each week — a deposit, a borrow, a swap or a vote — so the wallet shows a pattern, not a single deposit.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
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
      cost: `$${Math.round(capital / 2)} of capital and about $3 of gas`,
      time: '15 minutes',
    });
  }
  if (watched) {
    steps.push({
      text: `This protocol is on the radar's watchlist — at least $50M of TVL with no token on record — so keep the weekly action going for at least 8 weeks instead of stopping after the first month.`,
      cost: 'about $2 of gas a week',
      time: '8 weeks',
    });
  }
  steps.push(
    {
      text: `Before you withdraw anything, open the protocol's own points or rewards page and claim only from the link it publishes there.`,
      cost: 'no fee to check, and never pay to claim',
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
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
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
