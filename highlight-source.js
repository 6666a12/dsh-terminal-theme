    const highlightCategories = Object.freeze({
      keyword: 'keyword', built_in: 'type', type: 'type', literal: 'literal',
      number: 'number', string: 'string', regexp: 'regexp', comment: 'comment',
      quote: 'comment', title: 'function', function_: 'function', class_: 'type',
      params: 'parameter', variable: 'parameter', attr: 'parameter', property: 'parameter',
      meta: 'keyword', tag: 'keyword', name: 'keyword', selector_tag: 'keyword',
      symbol: 'literal', addition: 'inserted', deletion: 'deleted', punctuation: 'punctuation',
    });
    const highlightNames = [...new Set(Object.values(highlightCategories))];
    const highlightKey = kind => `dsh-terminal-syntax-${kind}`;
    const plainLanguages = /^(?:text|txt|plain|plain-?text|markdown|md|log|output|console|math|latex|tex|mermaid|diagram)$/i;

    function inferLanguage(text) {
      if (/^#![^\n]*\bpython\d*\b/m.test(text)) return 'python';
      if (/^#![^\n]*\b(?:bash|sh|zsh)\b/m.test(text)) return 'bash';
      if (/^#![^\n]*\b(?:node|deno|bun)\b/m.test(text)) return 'javascript';
      if (/^\s*[\[{]/.test(text)) {
        try { const data = JSON.parse(text); if (data && typeof data === 'object') return 'json'; } catch { /* not JSON */ }
      }
      if (/^\s*(?:(?:async )?def\s+\w+\s*\([^\n]*\)\s*(?:->[^\n:]+)?\s*:|from\s+[\w.]+\s+import\s+\w+|class\s+\w+(?:\([^\n]*\))?\s*:)/m.test(text)) return 'python';
      if (/^\s*(?:export\s+)?(?:interface\s+\w+[^\n]*\{|type\s+\w+\s*=|(?:const|let)\s+\w+\s*:\s*[\w[])/m.test(text)) return 'typescript';
      if (/^\s*(?:export\s+(?:default\s+)?)?(?:(?:async\s+)?function\s+\w+\s*\(|(?:const|let|var)\s+\w+\s*=|import\s+.+\s+from\s+['"])/m.test(text)) return 'javascript';
      if (/^\s*(?:select\s+[^;]+?\bfrom\s+[^;]+|create\s+table\s+\w+\s*\()/im.test(text)) return 'sql';
      if (/^\s*(?:<!doctype html\b|<(?:html|div|span|main|script|style|form)\b)[\s\S]*>/i.test(text)) return 'xml';
      if (/^\s*(?:export\s+[A-Za-z_]\w*=|set\s+-[euxo]+\b|if\s+\[\[)/m.test(text)) return 'bash';
      return null; // ambiguous snippets and output stay literal
    }

    function paintFallbackSyntax(win, doc) {
      const registry = win.CSS?.highlights;
      if (!registry || !win.Highlight || !win.IntersectionObserver || !win.MutationObserver) return () => {};
      const blockSelector = '[data-chat-flow] ._markdown_1ypvv_5 .md-code-block';
      const active = new Map(); // DOM blocks currently near the viewport
      const seen = new Set();
      let parser;
      let raf = null;
      let scanNeeded = true;
      let refreshNeeded = false;
      const schedule = () => { raf ??= win.requestAnimationFrame(flush); };

      function collect(block, previous) {
        if (block.closest('[data-markdown-variant="compact"]')) return null;
        const pre = block.querySelector('[data-code-block-content] pre');
        const code = pre?.querySelector(':scope > code');
        const source = code?.firstChild;
        if (!code || pre.classList.contains('shiki') || code.childNodes.length !== 1 || source?.nodeType !== 3) return null;
        const text = source.data;
        const label = block.querySelector('[data-code-block-banner] > :first-child')?.textContent.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
        if (previous?.source === source && previous.text === text && previous.label === label) return previous;
        if (!text.trim() || text.length > 12000 || text.split('\n').some(line => line.length >= 1000) || plainLanguages.test(label)) return null;
        // Native Markdown collapses empty/unknown info strings to the same
        // localized generic header. Only clear source structures are inferred.
        const language = !label || /^(?:code|代码|程式碼|代碼|コード|코드)$/.test(label) ? inferLanguage(text) : label;
        if (!language) return null;
        parser ??= createFallbackParser();
        if (!parser.getLanguage(language)) return null;

        const result = parser.highlight(text, { language, ignoreIllegals: false });
        if (result.illegal) return null;
        const template = doc.createElement('template');
        // Highlight.js escapes the snippet. The inert fragment is never mounted.
        template.innerHTML = result.value;
        if (template.content.textContent !== text) return null;
        const records = [];
        let offset = 0;
        function walk(node, kind) {
          if (node.nodeType === 3) {
            const end = offset + node.data.length;
            if (kind && end > offset && records.length < 3000) {
              const range = doc.createRange();
              range.setStart(source, offset);
              range.setEnd(source, end);
              records.push([kind, range]);
            }
            offset = end;
            return;
          }
          if (node.nodeName === 'SPAN') {
            const match = [...node.classList].map(name => name.startsWith('hljs-') ? name.slice(5).replace('-', '_') : name)
              .map(name => highlightCategories[name]).find(Boolean);
            kind = node.classList.contains('class_') ? 'type' : match ?? kind;
          }
          for (const child of node.childNodes) walk(child, kind);
        }
        walk(template.content, null);
        return { source, text, label, records };
      }

      function flush() {
        raf = null;
        if (scanNeeded) {
          scanNeeded = false;
          for (const block of seen) if (!block.isConnected) {
            intersection.unobserve(block);
            seen.delete(block);
            refreshNeeded = active.delete(block) || refreshNeeded;
          }
          for (const block of doc.querySelectorAll(blockSelector)) if (!seen.has(block)) {
            seen.add(block);
            intersection.observe(block);
          }
        }
        if (!refreshNeeded) return;
        refreshNeeded = false;
        const next = new Map();
        for (const [block, previous] of active) {
          let state = null;
          try { state = collect(block, previous); } catch { /* preserve native plain text */ }
          active.set(block, state);
          for (const [kind, range] of state?.records ?? []) {
            if (!next.has(kind)) next.set(kind, new win.Highlight());
            next.get(kind).add(range);
          }
        }
        for (const name of highlightNames) {
          if (next.has(name)) registry.set(highlightKey(name), next.get(name));
          else registry.delete(highlightKey(name));
        }
      }

      const intersection = new win.IntersectionObserver(entries => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.target.isConnected) {
            if (!active.has(entry.target)) active.set(entry.target, null);
          } else active.delete(entry.target);
        }
        refreshNeeded = true;
        schedule();
      }, { rootMargin: '120px' });
      const mutations = new win.MutationObserver(records => {
        if (!records.some(record => (record.target.nodeType === 1 ? record.target : record.target.parentElement)?.closest('[data-chat-flow]')
          || [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1
            && (node.matches('[data-chat-flow], .md-code-block') || node.querySelector('[data-chat-flow], .md-code-block'))))) return;
        scanNeeded = true;
        refreshNeeded = true;
        schedule();
      });
      mutations.observe(doc.body, { childList: true, subtree: true, characterData: true });
      schedule();
      return () => {
        intersection.disconnect();
        mutations.disconnect();
        if (raf !== null) win.cancelAnimationFrame(raf);
        for (const name of highlightNames) registry.delete(highlightKey(name));
        active.clear();
        seen.clear();
      };
    }
