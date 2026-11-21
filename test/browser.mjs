// Isolated Chromium fixture; does not open or alter the actual DSH profile.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const edge = process.env.DSH_TERMINAL_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const work = await mkdtemp(join(tmpdir(), 'dsh-terminal-browser-'));
const profile = join(work, 'edge');
const entry = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
const file = join(work, 'fixture.html');
await writeFile(file, `<!doctype html><meta charset="utf-8"><style>
body{margin:8px;--dsw-alias-bg-base:#191714;--dsw-alias-label-primary:#eee4d8;--dsw-alias-label-secondary:#b9aea1}
[data-conversation-content]{height:360px;position:relative;display:flex;flex-direction:column}
[data-conversation-scroll]{flex:1;min-height:0;overflow-y:auto;scrollbar-gutter:stable;display:flex;flex-direction:column;margin-right:2px}
[data-slot="conversation.session"]{flex:none}
[data-conversation-scroll]:has([data-conversation-composer-overlay]){position:relative;overflow:hidden auto}
[data-conversation-scroll]:has([data-conversation-composer-overlay])>[data-composer-seat]{position:absolute;left:0;right:0}
[data-conversation-scroll] .EvIC1a_toBottomSlot{bottom:calc(var(--dsh-composer-height, 72px) + 16px);position:sticky}
.eGxaPq_frame{--turn-rail-band:calc(var(--dsh-conversation-viewport-height, 360px) - var(--dsh-composer-height, 72px))}
[data-composer-seat]{position:sticky;bottom:0;z-index:7;flex:none;background:linear-gradient(transparent,#191714 36px)}
[data-composer-seat]:has([data-todo]){z-index:9}[data-todo]{height:48px;background:#ddd}
[data-queue-dock] ._7yHdaG_panel{height:32px;position:relative}
[data-queue-dock] ._7yHdaG_panel::before{content:'';position:absolute;inset:0;background:#ddd}
[data-goal-bar] .nLMEza_bar{height:36px;position:relative;box-shadow:0 0 3px black;border-radius:8px}
[data-goal-bar] .nLMEza_bar::before{content:'';position:absolute;inset:0;background:#ddd;backdrop-filter:blur(8px);pointer-events:none}
[data-composer-card]{height:72px;background:rgba(0,0,0,.2)}
.EvIC1a_root{position:relative}.paint-stripe{position:absolute;left:65%;width:12px;inset-block:0;background:red;z-index:12}
[data-step-process-body]{max-height:min(400px,50vh);overflow-y:auto;mask-image:linear-gradient(black,transparent)}
[data-tool-detail]{max-height:45px;overflow:auto}.source-content{height:520px}
.md-table-wide table{position:relative;z-index:12}.uV2eYG_add{border-radius:999px}
</style><body data-ds-dark-theme><script>window.__ModuleLoader__={load(definition){window.themeEntry=definition;}};</script>
<script>${entry.replace(/<\/script/gi, '<\\/script')}</script>
<div data-conversation-content data-content-phase="active"><div data-conversation-scroll><div data-slot="conversation.session"><div class="EvIC1a_root" data-chat-flow><div class="paint-stripe" aria-hidden="true"></div>
<div class="_markdown_1ypvv_5">
<div class="md-code-block"><div data-code-block-banner><span>代码</span></div><div data-code-block-content><pre><code id="source">def square(x):
    return x * 42  # return</code></pre></div></div>
<div class="md-code-block"><div data-code-block-banner><span>text</span></div><div data-code-block-content><pre><code id="plain">const x = 42;</code></pre></div></div>
<div class="md-code-block"><div data-code-block-content><pre class="shiki"><code><span id="native" style="color:var(--shiki-token-keyword)">const</span></code></pre></div></div>
<div class="md-table-wide"><table><tr><td>Wide table at the composer boundary</td></tr></table></div>
</div>
<div data-step-process><button id="toggle" aria-expanded="true">steps</button><div data-step-process-body><div class="source-content"><div data-tool-detail><div style="height:90px">tool output</div></div></div></div></div>
<div class="eGxaPq_frame"></div><div class="EvIC1a_toBottomSlot"></div>
</div></div><div data-composer-seat><div data-composer-card><div class="uV2eYG_row"><button class="uV2eYG_add">+</button><textarea id="draft" aria-label="draft"></textarea></div></div></div></div></div>
<script>const body=document.querySelector('[data-step-process-body]');
const toggle=document.getElementById('toggle');
toggle.onclick=()=>{body.hidden=!body.hidden;toggle.setAttribute('aria-expanded',!body.hidden)};
window.themeEntry.factory().apply({effect(fn){window.dispose=fn()},theme:{overrideTokens(){return ()=>{}}}});
</script>`);

