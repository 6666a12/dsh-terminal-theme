import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const read = file => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const [css, entry, manifestText, patch, paletteText] = await Promise.all([
  read('theme.css'), read('lib/client.js'), read('package.json'), read('cordis.patch.yml'), read('palette.json'),
]);
const manifest = JSON.parse(manifestText);
const palette = JSON.parse(paletteText);

function boot({ badMount = false } = {}) {
  const attributes = new Set();
  const styles = new Set();
  const layers = new Map();
  let module;
  let dispose;
  const window = {
    __ModuleLoader__: { load(definition) { module = definition; } },
    document: {
      body: {
        setAttribute(name) {
          if (badMount) throw new Error('mount failed');
          attributes.add(name);
        },
        removeAttribute(name) { attributes.delete(name); },
      },
      head: { appendChild(style) { styles.add(style); } },
      createElement(tag) {
        assert.equal(tag, 'style');
        return { dataset: {}, remove() { styles.delete(this); } };
      },
    },
  };
  vm.runInNewContext(entry, { window });
  return {
    module, attributes, styles, layers,
    apply() {
      module.factory().apply({
        effect(effect) { dispose = effect(); },
        theme: { overrideTokens(id, tokens) { layers.set(id, tokens); return () => layers.delete(id); } },
      });
    },
    dispose() { dispose?.(); },
  };
}

test('the bundle declares its client, version and patch row', () => {
  const { module } = boot();
  assert.equal(module.id, manifest.name);
  assert.deepEqual([...module.factory().inject], ['theme']);
  assert.equal(manifest.dsh.client.platform, 'web');
  assert.equal(manifest.engines.dsh, '0.2.1-rc.2');
  const runtimeEntry = patch.match(/^\s+name:\s+(\S+)\s*$/m)?.[1];
  // On DSH 0.2.1-rc.2 a package/subpath can resolve in Node but is never
  // discovered as a browser module. Require the package root exactly.
  assert.equal(runtimeEntry, manifest.name);
  assert.equal(manifest.exports['.'], './lib/index.js');
  assert.equal(manifest.exports['./client'], './lib/client.js');
  assert.match(patch, new RegExp(`id: ${manifest.name}\\s`));
  assert.equal(manifest.scripts.install, undefined);
  assert.equal(manifest.dependencies, undefined);
});

test('enable/disable installs and removes its complete appearance; it can be enabled again', () => {
  const state = boot();
  for (let i = 0; i < 2; i++) {
    state.apply();
    assert.deepEqual([...state.attributes], ['data-dsh-terminal']);
    const [style] = state.styles;
    assert.equal(style.dataset.plugin, manifest.name);
    assert.equal(style.textContent, css);
    assert.deepEqual(JSON.parse(JSON.stringify(state.layers.get(manifest.name))), palette);
    state.dispose();
    assert.equal(state.attributes.size + state.styles.size + state.layers.size, 0);
  }
});

test('a failed stylesheet mount rolls back its token layer', () => {
  const state = boot({ badMount: true });
  assert.throws(() => state.apply(), /mount failed/);
  assert.equal(state.attributes.size + state.styles.size + state.layers.size, 0);
});

test('theme tokens cover both schemes, and Shiki and KaTeX use native hooks', () => {
  assert.equal(Object.keys(palette).length, 14);
  for (const token of Object.values(palette)) {
    assert.match(token.dark, /^#[\da-f]{6}$/i);
    assert.match(token.light, /^#[\da-f]{6}$/i);
  }
  assert.match(css, /pre\.shiki\s*\{/);
  assert.match(css, /\.katex-display\s*\{[^}]*overflow-x:\s*auto/);
  assert.doesNotMatch(css, /\.katex-(?:mathml|html)\b/);
  assert.doesNotMatch(css, /(?:display\s*:\s*none|visibility\s*:\s*hidden)/);
});

test('native scroll owner reserves the dock below it without a JavaScript scroll listener', async () => {
  assert.match(css, /\[data-dsh-terminal-viewport\][^{]+\{[^}]*margin-block-end:\s*var\(--dsh-terminal-dock-size\)/);
  assert.match(css, /\[data-dsh-terminal-viewport\][^{]+ > \[data-composer-seat\]\s*\{\s*position:\s*absolute/);
  assert.match(css, /\[data-goal-bar\] > \.nLMEza_bar::before\s*\{\s*background:\s*transparent/);
  assert.match(css, /\[data-conversation-scroll\] > \[data-composer-seat\]\s*\{[^}]*background:\s*var\(--dsw-alias-bg-base\)/);
  assert.doesNotMatch(css, /clip-path|data-dsh-terminal-clip/);
  assert.doesNotMatch(await read('composer-source.js'), /addEventListener|scrollTop|getBoundingClientRect/);
});

test('outer process disclosure is unrestricted; tool controls and hidden state stay native', () => {
  assert.match(css, /\[data-step-process\] > \[data-step-process-body\]:not\(\[hidden\]\)\s*\{[^}]*max-height:\s*none;[^}]*overflow:\s*visible/);
  assert.doesNotMatch(css, /\[data-chat-flow-kind="tool-call"\]\s*\{[^\}]*max-height/);
});

test('the bundled parser separates code tokens and uses conservative language inference', async () => {
  const marker = "    return { apply, inject: ['theme'] };";
  const window = { __ModuleLoader__: { load(definition) { this.definition = definition; } } };
  vm.runInNewContext(entry.replace(marker, '    return { createFallbackParser, inferLanguage };'), { window });
  const { createFallbackParser, inferLanguage } = window.__ModuleLoader__.definition.factory();
  assert.equal(inferLanguage('def square(x):\n    return x * x'), 'python');
  assert.equal(inferLanguage('const answer = 42;'), 'javascript');
  assert.equal(inferLanguage('{"ready": true}'), 'json');
  assert.equal(inferLanguage('running: ready\nOK'), null);
  const result = createFallbackParser().highlight('const x = "return"; // return\nif (x) call(42);', { language: 'javascript' }).value;
  assert.match(result, /hljs-keyword">const</);
  assert.match(result, /hljs-keyword">if</);
  assert.match(result, /hljs-string">&quot;return&quot;</);
  assert.match(result, /hljs-comment">\/\/ return</);
  assert.match(result, /hljs-number">42</);
});
