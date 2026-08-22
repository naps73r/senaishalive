(() => {
  "use strict";

  /*
   * V7.8.2 — Amazon Silk / Echo Show viewport adapter.
   *
   * Silk's browser chrome can remain visible at the top of an Echo Show.
   * We do not try to hide or manipulate that browser UI. Instead, the app
   * measures the *actual visible viewport* and fits the complete radio UI
   * inside the remaining area.
   */

  const ua = navigator.userAgent || "";
  const isSilk = /\bSilk\//i.test(ua) ||
                 /AmazonWebAppPlatform/i.test(ua) ||
                 /\bKF[A-Z0-9]{2,}\b/i.test(ua);

  if (!isSilk) return;

  const root = document.documentElement;
  root.classList.add("alaina-silk");

  function applySilkClassToBody() {
    document.body?.classList.add("alaina-silk");
  }

  if (document.body) {
    applySilkClassToBody();
  } else {
    document.addEventListener("DOMContentLoaded", applySilkClassToBody, { once: true });
  }

  let lastHeight = 0;
  let resizeTimer = null;

  function visibleHeight() {
    const vv = window.visualViewport;
    const candidates = [
      vv && Number.isFinite(vv.height) ? vv.height : 0,
      Number.isFinite(window.innerHeight) ? window.innerHeight : 0,
      Number.isFinite(document.documentElement.clientHeight)
        ? document.documentElement.clientHeight : 0
    ].filter(value => value > 0);

    return Math.max(1, Math.floor(Math.min(...candidates)));
  }

  function updateViewport() {
    const height = visibleHeight();
    const width = Math.max(
      1,
      Math.floor(
        (window.visualViewport && window.visualViewport.width) ||
        window.innerWidth ||
        document.documentElement.clientWidth ||
        1
      )
    );

    if (height !== lastHeight) {
      root.style.setProperty("--alaina-visible-height", `${height}px`);
      lastHeight = height;
    }

    root.style.setProperty("--alaina-visible-width", `${width}px`);

    root.classList.toggle("alaina-silk-very-short", height < 500);
    root.classList.toggle("alaina-silk-short", height >= 500 && height < 610);
    root.classList.toggle("alaina-silk-medium", height >= 610);

    root.dataset.silkViewport = `${width}x${height}`;
  }

  function scheduleViewportUpdate() {
    clearTimeout(resizeTimer);
    updateViewport();
    resizeTimer = setTimeout(updateViewport, 80);
  }

  updateViewport();

  window.addEventListener("resize", scheduleViewportUpdate, { passive: true });
  window.addEventListener("orientationchange", () => {
    updateViewport();
    setTimeout(updateViewport, 160);
    setTimeout(updateViewport, 500);
  }, { passive: true });

  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", scheduleViewportUpdate, { passive: true });
    window.visualViewport.addEventListener("scroll", scheduleViewportUpdate, { passive: true });
  }

  // Silk can settle its address bar size shortly after navigation.
  [120, 350, 800, 1600].forEach(delay => setTimeout(updateViewport, delay));
})();