const child = spawn(edge, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
let failure;
child.on('error', err => { failure = err; });
async function until(get, description) {
  for (let i = 0; i < 100; i++) {
    if (failure) throw failure;
    const result = await get().catch(() => null);
    if (result) return result;
    await sleep(50);
  }
  throw new Error(`Timed out: ${description}`);
}
let ws;
try {
  const devTools = await until(() => readFile(join(profile, 'DevToolsActivePort'), 'utf8'), 'CDP port');
  const [port] = devTools.split('\n');
  const target = await until(async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(x => x.type === 'page'), 'page target');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  let serial = 0;
  async function rpc(method, params) {
    const id = ++serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { ws.removeEventListener('message', handle); reject(new Error(method)); }, 4500);
      const handle = ({ data }) => {
        const result = JSON.parse(data);
        if (result.id !== id) return;
        ws.removeEventListener('message', handle);
        clearTimeout(timer);
        if (result.error) reject(new Error(result.error.message));
        else resolve(result.result);
      };
      ws.addEventListener('message', handle);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const out = await rpc('Runtime.evaluate', { expression, returnByValue: true });
    if (out.exceptionDetails) throw new Error(out.exceptionDetails.exception?.description ?? out.exceptionDetails.text);
    return out.result.value;
  }
  await rpc('Page.navigate', { url: pathToFileURL(file).href });
  await until(() => evaluate(`CSS.highlights?.has('dsh-terminal-syntax-keyword')`), 'visible fallback syntax');
  const result = await evaluate(`(() => {
    const $=s=>document.querySelector(s), styles=getComputedStyle, ranges=k=>[...(CSS.highlights.get('dsh-terminal-syntax-'+k)??[])].map(r=>[r.toString(),r.startContainer.parentElement.id]);
    window.captureBoundary=()=>{
      const seat=$('[data-composer-seat]'), port=$('[data-conversation-scroll]'), root=$('.EvIC1a_root'), stripe=$('.paint-stripe');
      const input=$('#draft'), inputRect=input.getBoundingClientRect(), goal=$('[data-goal-bar] .nLMEza_bar');
      const {top}=seat.getBoundingClientRect(), x=stripe.getBoundingClientRect().left+4;
      return {top, above:document.elementFromPoint(x,top-3)===stripe,
        below:document.elementFromPoint(x,top+3)===stripe, seat:styles(seat).backgroundColor,
        fill:styles($('[data-composer-card]')).backgroundColor, position:styles(seat).position,
        seatLayer:styles(seat).zIndex, scrollerOverflow:styles(port).overflowY,
        scrollHeight:port.scrollHeight, clientHeight:port.clientHeight, floor:port.scrollHeight-port.clientHeight,
        edge:port.getBoundingClientRect().top+port.clientTop+port.clientHeight, clip:styles(root).clipPath,
        sameParent:seat.parentElement===port && root.closest('[data-conversation-scroll]')===port,
        outerPosition:seat.offsetParent===port.parentElement,
        inputHit:document.elementFromPoint(inputRect.left+5,inputRect.top+5)===input,
        goal:goal?styles(goal,'::before').backgroundColor:null, goalShadow:goal?styles(goal).boxShadow:null,
        bottom:styles($('.EvIC1a_toBottomSlot')).bottom,
        todo:$('[data-todo]')?styles($('[data-todo]')).backgroundColor:null,
        queue:$('[data-queue-dock] ._7yHdaG_panel')?styles($('[data-queue-dock] ._7yHdaG_panel'),'::before').backgroundColor:null};
    };
    const container=$('[data-conversation-content]');
    const withoutTodo=window.captureBoundary();
    container.removeAttribute('data-dsh-terminal-viewport'); const previousFloor=window.captureBoundary().floor;
    container.setAttribute('data-dsh-terminal-viewport','');
    const body=$('[data-step-process-body]'), bodyHeight=body.clientHeight;
    const tools=$('[data-tool-detail]');
    const nestedScroll=tools.clientHeight<tools.scrollHeight;
    const groupOverflow=styles(body).overflow;
    $('#toggle').click(); const collapsed=body.hidden&&body.getBoundingClientRect().height===0;
    $('#toggle').click(); const reopened=body.clientHeight===bodyHeight;
    return {withoutTodo,previousFloor,bodyHeight,nestedScroll,groupOverflow,collapsed,reopened,
      buttonRadius:styles($('.uV2eYG_add')).borderRadius,
      nativeColor:styles($('#native')).color, keywords:ranges('keyword'),numbers:ranges('number'),comments:ranges('comment'),
      fallbackColor:styles($('#source'),'::highlight(dsh-terminal-syntax-keyword)').color,
      untouched:$('#source').childNodes.length===1&&$('#plain').textContent==='const x = 42;'};
  })()`);
  const clear = 'rgba(0, 0, 0, 0)';
  function assertBoundary(data) {
    assert.equal(data.seat, clear);
    assert.equal(data.fill, clear);
    assert.equal(data.position, 'absolute');
    assert.equal(data.scrollerOverflow, 'auto');
    assert.equal(data.clip, 'none');
    assert.equal(data.above, true);
    assert.equal(data.below, false);
    assert.ok(Math.abs(data.top - data.edge) <= 1);
    assert.ok(data.sameParent && data.outerPosition && data.inputHit);
    assert.equal(data.bottom, '16px');
  }
  assertBoundary(result.withoutTodo);
  assert.equal(result.withoutTodo.seatLayer, '7');
  assert.equal(result.withoutTodo.floor, result.previousFloor);
  await evaluate(`(() => {
    const seat=document.querySelector('[data-composer-seat]');
    seat.insertAdjacentHTML('afterbegin','<div data-todo class="lXshSW_root">TODO</div><div data-queue-dock><div class="_7yHdaG_panel">queued</div></div><div data-goal-bar><div class="nLMEza_bar"><button class="nLMEza_iconBtn">Pause</button></div></div>');
  })()`);
  const withDock = await until(async () => {
    const data = await evaluate(`window.captureBoundary()`);
    return data.top < result.withoutTodo.top && data.above && !data.below ? data : null;
  }, 'clipping follows resized TODO + queue');
  assertBoundary(withDock);
  assert.equal(withDock.seatLayer, '9');
  assert.equal(withDock.todo, clear);
  assert.equal(withDock.queue, clear);
  assert.equal(withDock.goal, clear);
  assert.equal(withDock.goalShadow, 'none');
  assert.equal(result.withoutTodo.top - withDock.top, 116);
  assert.equal(withDock.scrollHeight, result.withoutTodo.scrollHeight);
  const jumps = await evaluate(`(() => {
    const port=document.querySelector('[data-conversation-scroll]');
    // All checks happen in the same task as scrollTop writes. No scroll
    // callback, rAF or observer can run between the scroll and the hit test.
    return [200, 5, 380, 100, 1e6, 0].map(offset=>{
      port.scrollTop=offset;
      return {...window.captureBoundary(), offset:port.scrollTop};
    });
  })()`);
  for (const data of jumps) {
    assertBoundary(data);
    assert.equal(data.top, withDock.top);
  }
  assert.equal(jumps[4].offset, withDock.floor);
  assert.equal(jumps[5].offset, 0);
  await rpc('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 50, y: 100, deltaX: 0, deltaY: 1600 });
  await until(() => evaluate(`(() => { const p=document.querySelector('[data-conversation-scroll]'); return p.scrollTop===p.scrollHeight-p.clientHeight; })()`), 'native wheel reaches tail');
  assertBoundary(await evaluate('window.captureBoundary()'));
  await rpc('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 50, y: 100, deltaX: 0, deltaY: -1600 });
  await until(() => evaluate(`document.querySelector('[data-conversation-scroll]').scrollTop===0`), 'native wheel returns to top');
  assertBoundary(await evaluate('window.captureBoundary()'));
  assert.equal(await evaluate(`(() => {const d=document.getElementById('draft'); d.focus();d.value='hello';return d===document.activeElement&&d.value==='hello'})()`), true);
  await evaluate(`document.getElementById('draft').setAttribute('data-conversation-composer-overlay','')`);
  await until(() => evaluate(`!document.querySelector('[data-dsh-terminal-viewport]')`), 'custom overlay keeps native layout');
  await evaluate(`document.getElementById('draft').removeAttribute('data-conversation-composer-overlay')`);
  await until(() => evaluate(`!!document.querySelector('[data-dsh-terminal-viewport]')`), 'viewport restored after overlay');
  assertBoundary(await evaluate('window.captureBoundary()'));
  assert.equal(result.bodyHeight, 520);
  assert.equal(result.groupOverflow, 'visible');
  assert.ok(result.nestedScroll && result.collapsed && result.reopened);
  assert.equal(result.buttonRadius, '0px');
  assert.equal(result.nativeColor, 'rgb(197, 134, 192)');
  assert.equal(result.fallbackColor, result.nativeColor);
  assert.deepEqual(result.keywords, [['def', 'source'], ['return', 'source']]);
  assert.deepEqual(result.numbers, [['42', 'source']]);
  assert.deepEqual(result.comments, [['# return', 'source']]);
  assert.equal(result.untouched, true);
  const widths = await evaluate(`(() => {
    const fixture=document.createElement('div');
    fixture.setAttribute('data-conversation-content','');
    fixture.setAttribute('data-content-phase','active');
    fixture.innerHTML='<div style="padding-inline:32px"><div id="test-chat" style="width:100%;max-width:var(--dsh-chat-content-width);margin-inline:auto"></div></div><div style="padding-inline:16px"><div id="test-composer" style="width:100%;max-width:var(--dsh-composer-card-max-width);margin-inline:auto"></div></div>';
    const native=document.createElement('style');
    native.textContent='[data-conversation-content]{--dsh-chat-content-width:var(--dsh-chat-user-width,clamp(680px,calc(var(--dsh-conversation-column-width,0px) * .64),920px));--dsh-composer-card-max-width:calc(var(--dsh-chat-content-width) + 32px)}.wSkVaW_embeddedBody{--dsh-chat-content-width:920px}';
    document.head.append(native);document.body.append(fixture);
    try {
      return [[1574,null,false],[1200,null,false],[530,null,false],[1574,1000,false],[1574,null,true]].map(([column,user,embedded])=>{
        fixture.style.width=column+'px';fixture.style.setProperty('--dsh-conversation-column-width',column+'px');
        fixture.classList.toggle('wSkVaW_embeddedBody',embedded);
        if(user)fixture.style.setProperty('--dsh-chat-user-width',user+'px');else fixture.style.removeProperty('--dsh-chat-user-width');
        const chat=fixture.querySelector('#test-chat').getBoundingClientRect(), composer=fixture.querySelector('#test-composer').getBoundingClientRect();
        return [chat.width,composer.width,Math.abs(chat.left+chat.width/2-composer.left-composer.width/2)];
      });
    } finally {fixture.remove();native.remove()}
  })()`);
  assert.deepEqual(widths, [[1140,1172,0],[936,968,0],[466,498,0],[1000,1032,0],[920,952,0]]);
  assert.equal(await evaluate(`(window.dispose(), CSS.highlights.size === 0 && !document.body.hasAttribute('data-dsh-terminal') && !document.querySelector('[data-dsh-terminal-viewport]') && getComputedStyle(document.querySelector('[data-composer-seat]')).position==='sticky')`), true);
  console.log('Browser fixture: native boundary, rapid same-task scroll, unchanged scroll floor, dock resize, transparent goal, input focus, disclosure and syntax, clean teardown.');
} finally {
  ws?.close();
  child.kill();
}
