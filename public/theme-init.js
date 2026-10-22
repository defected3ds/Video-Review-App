// Apply the saved appearance before the application paints.
(() => {
  let saved;
  try { saved = localStorage.getItem('pipelife-theme'); } catch {}
  const dark = saved === 'dark' || saved !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#101a2a' : '#003087');
})();
