
const { chromium, devices } = require('/home/user/node_modules/playwright-core');
const OUT = process.argv[2]; const which = process.argv[3] || 'all';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = [];
function L(...a) { const s = a.join(' '); log.push(s); console.log(s); }

async function newPage(b, opts) {
  const ctx = await b.newContext(opts);
  const p = await ctx.newPage();
  p._errs = [];
  p.on('console', m => { if (m.type() === 'error') p._errs.push(m.text()); });
  p.on('pageerror', e => p._errs.push('pageerror: ' + e.message));
  await p.goto('http://127.0.0.1:8765/site/index.html');
  await p.waitForFunction(() => document.body.classList.contains('ready'));
  return p;
}
const idle = async (p, ms = 15000) => { await p.waitForFunction(() => !window.__rig.attempt || !window.__rig.attempt.busy, null, { timeout: ms }); await sleep(150); };
async function start(p, name, touch, mode) {
  if (await p.isVisible('#portraitOk')) await p.click('#portraitOk');
  await p.fill('#nameInput', name);
  if (mode) await p.click(`[data-mode="${mode}"]`);
  await p.click('#startBtn'); await sleep(300);
  await p.click('#goBtn'); await sleep(500);
}
// Teleport to a station, then click/tap the object where it really is on screen (real raycast).
async function act(p, station, iid, touch, opts = {}) {
  await p.evaluate((s) => window.__rig.goToStation(s), station);
  await sleep(250);
  const pos = await p.evaluate((i) => window.__rig.screenPos(i), iid);
  const before = await p.evaluate(() => JSON.stringify(window.__rig.state));
  if (pos.onScreen) { if (touch) await p.touchscreen.tap(pos.x, pos.y); else await p.mouse.click(pos.x, pos.y); }
  await sleep(120);
  let after = await p.evaluate(() => JSON.stringify(window.__rig.state));
  const busyNow = await p.evaluate(() => window.__rig.attempt && window.__rig.attempt.busy);
  const incidentVisible = await p.isVisible('#incident');
  const modalVisible = await p.isVisible('#modal');
  let via = 'click';
  if (!pos.onScreen || (before === after && !busyNow && !incidentVisible && !modalVisible && !opts.expectNoChange)) {
    via = pos.onScreen ? 'click-missed->hook' : 'offscreen->hook';
    await p.evaluate((i) => window.__rig.interact(i), iid);
  }
  if (!opts.noWait) await idle(p);
  L(`  ${iid.padEnd(16)} via ${via}`);
  return via;
}
async function permit(p) {
  await act(p, 'permit', 'permit_board', p._touch);
  await p.waitForSelector('#permitSign');
  for (const id of ['elec', 'mech', 'press', 'driller']) await p.check(`.chks input[value="${id}"]`);
  await p.click('#permitSign'); await sleep(300);
}
async function prep(p) {
  const t = p._touch;
  // deck walk by teleporting near each station
  for (const s of ['muster', 'pump', 'mcc']) { await p.evaluate((st) => window.__rig.goToStation(st), s); await sleep(200); }
  await permit(p);
  for (const i of ['hardhat', 'glasses', 'gloves', 'boots']) await act(p, 'locker', 'ppe_' + i, t);
}
async function isolate(p, { lock = true, bleed = true, verify = true } = {}) {
  const t = p._touch;
  await act(p, 'mcc', 'breaker_mp1', t);
  if (lock) { await act(p, 'mcc', 'hasp_mp1', t, { noWait: true }); await sleep(450); if (p._shot) await p.screenshot({ path: OUT + '/lock_snap.png' }); await idle(p); await sleep(900); if (p._shot) await p.screenshot({ path: OUT + '/lock_done.png' }); }
  await act(p, 'valves', 'valve_suction', t); await act(p, 'valves', 'valve_discharge', t);
  if (bleed) await act(p, 'valves', 'bleed', t);
  if (verify) await act(p, 'start', 'start_btn', t);
}
async function tools(p) {
  for (const id of ['cover_wrench', 'clamp_wrench', 'liner_puller']) await act(p, 'rack', 'tool_' + id, p._touch);
}
async function repairToDistractor(p) {
  const t = p._touch;
  await act(p, 'pump', 'cover2', t);
  await act(p, 'pump', 'liner_old', t);
  await p.waitForSelector('.choice', { timeout: 10000 });
}
async function chooseRefuse(p) { await p.click('.choice[data-id="refuse"]'); await sleep(300); await idle(p); }
async function finishJob(p) {
  const t = p._touch;
  await act(p, 'pump', 'liner_new', t);
  await act(p, 'pump', 'cover2', t);
  await act(p, 'pump', 'tool_tray', t);
  await act(p, 'pump', 'liner_old', t);
  await act(p, 'valves', 'bleed', t);
  await act(p, 'valves', 'valve_suction', t); await act(p, 'valves', 'valve_discharge', t);
  await act(p, 'mcc', 'lock_mp1', t);
  await act(p, 'mcc', 'breaker_mp1', t);
  await act(p, 'start', 'start_btn', t);
  await act(p, 'permit', 'permit_board', t);
  await p.waitForSelector('#closeSign'); await p.click('#closeSign');
  await p.waitForSelector('#score:not([hidden])', { timeout: 8000 });
}
async function summary(p, label) {
  const a = await p.evaluate(() => window.__rig.attempt);
  const sc = await p.evaluate(() => ({ score: document.getElementById('scScore').textContent, verdict: document.getElementById('scVerdict').textContent, ready: document.getElementById('scReady').textContent }));
  L(`${label}: mistakes=${a.mistakes} incidents=${a.incidents} score=${sc.score} ${sc.verdict} (${sc.ready}) errors=${JSON.stringify(p._errs)}`);
  return { a, sc };
}

