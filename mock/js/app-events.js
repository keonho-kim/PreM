// Purpose: Bind mock browser events and dispose the owned application resources at page exit.
// Pattern: Narrow event adapter around application commands and feature callbacks.
// Usage: app.js provides handlers and lifecycle ports after composition.
// Related: mock/app.js, feedback.js, mock/index.html.
window.PreMModules.appEvents = (capabilities) => {
  'use strict';
  const {
    actions,
    submitSpace,
    submitForm,
    chooseAsset,
    parseRoute,
    beforeReset,
    afterAction,
    dispose,
  } = capabilities;
  document.addEventListener('submit', (event) => {
    if (event.target.dataset.form === 'space-upload') submitSpace(event);
    else submitForm(event);
  });
  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (!target || target.disabled || !Object.hasOwn(actions, target.dataset.action)) return;
    event.preventDefault();
    if (target.dataset.action === 'reset') beforeReset();
    actions[target.dataset.action](target);
    afterAction();
  });
  document.addEventListener('input', (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
      event.target.setCustomValidity('');
  });
  document.addEventListener('change', (event) => {
    if (event.target.matches('[data-asset-choice]')) chooseAsset(event.target);
    if (event.target instanceof HTMLInputElement) event.target.setCustomValidity('');
  });
  window.addEventListener('hashchange', parseRoute);
  window.addEventListener('pagehide', dispose);
};
