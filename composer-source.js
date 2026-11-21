    // Keep the exact scroll element and composer descendant that DSH's chat
    // controller attaches to. Only give the composer a different containing
    // block and reserve its measured height outside the real scroll viewport.
    function bindTranscriptViewport(win, doc) {
      if (!win.ResizeObserver || !win.MutationObserver) return () => {};
      const containerSelector = '[data-conversation-content]';
      const portSelector = '[data-conversation-scroll]';
      const seatSelector = '[data-composer-seat]';
      const viewSelector = '.EvIC1a_root';
      const overlaySelector = '[data-conversation-composer-overlay]';
      const watched = `${containerSelector}, ${portSelector}, ${seatSelector}, ${viewSelector}, ${overlaySelector}`;
      const flag = 'data-dsh-terminal-viewport';
      const dockSize = '--dsh-terminal-dock-size';
      const gutterSize = '--dsh-terminal-scrollbar-size';
      const groups = new Map();
      let reconcileFrame = null;

      function clear(group) {
        group.container.removeAttribute(flag);
        group.container.style.removeProperty(dockSize);
        group.container.style.removeProperty(gutterSize);
      }
      function setLength(container, property, length) {
        const value = `${length}px`;
        if (container.style.getPropertyValue(property) !== value) container.style.setProperty(property, value);
      }
      function update(group) {
        const { container, port, seat } = group;
        const dock = seat.offsetHeight;
        if (container.getAttribute('data-content-phase') !== 'active' || !dock || container.clientHeight - dock < 32 || port.querySelector(overlaySelector)) {
          clear(group);
          return;
        }
        const scrollbar = Math.max(0, port.offsetWidth - port.clientWidth);
        setLength(container, dockSize, dock);
        setLength(container, gutterSize, scrollbar);
        if (!container.hasAttribute(flag)) container.setAttribute(flag, '');
      }
      function unbind(group) {
        group.resize.disconnect();
        clear(group);
      }
      function reconcile() {
        reconcileFrame = null;
        const current = new Set();
        for (const container of doc.querySelectorAll(containerSelector)) {
          const port = container.querySelector(`:scope > ${portSelector}`);
          const seat = port?.querySelector(`:scope > ${seatSelector}`);
          const view = port?.querySelector(`:scope > [data-slot="conversation.session"] ${viewSelector}`);
          if (!seat || !view || view.closest(portSelector) !== port) continue;
          current.add(container);
          const previous = groups.get(container);
          if (previous?.port === port && previous.seat === seat) {
            update(previous);
            continue;
          }
          if (previous) unbind(previous);
          const group = { container, port, seat, resize: new win.ResizeObserver(() => update(group)) };
          groups.set(container, group);
          // Content-box observes width changes from scrollbar gutters; the seat
          // border-box observes padding or size changes from any dock or editor.
          group.resize.observe(container, { box: 'border-box' });
          group.resize.observe(port);
          group.resize.observe(seat, { box: 'border-box' });
          update(group);
        }
        for (const [container, group] of groups) if (!current.has(container)) {
          unbind(group);
          groups.delete(container);
        }
      }
      const mutations = new win.MutationObserver(records => {
        if (records.some(record => record.type === 'attributes' || [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1
          && (node.matches(watched) || node.querySelector(watched))))) {
          reconcileFrame ??= win.requestAnimationFrame(reconcile);
        }
      });
      mutations.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-content-phase', 'data-conversation-composer-overlay'] });
      reconcile();
      return () => {
        if (reconcileFrame !== null) win.cancelAnimationFrame(reconcileFrame);
        mutations.disconnect();
        for (const group of groups.values()) unbind(group);
        groups.clear();
      };
    }