(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const results = {};
  if (which === 'all' || which === 'desktop') {
    L('== Desktop 1280x720 happy path ==');
    const p = await newPage(b, { viewport: { width: 1280, height: 720 } }); p._touch = false; p._shot = true;
    await start(p, 'Bunmi', false);
    // real movement: hold W, then click the deck to walk
    const p0 = await p.evaluate(() => ({ ...window.__rig.player }));
    await p.keyboard.down('KeyW'); await sleep(900); await p.keyboard.up('KeyW');
    const p1 = await p.evaluate(() => ({ ...window.__rig.player }));
    L(`  WASD moved ${Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(2)} m`);
    await p.mouse.move(640, 300); await p.mouse.down(); await p.mouse.move(700, 300, { steps: 5 }); await p.mouse.up();
    const p2 = await p.evaluate(() => ({ ...window.__rig.player }));
    L(`  drag-look yaw change ${(p2.yaw - p1.yaw).toFixed(3)} rad`);
    await p.mouse.click(640, 560); await sleep(1500);
    const p3 = await p.evaluate(() => ({ ...window.__rig.player }));
    L(`  click-to-walk moved ${Math.hypot(p3.x - p2.x, p3.z - p2.z).toFixed(2)} m`);
    await p.evaluate(() => { Object.assign(window.__rig.player, { x: 0, z: 9, yaw: 0.35, pitch: -0.12 }); });
    await sleep(600); await p.screenshot({ path: OUT + '/deck.png' });
    await prep(p); await isolate(p); await tools(p); await repairToDistractor(p);
    await p.screenshot({ path: OUT + '/distractor.png' });
    await chooseRefuse(p); await finishJob(p); await sleep(1200);
    await p.screenshot({ path: OUT + '/score_pass.png' });
    results.desktopHappy = await summary(p, 'Desktop happy');
    await p.goto('http://127.0.0.1:8765/site/dashboard.html'); await sleep(800);
    await p.screenshot({ path: OUT + '/dashboard.png', fullPage: true });
    L('  dashboard rows: ' + await p.locator('#rows tr').count());
    await p.context().close();
  }
  if (which === 'all' || which === 'fail') {
    L('== Failure path A: skip the lock (desktop) ==');
    let p = await newPage(b, { viewport: { width: 1280, height: 720 } }); p._touch = false;
    await start(p, 'Skipper', false);
    await prep(p); await act(p, 'mcc', 'breaker_mp1', false);
    await isolate(p, { lock: false, verify: false }).catch(() => {});
    await tools(p);
    await act(p, 'pump', 'cover2', false, { noWait: true });
    await p.waitForSelector('#incident:not([hidden])', { timeout: 15000 });
    await sleep(500); await p.screenshot({ path: OUT + '/incident_nolock.png' });
    L('  incident title: ' + await p.textContent('#incTitle'));
    await p.click('#incRetry'); await sleep(400);
    const st = await p.evaluate(() => window.__rig.state);
    L(`  after rewind: cover=${st.cover} locked=${st.locked}`);
    // now do it right: lock, verify, then continue to the end
    await act(p, 'mcc', 'hasp_mp1', false); await act(p, 'start', 'start_btn', false);
    await repairToDistractor(p); await chooseRefuse(p); await finishJob(p); await sleep(1000);
    results.failNoLock = await summary(p, 'Fail A (no lock, then fixed)');
    await p.screenshot({ path: OUT + '/score_fail.png' });
    await p.context().close();

    L('== Failure path B: accept the lock removal (phone landscape, touch) ==');
    p = await newPage(b, { ...devices['Pixel 5'], viewport: { width: 851, height: 393 }, isMobile: true, hasTouch: true }); p._touch = true;
    await start(p, 'Yes Man', true);
    await prep(p); await isolate(p); await tools(p); await repairToDistractor(p);
    await p.screenshot({ path: OUT + '/phone_distractor.png' });
    await p.tap('.choice[data-id="accept"]');
    await p.waitForSelector('#incident:not([hidden])', { timeout: 15000 });
    await sleep(400); await p.screenshot({ path: OUT + '/phone_incident.png' });
    L('  incident title: ' + await p.textContent('#incTitle'));
    await p.tap('#incRetry'); await sleep(500);
    L('  dialog shown again after rewind: ' + await p.isVisible('.choice'));
    await p.tap('.choice[data-id="refuse"]'); await sleep(300); await idle(p);
    await finishJob(p); await sleep(1000);
    await p.screenshot({ path: OUT + '/phone_score.png' });
    results.failAccept = await summary(p, 'Fail B (accepted lock removal)');
    await p.context().close();

    L('== Failure path C: no bleed-down + wrong breaker + wrong tool (desktop) ==');
    p = await newPage(b, { viewport: { width: 1280, height: 720 } }); p._touch = false;
    await start(p, 'Rusher', false, 'assess');
    await prep(p);
    await act(p, 'mcc', 'breaker_mp2', false); await sleep(1700); await idle(p);
    await isolate(p, { bleed: false });
    await act(p, 'rack', 'tool_cheater', false);
    await tools(p);
    await act(p, 'pump', 'cover2', false, { noWait: true });
    await p.waitForSelector('#incident:not([hidden])', { timeout: 15000 });
    L('  incident title: ' + await p.textContent('#incTitle'));
    await sleep(300); await p.screenshot({ path: OUT + '/incident_nobleed.png' });
    const a = await p.evaluate(() => window.__rig.attempt);
    L(`  mistakes so far=${a.mistakes} incidents=${a.incidents} errors=${JSON.stringify(p._errs)}`);
    await p.context().close();
  }
  if (which === 'all' || which === 'phone') {
    L('== Phone landscape happy path (touch) ==');
    const p = await newPage(b, { ...devices['Pixel 5'], viewport: { width: 851, height: 393 }, isMobile: true, hasTouch: true }); p._touch = true;
    await start(p, 'Ada', true);
    await p.evaluate(() => { Object.assign(window.__rig.player, { x: 0, z: 9, yaw: 0.35, pitch: -0.12 }); }); await sleep(500);
    await p.screenshot({ path: OUT + '/phone_deck.png' });
    // joystick drag
    const jb = await p.locator('#joy').boundingBox();
    const q0 = await p.evaluate(() => ({ ...window.__rig.player }));
    const cdp = await p.context().newCDPSession(p);
    const cx = jb.x + jb.width / 2, cy = jb.y + jb.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] });
    for (let i = 1; i <= 10; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx, y: cy - 4 * i }] }); await sleep(60); }
    await sleep(700);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const q1 = await p.evaluate(() => ({ ...window.__rig.player }));
    L(`  joystick moved ${Math.hypot(q1.x - q0.x, q1.z - q0.z).toFixed(2)} m`);
    await prep(p); await isolate(p); await tools(p); await repairToDistractor(p); await chooseRefuse(p);
    await p.evaluate(() => window.__rig.goToStation('pump')); await sleep(400); await p.screenshot({ path: OUT + '/phone_repair.png' });
    await finishJob(p); await sleep(1000);
    await p.screenshot({ path: OUT + '/phone_score_pass.png' });
    results.phoneHappy = await summary(p, 'Phone happy');
    await p.context().close();
    L('== Phone portrait ==');
    const q = await newPage(b, { ...devices['Pixel 5'], viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true });
    await sleep(500); L('  rotate hint visible: ' + await q.isVisible('#rotate'));
    await q.screenshot({ path: OUT + '/portrait_rotate.png' });
    await q.tap('#portraitOk'); await sleep(300);
    await q.screenshot({ path: OUT + '/portrait_title.png' });
    await start(q, 'Port', true); await q.evaluate(() => window.__rig.goToStation('mcc')); await sleep(500);
    await q.screenshot({ path: OUT + '/portrait_play.png' });
    L('  portrait errors: ' + JSON.stringify(q._errs));
    await q.context().close();
  }
  require('fs').writeFileSync(OUT + '/playtest-' + which + '.log', log.join('\n'));
  await b.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
