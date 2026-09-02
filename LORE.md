# LORE.md — Historical grounding, factions, regions, quest spine

Working title: **Eidgenossen**. Setting: the Waldstätte (Uri, Schwyz, Unterwalden) and their Habsburg
neighbours, 1291–1315 (Act 1), with hooks to 1386 and the 1400s.

Legend used throughout this file and in every content definition (`historical` field):

* **H — historical.** Attested in contemporary or near-contemporary sources (the Bundesbrief itself, charters,
  chronicles within ~50 years, place names, the battle of Morgarten).
* **L — legend / tradition.** Part of the Swiss founding tradition as recorded in the *Weisses Buch von Sarnen*
  (c. 1470), Aegidius Tschudi's *Chronicon Helveticum* (1550s), the *Tellenlied*, and later Schiller. Not attested
  in 13th/14th-century sources, but *the* canon of the era the player expects. We use these as **dramatised**
  events and say so in the in-game journal ("as the old people of Sarnen tell it").
* **I — invented.** Our fiction: individual NPCs, side plots, exact dialogue, specific tactical layouts. Invented
  content must stay *plausible*: Alemannic names, real economy, no anachronistic gear.

Rule (from the brief): named political entities, geography, and the mandated beats are H or L, never I.
Where this file conflicts with an agent's memory of history, this file wins; where this file is silent, prefer
sources over invention and flag the addition here.

---

## 1. Timeline used by the game

