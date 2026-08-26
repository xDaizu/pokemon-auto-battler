/**
 * Independent script (not wired into the battle simulator) that queries PokeAPI
 * to build the list of every Pokemon a player can legitimately have access to
 * in Pokemon FireRed/LeafGreen before defeating Misty, the Cerulean City Gym
 * Leader.
 *
 * Run with: npx tsx scripts/pokemon-before-misty.ts
 *
 * Covers:
 *  - The starter chosen from Professor Oak in Pallet Town.
 *  - Wild encounters on every route/area reachable before entering the
 *    Cerulean Gym: Brock's five areas (Route 1, Route 2 both halves, Route 22,
 *    Viridian Forest) plus Route 3, Mt. Moon (1F, B1F, B2F), Route 4, Route 24
 *    and Route 25.
 */

const POKEAPI_BASE = "https://pokeapi.co/api/v2";

const VERSIONS = ["firered", "leafgreen"];

const AREAS_BEFORE_MISTY: { area: string; label: string }[] = [
  { area: "kanto-route-1-area", label: "Route 1" },
  { area: "kanto-route-2-south-towards-viridian-city", label: "Route 2 (South, towards Viridian City)" },
  { area: "kanto-route-2-north-towards-pewter-city", label: "Route 2 (North, towards Pewter City)" },
  { area: "kanto-route-22-area", label: "Route 22" },
  { area: "viridian-forest-area", label: "Viridian Forest" },
  { area: "kanto-route-3-area", label: "Route 3" },
  { area: "mt-moon-1f", label: "Mt. Moon 1F" },
  { area: "mt-moon-b1f", label: "Mt. Moon B1F" },
  { area: "mt-moon-b2f", label: "Mt. Moon B2F" },
  { area: "kanto-route-4-area", label: "Route 4" },
  { area: "kanto-route-24-area", label: "Route 24" },
  { area: "kanto-route-25-area", label: "Route 25" },
];

const STARTERS = [
  { name: "bulbasaur", source: "Professor Oak's Lab, Pallet Town (choose one starter)" },
  { name: "charmander", source: "Professor Oak's Lab, Pallet Town (choose one starter)" },
  { name: "squirtle", source: "Professor Oak's Lab, Pallet Town (choose one starter)" },
];

// Only "walk" (regular grass) encounters are reachable before Misty: Surf and
// the Old Rod (the first fishing rod, from the Vermilion fisherman) are both
// obtained after the Cerulean Gym, so encounters that only appear via those
// methods (e.g. Magikarp, Poliwag, Slowpoke) are excluded.
const USABLE_ENCOUNTER_METHODS = new Set(["walk"]);

interface PokemonEncounter {
  pokemon: { name: string; url: string };
  version_details: {
    version: { name: string };
    encounter_details: { method: { name: string } }[];
  }[];
}

interface LocationAreaResponse {
  pokemon_encounters: PokemonEncounter[];
}

async function fetchLocationArea(area: string): Promise<LocationAreaResponse | null> {
  const res = await fetch(`${POKEAPI_BASE}/location-area/${area}`);
  if (!res.ok) {
    console.error(`Failed to fetch ${area}: ${res.status} ${res.statusText}`);
    return null;
  }
  return (await res.json()) as LocationAreaResponse;
}

async function main() {
  const speciesToLocations = new Map<string, Set<string>>();

  for (const { area, label } of AREAS_BEFORE_MISTY) {
    const data = await fetchLocationArea(area);
    if (!data) continue;

    for (const encounter of data.pokemon_encounters) {
      const inTargetVersion = encounter.version_details.some(
        (vd) =>
          VERSIONS.includes(vd.version.name) &&
          vd.encounter_details.some((ed) => USABLE_ENCOUNTER_METHODS.has(ed.method.name))
      );
      if (!inTargetVersion) continue;

      const name = encounter.pokemon.name;
      if (!speciesToLocations.has(name)) {
        speciesToLocations.set(name, new Set());
      }
      speciesToLocations.get(name)!.add(label);
    }
  }

  const wildEncounters = Array.from(speciesToLocations.entries())
    .map(([name, locations]) => ({
      name,
      locations: Array.from(locations).sort(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const allPokemonNames = Array.from(
    new Set([...STARTERS.map((s) => s.name), ...wildEncounters.map((w) => w.name)])
  ).sort();

  const result = {
    generatedAt: new Date().toISOString(),
    game: ["Pokemon FireRed", "Pokemon LeafGreen"],
    milestone: "Before defeating Misty (Cerulean City Gym Leader)",
    starters: STARTERS,
    wildEncounters,
    allPokemonNames,
  };

  const outPath = new URL("./output/pokemon-before-misty.json", import.meta.url);

  const { writeFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  writeFileSync(fileURLToPath(outPath), JSON.stringify(result, null, 2));

  console.log(`Found ${allPokemonNames.length} Pokemon accessible before Misty:`);
  console.log(allPokemonNames.join(", "));
  console.log(`\nSaved full details to ${fileURLToPath(outPath)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
