/** quest.der-eid — Prologue, August 1291. LORE.md §6 "Der Eid". */
import type { QuestDef } from '@core/schemas';

export const derEid: QuestDef = {
  id: 'quest.der-eid', title: 'Der Eid', kind: 'main', chapter: 'prologue-1291',
  historical: 'legend', note: "The Bundesbrief and its sealing are H (early Aug 1291); the Rütlischwur staging is L (Tschudi). LORE.md §1/§6.",
  description: "News of King Rudolf's death reaches the Waldstätte. Carry word, escort an elder to the meeting, and stand witness as the Bundesbrief is sealed.",
  stages: [
    {
      id: 'fluelen-news', journal: 'Flüelen, dawn: a Säumer boat brings word that King Rudolf of Habsburg is dead.',
      marker: 'poi.altdorf', objectiveText: 'Learn the news at Flüelen, then make for Altdorf.',
      onEnter: [
        { cutscene: 'cs.intro-1291' },
        // 4.5 coach, beat 1 (movement): unconditional tutorial toast on quest entry — fires exactly
        // once per playthrough (enterStage runs once per stage entry; the quest never re-enters
        // fluelen-news, and new-game resets flags). Headless-safe: a pure toast, no quest advance,
        // so the walkthrough driver and harness beats are unaffected.
        // i18n-delta: ui.tutorial.move ("Move with WASD or arrows — hold Shift to run.")
        { toast: 'Move with WASD or arrows — hold Shift to run.' },
        { setFlag: ['tutorial-step', 'camera'] },
      ],
      advanceWhen: [{ cond: { nearPoi: ['poi.altdorf', 160] }, to: 'altdorf-message' }],
    },
    {
      // 4.5 coach, beats 2–5 (camera → interact → journal/map → speech check): toast + objective step
      // pairs folded into the quest's own altdorf-message stage — no extra stages, so the stage ids the
      // walkthrough/harness/main.ts beats assert on (fluelen-news → altdorf-message → escort → …) are
      // unchanged. The interact ([E]) and journal/map beats reference the real HUD prompt (interact.ts:
      // nearestInteractable prompt + [E] key) and the real hotkeys (ui/index.ts: J journal, M map). The
      // speech beat names the real Fürst check (dlg.walter-fuerst advances to escort). Skippable: the
      // Fürst dialogue advances straight to escort, bypassing nothing (there is nothing to bypass).
      // Never-refire: altdorf-message is entered exactly once per playthrough, so its onEnter runs once.
      // i18n-delta: ui.tutorial.camera ("Drag the mouse to look around — wheel zooms the camera.")
      // i18n-delta: ui.tutorial.interact ("Step close and press [E] to talk.")
      // i18n-delta: ui.tutorial.journal ("Press [J] for the journal — [M] opens the map.")
      // i18n-delta: ui.tutorial.speech ("Talk to Walter Fürst — Speech checks can open another way.")
      id: 'altdorf-message', journal: 'The Landsgemeinde is called at Altdorf. Walter Fürst asks you to carry word to Freiherr Werner von Attinghausen.',
      marker: 'poi.altdorf', objectiveText: 'Find Walter Fürst at Altdorf and carry his message.',
      onEnter: [
        { toast: 'Drag the mouse to look around — wheel zooms the camera.' },
        { toast: 'Step close and press [E] to talk.' },
        { toast: 'Press [J] for the journal — [M] opens the map.' },
        { toast: 'Talk to Walter Fürst — Speech checks can open another way.' },
        { setFlag: ['tutorial-step', 'combat'] },
      ],
    },
    {
      id: 'escort', journal: 'A boat carries the elder toward Steinen and the meeting place — but the Brunnen quay road is not always safe for Habsburg toll-men to travel unchallenged, nor for those who cross them.',
      marker: 'poi.brunnen', objectiveText: 'Escort the elder past the Brunnen quay.',
      onEnter: [
        // 4.5 coach, beat 6 (combat intro): the encounter itself FIRST (byte-identical to the
        // pre-4.5 def — the retry-loop timing is untouched), then the toast + progress flags. No
        // quest advance here, so it can never wedge the headless walkthrough or the encounter
        // runner. Retry note: escort-recover re-enters this stage, so the toast re-fires on retry —
        // accepted and pinned by the tutorial test (exactly-once applies to beats 1–5 and to the
        // combat *hint card*, which is dismiss-on-first-win via `tutorial-combat-hint-seen` and
        // never shows again).
        // i18n-delta: ui.tutorial.combat ("Steel decides it now — move, attack, or brace for the toll-men.")
        { encounter: 'enc.brunnen-quay' },
        { toast: 'Steel decides it now — move, attack, or brace for the toll-men.' },
        { setFlag: ['tutorial-step', 'done'] },
        { setFlag: ['tutorial-done', true] },
      ],
      advanceWhen: [
        { cond: { var: ['quest.der-eid', 'combat.outcome', 'win'] }, to: 'travel-ruetli' },
        { cond: { var: ['quest.der-eid', 'combat.outcome', 'fled'] }, to: 'travel-ruetli' },
        { cond: { var: ['quest.der-eid', 'combat.outcome', 'lose'] }, to: 'escort-recover' },
      ],
    },
    {
      id: 'escort-recover', journal: "The toll-men beat you back from the quay. The elder's boat pulls off to a hidden inlet to wait out the hour — you will have to try the quay again.",
      marker: 'poi.brunnen', objectiveText: 'Regroup and try the Brunnen quay again.',
      onEnter: [{ rest: 8 }, { quest: ['advance', 'quest.der-eid', 'escort'] }],
    },
    {
      id: 'travel-ruetli', journal: 'Word passes quietly: gather at the Rütli meadow after dark.',
      marker: 'poi.ruetli', objectiveText: 'Make for the Rütli meadow.',
      advanceWhen: [{ cond: { nearPoi: ['poi.ruetli', 100] }, to: 'ruetli-oath' }],
    },
    {
      id: 'ruetli-oath', journal: 'Night falls on the Rütli meadow. Werner Stauffacher, Walter Fürst and Arnold von Melchtal — and their witnesses — gather to swear.',
      marker: 'poi.ruetli', objectiveText: 'Speak the oath at the Rütli.',
      onEnter: [{ dialogue: 'dlg.ruetli-oath' }],
    },
    {
      id: 'sealing', journal: 'The letter is drawn up to be sealed.',
      marker: 'poi.ruetli', objectiveText: 'Witness the sealing of the Bundesbrief.',
      onEnter: [{ cutscene: 'cs.bundesbrief-sealing' }],
    },
  ],
  // 4.5 coach never-refire mechanism: ONE shared progression flag `tutorial-step` plus ONE
  // terminal flag `tutorial-done` (both in the quest service's persistent flag map — saved via
  // save.snapshot, cleared only on new-game reset — and never reset by any stage). Beats 1–5 are
  // plain onEnter toasts on the quest's own stages (fluelen-news, altdorf-message), each entered
  // exactly once per playthrough, so each fires exactly once. Beat 6 (combat intro) is a toast pair
  // on `escort`'s onEnter: it fires on escort entry (and re-fires if the escort-recover loop retries
  // the stage — accepted, pinned by test; the retry is rare and the reminder is relevant). The combat
  // *hint card* (combatUi) is the strictly-once surface: dismiss-on-first-win via
  // `tutorial-combat-hint-seen`, never shows again. Advancing the quest skips remaining hints
  // trivially: there are no side stages to get stuck in — the main flow (nearPoi arrival, Fürst
  // dialogue → escort → travel-ruetli) is the only path, and every hint is attached to it.
  onStart: [{ toast: 'Quest started: Der Eid' }, { setFlag: ['tutorial-step', 'move'] }],
  onComplete: [{ toast: 'The Bundesbrief is sealed. Sixteen years pass...' }, { setFlag: ['tutorial-done', true] }],
};
