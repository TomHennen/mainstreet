/**
 * Where an unpainted building sends a player who would like to draw it.
 *
 * The base URL is world data (`world.json` `contribute`, DESIGN.md §2) — the
 * engine only appends which building was examined, so no world, no id and no
 * URL ever appears in engine code (CLAUDE.md hard rule 1). A world with no
 * `contribute` simply gets no link (hard rule 3).
 */
export function paintUrl(contribute: string | undefined, buildingId: string): string | undefined {
  if (!contribute) return undefined;
  const separator = contribute.includes('?') ? '&' : '?';
  return `${contribute}${separator}building=${encodeURIComponent(buildingId)}`;
}
