import { useEffect, useMemo, useState } from 'react';
import '../styles/teamBuilder.css';
import { fetchRoster, importTeam, spriteUrl } from '../api/client';
import { rockMatchup } from '../dex/rockMatchup';
import type {
  NatureOption,
  PlayerPokemonSelection,
  RosterLine,
  RosterResponse,
  StageOption,
  StatId,
} from '../api/types';
import { useLanguage } from '../i18n/LanguageContext';
import {
  statAbbr,
  translateAbilityDesc,
  translateAbilityName,
  translateMoveName,
  translateNatureName,
  translateSpeciesName,
  translateType,
  type Lang,
} from '../i18n/dexNames';

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

function NatureLabel({ nature, lang }: { nature: NatureOption; lang: Lang }) {
  const name = translateNatureName(nature.name, lang);
  if (!nature.plus || !nature.minus) {
    return <span className="nature-label">{name}</span>;
  }
  return (
    <span className="nature-label">
      {name}
      <span className="nature-stat nature-up">↑{statAbbr(nature.plus, lang)}</span>
      <span className="nature-stat nature-down">↓{statAbbr(nature.minus, lang)}</span>
    </span>
  );
}

export function TeamBuilder({ onReady }: { onReady: (selections: PlayerPokemonSelection[]) => void }) {
  const { t, lang } = useLanguage();
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
      .catch((err) => setLoadError(err instanceof Error ? err.message : t('teamBuilder.loadRosterFailed')));
  }, [t]);

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
      return t('teamBuilder.starterValidation');
    }
    if (slots[0].stageId && slots[0].stageId === slots[1].stageId) {
      return t('teamBuilder.duplicateBlocked');
    }
    return null;
  }, [slots, roster, t]);

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
      setImportError(err instanceof Error ? err.message : t('teamBuilder.importFailed'));
    } finally {
      setImporting(false);
    }
  };

  if (loadError) return <div className="panel error-msg">{loadError}</div>;
  if (!data) return <div className="panel loading-msg">{t('teamBuilder.loadingRoster')}</div>;

  return (
    <div className="panel">
      <div className="builder-header">
        <h2>{t('teamBuilder.heading')}</h2>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            setImportOpen((open) => !open);
            setImportError(null);
          }}
        >
          {importOpen ? t('teamBuilder.cancelImport') : t('teamBuilder.importFromShowdown')}
        </button>
      </div>
      <p className="builder-rules">{t('teamBuilder.rules', { cap: data.levelCap, max: MAX_MOVES })}</p>

      {importOpen && (
        <div className="import-panel">
          <textarea
            className="import-textarea"
            // Showdown export text is always in English canonical names regardless of
            // UI language — @pkmn/sim's dex lookups on the backend only recognize
            // those — so only the instructional line is translated, not the example.
            placeholder={`${t('teamBuilder.importPlaceholderIntro')}\n\nPikachu\nAbility: Static\nLevel: ${data.levelCap}\n- Thunder Shock\n- Quick Attack\n\n...`}
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
              {importing ? t('teamBuilder.importing') : t('teamBuilder.import')}
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
              <h3>{t('teamBuilder.pokemonSlot', { n: slotIdx + 1 })}</h3>

              <div className="species-grid">
                {roster.map((candidateLine) => {
                  const base = candidateLine.stages[0]!;
                  const baseName = translateSpeciesName(base.name, lang);
                  const selected = candidateLine.groupId === slot.groupId;
                  const exclusiveBlocked =
                    !selected &&
                    !!candidateLine.exclusiveGroup &&
                    candidateLine.exclusiveGroup === blockedGroup;
                  const duplicateBlocked =
                    !selected && candidateLine.stages.every((s) => s.id === blockedStageId);
                  const disabled = exclusiveBlocked || duplicateBlocked;
                  const title = exclusiveBlocked
                    ? t('teamBuilder.starterBlocked')
                    : duplicateBlocked
                      ? t('teamBuilder.duplicateBlocked')
                      : baseName;
                  const matchup = rockMatchup(base);
                  return (
                    <button
                      type="button"
                      key={candidateLine.groupId}
                      className={`species-btn${selected ? ' selected' : ''}`}
                      disabled={disabled}
                      onClick={() => selectSpecies(slotIdx, candidateLine.groupId)}
                      title={title}
                    >
                      <img src={spriteUrl(base.num)} alt={baseName} />
                      <span className={`species-label species-label-${matchup}`}>{baseName}</span>
                    </button>
                  );
                })}
              </div>

              {line && line.stages.length > 1 && (
                <div className="stage-row">
                  {line.stages.map((s) => {
                    const stageDisabled = s.id !== slot.stageId && s.id === blockedStageId;
                    const stageName = translateSpeciesName(s.name, lang);
                    return (
                      <button
                        type="button"
                        key={s.id}
                        className={`stage-chip${s.id === slot.stageId ? ' selected' : ''}`}
                        disabled={stageDisabled}
                        onClick={() => selectStage(slotIdx, s.id)}
                        title={stageDisabled ? t('teamBuilder.duplicateBlocked') : stageName}
                      >
                        <img src={spriteUrl(s.num)} alt={stageName} />
                        {stageName}
                      </button>
                    );
                  })}
                </div>
              )}

              {stage && (
                <div className="ability-section">
                  <h3>{t('teamBuilder.abilityHeading')}</h3>
                  <div className="ability-row">
                    {stage.abilities.map((a) => (
                      <button
                        type="button"
                        key={a.id}
                        className={`ability-chip${a.id === slot.ability ? ' selected' : ''}`}
                        onClick={() => selectAbility(slotIdx, a.id)}
                      >
                        {translateAbilityName(a.name, lang)}
                      </button>
                    ))}
                  </div>
                  {(() => {
                    const selectedAbility = stage.abilities.find((a) => a.id === slot.ability);
                    return (
                      selectedAbility && (
                        <p className="ability-desc">
                          {translateAbilityDesc(selectedAbility.name, selectedAbility.shortDesc, lang)}
                        </p>
                      )
                    );
                  })()}
                </div>
              )}

              {stage && (
                <div className="nature-section">
                  <h3>{t('teamBuilder.natureHeading')}</h3>
                  <div className="nature-dropdown">
                    <button
                      type="button"
                      className="nature-trigger"
                      onClick={() => setOpenNatureSlot((cur) => (cur === slotIdx ? null : slotIdx))}
                    >
                      {(() => {
                        const selectedNature = natures.find((n) => n.id === slot.nature);
                        return selectedNature ? (
                          <NatureLabel nature={selectedNature} lang={lang} />
                        ) : (
                          t('teamBuilder.selectNature')
                        );
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
                            <NatureLabel nature={n} lang={lang} />
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
                    <h3>{t('teamBuilder.movesHeading')}</h3>
                    <span>{t('teamBuilder.movesSelected', { count: slot.moves.length, max: MAX_MOVES })}</span>
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
                            {translateMoveName(move.name, lang)}
                          </span>
                          <span className="move-meta">
                            <span className={`type-badge type-${move.type.toLowerCase()}`}>
                              {translateType(move.type, lang)}
                            </span>
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
          {t('teamBuilder.battleCta')}
        </button>
      </div>
    </div>
  );
}
