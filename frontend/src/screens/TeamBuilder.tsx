import { useEffect, useMemo, useState } from 'react';
import { fetchRoster, spriteUrl } from '../api/client';
import type { PlayerPokemonSelection, RosterLine, RosterResponse, StageOption } from '../api/types';

interface SlotState {
  groupId: string | null;
  stageId: string | null;
  moves: string[];
}

const EMPTY_SLOT: SlotState = { groupId: null, stageId: null, moves: [] };
const MAX_MOVES = 4;

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

export function TeamBuilder({ onReady }: { onReady: (selections: PlayerPokemonSelection[]) => void }) {
  const [data, setData] = useState<RosterResponse | null>(null);
  const [slots, setSlots] = useState<[SlotState, SlotState]>([EMPTY_SLOT, EMPTY_SLOT]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetchRoster()
      .then(setData)
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Failed to load roster.'));
  }, []);

  const roster = data?.roster ?? [];

  const otherExclusiveGroup = (slotIdx: 0 | 1): string | undefined => {
    const other = slots[slotIdx === 0 ? 1 : 0];
    return findLine(roster, other.groupId)?.exclusiveGroup;
  };

  const selectSpecies = (slotIdx: 0 | 1, groupId: string) => {
    const line = findLine(roster, groupId);
    const firstStage = line?.stages[0];
    setSlots((prev) => {
      const next = [...prev] as [SlotState, SlotState];
      next[slotIdx] = { groupId, stageId: firstStage?.id ?? null, moves: [] };
      return next;
    });
  };

  const selectStage = (slotIdx: 0 | 1, stageId: string) => {
    setSlots((prev) => {
      const next = [...prev] as [SlotState, SlotState];
      next[slotIdx] = { ...next[slotIdx], stageId, moves: [] };
      return next;
    });
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
    return null;
  }, [slots, roster]);

  const isComplete = slots.every((s) => s.stageId && s.moves.length >= 1);
  const canBattle = isComplete && !validationError;

  if (loadError) return <div className="panel error-msg">{loadError}</div>;
  if (!data) return <div className="panel loading-msg">Loading roster…</div>;

  return (
    <div className="panel">
      <div className="builder-header">
        <h2>Build Your Team</h2>
      </div>
      <p className="builder-rules">
        Level cap {data.levelCap} · No items · 2 Pokémon only · pick an evolution stage and up to 4
        moves legal at level {data.levelCap}.
      </p>

      <div className="slots">
        {([0, 1] as const).map((slotIdx) => {
          const slot = slots[slotIdx];
          const line = findLine(roster, slot.groupId);
          const stage = findStage(roster, slot.stageId);
          const blockedGroup = otherExclusiveGroup(slotIdx);

          return (
            <div className="slot" key={slotIdx}>
              <h3>Pokémon {slotIdx + 1}</h3>

              <div className="species-grid">
                {roster.map((candidateLine) => {
                  const base = candidateLine.stages[0]!;
                  const selected = candidateLine.groupId === slot.groupId;
                  const disabled =
                    !selected &&
                    !!candidateLine.exclusiveGroup &&
                    candidateLine.exclusiveGroup === blockedGroup;
                  return (
                    <button
                      type="button"
                      key={candidateLine.groupId}
                      className={`species-btn${selected ? ' selected' : ''}`}
                      disabled={disabled}
                      onClick={() => selectSpecies(slotIdx, candidateLine.groupId)}
                      title={disabled ? 'Only one starter allowed on your team' : base.name}
                    >
                      <img src={spriteUrl(base.num)} alt={base.name} />
                      <span>{base.name}</span>
                    </button>
                  );
                })}
              </div>

              {line && line.stages.length > 1 && (
                <div className="stage-row">
                  {line.stages.map((s) => (
                    <button
                      type="button"
                      key={s.id}
                      className={`stage-chip${s.id === slot.stageId ? ' selected' : ''}`}
                      onClick={() => selectStage(slotIdx, s.id)}
                    >
                      <img src={spriteUrl(s.num)} alt={s.name} />
                      {s.name}
                    </button>
                  ))}
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
                          <span className="move-name">{move.name}</span>
                          <span className="move-meta">
                            <span className="type-badge">{move.type}</span>
                            {move.basePower > 0 && <span>{move.basePower} BP</span>}
                            <span>Lv {move.learnedAt}</span>
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
              slots.map((s) => ({ stageId: s.stageId!, moves: s.moves })) as PlayerPokemonSelection[]
            )
          }
        >
          Battle!
        </button>
      </div>
    </div>
  );
}