| Date | Event | Status | Game use |
|---|---|---|---|
| 1231 / 1240 | Uri (1231) and Schwyz (1240, Faenza charter of Frederick II) obtain *Reichsfreiheit* — immediacy to the Emperor, bypassing Habsburg counts. The Gotthard route (Schöllenen gorge bridged c. 1220–1230, "Teufelsbrücke") makes the valleys strategically valuable. | H | Backstory, dialogue with elders; why the Habsburg bailiffs are resented. |
| 15 July 1291 | Death of King Rudolf I of Habsburg at Speyer. | H | Prologue opens with the news arriving by boat at Flüelen. |
| early Aug 1291 | **Bundesbrief** (Federal Charter) sealed by the men of Uri, Schwyz and the *Unterwalden* valley community: mutual aid, no foreign judges, arbitration of disputes, renewal of an *older* alliance ("antiquam confoederationis formam"). Written in Latin; sealed with the seals of Uri, Schwyz and Nidwalden (Obwalden's seal was affixed later / disputed). | H | **Prologue "Der Eid":** the player attends the sealing. |
| 16 Oct 1291 | Alliance of Uri and Schwyz with Zürich against Habsburg (the "Zürcher Bund"). | H | Mentioned by a Zürich merchant; hook to a later act. |
| 1298–1308 | King Albrecht I of Habsburg; tightening of Habsburg administration; the Waldstätte's imperial privileges not renewed by him. | H | Chapter 1 political background. |
| **1307 (Tschudi's date; Weisses Buch gives no year)** | **Rütlischwur** — Werner Stauffacher (Schwyz), Walter Fürst (Uri), Arnold von Melchtal (Unterwalden) swear on the Rütli meadow to expel the bailiffs. **Gessler's hat** on the pole at Altdorf; **Tell's apple shot**; Tell's leap at the Tellsplatte; Gessler killed in the Hohle Gasse near Küssnacht. **Burgenbruch** — storming of Zwing Uri, Rotzberg (Nidwalden) and Sarnen (Obwalden, bailiff Landenberg). | L | **Chapter 1** (all mandated beats). The game uses **1307**, states in the journal that the tellers of Sarnen "give no year". |
| 1 May 1308 | Albrecht I murdered near Windisch by his nephew Johann "Parricida" of Swabia. | H | News in Chapter 1 epilogue; Habsburg pressure pauses. |
| 1309 | Henry VII confirms the Waldstätte's privileges; Unterwalden gets its charter. | H | Reward beat closing Chapter 1. |
| 1314 | Double election (Louis of Bavaria vs. Frederick "the Fair" of Habsburg); the Waldstätte side with Louis. | H | Chapter 2 framing. |
| 6 Jan 1314 (Epiphany night) | **Marchenstreit** escalates: men of Schwyz raid Einsiedeln abbey over disputed alpine pastures, plunder it and drag monks to Schwyz; the Confederates are excommunicated. | H | **Chapter 2 opening** ("Die Nacht der Heiligen Drei Könige"); the player's choices decide how brutal the raid is (rep with Einsiedeln). |
| **15 Nov 1315** | **Battle of Morgarten.** Duke Leopold I of Austria marches from Zug along the Ägerisee toward Schwyz; ~1 500 Confederates (Schwyz with Uri and Unterwalden contingents) ambush the column between the lake and the Figlenfluh / Morgarten slope, using rocks and tree trunks from above, then halberds against the cramped cavalry; many knights drown in the lake. Chroniclers: Johannes of Winterthur (whose father was present on the Austrian side; written 1340s). | H | **Chapter 2 finale**, playable set piece. |
| 9 Dec 1315 | **Pact of Brunnen** renews the Bundesbrief in German. | H | Act 1 epilogue. |
| 1332 Luzern, 1351 Zürich, 1352 Glarus & Zug, 1353 Bern | The Acht Orte. | H | Later acts. |
| 1339 Laupen; 9 Jul 1386 **Sempach** (Leopold III killed; Winkelried legend); 9 Apr 1388 **Näfels** | Battles. | H (Winkelried: L) | Later acts. |
| 1422 Arbedo, 1476 Grandson & Murten, 1477 Nancy, 1499 Swabian War, 1515 Marignano | The pike-square century. | H | Later acts; the full Gewalthaufen era. |

**Design decision [ASSUMPTION]:** Act 1 spans 1291 → 1315 with two time-skips. The player character is born
c. 1276, is 15 at the Bundesbrief, 31 in 1307 and 39 at Morgarten. The character screen shows age; companions age
too; some elders die in the skips (journal notes). This keeps every mandated beat on its real date instead of
compressing 24 years into one summer.

---

## 2. Factions

| ID | Name | Kind | Status | Notes / referent |
|---|---|---|---|---|
| `uri` | **Land Uri** (Talschaft Uri; Landsgemeinde; Landammann) | canton (Waldstätte) | H | Leading families: von Attinghausen (Freiherr Werner von Attinghausen, Landammann c. 1294–1321 — H), Fürst (Walter Fürst — L), Tell of Bürglen (L). Seat: Altdorf. Controls the Gotthard (Säumer / muleteer economy). |
| `schwyz` | **Land Schwyz** | canton (Waldstätte) | H | Stauffacher of Steinen (Werner Stauffacher — name attested in Schwyz documents; his Rütli role is L), Reding, Ab Yberg. Seat: Schwyz. The most aggressive of the three (Marchenstreit). |
| `unterwalden` | **Unterwalden** — Nidwalden (Stans) and Obwalden (Sarnen) | canton (Waldstätte) | H | von Melchtal (Arnold — L), Winkelried (attested family, Nidwalden — H; the Sempach legend — L), von Wolfenschiessen (the bailiff's man killed in the bath-house — L). Rotzberg castle (Nidwalden), Landenberg hill at Sarnen. |
| `habsburg` | **House of Habsburg-Austria** and its bailiffs (Landvögte / Vögte) | house | H | King Rudolf I († 1291), Albrecht I († 1308), Duke Leopold I (Morgarten). Bailiffs: **Hermann Gessler** (L; no such Vogt is attested), **Beringer von Landenberg** (L), Habsburg-loyal knights of the Aargau (H: Habsburg heartland, Habichtsburg). Holdings near the lake: **Luzern** (bought 1291 from Murbach abbey — H), Küssnacht (Gesslerburg — a real castle, association with Gessler is L), Rotzberg, Zug (Habsburg town — H), Sempach. |
| `einsiedeln` | **Abbey of Einsiedeln** (Benedictine; Abbot Johannes I von Schwanden 1298–1327 — H) | abbey | H | Landholder disputing the March pastures with Schwyz since 1114 (Marchenstreit — H). Under Habsburg *Kastvogtei* (advocacy) — hence Leopold's casus belli. |
| `luzern` | **Town of Luzern** (Habsburg town 1291–1332; guilds, Reuss bridges) | town | H | Trading partner of the Waldstätte and Habsburg garrison at once — market, boatmen, tension. Joins the Confederacy 1332 (later act). |
| `zuerich` | **Zürich** (imperial city; the 1336 guild revolution of Rudolf Brun is later) | town / guild city | H | 1291 alliance with Uri and Schwyz. Appears in Act 1 as merchants and the Zürich alliance envoy. Full faction in later acts. |
| `bern` | **Bern** (imperial city; Laupen 1339) | town / guild city | H | Later act; mentioned. |
| `saeumer` | **Säumergenossenschaft** of the Gotthard (muleteers' cooperatives of Uri) | band | H (cooperatives attested 14th c.; our named one is I) | Side quests: escort, toll disputes, the Schöllenen. |
| `raubritter` | Bands of landless knights & deserters in the Aargau borderland | band | I (plausible) | Filler enemies on roads; explicitly not "bandits" as fantasy default — they are named, faction-affiliated men. |

Reputation is tracked per faction (−100..100). `habsburg` starts at 0 in 1291, drifts negative via main quest.

---

## 3. Regions (world map, 16 × 16 km compressed, see ARCHITECTURE.md §1)

Layout (game coordinates; north = −Z). The lake's shape is authored to be recognisable from the Seelisberg
viewpoint: the long north–south Urnersee arm, the east–west Gersau/Buochs basin, the Küssnacht and Alpnach arms,
the Luzern basin.

| Region ID | Canton / owner | Real referent | Key POIs | Status |
|---|---|---|---|---|
| `uri-reusstal` | uri | Urner Reusstal from Flüelen to Amsteg | **Altdorf** (village, Landsgemeinde site, the lime tree / Gessler's pole), **Bürglen** (Tell's home village, church), **Flüelen** (port), **Attinghausen** (castle of the Freiherren — H), **Zwing Uri** (Gessler's half-built fortress near Amsteg — L), Erstfeld, Silenen, Amsteg | H (Zwing Uri L) |
| `uri-urnersee` | uri | Urnersee, Axen shore | **Tellsplatte** (Tell's leap — L; chapel attested 16th c.), Sisikon, Isleten, **Rütli** (meadow above the lake on the Seelisberg side — H as place, oath L), **Seelisberg** (viewpoint) | H/L |
| `uri-schaechental` | uri | Schächental toward the Klausen | Spiringen, Unterschächen, alps; Klausenpass (closed in winter) | H |
| `uri-gotthard` | uri | Upper Reuss: Göschenen, **Schöllenen gorge & Teufelsbrücke** (c. 1230), Andermatt (Ursern — a separate valley community under the Disentis abbey, H), Hospental, **Gotthard hospice** (H, 13th c.) | H |
| `schwyz-talkessel` | schwyz | Schwyz basin under the two **Mythen** | **Schwyz** (village, church, Landsgemeinde on the Ibach meadow), **Steinen** (Stauffacher's house by the Steiner Aa — H house tradition L), **Brunnen** (port; Pact of Brunnen 1315), Ibach, Seewen, Lauerz & Lauerzersee | H |
| `schwyz-muotathal` | schwyz | Muotatal | Muotathal village, alps, the Pragel (closed) | H |
| `schwyz-arth-morgarten` | schwyz / disputed | Arth, Rigi south flank, **Sattel**, **Morgarten** slope (Figlenfluh), **Ägerisee** south shore | Arth, Goldau (no rockslide yet — that is 1806), Steinerberg, **Sattel letzi** (letzi walls attested for Schwyz — H), **Morgarten battlefield** (Schafstetten / Figlenfluh side — H) | H |
| `schwyz-march-einsiedeln` | schwyz ↔ einsiedeln | Alptal, the disputed **March** pastures, **Einsiedeln** abbey | Einsiedeln monastery (H, abbey church of the era), Alptal alps, Rothenthurm marsh | H |
| `unterwalden-nidwalden` | unterwalden | Stans basin, Buochs–Beckenried shore, Bürgenstock, Stanserhorn | **Stans** (village, church), **Rotzberg** (castle — H; storming L), Buochs, Beckenried, Emmetten, Wolfenschiessen | H |
| `unterwalden-obwalden` | unterwalden | Sarnen basin, Sarnersee, Melchtal, Alpnach | **Sarnen** (village; **Landenberg** hill with bailiff's castle — the hill exists, H; the bailiff L), **Melchtal** (Arnold's home — L), Kerns, Alpnach, Alpnachstad | H/L |
| `luzern-basin` | luzern / habsburg | Luzern town, the Reuss outflow, Pilatus | **Luzern** (walled town, Reuss bridges — the Kapellbrücke is c. 1365, so in 1291–1315 only a plain wooden bridge — H), Kriens, Horw; **Pilatus** (dragon lore — folk L, not a monster; it's a story a monk tells) | H |
| `kuessnacht-rigi` | habsburg | Küssnacht, Rigi north, Hohle Gasse | **Küssnacht** (Habsburg village, **Gesslerburg** ruins — H castle, L association), **Hohle Gasse** (sunken road toward Immensee — L), Immensee, Weggis & Vitznau (Rigi shore, under Luzern) | H/L |
| `zug` | habsburg | Zug town, Zugersee north end, Ägeri | **Zug** (Habsburg town, walls, Zytturm's predecessor — H), Baar, Ägeri, **Leopold's staging camp** (Nov 1315 — H) | H |
| `alps-high` | none | High Uri Alps, Urirotstock, Glärnisch backdrop | Impassable snow; visual only; a few alp huts (Alpwirtschaft — H) | H |

Peaks (visual anchors, heights in real metres → game metres above lake at 1:3): Pilatus 2 128 → 565,
Rigi 1 798 → 455, Bürgenstock 1 128 → 231, Stanserhorn 1 898 → 488, Fronalpstock 1 921 → 496,
Urirotstock 2 928 → 831, Grosser Mythen 1 898 → 488, Rossberg 1 580 → 382, Gotthard pass 2 106 → 557.

---

## 4. Points of interest (Act 1 target ≈ 60; the exploration builder authors the remaining minor ones as I)

Mandated (must exist, with the noted kind): Rütli (meadow), Altdorf (village + Gessler's pole site),
Bürglen (village), Flüelen (port), Tellsplatte (landmark), Hohle Gasse (landmark), Küssnacht + Gesslerburg
(village + castle), Zwing Uri (castle under construction), Attinghausen (castle), Schwyz (village),
Steinen (village + Stauffacher house), Brunnen (port), Sattel + letzi (bridge/wall), Morgarten (battlefield),
Ägerisee shore, Einsiedeln (monastery), Stans (village), Rotzberg (castle), Sarnen + Landenberg (village + castle),
Melchtal (alp hamlet), Luzern (town), Zug (town), Schöllenen + Teufelsbrücke (bridge), Andermatt (village),
Gotthard hospice (pass), Seelisberg (viewpoint), Pilatus alp (alp), Rigi alp (alp), Muotathal (village).

Minor POIs the builder may invent (I): named alp huts (`alp.<name>` using real alp names where possible —
Urnerboden, Alp Bannalp, Klewenalp, Fräkmüntegg…), wayside crosses, charcoal burners' camps, a hermit's cell,
fishermen's huts, mills, a quarry, shepherds' shelters, ruins of the *old* Habsburg toll station.

---

## 5. Characters

### Historical / legendary (fixed names, roles per tradition)

| ID | Name | Faction | Status | Role in game |
|---|---|---|---|---|
| `npc.werner-stauffacher` | Werner Stauffacher of Steinen | schwyz | name H / role L | One of the three Eidgenossen; Landammann; commands at Morgarten (tradition). |
| `npc.walter-fuerst` | Walter Fürst of Attinghausen | uri | L | One of the three; Tell's father-in-law (per Schiller — L²; we keep it as "kinsman"). |
| `npc.arnold-von-melchtal` | Arnold von Melchtal | unterwalden | L | One of the three; his father Heinrich blinded by the bailiff (L). |
| `npc.wilhelm-tell` | Wilhelm Tell of Bürglen | uri | L | Crossbowman; the hat; the apple; the Hohle Gasse. Can be a temporary companion in Chapter 1. |
| `npc.hermann-gessler` | Hermann Gessler, Landvogt | habsburg | L | Antagonist of Chapter 1. |
| `npc.beringer-von-landenberg` | Beringer von Landenberg, Landvogt at Sarnen | habsburg | L | Antagonist of the Burgenbruch. |
| `npc.werner-von-attinghausen` | Freiherr Werner von Attinghausen | uri | H | Landammann of Uri; the moderate voice; Uri's political weight. |
| `npc.leopold-i` | Duke Leopold I of Austria | habsburg | H | Commander at Morgarten (appears only at a distance / in the set piece as the objective's "rout the column"). |
| `npc.abt-johannes` | Abbot Johannes von Schwanden | einsiedeln | H | Marchenstreit antagonist/negotiator. |
| `npc.konrad-ab-yberg` | Konrad Ab Yberg | schwyz | H (family; individual I) | Landammann figure in Schwyz politics, Marchenstreit hawk. |
| `npc.heinrich-von-hunenberg` | Heinrich von Hünenberg | habsburg (Zug knight) | L | Tradition: the knight who shot an arrow with the warning "Hütet euch am Morgarten" into Schwyz — the source of the ambush intelligence. A Chapter 2 choice: trust the warning or not. |
| `npc.johannes-von-winterthur` | Johannes of Winterthur (a boy in 1315) | none | H | Chronicler; appears as a boy in Winterthur's father's retinue — a cameo the journal notes. |

### Invented (I) core cast — names Alemannic, roles plausible

* **Player**: origin canton chosen (Uri / Schwyz / Unterwalden), given name from a curated list
  (Kuoni, Ruodi, Werni, Jost, Heini, Ueli, Peter, Hans, Konrad, Burkhard, Rudi / Gret, Trudi, Elsi, Mechthild,
  Adelheid, Anna, Verena, Bertha), family name from place (Imhof, Gisler, Zumbrunnen, Aschwanden, Herger,
  Schorno, Bühler, Zgraggen, Odermatt, Amstutz, Wyrsch, Lussi).
* **Companions (max 3 at once, from a pool of 6):**
  * `npc.jost-imhof` — Uri Säumer, spear and crossbow, knows the Gotthard. (I)
  * `npc.mechthild-schorno` — Schwyz herbalist, the party's healer (herbalism, dagger); daughter of a Landsgemeinde family. (I)
  * `npc.heini-odermatt` — Nidwalden herder, huge, halberd; prone to rout unless rallied — the morale system's teaching companion. (I)
  * `npc.bruder-anselm` — lay brother of Engelberg, literate, speech & trade; conflicted during the Einsiedeln raid. (I)
  * `npc.ueli-zgraggen` — deserter from a Habsburg garrison, shield & sword, knows knightly tactics; rep with habsburg matters. (I)
  * `npc.wilhelm-tell` — Chapter 1 only (L).
* Antagonist lieutenants (I): `npc.ritter-eberhard-von-mülinen` (Habsburg Aargau knight, at Morgarten),
  `npc.vogt-schreiber-ludwig` (Gessler's clerk, the man who actually runs Altdorf's tolls).

---

## 6. Main quest spine — Act 1

Journal identifies L beats with "as it is told". Player choices change outcomes at the margin (who lives, rep,
loot, companion availability) but never the historical outcome of H events.

### Prologue — *Der Eid* (August 1291)
1. **Flüelen, dawn.** Player (15) is helping unload a Säumer boat. News: King Rudolf is dead. Tutorial: movement,
   interaction, the compass, a first POI discovery (Flüelen → Altdorf).
2. **Altdorf.** The Landsgemeinde is called. Speech tutorial: player carries a message to Werner von Attinghausen.
3. **Steinen / Stans.** Escort the elder of the player's canton by boat and foot to the meeting. **First combat**
   (turn-based tutorial, 2v2): two of a Habsburg road-toll party try to seize the boat's cargo at Brunnen. Introduces
   action / bonus / movement, Edge from high ground on the quay, a spear brace.
4. **Rütli.** Night, the meadow, the three men and their witnesses. The **oath** — a scripted dialogue where the
   player speaks the (German paraphrase of the Latin) Bundesbrief clauses back: mutual aid, no foreign judges,
   arbitration. The player's line closes the scene. Journal: "The letter was sealed in the first days of August…"
   Cutscene ends with the sealing of the charter (H) and the fade to **1307**.

### Chapter 1 — *Der Hut auf der Stange* (1307)
5. **Altdorf, sixteen years later.** Gessler's hat on the pole by the lime tree. The player, now 31, must pass. Choice:
   bow (rep +habsburg, −uri; companions comment), walk past (arrested → dialogue/speech/bribe or fight 3v4 in the
   square with the guards), or hang back and watch **Tell** refuse (L). The **apple shot** is a cutscene the player
   can influence only by dialogue with Tell before it (steadying him gives no mechanical effect; it's the scene).
6. **Tellsplatte.** Storm on the Urnersee; Tell's leap. Player and party row after / meet Tell on the Axen path.
7. **Hohle Gasse.** Tell waits for Gessler. The player's party holds the road behind — **combat 4v6** against
   Gessler's escort while Tell's shot resolves by script at turn 2 (Gessler dies — L). Player can choose to free
   the escort's peasants (rep).
8. **Burgenbruch.** Three short set pieces the player may do in any order or delegate to allies: Zwing Uri (walk in
   as labourers — stealth/speech), Rotzberg (night, rope up the wall — athletics; L detail of the servant girl's
   lover), Sarnen/Landenberg (the New Year's gift procession — L: men hide weapons in the gift baskets). At least one
   must be played; the others resolve by choosing a commander (party member's leadership skill). Journal notes these
   are "told in Sarnen".
9. **Epilogue 1308.** News of Albrecht's murder at Windisch (H). Fade to **1314**.

### Chapter 2 — *Morgarten* (1314–1315)
10. **Epiphany 1314, Schwyz.** Konrad Ab Yberg and Werner Stauffacher argue over the March pastures. The raid on
    **Einsiedeln** (H). Player joins or tries to restrain: plunder vs. restraint affects `einsiedeln` rep, loot, and
    whether Bruder Anselm stays. **Combat 4v5** at the abbey gate against the abbey's men-at-arms, or a speech path.
11. **Excommunication and muster.** A year of preparation: the player can improve the **letzi** at Sattel
    (craft), recruit (leadership), scout Zug (stealth — sees Leopold's camp, H), and receive the **Hünenberg arrow**
    (L) — decide whether to trust it (if not, the ambush setup is worse: fewer boulder caches).
12. **Morgarten, 15 Nov 1315.** The set piece. Terrain: lake (west), steep slope (east), the road between. Grid
    40 × 24. Confederates hold the slope with **boulder / trunk caches** (environment interaction, rolled onto
    the road), then descend in **Haufen** with halberds. Objectives: hold the ridge 3 turns while the column bunches
    (`survive`), trigger ≥ 2 rockfalls, then `rout` the column: enemy morale collapses; knights pushed into the
    lake `Drowning`. Leopold escapes (H — he must; the objective is rout, not kill).
13. **Brunnen, 9 Dec 1315.** The Pact renewed in German. Act 1 ends; epilogue stats (companions alive, rep).

### Side quests (I unless noted)
* *Der Säumer* — escort a mule train through the Schöllenen; a wrong turn on the Teufelsbrücke is a ledge fight.
* *Alpstreit* — arbitrate an alp boundary between Schwyz and Arth herders (the Bundesbrief's arbitration clause in play — H mechanic).
* *Die Fischer von Gersau* — Gersau's free village (H, later a free republic) vs. a Habsburg toll.
* *Der Drache vom Pilatus* — a monk of Luzern hires the party to find a "dragon" — it's a lammergeier and a
  smuggler; explicitly no monster (folk L).
* *Schützenkönig* — a crossbow contest in Altdorf (competitions attested later; I).
* *Das Bad zu Wolfenschiessen* — the bath-house murder of the bailiff's man (L), told as a done thing the party helps hide.

---

## 7. Material culture — items allowed in Act 1

| Item | Era note | Status |
|---|---|---|
| **Halbarte** (halberd, early form: axe blade + spike on 2 m haft, "Sempach halberd" style) | Attested in the Confederacy from the early 14th c.; Morgarten chroniclers describe "halberds". | H |
| **Spiess** (spear 2.5–3 m) | Universal peasant weapon. | H |
| **Langspiess** (pike 4–5.5 m) | Widespread only from the 15th c. Available in Act 1 only as a *Haufen* training item at the end of Chapter 2 (tool-tip says so). | H (dated) |
| **Armbrust** (crossbow; simple stirrup + belt hook; windlass is 15th c. → not in Act 1) | Tell. | H |
| **Morgenstern** (spiked club) | Attested for peasant militias 14th–15th c.; Morgarten tradition. | H |
| **Schwert** (arming sword), **Langschwert** (longsword; two-handed, from c. 1300) | Knights & wealthy freemen. | H |
| **Messer / Bauernwehr**, **Schweizerdolch** (the Swiss dagger form begins as the "Basler Dolch", c. 1300) | Sidearm for everyone. | H |
| **Axe**, **flail**, **sling**, **hunting bow** | Peasant kit. | H |
| Armour: **Gambeson**, **mail shirt (Panzer)**, **kettle hat (Eisenhut)**, **coat of plates** (knights), **early bascinet**, **heater shield**, **buckler** | Habsburg knights have the heavy set; Confederates rarely more than gambeson + Eisenhut. | H |
| Money: **Pfennig / Haller**, **Schilling** (12 Pfennig), **Pfund** (20 Schilling) — Zürich mint. | | H |
| Food: bread, cheese (Sbrinz-type hard cheese exists as "Alpkäse"), dried meat, wine from the Luzern shore, milk. **No potatoes, no maize, no tomatoes, no tobacco, no chocolate.** | | H |

Banned player-facing anachronisms: plate harness, wheellocks/handguns (the Confederates' first hand-cannons are
late 14th c. — later acts only), stirrup-less crossbow spanning windlass in 1291–1315, the Kapellbrücke,
the Swiss cross as a *flag* (a field sign appears from 1339 Laupen — later act), "Switzerland" as a word (we
use "the Eidgenossen", "the Waldstätte", "the Länder"), the word "canton" in NPC speech (UI may use it).

---

## 8. Language and naming

* Places use modern Swiss German spellings (Altdorf, Schwyz, Küssnacht) except where an older form is iconic in
  dialogue (Lucerne → "Luzern" always).
* Person names: given name + "von <place>" for nobility, "of <village>" / trade-name for commoners, Alemannic
  diminutives in speech (Ueli, Heini, Kuoni, Ruodi, Gret, Trudi).
* Forms of address: "Ammann", "Herr Vogt", "Freiherr", "Bruder", "Vater Abt".
* Oaths and exclamations: "Bei Sankt Verena!", "Gottes Wunden!" — Christian, not fantasy.

---

## 9. Sources the writers should treat as canonical (for the builders' reference)

Bundesbrief 1291 (Bundesbriefmuseum Schwyz text); *Weisses Buch von Sarnen* (c. 1470); Aegidius Tschudi,
*Chronicon Helveticum*; Johannes of Winterthur, *Chronica* (Morgarten); Historisches Lexikon der Schweiz (HLS) entries
for Morgarten, Marchenstreit, Bundesbrief, Tell, Gessler, Stauffacher, Attinghausen, Winkelried, Landenberg,
Einsiedeln, Luzern; Schiller's *Wilhelm Tell* (1804) for the *shape* of the legend only — never for facts.

---

## 10. Register of invented additions (append-only; builders add lines here)

| ID | What | Added by | Justification |
|---|---|---|---|
| `npc.jost-imhof` … `npc.ueli-zgraggen` | Companion pool | integrator | Playable party needs fictional peers of the historical figures. |
| `npc.ritter-eberhard-von-mülinen`, `npc.vogt-schreiber-ludwig` | Antagonist lieutenants | integrator | Mülinen is a real Aargau ministerial family; the individual is fictional. |
| `saeumer`, `raubritter` factions | Road-life factions | integrator | Attested social groups; the specific bands are fiction. |
| Time-skip structure 1291 → 1307 → 1314 | Narrative device | integrator | Keeps H/L dates intact. |
| `item.lance` | Habsburg knightly lance (mounted, `spear` skill, requires spear 25) | party builder | Not itemised by name in §7, but directly implied by §7's "Habsburg knights have the heavy set" and the standard knightly panoply of the period; restricted to mounted Habsburg-knight kit, never a Confederate/peasant weapon. |
| `item.staff` | Plain walking/herding staff, doubles as a boat hook | party builder | An ordinary rural tool-weapon (quarterstaff/herder's stick); no anachronism, not worth naming in §7's weapon list but needs no special justification either. |
| `item.leather-cap`, `item.wooden-shoes`, `item.leather-boots`, `item.hobnailed-boots` | Footwear and a leather cap as light protection | party builder | Cuir-bouilli leather caps, wooden clogs and hobnailed boots are all attested general medieval practice, not specific to any banned anachronism; §7 covers the named armour set but not everyday footwear. |
| `item.bandage`, `item.herbs`, `item.salve` | Healing consumables | party builder | ARCHITECTURE §5.3 names Bandage as the core combat stabilise/heal mechanic; herbs (arnica, yarrow, St John's wort) and a rendered-fat salve are plausible period household medicine, not a potion economy. |
| Perk mechanic names (all of `src/content/perks.ts` except the four §5.5 examples: Hook, Wall of Iron, Eidgenoss, and the renamed crossbow capstone below) | Invented perk names for real historical techniques | party builder | Each name (Spiessstoss, Schnellschuss, Schwingerwurf, Plattenrock, Sure Foot, War Cry, Boulder Sense, etc.) is the builder's label for a mechanic whose period justification is in its own `note` field; none introduce new lore, only new vocabulary for existing techniques. |
| `perk.crossbow-75` "Gürtelhaken-Drill" | Renamed crossbow reload capstone | party builder | Fix round 1 (critic issue 9): replaces an earlier "Windlass Drill", which used the 15th-c. windlass span banned by §7 as a player-facing anachronism for 1291–1315. Renamed to the stirrup-and-belt-hook spanning method the Act 1 Armbrust (§7) actually uses, so the perk is period-correct and usable in Act 1 rather than a dormant placeholder. |
| `poi.alp-bannalp`, `poi.wegkreuz-axenweg`, `poi.wegkreuz-gotthardweg`, `poi.kohlerplatz-schaechental`, `poi.kohlerplatz-melchtal`, `poi.klausnerzelle`, `poi.fischerhuetten-gersau`, `poi.muehle-sarneraa`, `poi.steinbruch-axen`, `poi.alte-zollstatt` | Minor invented POIs per §4's list (named alp hut, two wayside crosses, two charcoal burners' camps, a hermit's cell, fishermen's huts, a mill, a quarry, an old toll-station ruin) | exploration builder | Each is offset from a real gazetteer place into that place's region; individual/exact-siting details are fiction, the underlying activity (charcoal-burning, lake fishing, water-milling, quarrying, wayside devotion, toll roads) is ordinary attested period practice per each entry's own `note`. `src/content/pois.ts` also adds ~50 further real-toponym POIs (`historical: true`) from `gazetteer.ts` beyond LORE's mandated list, to reach the ≈60+ exploration target. |
| ~79 minor named NPCs in `src/content/npcs.ts` (innkeepers, priests, boatmen, smiths, herders, Landsgemeinde men, monks, Habsburg guards/toll-collectors, fishermen — see that file for the full roster) | Settlement population, named per LORE §8's Alemannic given-name/family-name rules | exploration builder | Fills out Altdorf, Schwyz, Luzern, Zug, Sarnen, Stans, Brunnen, Flüelen, Küssnacht, Einsiedeln and a dozen more settlements with individually-named, schedule-bearing residents; each one's equipment/skills are cloned from an existing `archetypes.ts` template (so every item id is guaranteed valid) and each carries its own one-line `note`. One entry, `npc.heinrich-von-melchtal` (Arnold's father, per the L Weisses Buch tradition), is `historical: 'legend'` rather than invented. |
| Exact staged content of the six §6 side quests (`quest.der-saeumer`, `quest.alpstreit`, `quest.fischer-von-gersau`, `quest.drache-vom-pilatus`, `quest.schuetzenkoenig`, `quest.bad-zu-wolfenschiessen`) and every `dlg.*`/`cs.*` def's specific staging, dialogue lines and skill-check DCs (`src/content/quests/**`, `src/content/dialogues/**`, `src/content/cutscenes/**`) | Quest/dialogue content for the six side quests §6 already names, plus the Act 1 main-quest spine's scene-by-scene dialogue (the Rütlischwur's clause paraphrase, Gessler's confrontation lines, the Hünenberg arrow's exact wording, etc.) | quest builder | The plots and NPCs used (Niklaus Planzer for Der Säumer, Melchior Arnold for Alpstreit, Uli Fischer for Die Fischer von Gersau, Trudi Meier for Der Drache vom Pilatus, Burkhard Wyrsch for Schützenkönig, Jost Durrer for Das Bad zu Wolfenschiessen) are existing `historical: 'invented'` NPCs from `npcs.ts`, reused rather than newly invented; the plots themselves are the ones §6 already sanctions as I unless noted. The Bundesbrief clause paraphrase in `dlg.ruetli-oath`/`cs.bundesbrief-sealing` renders the charter's attested H content (mutual aid, no foreign judges, arbitration) in the player's own words, not new lore. |
| `npc.ritter-eberhard-von-mulinen` | Id spelling | integrator | Content ids are ASCII kebab-case (ARCHITECTURE §1); the §5 entry `von Mülinen` is this id. |
| POI `historical` convention | Convention | integrator | A POI is `true` when the place is attested even if its game role is legend (Rütli, Altdorf, Gesslerburg…); the role is stated in `note`. Only places that exist solely in the legend (Zwing Uri, Tellsplatte, Hohle Gasse, Melchtal as Arnold's home) are `legend`. |
