// Deterministic browser stand-in for the provider script. Only the test router
// serves this file; it is never imported by the app or production bundle.
(() => {
  const state = (window.__localVerification = {
    renders: 0,
    resets: 0,
    removes: 0,
    active: 0,
    prefix: 'valid-',
    renderFailures: 0,
    resetFailures: 0,
    ...window.__localVerification,
  });
  const widgets = new Map();
  window.turnstile = {
    render(element, options) {
      const id = String(++state.renders);
      if (state.renderFailures > 0) {
        state.renderFailures--;
        throw new Error('Local render failure');
      }
      const container = document.createElement('div');
      container.dataset.localWidget = id;
      container.dataset.action = options.action;
      container.dataset.sitekey = options.sitekey;
      const button = (label, callback) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.onclick = callback;
        container.append(button);
      };
      button('Complete local verification', () =>
        options.callback(state.prefix + crypto.randomUUID()),
      );
      button('Expire local verification', () => options['expired-callback']());
      button('Fail local verification', () => options['error-callback']('local-error'));
      element.append(container);
      widgets.set(id, { container, options });
      state.active = widgets.size;
      return id;
    },
    reset(id) {
      if (!widgets.has(id)) throw new Error('Reset of removed widget');
      state.resets++;
      if (state.resetFailures > 0) {
        state.resetFailures--;
        throw new Error('Local reset failure');
      }
    },
    remove(id) {
      widgets.get(id)?.container.remove();
      widgets.delete(id);
      state.removes++;
      state.active = widgets.size;
    },
  };
})();
