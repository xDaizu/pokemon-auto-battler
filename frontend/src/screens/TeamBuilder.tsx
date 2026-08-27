import { useEffect, useMemo, useState } from 'react';
import '../styles/teamBuilder.css';
import { fetchRoster, importTeam, spriteUrl } from '../api/client';
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
import { pokemonCountWord } from '../i18n/pokemonCount';

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

export function TeamBuilder({
  leaderId,
  onBack,
  onReady,
}: {
  leaderId: string;
  /** Returns to IntroScreen - the only way to pick a different leader once
   * the team picker has taken over (LeaderBar itself goes inert here, see
   * App.tsx). */
  onBack: () => void;
  onReady: (selections: PlayerPokemonSelection[]) => void;
}) {
  const { t, lang } = useLanguage();
  const [data, setData] = useState<RosterResponse | null>(null);
  const [slots, setSlots] = useState<SlotState[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [activeSlot, setActiveSlot] = useState(0);
  const [natureMenuOpen, setNatureMenuOpen] = useState(false);

  useEffect(() => {
    fetchRoster(leaderId)
      .then((res) => {
        setData(res);
        setSlots(Array.from({ length: res.teamSize }, () => EMPTY_SLOT));
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : t('teamBuilder.loadRosterFailed')));
  }, [t, leaderId]);

  const roster = data?.roster ?? EMPTY_ROSTER;
  const natures = data?.natures ?? [];

  const otherExclusiveGroups = (slotIdx: number): Set<string> => {
    const groups = new Set<string>();
    slots.forEach((s, i) => {
      if (i === slotIdx) return;
      const group = findLine(roster, s.groupId)?.exclusiveGroup;
      if (group) groups.add(group);
    });
    return groups;
  };

  const otherStageIds = (slotIdx: number): (string | null)[] =>
    slots.filter((_, i) => i !== slotIdx).map((s) => s.stageId);

  const selectSpecies = (slotIdx: number, groupId: string) => {
    const line = findLine(roster, groupId);
    const blockedStageIds = otherStageIds(slotIdx);
    const firstStage = line?.stages.find((s) => !blockedStageIds.includes(s.id)) ?? line?.stages[0];
    setSlots((prev) => {
      const next = [...prev];
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

  const selectStage = (slotIdx: number, stageId: string) => {
    const stageObj = findStage(roster, stageId);
    setSlots((prev) => {
      const next = [...prev];
      const prevSlot = next[slotIdx]!;
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

  const selectAbility = (slotIdx: number, abilityId: string) => {
    setSlots((prev) => {
      const next = [...prev];
      next[slotIdx] = { ...next[slotIdx]!, ability: abilityId };
      return next;
    });
  };

  const selectNature = (slotIdx: number, natureId: string) => {
    setSlots((prev) => {
      const next = [...prev];
      next[slotIdx] = { ...next[slotIdx]!, nature: natureId };
      return next;
    });
    setNatureMenuOpen(false);
  };

  const clearSlot = (slotIdx: number) => {
    setSlots((prev) => {
      const next = [...prev];
      next[slotIdx] = EMPTY_SLOT;
      return next;
    });
  };

  const toggleMove = (slotIdx: number, moveId: string) => {
    setSlots((prev) => {
      const next = [...prev];
      const slot = next[slotIdx]!;
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
    for (const slot of slots) {
      if (!slot.stageId) return null; // not yet an error, just incomplete
      if (slot.moves.length < 1) return null;
    }
    const lines = slots.map((s) => findLine(roster, s.groupId));
    for (let i = 0; i < lines.length; i++) {
      for (let j = i + 1; j < lines.length; j++) {
        const group = lines[i]?.exclusiveGroup;
        if (group && group === lines[j]?.exclusiveGroup) {
          return lines[i]?.exclusiveGroupKind === 'trade'
            ? t('teamBuilder.tradeValidation')
            : t('teamBuilder.starterValidation');
        }
      }
    }
    const stageIds = slots.map((s) => s.stageId);
    for (let i = 0; i < stageIds.length; i++) {
      for (let j = i + 1; j < stageIds.length; j++) {
        if (stageIds[i] && stageIds[i] === stageIds[j]) return t('teamBuilder.duplicateBlocked');
      }
    }
    return null;
  }, [slots, roster, t]);

  const isComplete = slots.every((s) => s.stageId && s.ability && s.nature && s.moves.length >= 1);
  const canBattle = isComplete && !validationError;

  const handleImport = async () => {
    setImporting(true);
    setImportError(null);
    try {
      const { selections } = await importTeam(importText, leaderId);
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
      setSlots(nextSlots);
      setActiveSlot(0);
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

  const activeSlotState = slots[activeSlot]!;
  const activeLine = findLine(roster, activeSlotState.groupId);
  const activeStage = findStage(roster, activeSlotState.stageId);
  const activeBlockedGroups = otherExclusiveGroups(activeSlot);
  const activeBlockedStageIds = otherStageIds(activeSlot);

  return (
    <div className="panel">
      <div className="builder-header">
        <div className="builder-header-title">
          <button type="button" className="back-arrow" onClick={onBack} aria-label={t('teamBuilder.back')}>
            ←
          </button>
          <h2>{t('teamBuilder.heading')}</h2>
        </div>
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
      <p className="builder-rules">
        {t('teamBuilder.rules', { cap: data.levelCap, max: MAX_MOVES, count: pokemonCountWord(data.teamSize, lang) })}
      </p>

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

      <div className="builder-toprow">
        <div className="slot-tiles">
          {Array.from({ length: 6 }, (_, tileIdx) => {
            const locked = tileIdx >= data.teamSize;
            if (locked) {
              return (
                <button
                  type="button"
                  key={tileIdx}
                  className="slot-tile slot-tile--locked"
                  disabled
                  title={t('teamBuilder.slotLocked')}
                >
                  <span aria-hidden="true">🔒</span>
                </button>
              );
            }
            const tileSlot = slots[tileIdx]!;
            const tileStage = tileSlot.stageId ? findStage(roster, tileSlot.stageId) : undefined;
            const isActive = tileIdx === activeSlot;
            return (
              <button
                type="button"
                key={tileIdx}
                className={`slot-tile${isActive ? ' selected' : ''}`}
                onClick={() => setActiveSlot(tileIdx)}
                title={t('teamBuilder.pokemonSlot', { n: tileIdx + 1 })}
              >
                {tileStage ? (
                  <>
                    <img src={spriteUrl(tileStage.num)} alt="" />
                    <span className="slot-tile-label">{translateSpeciesName(tileStage.name, lang)}</span>
                  </>
                ) : (
                  <span className="slot-tile-plus" aria-hidden="true">
                    +
                  </span>
                )}
              </button>
            );
          })}
        </div>
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

      {validationError && <p className="error-msg builder-toprow-error">{validationError}</p>}

      <div className="slot-editor">
        {!activeSlotState.stageId ? (
          <div className="species-picker">
            <h3>{t('teamBuilder.selectHeading', { n: activeSlot + 1 })}</h3>
            <div className="species-grid">
              {roster.map((candidateLine) => {
                const base = candidateLine.stages[0]!;
                const baseName = translateSpeciesName(base.name, lang);
                const exclusiveBlocked =
                  !!candidateLine.exclusiveGroup && activeBlockedGroups.has(candidateLine.exclusiveGroup);
                const duplicateBlocked = candidateLine.stages.every((s) => activeBlockedStageIds.includes(s.id));
                const disabled = exclusiveBlocked || duplicateBlocked;
                const title = exclusiveBlocked
                  ? candidateLine.exclusiveGroupKind === 'trade'
                    ? t('teamBuilder.tradeBlocked')
                    : t('teamBuilder.starterBlocked')
                  : duplicateBlocked
                    ? t('teamBuilder.duplicateBlocked')
                    : baseName;
                const matchup = base.matchup;
                return (
                  <button
                    type="button"
                    key={candidateLine.groupId}
                    className="species-btn"
                    disabled={disabled}
                    onClick={() => selectSpecies(activeSlot, candidateLine.groupId)}
                    title={title}
                  >
                    <img src={spriteUrl(base.num)} alt={baseName} />
                    <span className={`species-label matchup-${matchup}`}>{baseName}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="customize-panel">
            <div className="customize-header">
              <h3>{t('teamBuilder.pokemonSlot', { n: activeSlot + 1 })}</h3>
              <button
                type="button"
                className="remove-btn"
                onClick={() => clearSlot(activeSlot)}
                aria-label={t('teamBuilder.removePokemon')}
                title={t('teamBuilder.removePokemon')}
              >
                <span aria-hidden="true">🗑</span>
              </button>
            </div>

            {activeLine && activeLine.stages.length > 1 && (
              <div className="stage-row">
                {activeLine.stages.map((s) => {
                  const stageDisabled = s.id !== activeSlotState.stageId && activeBlockedStageIds.includes(s.id);
                  const stageName = translateSpeciesName(s.name, lang);
                  return (
                    <button
                      type="button"
                      key={s.id}
                      className={`stage-chip${s.id === activeSlotState.stageId ? ' selected' : ''}`}
                      disabled={stageDisabled}
                      onClick={() => selectStage(activeSlot, s.id)}
                      title={stageDisabled ? t('teamBuilder.duplicateBlocked') : stageName}
                    >
                      <img src={spriteUrl(s.num)} alt={stageName} />
                      {stageName}
                    </button>
                  );
                })}
              </div>
            )}

            {activeStage && (
              <div className="ability-section">
                <h3>{t('teamBuilder.abilityHeading')}</h3>
                <div className="ability-row">
                  {activeStage.abilities.map((a) => (
                    <button
                      type="button"
                      key={a.id}
                      className={`ability-chip${a.id === activeSlotState.ability ? ' selected' : ''}`}
                      onClick={() => selectAbility(activeSlot, a.id)}
                    >
                      {translateAbilityName(a.name, lang)}
                    </button>
                  ))}
                </div>
                {(() => {
                  const selectedAbility = activeStage.abilities.find((a) => a.id === activeSlotState.ability);
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

            {activeStage && (
              <div className="nature-section">
                <h3>{t('teamBuilder.natureHeading')}</h3>
                <div className="nature-dropdown">
                  <button type="button" className="nature-trigger" onClick={() => setNatureMenuOpen((open) => !open)}>
                    {(() => {
                      const selectedNature = natures.find((n) => n.id === activeSlotState.nature);
                      return selectedNature ? (
                        <NatureLabel nature={selectedNature} lang={lang} />
                      ) : (
                        t('teamBuilder.selectNature')
                      );
                    })()}
                    <span className="nature-caret">▾</span>
                  </button>
                  {natureMenuOpen && (
                    <div className="nature-menu">
                      {natures.map((n) => (
                        <button
                          type="button"
                          key={n.id}
                          className={`nature-option${n.id === activeSlotState.nature ? ' selected' : ''}`}
                          onClick={() => selectNature(activeSlot, n.id)}
                        >
                          <NatureLabel nature={n} lang={lang} />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeStage && (
              <div>
                <div className="moves-header">
                  <h3>{t('teamBuilder.movesHeading')}</h3>
                  <span>{t('teamBuilder.movesSelected', { count: activeSlotState.moves.length, max: MAX_MOVES })}</span>
                </div>
                <div className="move-list">
                  {activeStage.moves.map((move) => {
                    const checked = activeSlotState.moves.includes(move.id);
                    const disabled = !checked && activeSlotState.moves.length >= MAX_MOVES;
                    const stab = activeStage.types.includes(move.type);
                    return (
                      <label key={move.id} className={`move-row${checked ? ' checked' : ''}${disabled ? ' disabled' : ''}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => toggleMove(activeSlot, move.id)}
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
        )}
      </div>
    </div>
  );
}
