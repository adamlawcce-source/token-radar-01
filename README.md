# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/adamlawcce-source/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/adamlawcce-source/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar ranks 200 pre-token protocols by implied value, scored from a DeFiLlama protocol snapshot with the "radar-2" model (TVL × growth, chain reach, category and age multipliers).
It covers a 40-protocol watchlist (every protocol with at least $50M TVL and no token), adds 160 early pre-token rows, and ships a concrete farm plan with cost, time and risk for every row, plus a sortable, filterable dashboard with a detail view.
Built for the [token-radar-01 bounty](https://make.fun/bounty/token-radar-01) on make.fun.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Reads a DeFiLlama snapshot and writes `out/board.json`, `out/dossier.json` and `out/dashboard/` (plus `out/data.js` and `out/screenshots/`). Node 22 standard library only, no network, deterministic output.
Rank 1 on the competition snapshot: Steakhouse Financial, $593,672,934 implied value.

---

<sub>Entered on [make.fun](https://make.fun/?ref=eenffswd&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
