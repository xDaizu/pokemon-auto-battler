import { useEffect, useMemo, useState } from 'react';
import { fetchRoster, importTeam, spriteUrl } from '../api/client';
import type {
  NatureOption,
  PlayerPokemonSelection,
  RosterLine,
  RosterResponse,
  StageOption,
  StatId,
} from '../api/types';

interface SlotState {
  groupId: string | null;
  stageId: string | null;
  ability: string | null;
  nature: string | null;
  moves: string[];
}

const EMPTY_SLOT: SlotState = { groupId: null, stageId: null, ability: null, nature: null, moves: [] };
const EMPTY_ROSTER: RosterLine[] = [];
const MAX_MOVES = 4;
const STAT_LABEL: Record<StatId, string> = { hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe' };

function findLine(roster: RosterLine[], groupId: string | null): RosterLine | undefined {
  return roster.find((l) => l.groupId === groupId);
}

function findStage(roster: RosterLine[], stageId: string | null): StageOption | undefined {
  for (const line of roster) {
    const stage = line.stages.find((s) => s.id === stageId);
    if (stage) return stage;
  }
  return undefined;
}

function findLineForStage(roster: RosterLine[], stageId: string): RosterLine | undefined {
  return roster.find((line) => line.stages.some((s) => s.id === stageId));
}

/** Defaults to the last MAX_MOVES moves available to the stage (the ones
 * learned at the highest levels), so a fresh selection isn't empty. */
function defaultMoves(stage: StageOption | undefined): string[] {
  if (!stage) return [];
  return stage.moves.slice(-MAX_MOVES).map((m) => m.id);
}

/** Picks the nature that boosts a stage's higher offensive stat (Attack or
 * Special Attack) and lowers the other, falling back to a neutral nature on
 * a tie. */
function defaultNatureId(natures: NatureOption[], baseStats: StageOption['baseStats']): string | null {
  if (natures.length === 0) return null;
  if (baseStats.atk === baseStats.spa) {
    return natures.find((n) => !n.plus)?.id ?? natures[0]!.id;
  }
  const boost: StatId = baseStats.atk > baseStats.spa ? 'atk' : 'spa';
  const lower: StatId = boost === 'atk' ? 'spa' : 'atk';
  return natures.find((n) => n.plus === boost && n.minus === lower)?.id ?? natures[0]!.id;
}

function NatureLabel({ nature }: { nature: NatureOption }) {
  if (!nature.plus || !nature.minus) {
    return <span className="nature-label">{nature.name}</span>;
  }
  return (
    <span className="nature-label">
      {nature.name}
      <span className="nature-stat nature-up">↑{STAT_LABEL[nature.plus]}</span>
      <span className="nature-stat nature-down">↓{STAT_LABEL[nature.minus]}</span>
    </span>
  );
}

export function TeamBuilder({ onReady }: { onReady: (selections: PlayerPokemonSelection[]) => void }) {
  const [data, setData] = useState<RosterResponse | null>(null);
  const [slots, setSlots] = useState<[SlotState, SlotState]>([EMPTY_SLOT, EMPTY_SLOT]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [openNatureSlot, setOpenNatureSlot] = useState<0 | 1 | null>(null);

  useEffect(() => {
    fetchRoster()
      .then(setData)
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Failed to load roster.'));
  }, []);

  const roster = data?.roster ?? EMPTY_ROSTER;
  const natures = data?.natures ?? [];

  const otherExclusiveGroup = (slotIdx: 0 | 1): string | undefined => {
    const other = slots[slotIdx === 0 ? 1 : 0];
    return findLine(roster, other.groupId)?.exclusiveGroup;
  };

  const otherStageId = (slotIdx: 0 | 1): string | null => slots[slotIdx === 0 ? 1 : 0].stageId;

  const selectSpecies = (slotIdx: 0 | 1, groupId: string) => {
    const line = findLine(roster, groupId);
    const blockedStageId = otherStageId(slotIdx);
    const firstStage = line?.stages.find((s) => s.id !== blockedStageId) ?? line?.stages[0];
    setSlots((prev) => {
      const next = [...prev] as [SlotState, SlotState];
      next[slotIdx] = {
        groupId,
        stageId: firstStage?.id ?? null,
        ability: firstStage?.abilities[0]?.id ?? null,
        nature: firstStage ? defaultNatureId(natures, firstStage.baseStats) : null,
        moves: defaultMoves(firstStage),
      };
      return next;
    });
  };

  const selectStage = (slotIdx: 0 | 1, stageId: string) => {
    const stageObj = findStage(roster, stageId);
    setSlots((prev) => {
      const next = [...prev] as [SlotState, SlotState];
      const prevSlot = next[slotIdx];
      const abilityStillValid = stageObj?.abilities.some((a) => a.id === prevSlot.ability) ?? false;
      next[slotIdx] = {
        ...prevSlot,
        stageId,
        ability: abilityStillValid ? prevSlot.ability : (stageObj?.abilities[0]?.id ?? null),
        nature: stageObj ? defaultNatureId(natures, stageObj.baseStats) : prevSlot.nature,
        moves: defaultMoves(stageObj),
      };
      return next;
    });
  };

  const selectAbility = (slotIdx: 0 | 1, abilityId: string) => {
    setSlots((prev) => {
      const next = [...prev] as [SlotState, SlotState];
      next[slotIdx] = { ...next[slotIdx], ability: abilityId };
      return next;
    });
  };

  const selectNature = (slotIdx: 0 | 1, natureId: string) => {
    setSlots((prev) => {
      const next = [...prev] as [SlotState, SlotState];
      next[slotIdx] = { ...next[slotIdx], nature: natureId };
      return next;
    });
    setOpenNatureSlot(null);
  };

  const toggleMove = (slotIdx: 0 | 1, moveId: string) => {
    setSlots((prev) => {
      const next = [...prev] as [SlotState, SlotState];
      const slot = next[slotIdx];
      const already = slot.moves.includes(moveId);
      const moves = already
        ? slot.moves.filter((m) => m !== moveId)
        : slot.moves.length < MAX_MOVES
          ? [...slot.moves, moveId]
          : slot.moves;
      next[slotIdx] = { ...slot, moves };
      return next;
    });
  };

  const validationError = useMemo(() => {
    for (let i = 0 as 0 | 1; i < 2; i++) {
      const slot = slots[i];
      if (!slot.stageId) return null; // not yet an error, just incomplete
      if (slot.moves.length < 1) return null;
    }
    if (!slots[0].stageId || !slots[1].stageId) return null;
    const groupA = findLine(roster, slots[0].groupId)?.exclusiveGroup;
    const groupB = findLine(roster, slots[1].groupId)?.exclusiveGroup;
    if (groupA && groupB && groupA === groupB) {
      return 'Only one starter (Bulbasaur/Charmander/Squirtle) can be on your team.';
    }
    if (slots[0].stageId && slots[0].stageId === slots[1].stageId) {
      return 'Your team cannot contain the same Pokemon twice.';
    }
    return null;
  }, [slots, roster]);

  const isComplete = slots.every((s) => s.stageId && s.ability && s.nature && s.moves.length >= 1);
  const canBattle = isComplete && !validationError;

  const handleImport = async () => {
    setImporting(true);
    setImportError(null);
    try {
      const { selections } = await importTeam(importText);
      const nextSlots = selections.map((selection: PlayerPokemonSelection) => {
        const line = findLineForStage(roster, selection.stageId);
        return {
          groupId: line?.groupId ?? null,
          stageId: selection.stageId,
          ability: selection.ability,
          nature: selection.nature,
          moves: selection.moves,
        };
      });
      setSlots(nextSlots as [SlotState, SlotState]);
      setImportOpen(false);
      setImportText('');
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Failed to import team.');
    } finally {
      setImporting(false);
    }
  };

  if (loadError) return <div className="panel error-msg">{loadError}</div>;
  if (!data) return <div className="panel loading-msg">Loading roster…</div>;

  return (
    <div className="panel">
      <div className="builder-header">
        <h2>Build Your Team</h2>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            setImportOpen((open) => !open);
            setImportError(null);
          }}
        >
          {importOpen ? 'Cancel Import' : 'Import from Showdown'}
        </button>
      </div>
      <p className="builder-rules">
        Level cap {data.levelCap} · No items · 2 Pokémon only · pick an evolution stage and up to 4
        moves legal at level {data.levelCap}.
      </p>

      {importOpen && (
        <div className="import-panel">
          <textarea
            className="import-textarea"
            placeholder={`Paste a Showdown export, e.g.\n\nPikachu\nAbility: Static\nLevel: ${data.levelCap}\n- Thunder Shock\n- Quick Attack\n\n...`}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            rows={10}
          />
          <div className="import-actions">
            {importError && <span className="error-msg">{importError}</span>}
            <button
              type="button"
              className="btn-primary"
              disabled={!importText.trim() || importing}
              onClick={handleImport}
            >
              {importing ? 'Importing…' : 'Import'}
            </button>
          </div>
        </div>
      )}

      <div className="slots">
        {([0, 1] as const).map((slotIdx) => {
          const slot = slots[slotIdx];
          const line = findLine(roster, slot.groupId);
          const stage = findStage(roster, slot.stageId);
          const blockedGroup = otherExclusiveGroup(slotIdx);
          const blockedStageId = otherStageId(slotIdx);

          return (
            <div className="slot" key={slotIdx}>
              <h3>Pokémon {slotIdx + 1}</h3>

              <div className="species-grid">
                {roster.map((candidateLine) => {
                  const base = candidateLine.stages[0]!;
                  const selected = candidateLine.groupId === slot.groupId;
                  const exclusiveBlocked =
                    !selected &&
                    !!candidateLine.exclusiveGroup &&
                    candidateLine.exclusiveGroup === blockedGroup;
                  const duplicateBlocked =
                    !selected && candidateLine.stages.every((s) => s.id === blockedStageId);
                  const disabled = exclusiveBlocked || duplicateBlocked;
                  const title = exclusiveBlocked
                    ? 'Only one starter allowed on your team'
                    : duplicateBlocked
                      ? 'Your team cannot contain the same Pokemon twice.'
                      : base.name;
                  return (
                    <button
                      type="button"
                      key={candidateLine.groupId}
                      className={`species-btn${selected ? ' selected' : ''}`}
                      disabled={disabled}
                      onClick={() => selectSpecies(slotIdx, candidateLine.groupId)}
                      title={title}
                    >
                      <img src={spriteUrl(base.num)} alt={base.name} />
                      <span>{base.name}</span>
                    </button>
                  );
                })}
              </div>

              {line && line.stages.length > 1 && (
                <div className="stage-row">
                  {line.stages.map((s) => {
                    const stageDisabled = s.id !== slot.stageId && s.id === blockedStageId;
                    return (
                      <button
                        type="button"
                        key={s.id}
                        className={`stage-chip${s.id === slot.stageId ? ' selected' : ''}`}
                        disabled={stageDisabled}
                        onClick={() => selectStage(slotIdx, s.id)}
                        title={stageDisabled ? 'Your team cannot contain the same Pokemon twice.' : s.name}
                      >
                        <img src={spriteUrl(s.num)} alt={s.name} />
                        {s.name}
                      </button>
                    );
                  })}
                </div>
              )}

              {stage && (
                <div className="ability-section">
                  <h3>Ability</h3>
                  <div className="ability-row">
                    {stage.abilities.map((a) => (
                      <button
                        type="button"
                        key={a.id}
                        className={`ability-chip${a.id === slot.ability ? ' selected' : ''}`}
                        onClick={() => selectAbility(slotIdx, a.id)}
                      >
                        {a.name}
                      </button>
                    ))}
                  </div>
                  {(() => {
                    const selectedAbility = stage.abilities.find((a) => a.id === slot.ability);
                    return selectedAbility && <p className="ability-desc">{selectedAbility.shortDesc}</p>;
                  })()}
                </div>
              )}

              {stage && (
                <div className="nature-section">
                  <h3>Nature</h3>
                  <div className="nature-dropdown">
                    <button
                      type="button"
                      className="nature-trigger"
                      onClick={() => setOpenNatureSlot((cur) => (cur === slotIdx ? null : slotIdx))}
                    >
                      {(() => {
                        const selectedNature = natures.find((n) => n.id === slot.nature);
                        return selectedNature ? <NatureLabel nature={selectedNature} /> : 'Select nature';
                      })()}
                      <span className="nature-caret">▾</span>
                    </button>
                    {openNatureSlot === slotIdx && (
                      <div className="nature-menu">
                        {natures.map((n) => (
                          <button
                            type="button"
                            key={n.id}
                            className={`nature-option${n.id === slot.nature ? ' selected' : ''}`}
                            onClick={() => selectNature(slotIdx, n.id)}
                          >
                            <NatureLabel nature={n} />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {stage && (
                <div>
                  <div className="moves-header">
                    <h3>Moves</h3>
                    <span>
                      {slot.moves.length} / {MAX_MOVES} selected
                    </span>
                  </div>
                  <div className="move-list">
                    {stage.moves.map((move) => {
                      const checked = slot.moves.includes(move.id);
                      const disabled = !checked && slot.moves.length >= MAX_MOVES;
                      const stab = stage.types.includes(move.type);
                      return (
                        <label
                          key={move.id}
                          className={`move-row${checked ? ' checked' : ''}${disabled ? ' disabled' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={disabled}
                            onChange={() => toggleMove(slotIdx, move.id)}
                          />
                          <span className={`move-name${stab ? ' stab' : ''}`} title={stab ? 'STAB' : undefined}>
                            {move.name}
                          </span>
                          <span className="move-meta">
                            <span className={`type-badge type-${move.type.toLowerCase()}`}>{move.type}</span>
                            <span className="move-stats">
                              {move.basePower > 0 ? move.basePower : '—'} / {move.accuracy === true ? '—' : `${move.accuracy}%`}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="builder-footer">
        <span className="error-msg">{validationError ?? ''}</span>
        <button
          type="button"
          className="btn-primary"
          disabled={!canBattle}
          onClick={() =>
            onReady(
              slots.map((s) => ({
                stageId: s.stageId!,
                ability: s.ability!,
                nature: s.nature!,
                moves: s.moves,
              })) as PlayerPokemonSelection[]
            )
          }
        >
          Battle!
        </button>
      </div>
    </div>
  );
}
