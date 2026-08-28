/**
 * Independent script (not wired into the battle simulator) that queries PokeAPI
 * to build the list of every Pokemon a player can legitimately have access to
 * in Pokemon FireRed/LeafGreen before defeating Lt. Surge, the Vermilion City
 * Gym Leader.
 *
 * Run with: npx tsx scripts/pokemon-before-lt-surge.ts
 *
 * Covers:
 *  - The starter chosen from Professor Oak in Pallet Town.
 *  - Every wild encounter reachable before Misty (see
 *    pokemon-before-misty.ts's own area list) plus Route 5, the Underground
 *    Path connecting it to Route 6, Route 6 itself (the only path from
 *    Cerulean City to Vermilion City), and Route 9/Route 10/Route 11/
 *    Diglett's Cave — all walkable with no badge or HM gate, same
 *    "physically reachable before the gym" bar the earlier two scripts use.
 *  - Rock Tunnel and the Power Plant are deliberately left out: Rock Tunnel
 *    is unnavigable in practice without Flash (not obtainable this early),
 *    and the Power Plant is blocked by a Team Rocket grunt until well after
 *    Surge — neither is "legitimately obtainable" yet, matching the
 *    Surf/fishing-method exclusion below.
 */

const POKEAPI_BASE = "https://pokeapi.co/api/v2";

const VERSIONS = ["firered", "leafgreen"];

const AREAS_BEFORE_LT_SURGE: { area: string; label: string }[] = [
  // Everything reachable before Misty (see pokemon-before-misty.ts).
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
  // New for Lt. Surge: the Cerulean-to-Vermilion corridor, plus the routes
  // fanning out from Vermilion itself.
  { area: "kanto-route-5-area", label: "Route 5" },
  { area: "kanto-route-6-area", label: "Route 6" },
  { area: "kanto-route-9-area", label: "Route 9" },
  { area: "kanto-route-10-area", label: "Route 10" },
  { area: "kanto-route-11-area", label: "Route 11" },
  { area: "digletts-cave-area", label: "Diglett's Cave" },
];

const STARTERS = [
  { name: "bulbasaur", source: "Professor Oak's Lab, Pallet Town (choose one starter)" },
  { name: "charmander", source: "Professor Oak's Lab, Pallet Town (choose one starter)" },
  { name: "squirtle", source: "Professor Oak's Lab, Pallet Town (choose one starter)" },
];

// Only "walk" (regular grass) encounters are reachable before Surge: Surf and
// the Old Rod (the first fishing rod, from the Vermilion fisherman) aren't
// handed out until after his badge, so encounters that only appear via those
// methods (e.g. Magikarp, Poliwag, Slowpoke, Tentacool) are excluded.
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

  for (const { area, label } of AREAS_BEFORE_LT_SURGE) {
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
    milestone: "Before defeating Lt. Surge (Vermilion City Gym Leader)",
    starters: STARTERS,
    wildEncounters,
    allPokemonNames,
  };

  const outPath = new URL("./output/pokemon-before-lt-surge.json", import.meta.url);

  const { writeFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  writeFileSync(fileURLToPath(outPath), JSON.stringify(result, null, 2));

  console.log(`Found ${allPokemonNames.length} Pokemon accessible before Lt. Surge:`);
  console.log(allPokemonNames.join(", "));
  console.log(`\nSaved full details to ${fileURLToPath(outPath)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
