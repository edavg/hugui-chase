// E2E de la criatura del sótano (Calderas) con Chrome headless vía CDP.
// Requiere el servidor de desarrollo levantado (npm run dev).
// Uso: node tools/e2e_lurker.mjs [baseUrl] [carpetaCapturas]
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const [base = 'http://localhost:5173', shots] = process.argv.slice(2);
const port = 9345;
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--enable-unsafe-swiftshader',
    '--window-size=1024,768',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'mondyi-lurker-'))}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let wsUrl = null;
for (let attempt = 0; attempt < 50 && !wsUrl; attempt += 1) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    wsUrl = targets.find((target) => target.type === 'page')?.webSocketDebuggerUrl ?? null;
  } catch {
    // chrome todavía no escucha
  }
  if (!wsUrl) await sleep(200);
}
if (!wsUrl) {
  console.error('CDP no disponible');
  chrome.kill();
  process.exit(1);
}
const socket = new WebSocket(wsUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let nextId = 1;
const pending = new Map();
const errors = [];
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  } else if (message.method === 'Runtime.exceptionThrown') {
    errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId;
    nextId += 1;
    pending.set(id, (message) => (message.error ? reject(new Error(message.error.message)) : resolve(message.result)));
    socket.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result.value;
};
const capture = async (name) => {
  if (!shots) return;
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(shots, name), Buffer.from(shot.data, 'base64'));
};

const results = [];
const check = (name, ok, info) => {
  results.push(ok);
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${ok || !info ? '' : ` ${JSON.stringify(info)}`}`);
};
const game = 'window.__mondyi';
const lurker = `(() => { const g = ${game}; const l = g.lurker; return {
  room: l.roomId, state: l.state, x: l.position.x, z: l.position.z,
  yaw: Math.round(l.yaw * 180 / Math.PI), drawn: !!l.object.parent,
  playerRoom: g.debugRoomId(), hearts: g.hearts }; })()`;
// `condition`: expresión que se evalúa en la página, o predicado (en Node)
// sobre el estado de la criatura.
const waitFor = async (condition, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const ok = typeof condition === 'function' ? condition(await evaluate(lurker)) : await evaluate(condition);
    if (ok) return true;
    await sleep(100);
  }
  return false;
};
const config = await (await fetch(`${base}/config/psx_config.json`)).json();
const [postX, postZ] = config.lurker.position;
const atPost = (s) =>
  s.room === config.lurker.room &&
  s.state === 'patrol' &&
  Math.hypot(s.x - postX, s.z - postZ) < 0.35 &&
  Math.abs(s.yaw - config.lurker.yaw) < 3;
const ready = `!!${game}?.lurker && ${game}.state === 'playing'`;
// Coloca al jugador y la cámara (yaw/pitch en grados, convenio de los spawns).
const place = (x, z, yaw, pitch = 0) =>
  evaluate(`(${game}.debugTeleport(${x}, ${z}, ${yaw}), ${game}.debugLook(${yaw}, ${pitch}))`);
// Cruza la puerta hacia `to` desde dentro de la sala actual.
const crossDoor = async (to) => {
  const door = (await evaluate(`${game}.debugDoors()`)).find((candidate) => candidate.to === to);
  const length = Math.hypot(door.cx, door.cz);
  const x = door.cx - (door.cx / length) * 0.9;
  const z = door.cz - (door.cz / length) * 0.9;
  await place(x, z, (Math.atan2(-(door.cx - x), -(door.cz - z)) * 180) / Math.PI);
  await sleep(300);
  await evaluate(`${game}.debugInteract()`);
  return waitFor(`${game}.debugRoomId() === '${to}' && ${game}.state === 'playing'`, 15000);
};
// El stalker principal, lejos: que no se meta en la prueba.
const parkStalker = () => evaluate(`${game}.debugTeleportStalker('room_atico', 0, 0, 'patrol')`);

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false });

  // 1. Desde la Lavandería: espera en su puesto mirando el afiche y no se dibuja.
  await send('Page.navigate', { url: `${base}/?room=room_lavanderia&spawn=from_sotano&wake=0&flashlight=1` });
  check('la criatura carga', await waitFor(ready, 30000));
  await waitFor(`!!${game}.stalker`, 10000);
  await parkStalker();
  await sleep(600);
  let s = await evaluate(lurker);
  check('en su puesto mirando el afiche, sin dibujarse fuera de Calderas', atPost(s) && !s.drawn, s);

  // 2. Entrar en Calderas sin mirar al afiche: no reacciona.
  check('el jugador entra en Calderas', await crossDoor(config.lurker.room));
  await place(0, -2, 180);
  await sleep(3000);
  s = await evaluate(lurker);
  check('al entrar sin mirar el afiche sigue quieta', atPost(s) && s.drawn && s.hearts === 3, s);

  // 3. Mirar hacia el afiche con la caldera en medio: no la ve.
  await place(2.2, 0.2, 90);
  await sleep(1500);
  s = await evaluate(lurker);
  check('mirando con la caldera en medio sigue quieta', atPost(s), s);

  // 4. Mirar hacia el afiche: se gira, te mira, te persigue y golpea.
  await place(1.2, -2.4, 120, 4);
  check('al mirar el afiche te ve (suspect)', await waitFor(`${game}.lurker.state === 'suspect'`, 1000));
  await sleep(300);
  await capture('lurker_mira.png');
  check('se gira hacia el jugador', Math.abs((await evaluate(lurker)).yaw - config.lurker.yaw) > 30);
  check('te persigue (chase)', await waitFor(`${game}.lurker.state === 'chase'`, 3000));
  check('golpea y quita un corazón', await waitFor(`${game}.hearts === 2`, 6000), await evaluate(lurker));
  await capture('lurker_golpe.png');

  // 5. Salir a la Lavandería: no te sigue y vuelve al afiche.
  check('el jugador sale a la Lavandería', await crossDoor('room_lavanderia'));
  check('no sale de Calderas y vuelve al puesto', await waitFor((state) => atPost(state) && !state.drawn, 15000), await evaluate(lurker));

  // 6. Volver a entrar sin mirar: vuelve a esperar a que la mires.
  check('el jugador vuelve a Calderas', await crossDoor(config.lurker.room));
  await place(0, -2, 180);
  await sleep(2000);
  s = await evaluate(lurker);
  check('al volver sin mirar el afiche sigue quieta', atPost(s), s);
} catch (error) {
  check(`sin excepciones (${error.message})`, false);
}
check('sin errores en la página', errors.length === 0, errors);

const passed = results.every(Boolean);
console.log(passed ? `TODO OK (${results.length} comprobaciones)` : 'HAY FALLOS');
socket.close();
chrome.kill();
process.exit(passed ? 0 : 1);
