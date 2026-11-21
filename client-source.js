    // Static DSH client plugin. ctx.effect owns both the CSS and palette.
    function apply(ctx) {
      ctx.effect(() => {
        const doc = window.document;
        const style = doc.createElement('style');
        style.dataset.plugin = id;
        style.textContent = css;
        const removePalette = ctx.theme.overrideTokens(id, palette);
        let removeSyntax;
        let removeViewport;
        try {
          doc.head.appendChild(style);
          doc.body.setAttribute('data-dsh-terminal', version);
          removeSyntax = paintFallbackSyntax(window, doc);
          removeViewport = bindTranscriptViewport(window, doc);
        } catch (error) {
          removeViewport?.();
          removeSyntax?.();
          doc.body.removeAttribute('data-dsh-terminal');
          style.remove();
          removePalette();
          throw error;
        }
        return () => {
          removeViewport();
          removeSyntax();
          doc.body.removeAttribute('data-dsh-terminal');
          style.remove();
          removePalette();
        };
      }, 'DSH Terminal: reversible appearance');
    }
