(() => {
  "use strict";

  /*
   * Alaina Live V7.8
   * - Stable station deep links for Siri / Samsung shortcuts later.
   * - Best-effort live stream metadata (Zeno, Triton, Icecast).
   * - Compact Now Playing strip + local heard-track history.
   * - Device-aware song-identification handoff.
   *
   * IMPORTANT:
   * A static web page cannot reliably read the raw audio bytes of every
   * cross-origin radio stream. The Identify button therefore prefers:
   *   1) broadcaster metadata when available,
   *   2) Shazam/device recognition handoff,
   *   3) a future open-source recognizer hook.
   */

  const cards = Array.from(document.querySelectorAll(".station-card"));
  const audioEl = document.getElementById("radioPlayer");
  const stationRegionEl = document.getElementById("stationRegion");
  const nowPlayingStationEl = document.getElementById("nowPlayingText");
  const playerTop = document.querySelector(".player-top");

  if (!cards.length || !audioEl || !playerTop || !stationRegionEl) return;

  const HISTORY_KEY = "alainaTrackHistoryV78";
  const MAX_HISTORY = 10;
  const POLL_MS = 15000;
  const SOURCE_TIMEOUT_MS = 6500;

  // V7.8.5 FAST_START_METADATA
  // Normal radio use must not make extra cross-origin metadata requests.
  // Add ?metadata=1 only when we deliberately want to test those feeds.
  const AUTO_METADATA_NETWORK =
    new URLSearchParams(window.location.search).get("metadata") === "1";
  const CONFIGS = [
    {
      slug: "tamilfm",
      match: ["89.4 Tamil FM"],
      aliases: ["894", "89.4", "tamil", "tamil fm", "89.4 tamil fm", "eight nine four"],
      metadata: {
        type: "icecast",
        urls: [
          "https://centova.aarenworld.com/status-json.xsl",
          "https://centova.aarenworld.com/proxy/894tamilfm/status-json.xsl"
        ],
        hints: ["894tamilfm", "89.4 tamil", "tamil fm"]
      }
    },
    {
      slug: "livefm",
      match: ["107.2 Live FM"],
      aliases: ["1072", "107.2", "live fm", "live fm bahrain"],
      metadata: {
        type: "icecast",
        urls: ["https://stream.aiir.com/status-json.xsl"],
        hints: ["dbv0rxpwp6ytv", "107.2", "live fm"]
      }
    },
    {
      slug: "suno",
      match: ["Radio Suno 87.6 FM"],
      aliases: ["radio suno", "suno", "suno radio", "87.6", "suno 87.6", "radio suno 87.6"],
      metadata: {
        type: "icecast",
        urls: ["https://a1.asurahosting.com/status-json.xsl"],
        hints: ["radio_suno_87.6fm", "radio suno", "suno"]
      }
    },
    {
      slug: "mirchi",
      match: ["Radio Mirchi 104.2 FM"],
      aliases: ["radio mirchi", "mirchi", "mirchi bahrain", "104.2", "mirchi 104.2"],
      // V7.8.1: the public Triton history endpoint for this mount was
      // producing a title that did not match the actual live audio.
      // Wrong metadata is worse than no metadata, so keep it disabled until
      // we verify a true live cue feed for the Bahrain stream.
      metadataDisabledReason: "Live title disabled — Mirchi metadata did not match the audio."
    },
    {
      slug: "shakthi",
      match: ["Shakthi FM SL"],
      aliases: ["shakthi", "shakthi fm", "sakthi", "sakthi fm"],
      metadata: {
        type: "icecast",
        urls: ["https://mbc.thestreamtech.com:8086/status-json.xsl"],
        hints: ["shakthi", "stream"]
      }
    },
    {
      slug: "sooriyan",
      match: ["Sooriyan FM SL"],
      aliases: ["sooriyan", "sooriyan fm", "suriyan", "suriyan fm"],
      metadata: {
        type: "icecast",
        urls: ["https://radio.lotustechnologieslk.net:2020/status-json.xsl"],
        hints: ["sooriyan", "garden"]
      }
    },
    {
      slug: "mango",
      match: ["Radio Mango Kochi"],
      aliases: ["radio mango", "mango", "mango radio", "mango kochi"],
      metadata: {
        type: "icecast",
        urls: ["https://eu10.fastcast4u.com/status-json.xsl"],
        hints: ["clubfmuae", "radio mango", "mango"]
      }
    },
    {
      slug: "clubfm",
      match: ["Club FM Thrissur"],
      aliases: ["club fm", "clubfm", "club", "club fm thrissur", "club fm kerala"]
    },
    {
      slug: "hellofm",
      match: ["Hello FM Kovai"],
      aliases: ["hello fm", "hellofm", "hello", "hello fm kovai", "hello fm coimbatore"],
      metadata: {
        type: "icecast",
        urls: ["https://radios.crabdance.com:8002/status-json.xsl"],
        hints: ["hello", "kovai"]
      }
    },
    {
      slug: "bahrain",
      match: ["Radio Bahrain"],
      aliases: ["radio bahrain", "bahrain radio", "bahrain"],
      metadata: {
        type: "icecast",
        urls: ["https://stream.aiir.com/status-json.xsl"],
        hints: ["uejfkn0dchcuv", "radio bahrain"]
      }
    },
    {
      slug: "asianet",
      match: ["Asianet 657AM"],
      aliases: ["asianet", "asianet radio", "asianet 657", "asianet 657 am", "657"],
      metadata: {
        type: "zeno",
        id: "512rbf1e3qzuv"
      }
    },
    {
      slug: "quran",
      match: ["Quran Bahrain"],
      aliases: ["quran", "quran bahrain", "bahrain quran", "quran radio", "106.1"]
    }
  ];

  function normalize(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9.]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function configForCard(card) {
    const name = normalize(card?.dataset?.name);
    return CONFIGS.find(config =>
      config.match.some(value => normalize(value) === name)
    ) || null;
  }

  cards.forEach((card, index) => {
    const config = configForCard(card);
    card.dataset.v78Index = String(index);
    if (config) card.dataset.stationSlug = config.slug;
  });

  // ------------------------------------------------------------
  // Compact Now Playing UI.
  // ------------------------------------------------------------
  const strip = document.createElement("div");
  strip.id = "v78TrackStrip";
  strip.className = "v78-track-strip";
  strip.dataset.state = "idle";
  strip.innerHTML = `
    <span class="v78-track-icon" aria-hidden="true">♫</span>
    <button id="v78TrackCopy" class="v78-track-copy" type="button"
            aria-label="Open recently heard tracks">
      <span id="v78TrackTitle" class="v78-track-title">Track info ready</span>
      <span id="v78TrackArtist" class="v78-track-artist">Choose a station to check live metadata</span>
    </button>
    <button id="v78IdentifyButton" class="v78-identify-button" type="button"
            aria-label="Identify the song playing">Identify</button>
  `;
  stationRegionEl.insertAdjacentElement("afterend", strip);

  const trackTitleEl = document.getElementById("v78TrackTitle");
  const trackArtistEl = document.getElementById("v78TrackArtist");
  const trackCopyButton = document.getElementById("v78TrackCopy");
  const identifyButton = document.getElementById("v78IdentifyButton");

  const sheet = document.createElement("div");
  sheet.className = "v78-track-sheet";
  sheet.hidden = true;
  sheet.innerHTML = `
    <section class="v78-track-dialog" role="dialog" aria-modal="true"
             aria-labelledby="v78SheetTitle">
      <header class="v78-track-dialog-header">
        <div id="v78SheetTitle" class="v78-track-dialog-title">Recently heard</div>
        <button id="v78SheetClose" class="v78-track-close" type="button" aria-label="Close">×</button>
      </header>
      <div id="v78SheetBody" class="v78-track-history"></div>
    </section>
  `;
  document.body.appendChild(sheet);

  const sheetTitle = document.getElementById("v78SheetTitle");
  const sheetBody = document.getElementById("v78SheetBody");
  const sheetClose = document.getElementById("v78SheetClose");

  function openSheet(title, html) {
    sheetTitle.textContent = title;
    sheetBody.innerHTML = html;
    sheet.hidden = false;
  }

  function closeSheet() {
    sheet.hidden = true;
  }

  sheetClose.addEventListener("click", closeSheet);
  sheet.addEventListener("click", event => {
    if (event.target === sheet) closeSheet();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !sheet.hidden) closeSheet();
  });

  function getHistory() {
    try {
      const value = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
      return Array.isArray(value) ? value : [];
    } catch (_) {
      return [];
    }
  }

  function saveHistory(track, stationName) {
    if (!track?.title) return;

    const item = {
      title: track.title,
      artist: track.artist || "",
      station: stationName || "",
      source: track.source || "Station metadata",
      at: Date.now()
    };

    const key = normalize(`${item.station}|${item.artist}|${item.title}`);
    const history = getHistory().filter(old =>
      normalize(`${old.station}|${old.artist}|${old.title}`) !== key
    );
    history.unshift(item);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
  }

  function renderHistory() {
    const history = getHistory();
    if (!history.length) {
      openSheet("Recently heard", `
        <div class="v78-track-empty">
          No track titles have been received yet.<br>
          When a station publishes song metadata, Alaina Live will remember the latest ${MAX_HISTORY}.
        </div>
      `);
      return;
    }

    const escapeHtml = value => String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

    const html = history.map(item => `
      <div class="v78-track-history-item">
        <span aria-hidden="true">♫</span>
        <div>
          <strong>${escapeHtml(item.title)}</strong>
          <small>${escapeHtml(
            [item.artist, item.station].filter(Boolean).join(" · ")
          )}</small>
        </div>
      </div>
    `).join("");

    openSheet("Recently heard", html);
  }

  trackCopyButton.addEventListener("click", renderHistory);

  // ------------------------------------------------------------
  // Metadata helpers.
  // ------------------------------------------------------------
  let currentTrack = null;
  let activeCard = null;
  let activeConfig = null;
  let pollTimer = null;
  let zenoSource = null;
  let metadataGeneration = 0;
  let lastMetadataKey = "";

  function cleanText(value) {
    return String(value || "")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function parseCombinedTitle(value, stationName = "") {
    const text = cleanText(value);
    if (!text) return null;

    const normalized = normalize(text);
    const stationNormalized = normalize(stationName);
    if (!normalized || normalized === stationNormalized) return null;

    // Ignore common non-song status labels.
    if (/^(live|live radio|online|unknown|stream|radio)$/i.test(text)) return null;

    for (const separator of [" — ", " – ", " - "]) {
      const parts = text.split(separator).map(cleanText).filter(Boolean);
      if (parts.length >= 2) {
        return {
          artist: parts[0],
          title: parts.slice(1).join(separator).trim()
        };
      }
    }

    return { artist: "", title: text };
  }

  function normalizeTrack(track, stationName = "") {
    if (!track) return null;

    let artist = cleanText(
      track.artist ?? track.currentArtist ?? track.performer ?? track.creator ?? ""
    );
    let title = cleanText(
      track.title ?? track.currentSong ?? track.song ?? track.streamTitle ??
      track.stream_title ?? track.cue_title ?? ""
    );

    if (!artist && title) {
      const parsed = parseCombinedTitle(title, stationName);
      if (parsed) {
        artist = parsed.artist;
        title = parsed.title;
      }
    }

    if (!title) return null;

    const stationNormalized = normalize(stationName);
    if (normalize(title) === stationNormalized) return null;

    return {
      artist,
      title,
      source: cleanText(track.source || "Station metadata")
    };
  }

  function setTrackPending(message = "Checking station metadata…") {
    currentTrack = null;
    lastMetadataKey = "";
    strip.dataset.state = "checking";
    trackTitleEl.textContent = "Now playing";
    trackArtistEl.textContent = message;
    identifyButton.textContent = "Identify";
  }

  function setTrackUnavailable(message = "No live song title from this station") {
    currentTrack = null;
    lastMetadataKey = "";
    strip.dataset.state = "idle";
    trackTitleEl.textContent = "Track info unavailable";
    trackArtistEl.textContent = message;
    identifyButton.textContent = "Identify";
  }

  function applyTrack(track, source = "Station metadata") {
    const stationName = activeCard?.dataset?.name || "";
    const normalized = normalizeTrack({ ...track, source }, stationName);
    if (!normalized) return false;

    const key = normalize(`${normalized.artist}|${normalized.title}`);
    if (!key) return false;

    currentTrack = normalized;
    strip.dataset.state = "found";
    trackTitleEl.textContent = normalized.title;
    trackArtistEl.textContent = normalized.artist
      ? `${normalized.artist} · ${source}`
      : source;
    identifyButton.textContent = "Details";

    if (key !== lastMetadataKey) {
      lastMetadataKey = key;
      saveHistory(normalized, stationName);
    }

    // When a broadcaster gives us the song title, expose it to lock-screen /
    // notification media controls as well.
    if ("mediaSession" in navigator && activeCard) {
      try {
        const art = new URL(activeCard.dataset.art, window.location.href).href;
        navigator.mediaSession.metadata = new MediaMetadata({
          title: normalized.title,
          artist: normalized.artist || stationName,
          album: `${stationName} · Alaina Live`,
          artwork: [{ src: art }]
        });
      } catch (_) {}
    }

    return true;
  }

  async function fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SOURCE_TIMEOUT_MS);
    try {
      return await fetch(url, {
        cache: "no-store",
        ...options,
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }
  }

  function icecastSources(data) {
    const source = data?.icestats?.source;
    if (!source) return [];
    return Array.isArray(source) ? source : [source];
  }

  function chooseIcecastSource(sources, hints, stationName) {
    if (!sources.length) return null;
    const wanted = (hints || []).map(normalize).filter(Boolean);

    const scored = sources.map(source => {
      const haystack = normalize(JSON.stringify(source));
      let score = 0;
      for (const hint of wanted) {
        if (haystack.includes(hint)) score += Math.max(2, hint.length);
      }
      if (haystack.includes(normalize(stationName))) score += 20;
      return { source, score };
    }).sort((a, b) => b.score - a.score);

    if (scored[0]?.score > 0) return scored[0].source;
    return sources.length === 1 ? sources[0] : null;
  }

  async function readIcecast(config, generation) {
    const stationName = activeCard?.dataset?.name || "";

    for (const url of config.urls || []) {
      if (generation !== metadataGeneration) return false;
      try {
        const response = await fetchWithTimeout(url, {
          headers: { "Accept": "application/json,text/plain,*/*" }
        });
        if (!response.ok) continue;
        const data = await response.json();
        const source = chooseIcecastSource(
          icecastSources(data),
          config.hints,
          stationName
        );
        if (!source) continue;

        const track = normalizeTrack({
          artist: source.artist || source.creator || "",
          title:
            source.title ||
            source.stream_title ||
            source["stream-title"] ||
            source.song ||
            "",
          source: "Station metadata"
        }, stationName);

        if (track && generation === metadataGeneration) {
          return applyTrack(track, "Station metadata");
        }
      } catch (_) {
        // CORS / unavailable status endpoint is expected for some providers.
      }
    }

    return false;
  }

  function propertyFromXml(xml, names) {
    const wanted = names.map(normalize);
    const properties = Array.from(xml.querySelectorAll("property"));

    for (const property of properties) {
      const name = normalize(
        property.getAttribute("name") ||
        property.getAttribute("key") ||
        ""
      );
      if (wanted.includes(name)) return cleanText(property.textContent);
    }

    for (const name of names) {
      const node = xml.querySelector(name.replace(/_/g, "\\_"));
      if (node?.textContent) return cleanText(node.textContent);
    }

    return "";
  }

  async function readTriton(config, generation) {
    try {
      const url =
        `https://np.tritondigital.com/public/nowplaying` +
        `?mountName=${encodeURIComponent(config.mount)}` +
        `&numberToFetch=3&eventType=track&_=${Date.now()}`;

      const response = await fetchWithTimeout(url, {
        headers: { "Accept": "application/xml,text/xml,*/*" }
      });
      if (!response.ok) return false;

      const text = await response.text();
      if (generation !== metadataGeneration) return false;

      const xml = new DOMParser().parseFromString(text, "application/xml");
      if (xml.querySelector("parsererror")) return false;

      const artist = propertyFromXml(xml, [
        "track_artist_name", "artist_name", "artist"
      ]);
      const title =
        propertyFromXml(xml, ["track_name", "song_name", "title"]) ||
        propertyFromXml(xml, ["cue_title"]);

      return applyTrack({ artist, title }, "Live station metadata");
    } catch (_) {
      return false;
    }
  }

  function startZeno(config, generation) {
    try {
      const url =
        `https://api.zeno.fm/mounts/metadata/subscribe/${encodeURIComponent(config.id)}`;

      zenoSource = new EventSource(url);

      zenoSource.onmessage = event => {
        if (generation !== metadataGeneration) return;
        try {
          const data = JSON.parse(event.data);
          applyTrack({
            artist:
              data.artist ||
              data.currentArtist ||
              data.performer ||
              "",
            title:
              data.streamTitle ||
              data.currentSong ||
              data.song ||
              data.title ||
              ""
          }, "Live Zeno metadata");
        } catch (_) {}
      };

      zenoSource.onerror = () => {
        // EventSource reconnects automatically. Keep the normal UI fallback.
      };
    } catch (_) {}
  }

  function stopMetadata() {
    metadataGeneration++;
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (zenoSource) {
      zenoSource.close();
      zenoSource = null;
    }
  }

  async function pollMetadataOnce(generation) {
    if (generation !== metadataGeneration || !activeConfig?.metadata) return false;

    const metadata = activeConfig.metadata;
    if (metadata.type === "icecast") {
      return await readIcecast(metadata, generation);
    }
    if (metadata.type === "triton") {
      return await readTriton(metadata, generation);
    }
    return false;
  }

  function beginMetadataFor(card) {
    stopMetadata();

    activeCard = card || null;
    activeConfig = card ? configForCard(card) : null;
    const generation = metadataGeneration;

    if (!activeCard) {
      setTrackPending("Choose a station to check live metadata");
      return;
    }

    if (activeConfig?.metadataDisabledReason) {
      setTrackUnavailable(activeConfig.metadataDisabledReason);
      return;
    }

    if (!activeConfig?.metadata) {
      setTrackUnavailable("This station does not expose a reliable metadata feed yet");
      return;
    }

    if (!AUTO_METADATA_NETWORK) {
      setTrackUnavailable("Fast start Â· tap Identify for song recognition");
      return;
    }
    setTrackPending();

    if (activeConfig.metadata.type === "zeno") {
      startZeno(activeConfig.metadata, generation);
      setTimeout(() => {
        if (generation === metadataGeneration && !currentTrack) {
          setTrackUnavailable("No song title received yet · tap Identify");
        }
      }, 7000);
      return;
    }

    pollMetadataOnce(generation).catch(() => false).then(found => {
      if (generation !== metadataGeneration) return;
      if (!found && !currentTrack) {
        setTrackUnavailable("No browser-readable title yet · tap Identify");
      }
    });

    pollTimer = setInterval(() => {
      pollMetadataOnce(generation);
    }, POLL_MS);
  }

  function getActiveCard() {
    return cards.find(card => card.classList.contains("active")) || null;
  }

  let activeChangeTimer = null;
  function detectStationChange() {
    clearTimeout(activeChangeTimer);
    activeChangeTimer = setTimeout(() => {
      const card = getActiveCard();
      if (card !== activeCard) beginMetadataFor(card);
    }, 30);
  }

  const cardObserver = new MutationObserver(detectStationChange);
  cards.forEach(card => {
    cardObserver.observe(card, { attributes: true, attributeFilter: ["class"] });
  });

  audioEl.addEventListener("playing", detectStationChange);

  // ------------------------------------------------------------
  // Stable station deep links.
  // Examples:
  //   ?station=suno
  //   ?station=mirchi&play=1
  //   ?station=sooriyan&play=1&theme=onam&bg=photo
  // ------------------------------------------------------------
  function configForQuery(value) {
    const wanted = normalize(value);
    if (!wanted) return null;

    return CONFIGS.find(config =>
      normalize(config.slug) === wanted ||
      config.aliases.some(alias => normalize(alias) === wanted) ||
      config.match.some(name => normalize(name) === wanted)
    ) || null;
  }

  function indexForConfig(config) {
    if (!config) return -1;
    return cards.findIndex(card => card.dataset.stationSlug === config.slug);
  }

  function updateAddressForCard(card, includePlay = false) {
    const slug = card?.dataset?.stationSlug;
    if (!slug) return;

    const url = new URL(window.location.href);
    url.searchParams.set("station", slug);
    if (includePlay) url.searchParams.set("play", "1");
    else url.searchParams.delete("play");

    history.replaceState(null, "", url);
  }

  cards.forEach(card => {
    card.addEventListener("click", event => {
      if (event.target.closest(".favorite-toggle")) return;
      updateAddressForCard(card, false);
    });
  });

  function selectDeepLinkStation() {
    const params = new URLSearchParams(location.search);
    const requested = params.get("station");
    if (!requested) {
      detectStationChange();
      return;
    }

    const config = configForQuery(requested);
    const index = indexForConfig(config);

    if (index < 0) {
      if (typeof window.showAlaina === "function") {
        window.showAlaina(`Station "${requested}" was not found.`);
      }
      detectStationChange();
      return;
    }

    // Use the existing player selection function without generating another
    // synthetic click.
    try {
      if (typeof updateSelectedStation === "function") {
        updateSelectedStation(index);
      } else {
        cards[index].classList.add("active");
      }
    } catch (_) {}

    beginMetadataFor(cards[index]);

    const wantsPlay = /^(1|true|yes)$/i.test(params.get("play") || "");
    if (!wantsPlay) return;

    // Browsers may reject autoplay when a voice assistant / shortcut opens
    // a normal web page. The V7.8 patch changes the core error state to
    // "Tap Play" for that case rather than falsely saying "Unavailable".
    setTimeout(async () => {
      try {
        if (typeof playCurrentStation === "function") {
          await playCurrentStation();
        } else {
          cards[index].click();
        }
      } catch (_) {}
    }, 180);
  }

  window.AlainaVoice = Object.freeze({
    stations: CONFIGS.map(config => ({
      id: config.slug,
      aliases: [...config.aliases]
    })),
    stationUrl(slug, play = true) {
      const config = configForQuery(slug);
      if (!config) return "";
      const url = new URL(window.location.href);
      url.searchParams.set("station", config.slug);
      if (play) url.searchParams.set("play", "1");
      else url.searchParams.delete("play");
      return url.href;
    }
  });

  // ------------------------------------------------------------
  // Song identification handoff — V7.8.1
  // ------------------------------------------------------------
  // A normal browser cannot directly trigger Shazam's listening screen on
  // Android/iOS. Chrome can launch an external app only when that app exposes
  // a browser-resolvable (BROWSABLE) activity/deep link. Shazam does not
  // publish a supported browser deep link for "start recognition".
  //
  // V7.8 used an undocumented Android START_TAGGING intent. On current Shazam
  // builds that intent is not browser-resolvable, so Chrome correctly falls
  // back to the website. V7.8.1 removes that misleading behavior.
  function isAndroid() {
    return /Android/i.test(navigator.userAgent);
  }

  function isSamsungAndroid() {
    const ua = navigator.userAgent || "";
    return /Android/i.test(ua) && (
      /SamsungBrowser/i.test(ua) ||
      /\bSM-[A-Z0-9-]+/i.test(ua) ||
      /\bSAMSUNG\b/i.test(ua)
    );
  }

  function isAppleMobile() {
    return /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }

  function showIdentifyHelp() {
    const stationName = activeCard?.dataset?.name || "the station";

    if (currentTrack?.title) {
      const artistLine = currentTrack.artist
        ? `<p><strong>${escapeForSheet(currentTrack.title)}</strong><br>${escapeForSheet(currentTrack.artist)}</p>`
        : `<p><strong>${escapeForSheet(currentTrack.title)}</strong></p>`;

      openSheet("Track identified", `
        <div class="v78-identify-help">
          ${artistLine}
          <p>
            This title came from ${escapeForSheet(stationName)}'s live metadata.
            Tap the Now Playing strip to see recently heard titles.
          </p>
        </div>
      `);
      return;
    }

    if (isAppleMobile()) {
      openSheet("Identify this song", `
        <div class="v78-identify-help">
          <h3>Use Music Recognition on this device</h3>
          <p>
            Keep ${escapeForSheet(stationName)} playing. Open Control Centre and
            tap <strong>Recognise Music</strong>, or ask Siri
            <strong>“What song is this?”</strong>.
          </p>
          <div class="v78-help-note">
            Apple builds Shazam recognition into iPhone/iPad, but a normal web
            page is not allowed to press that system control for you.
          </div>
        </div>
      `);
      return;
    }

    if (isSamsungAndroid()) {
      openSheet("Identify this song", `
        <div class="v78-identify-help">
          <h3>Samsung: use Music Search without leaving the radio</h3>
          <p>
            Keep ${escapeForSheet(stationName)} playing. Press and hold the
            <strong>Home button / navigation gesture bar</strong> to open
            <strong>Circle to Search</strong>, then tap the
            <strong>music-note / Music Search</strong> button.
          </p>
          <p>
            If you prefer Shazam, enable its <strong>Notification bar</strong>
            option once. Then while Alaina Live is playing, swipe down and tap
            <strong>Shazam</strong>. Shazam can recognise audio playing on the
            same Android device, including through headphones.
          </p>
          <div class="v78-help-note">
            V7.8.1 deliberately stays in Alaina Live. The previous button used
            an undocumented Shazam Android intent; current Shazam does not
            expose that recognition action to web browsers, which is why
            Chrome sent you to the install website instead.
          </div>
        </div>
      `);
      return;
    }

    if (isAndroid()) {
      openSheet("Identify this song", `
        <div class="v78-identify-help">
          <h3>Use Shazam from Android's notification shade</h3>
          <p>
            Keep ${escapeForSheet(stationName)} playing. In Shazam settings,
            enable <strong>Notification bar</strong> (or Pop-Up Shazam) once.
            Then swipe down while the radio is playing and tap
            <strong>Shazam</strong>.
          </p>
          <p>
            Shazam supports identifying music that is playing on the same
            Android device, with or without headphones.
          </p>
          <div class="v78-help-note">
            A website cannot directly press Shazam's listening button because
            Shazam does not publish a supported browser deep link for starting
            recognition.
          </div>
        </div>
      `);
      return;
    }

    openSheet("Identify this song", `
      <div class="v78-identify-help">
        <h3>Use Shazam in the browser</h3>
        <p>
          Keep ${escapeForSheet(stationName)} playing. On a desktop Chromium
          browser, the Shazam extension can identify audio playing in the tab.
          Shazam's website can also identify music through the microphone.
        </p>
        <div class="v78-help-actions">
          <a class="v78-help-action" href="https://www.shazam.com/"
             target="_blank" rel="noopener">Open Shazam Web</a>
        </div>
        <div class="v78-help-note">
          For a true one-tap Identify button inside Alaina Live on every
          device, we need a small server-side audio recognition service rather
          than an installed-app deep link.
        </div>
      </div>
    `);
  }

  function escapeForSheet(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  identifyButton.addEventListener("click", showIdentifyHelp);

  selectDeepLinkStation();
})();

