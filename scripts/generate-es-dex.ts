/**
 * Independent script (not wired into the runtime) that queries PokeAPI for
 * the official Spanish names/descriptions of every species, move, ability,
 * and nature that can ever appear in this app's UI — every playable leader's
 * roster (src/roster/roster.ts) plus their fixed team
 * (src/config/teams/fireRed/*.ts) — and writes them to
 * frontend/src/i18n/data/esDex.json for the frontend's Spanish translation
 * layer to look up at render time.
 *
 * Run with: npx tsx scripts/generate-es-dex.ts
 *
 * Types, stats, and move categories are NOT covered here — those are small,
 * fixed vocabularies hand-translated directly in frontend/src/i18n/dexNames.ts.
 */

import { Dex, Teams } from '@pkmn/sim';
import { writeFileSync } from 'node:fs';
import { getNatures, getRoster, FORMAT_ID } from '../src/roster/roster.js';
import { getLeader, listLeaders } from '../src/config/leaders/index.js';

const POKEAPI_BASE = 'https://pokeapi.co/api/v2';
const OUT_PATH = new URL('../frontend/src/i18n/data/esDex.json', import.meta.url);
const CONCURRENCY = 8;

interface MoveEntry {
  name: string;
  shortDesc?: string;
}

interface AbilityEntry {
  name: string;
  shortDesc?: string;
}

interface EsDex {
  species: Record<string, string>;
  moves: Record<string, MoveEntry>;
  abilities: Record<string, AbilityEntry>;
  natures: Record<string, string>;
}

function esName(names: { language: { name: string }; name: string }[]): string | undefined {
  return names.find((n) => n.language.name === 'es')?.name;
}

function esFlavor(entries: { language: { name: string }; flavor_text: string }[]): string | undefined {
  const text = entries.find((e) => e.language.name === 'es')?.flavor_text;
  return text?.replace(/\s+/g, ' ').trim();
}

/** PokeAPI resource slugs are dash-separated (e.g. "dragon-breath"), unlike
 * @pkmn's ids which strip all punctuation/spaces (e.g. "dragonbreath"). */
function toPokeApiSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function fetchJson(path: string): Promise<any | undefined> {
  const res = await fetch(`${POKEAPI_BASE}/${path}`);
  if (!res.ok) {
    console.error(`  ! ${path}: ${res.status} ${res.statusText}`);
    return undefined;
  }
  return res.json();
}

async function mapPool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return results;
}

async function main() {
  const dex = Dex.forFormat(FORMAT_ID);
  const leaders = listLeaders().filter((l) => l.available);

  const species = new Map<string, string>();
  const moves = new Map<string, string>();
  const abilities = new Map<string, string>();

  for (const entry of leaders) {
    // getLeader (not `entry` itself) so `.team` is typed without leaning on
    // the `available: true` narrowing a plain `.filter()` predicate can't
    // give TS across a discriminated union - see LeaderEntry.
    const leader = getLeader(entry.id);

    for (const line of getRoster(leader.id)) {
      for (const stage of line.stages) {
        species.set(stage.id, stage.name);
        for (const a of stage.abilities) abilities.set(a.id, a.name);
        for (const m of stage.moves) moves.set(m.id, m.name);
      }
    }

    const parsedTeam = Teams.import(leader.team.exportText) ?? [];
    for (const set of parsedTeam) {
      const sp = dex.species.get(set.species);
      species.set(sp.id, sp.name);
      if (set.ability) {
        const a = dex.abilities.get(set.ability);
        abilities.set(a.id, a.name);
      }
      for (const mv of set.moves ?? []) {
        const m = dex.moves.get(mv);
        moves.set(m.id, m.name);
      }
    }
  }

  const natures = new Map(getNatures().map((n) => [n.id, n.name]));

  console.log(
    `Fetching ${species.size} species, ${moves.size} moves, ${abilities.size} abilities, ${natures.size} natures from PokeAPI...`,
  );

  const out: EsDex = { species: {}, moves: {}, abilities: {}, natures: {} };

  await mapPool([...species], CONCURRENCY, async ([id, name]) => {
    const data = await fetchJson(`pokemon-species/${toPokeApiSlug(name)}`);
    const es = data && esName(data.names);
    if (es) out.species[id] = es;
    else console.error(`  ! no es name for species "${id}" (${name})`);
  });

  await mapPool([...moves], CONCURRENCY, async ([id, name]) => {
    const data = await fetchJson(`move/${toPokeApiSlug(name)}`);
    if (!data) return;
    const es = esName(data.names);
    const shortDesc = esFlavor(data.flavor_text_entries ?? []);
    if (es) out.moves[id] = { name: es, ...(shortDesc ? { shortDesc } : {}) };
    else console.error(`  ! no es name for move "${id}" (${name})`);
  });

  await mapPool([...abilities], CONCURRENCY, async ([id, name]) => {
    const data = await fetchJson(`ability/${toPokeApiSlug(name)}`);
    if (!data) return;
    const es = esName(data.names);
    const shortDesc = esFlavor(data.flavor_text_entries ?? []);
    if (es) out.abilities[id] = { name: es, ...(shortDesc ? { shortDesc } : {}) };
    else console.error(`  ! no es name for ability "${id}" (${name})`);
  });

  await mapPool([...natures], CONCURRENCY, async ([id, name]) => {
    const data = await fetchJson(`nature/${toPokeApiSlug(name)}`);
    const es = data && esName(data.names);
    if (es) out.natures[id] = es;
    else console.error(`  ! no es name for nature "${id}" (${name})`);
  });

  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + '\n');
  console.log(`Wrote ${OUT_PATH.pathname}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
