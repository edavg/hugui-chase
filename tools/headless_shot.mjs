// Captura una sala del juego con Chrome headless vía CDP (sin dependencias).
// Uso: node tools/headless_shot.mjs <url> <salida.png> [msEsperaTrasM3] [--live <ms>]
// Por defecto espera a que la consola emita "[M3] Mondyi" y luego 1200 ms.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const [url, output = '/tmp/mondyi.png', waitAfter = '1200', flag, liveMs] = process.argv.slice(2);
if (!url) {
  console.error('Uso: node tools/headless_shot.mjs <url> <salida.png> [ms] [--live <ms>]');
  process.exit(1);
}

const port = 9333;
const profile = mkdtempSync(join(tmpdir(), 'mondyi-shot-'));
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--enable-unsafe-swiftshader',
    '--hide-scrollbars',
    '--window-size=1024,768',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function findTarget() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === 'page');
      if (page?.webSocketDebuggerUrl) {
        return page.webSocketDebuggerUrl;
      }
    } catch {
      // chrome todavía no escucha
    }
    await sleep(200);
  }
  throw new Error('CDP no disponible');
}

const wsUrl = await findTarget();
const socket = new WebSocket(wsUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let nextId = 1;
const pending = new Map();
const logs = [];
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
    return;
  }
  if (message.method === 'Runtime.consoleAPICalled') {
    const text = message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' ');
    logs.push(text);
  }
});

function send(method, params = {}) {
  const id = nextId;
  nextId += 1;
  return new Promise((resolve, reject) => {
    pending.set(id, (message) => (message.error ? reject(new Error(message.error.message)) : resolve(message.result)));
    socket.send(JSON.stringify({ id, method, params }));
  });
}

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url });

const deadline = Date.now() + 30000;
let ready = false;
while (Date.now() < deadline) {
  if (logs.some((line) => line.includes('M3] Mondyi'))) {
    ready = true;
    break;
  }
  await sleep(250);
}
if (!ready) {
  console.error('Aviso: no se vio "[M3] Mondyi" en 30 s; capturo igualmente');
}

const extra = flag === '--live' ? Number(liveMs) || 0 : Number(waitAfter) || 0;
await sleep(ready ? Math.max(600, extra) : 1500);

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(output, Buffer.from(shot.data, 'base64'));
for (const line of logs.filter((entry) => /\[M\d+\]|Error|error/i.test(entry))) {
  console.log(line);
}
console.log(`Captura: ${output}`);

socket.close();
chrome.kill();
