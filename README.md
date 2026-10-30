# RigReady: Mud Pump Lockout

**Before you board: practise the job safely.**

RigReady is a phone-first 3D training sim for rig maintenance crews. It runs in any browser, with no headset and no app install. A trainee walks a rig deck, then changes the worn swab and liner on a triplex mud pump the safe way. If they skip a step, they see exactly how people get hurt, and the supervisor sees who is ready before anyone flies out.

Live demo: https://rigready-ng.sites.tab.bot

## The scenario

The trap is a real incident, [IADC Safety Alert 08-14](https://iadc.org/safety-alerts/alert-08-14-mud-pump-maintenance-results-serious-injury/). A mud pump was down for a swab change with only one breaker lock and no other lockout steps. The motorman removed the lock before the job was finished, the driller primed the pump, and the derrickman's lower leg was caught between the rod clamp and the pump.

## How to play

1. Type a trainee name, pick **Practice** (hints on) or **Assessment** (hints switch off after the deck walk).
2. **Deck walk:** find the muster point, Mud Pump 1 and the breaker panel (MCC).
3. **Do the job** by tapping equipment in the 3D scene:
   permit to work, PPE, switch MP-1 off at the MCC, attach your padlock and tag, close suction and discharge, bleed to 0 psi, try-start to verify, pick the right tools, open the #2 module, swap the liner, deal with an interruption, close up, clear the area, remove your lock, restore power, test run, hand back the permit.
4. **Score:** time, mistakes, incidents, safety score, pass or fail, and a checklist of what you did right and wrong.
5. **Supervisor dashboard** (`dashboard.html`): every attempt with score and readiness.

Controls: phone uses the joystick (bottom left), drag to look, tap to act or tap the deck to walk. Desktop uses W A S D or arrow keys, drag to look, click to act. Tapping something far away walks you to it.

Wrong choices have consequences: skipping isolation or bleed-down, removing your lock early, or letting a crewmate take your lock off all trigger an incident replay with the real alert, then a rewind so you can do it right.

## Run it

```bash
npm install
npm run dev      # local dev server
npm run build    # static site in ./site (deploy anywhere)
node --test test/site.test.mjs   # content checks on the built site
node test/playtest.cjs ./qa all   # headless playtest (serve the project on :8765 first)
```

Built with [Three.js](https://threejs.org) and Vite. Everything in the 3D scene is built from primitives in code, and every sound is synthesised with the Web Audio API, so there are no model or audio files to download (about 160 KB gzipped in total).

## Edit the procedure (for the engineer)

All the training content lives in **`src/procedure.json`**. You can change it without touching the 3D code:

- `job`: the job card text.
- `steps`: each step has a `title`, a `hint`, the `phase` it belongs to, and `requires`: the steps that must come first. Each requirement has an `outcome`:
  - `"block"`: the action is refused with your `message` (counts as a mistake if it has a `check`).
  - `"mistake"`: allowed, but recorded as a mistake with your `message`.
  - `"incident"`: triggers the incident replay named in `incident`.
- `checks`: the lines on the score checklist.
- `permit.options`: the permit form ticks (`correct: true/false`, with `why` for the wrong ones).
- `tools`: the tool rack (right tools and distractors, each with a reason).
- `breakers`: the MCC labels.
- `distractor`: what the crewmate says and the answer choices.
- `incidents`: what the incident card says, and the lesson.
- `scoring`, `passMark`, `readyMark`: points per mistake or incident, and the pass line.

After editing, run `npm run build` and redeploy.

## Results storage (and swapping to Neon)

For the demo, attempts are stored in the browser (`localStorage`), so it works offline with no server. `src/storage.js` is the only file that knows about storage. It includes a commented Neon Postgres version (table schema plus `fetch` calls to an API route), so the dashboard can become one shared view for a whole crew.

## Structure

```
index.html          trainer UI (title, HUD, dialogs, score)
dashboard.html      supervisor dashboard
src/procedure.json  the editable procedure
src/main.js         game logic, controls, procedure engine
src/world.js        the rig deck, built from primitives
src/audio.js        synthesised sound effects
src/storage.js      attempt storage (localStorage now, Neon later)
test/               content checks and the headless playtest
```

## Credits and disclaimer

- Incident text summarised from IADC Safety Alert 08-14. Energy isolation rule from the IOGP Life-Saving Rules.
- No third-party 3D models, textures or sounds are used. No real company logos.

**Demo procedure is a generic LOTO pattern; verify against your company's procedure.**
