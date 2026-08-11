# pokemon-auto-battler

Backend Gen 9 double-battle simulator, built on [`@pkmn/sim`](https://github.com/pkmn/ps) (the real Pokémon Showdown simulator engine). Runs one scripted battle between a fixed rival team and a configurable player team, printing a turn-by-turn log to the console.

## Run

```sh
npm install
npm run simulate
npm test
```

## Layout

- `src/config/teams/` — team definitions (Pokemon Showdown export-text format). `rival.ts` is Brock's fixed team; `player.ts` is a placeholder Pikachu/Butterfree team, swappable without touching any other code.
- `src/ai/HeuristicPlayerAI.ts` — move-selection AI used for both sides: scores each legal move/target by basePower × STAB × type-effectiveness (via `@pkmn/sim`'s own `Dex`), preferring damaging moves over status moves.
- `src/battle/runBattle.ts` — wires the two AI players into a `gen9doublescustomgame` battle stream and runs it to completion.
- `src/battle/log.ts` — prints the turn-by-turn battle log to the console.

This is backend-only: no server, no frontend yet. The separation exists so battle logic can later move behind an API without changes.
