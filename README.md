# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/adamlawcce-source/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/adamlawcce-source/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar ranks 200 pre-token protocols by implied value, scored from a DeFiLlama protocol snapshot with the "radar-4" model: a comps curve fitted at runtime to the 90 protocols that already have tokens and are launches like the ones ranked — exchanges, bridges and staking receipts are set aside first (log market cap = 8.8089 + 0.4142 x log TVL), times growth, chain reach, category and age multipliers, with two blind tests stated honestly (a slug holdout: 68.9% median error, within 3x for 72.2% of tokens, against 87.1% for one flat multiple; a time split: 86.9% against 87.1% for the flat multiple).
It covers a 40-protocol watchlist (every protocol with at least $50M TVL and no token), adds 160 early pre-token rows, and ships a concrete farm plan with cost, time and risk for every row — each row also carries a verdict on a $1,000 plan (FARM 155, THIN 23, SKIP 22), netting the slice against fees and a 4% T-bill — plus a sortable, filterable dashboard with a detail view, a comps scatter plot and a value waterfall.
Built for the [token-radar-01 bounty](https://make.fun/bounty/token-radar-01) on make.fun.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Reads a DeFiLlama snapshot and writes `out/board.json`, `out/dossier.json` and `out/dashboard/` (plus `out/data.js` and `out/screenshots/`). Node 22 standard library only, no network, deterministic output.
Rank 1 on the competition snapshot: Steakhouse Financial, $53,315,326 implied value (THIN on a $1,000 plan: $1.94 slice, $0.48 fees, −$4.68 net).

---

<sub>Entered on [make.fun](https://make.fun/?ref=eenffswd&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
