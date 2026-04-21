(function () {

  if (!window.__lanternTopLevelBouncerInstalled) {
    window.__lanternTopLevelBouncerInstalled = true;
    window.__lanternTopLevelBouncerLive = true;
    console.log("Lantern top-level bouncer live");

    document.addEventListener("click", (e) => {
      const copyBtn = e.target.closest("#rv-copy");
      const exportBtn = e.target.closest("#rv-export");

      if (!copyBtn && !exportBtn) return;

      e.preventDefault();
      e.stopPropagation();

      const transcriptEl = document.querySelector("#rv-transcript");
      const liveText = String(
        ((transcriptEl && (transcriptEl.innerText || transcriptEl.textContent)) || "")
      ).trim();

      if (copyBtn) {
        if (!liveText) {
          console.warn("Lantern: nothing to copy");
          return;
        }

        const ta = document.createElement("textarea");
        ta.value = liveText;
        ta.setAttribute("readonly", "true");
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        ta.style.top = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();

        const ok = document.execCommand("copy");
        ta.remove();

        console.log(ok ? "Lantern copied reflection" : "Lantern copy failed");
        return;
      }

      if (exportBtn) {
        if (!liveText) {
          console.warn("Lantern: nothing to download");
          return;
        }

        const blob = new Blob([liveText], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "lantern_reflection.txt";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);

        console.log("Lantern download triggered");
      }
    }, true);
  }

  const state = {
    personas: [],
    history: [],
    lastTranscript: "",
    pendingDividerLabel: "",
    viewMode: "live"
  };

  async function api(path, options = {}) {
    const res = await fetch(`/api/plugin/lantern/${path}`, {
      headers: { "Content-Type": "application/json" },
      ...options
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    return data;
  }

  function turnsEachToMessages(value) {
    return Math.max(1, parseInt(value, 10) || 2) * 2;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function personaTrimColor(name) {
    const key = String(name || "").trim().toLowerCase();
    const hit = (state.personas || []).find(p => {
      const k = String(p.key || "").trim().toLowerCase();
      const n = String(p.name || "").trim().toLowerCase();
      return key === k || key === n;
    });

    const color = String((hit && hit.trim_color) || "").trim();
    return color || "";
  }

  function speakerColor(name) {
    const key = String(name || "").trim().toLowerCase();

    if (key === "donna") return "#ffb347";
    if (key === "scene") return "#9bbcff";

    const trim = personaTrimColor(key);
    if (trim) return trim;

    const palette = [
      "#7dd3fc",
      "#86efac",
      "#f9a8d4",
      "#fca5a5",
      "#c4b5fd",
      "#fdba74",
      "#93c5fd",
      "#fcd34d",
      "#a7f3d0",
      "#d8b4fe"
    ];

    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
    }

    return palette[Math.abs(hash) % palette.length];
  }

  function splitTranscript(text) {
    const raw = String(text || "");
    const lines = raw.split(/\r?\n/);

    let scene = "";
    const entries = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith("Scene:")) {
        scene = trimmed;
        continue;
      }

      const match = trimmed.match(/^([^:]+):\s*(.*)$/);
      if (match) {
        entries.push({
          type: "line",
          speaker: match[1].trim(),
          body: match[2].trim()
        });
      } else {
        entries.push({
          type: "note",
          body: trimmed
        });
      }
    }

    return { scene, entries };
  }

  function renderTranscriptHtml(text) {
    const raw = String(text || "");
    if (!raw.trim()) return "";

    const current = splitTranscript(raw);
    const previous = splitTranscript(state.lastTranscript || "");

    let firstNewIndex = -1;
    if (state.lastTranscript && state.viewMode === "live") {
      const prevLen = previous.entries.length;
      const currLen = current.entries.length;
      if (currLen > prevLen) firstNewIndex = prevLen;
    }

    const html = [];

    if (current.scene) {
      html.push(
        `<div style="
          position: sticky;
          top: 0;
          z-index: 2;
          margin: 0 0 14px 0;
          padding: 10px 12px;
          border: 1px solid #3b4d7a;
          border-radius: 10px;
          background: rgba(32,40,70,.92);
          color: ${speakerColor("scene")};
          font-weight: 700;
          backdrop-filter: blur(4px);
        ">${escapeHtml(current.scene)}</div>`
      );
    }

    current.entries.forEach((entry, index) => {
      if (firstNewIndex === index && state.pendingDividerLabel) {
        html.push(
          `<div style="display:flex; align-items:center; gap:10px; margin:14px 0 16px 0;">
             <div style="height:1px; flex:1; background:linear-gradient(90deg, transparent, #7c3aed, transparent);"></div>
             <div style="
               padding: 4px 10px;
               border: 1px solid #7c3aed;
               border-radius: 999px;
               color: #d8b4fe;
               font-size: 12px;
               font-weight: 700;
               letter-spacing: .04em;
               text-transform: uppercase;
               background: rgba(76, 29, 149, .18);
             ">${escapeHtml(state.pendingDividerLabel)}</div>
             <div style="height:1px; flex:1; background:linear-gradient(90deg, transparent, #7c3aed, transparent);"></div>
           </div>`
        );
      }

      if (entry.type === "line") {
        const color = speakerColor(entry.speaker);
        const isNew = firstNewIndex !== -1 && index >= firstNewIndex;

        html.push(
          `<div style="
            margin: 0 0 12px 0;
            padding: 10px 12px;
            border-radius: 12px;
            border: 1px solid ${isNew ? "rgba(124, 58, 237, .55)" : "rgba(120,120,140,.28)"};
            background: ${isNew ? "rgba(76, 29, 149, .10)" : "rgba(255,255,255,.02)"};
            box-shadow: ${isNew ? "0 0 0 1px rgba(168, 85, 247, .08) inset" : "none"};
          ">
            <div style="margin:0 0 4px 0;">
              <span style="color:${color}; font-weight:800;">${escapeHtml(entry.speaker)}</span>
            </div>
            <div style="color:#f3e8ff; white-space:pre-wrap;">${escapeHtml(entry.body)}</div>
          </div>`
        );
      } else {
        html.push(
          `<div style="
            margin: 0 0 12px 0;
            padding: 8px 12px;
            border-left: 3px solid #7c3aed;
            color: #d8b4fe;
            background: rgba(255,255,255,.02);
            border-radius: 8px;
          ">${escapeHtml(entry.body)}</div>`
        );
      }
    });

    return html.join("");
  }

  async function copyText(text) {
    const value = String(text || "").trim();
    if (!value) {
      throw new Error("Nothing to copy.");
    }

    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return;
    }

    const ta = document.createElement("textarea");
    ta.value = value;
    ta.setAttribute("readonly", "true");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();

    const ok = document.execCommand("copy");
    document.body.removeChild(ta);

    if (!ok) {
      throw new Error("Copy failed.");
    }
  }

  function timestampForFilename() {
    const d = new Date();
    const pad = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  }

  function downloadTextFile(filename, text) {
    const value = String(text || "").trim();
    if (!value) {
      throw new Error("Nothing to download.");
    }

    const blob = new Blob([value], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function render(root) {
    root.innerHTML = `
      <div style="max-width: 1580px; margin: 0 auto; padding: 24px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:16px; margin-bottom:20px;">
          <div>
            <h2 style="margin:0;">🏮 Lantern</h2>
            <div style="opacity:.75; margin-top:6px;">Support for reflection, clarity, calm, and next steps.</div>
          </div>
          <div id="rv-status" style="opacity:.8; font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-weight:700;"></div>
        </div>

        <div style="display:grid; grid-template-columns: 290px minmax(0, 1.75fr) 290px; gap:20px; align-items:start;">
          <section style="border:1px solid #555; border-radius:12px; padding:16px;">
            <h3 style="margin-top:0;; font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-weight:800;">Start here</h3>

            <label style="display:block; margin-bottom:12px;">
              <div style="margin-bottom:6px;">Support mode</div>
              <select id="rv-persona-1" style="width:100%; padding:10px; border-radius:8px; font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;"></select>
            </label>

            <label style="display:block; margin-bottom:12px;">
              <div style="margin-bottom:6px;">Support style</div>
              <select id="rv-persona-2" style="width:100%; padding:10px; border-radius:8px; font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;"></select>
            </label>

            <label style="display:block; margin-bottom:12px;">
              <textarea id="rv-scene" rows="4" style="display:none;">I don’t know what I need. I just need a little help figuring it out.</textarea>
            </label>

            <label style="display:block; margin-bottom:12px;">
              <div style="margin-bottom:6px;">Pace</div>
              <select id="rv-turns-each" style="width:100%; padding:10px; border-radius:8px; font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;">
                <option value="1">Slow — gentle pace</option>
                <option value="2" selected>Steady — balanced pace</option>
                <option value="3">Focused — more depth</option>
                <option value="5">Deep — take our time</option>
              </select>
            </label>

            <button id="rv-start" style="width:100%; padding:12px; border-radius:10px; cursor:pointer; border:1px solid #7c3aed; background:rgba(76, 29, 149, .18); color:#e9d5ff; font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-weight:700;">Start Lantern</button>
          </section>

          <section style="border:1px solid #555; border-radius:12px; padding:16px; min-height:520px; max-height:calc(100vh - 170px); display:flex; flex-direction:column;">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:10px; flex-wrap:wrap; position:sticky; top:0; z-index:2; background:rgba(24,24,32,.96); padding-bottom:10px;">
              <h3 style="margin:0;; font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-weight:800;">Reflection</h3>
              <div style="display:flex; gap:8px; flex-wrap:wrap;">
                <button id="rv-copy" style="padding:9px 12px; border-radius:10px; cursor:pointer; border:1px solid #7c3aed; background:rgba(76, 29, 149, .18); color:#e9d5ff; font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-weight:700;">Copy Reflection</button>
                <button id="rv-export" style="padding:9px 12px; border-radius:10px; cursor:pointer; border:1px solid #7c3aed; background:rgba(76, 29, 149, .18); color:#e9d5ff; font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-weight:700;">Download TXT</button>
                <button id="rv-archive" style="padding:9px 12px; border-radius:10px; cursor:pointer; border:1px solid #7c3aed; background:rgba(76, 29, 149, .18); color:#e9d5ff; font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-weight:700;">Journal this</button>
              </div>
            </div>

            <div id="rv-transcript" style="
              overflow:auto;
              flex:1;
              min-height:320px;
              max-height:calc(100vh - 300px);
              margin:0;
              padding-right:8px;
              padding-bottom:12px;
              font-family:ui-monospace, SFMono-Regular, Menlo, monospace;
              line-height:1.35;
            "></div>
          </section>

          <section style="border:1px solid #555; border-radius:12px; padding:16px;">
            <h3 style="margin-top:0;; font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-weight:800;">Session tools</h3>

            <button id="rv-continue" style="width:100%; padding:12px; border-radius:10px; margin-bottom:10px; cursor:pointer; border:1px solid #7c3aed; background:rgba(76, 29, 149, .18); color:#e9d5ff; font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-weight:700;">Guide me further</button>
            <button id="rv-end" style="width:100%; padding:12px; border-radius:10px; margin-bottom:10px; cursor:pointer; border:1px solid #94a3b8; background:rgba(51, 65, 85, .22); color:#e2e8f0; font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-weight:700;">Close for now</button>
            <button id="rv-clear" style="width:100%; padding:12px; border-radius:10px; margin-bottom:16px; cursor:pointer; border:1px solid #f59e0b; background:rgba(120, 53, 15, .20); color:#fde68a; font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-weight:700;">Resume</button>
            <button id="rv-finish" style="width:100%; padding:12px; border-radius:10px; margin-bottom:16px; cursor:pointer; border:1px solid #dc2626; background:rgba(127, 29, 29, .22); color:#fecaca; font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace; font-weight:700;">End</button>

            <label style="display:block; margin-bottom:12px;">
              <div style="margin-bottom:6px;">Add more</div>
              <textarea id="rv-user-message" rows="5" style="width:100%; padding:10px; border-radius:8px; font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;" placeholder="Tell Lantern what feels hardest right now..."></textarea>
            </label>

            <button id="rv-send" style="width:100%; padding:12px; border-radius:10px; margin-bottom:18px; cursor:pointer; border:1px solid #7c3aed; background:rgba(76, 29, 149, .18); color:#e9d5ff; font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-weight:700;">Share with Lantern</button>

            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:10px;">
              <h3 style="margin:0; font-size:18px;; font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-weight:800;">Journal</h3>
              <button id="rv-refresh-history" style="display:none; padding:8px 10px; border-radius:10px; cursor:pointer; border:1px solid #7c3aed; background:rgba(76, 29, 149, .18); color:#e9d5ff; font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-weight:700;">Reload</button>
            </div>

            <div id="rv-history-list" style="
              max-height: 260px;
              overflow:auto;
              border:1px solid rgba(120,120,140,.28);
              border-radius:12px;
              padding:10px;
              background: rgba(255,255,255,.02);
            "></div>
          </section>
        </div>
      </div>
    `;

    const status = root.querySelector("#rv-status");
    const transcript = root.querySelector("#rv-transcript");

    const ensureLanternDisclaimer = () => {
      document.querySelectorAll("#ln-disclaimer").forEach((el) => el.remove());

      root.style.position = "relative";

      const disclaimer = document.createElement("div");
      disclaimer.id = "ln-disclaimer";
      disclaimer.style.cssText = "position:absolute; left:50%; top:10px; transform:translateX(-50%); width:auto; max-width:92%; font-size:10px; line-height:1.1; color:rgba(255,255,255,0.62); text-align:center; white-space:nowrap; pointer-events:none; z-index:30;";
      disclaimer.textContent = "Reflection support only — not licensed mental health care. In crisis or risk of harm, call emergency services or a crisis hotline right away.";

      root.appendChild(disclaimer);
    };

    ensureLanternDisclaimer();

    if (!window.__lanternEarlyCopyExportFix) {
      window.__lanternEarlyCopyExportFix = true;
      window.__lanternDocumentCopyExport = true;

      document.addEventListener("click", (e) => {
        const copyBtn = e.target.closest("#rv-copy");
        const exportBtn = e.target.closest("#rv-export");

        if (!copyBtn && !exportBtn) {
          return;
        }

        e.preventDefault();
        e.stopPropagation();

        const transcriptEl = document.querySelector("#rv-transcript");
        const liveText = String(
          ((transcriptEl && (transcriptEl.innerText || transcriptEl.textContent)) || "")
        ).trim();

        if (copyBtn) {
          try {
            if (!liveText) {
              if (typeof setStatus === "function") setStatus("Nothing to copy.");
              return;
            }

            const ta = document.createElement("textarea");
            ta.value = liveText;
            ta.setAttribute("readonly", "true");
            ta.style.position = "fixed";
            ta.style.left = "-9999px";
            ta.style.top = "0";
            document.body.appendChild(ta);
            ta.focus();
            ta.select();

            const ok = document.execCommand("copy");
            ta.remove();

            if (!ok) {
              throw new Error("Copy failed.");
            }

            if (typeof setStatus === "function") setStatus("Reflection copied.");
          } catch (err) {
            if (typeof setStatus === "function") {
              setStatus(String((err && err.message) || err || "Copy failed."));
            }
          }
          return;
        }

        if (exportBtn) {
          try {
            if (!liveText) {
              if (typeof setStatus === "function") setStatus("Nothing to download.");
              return;
            }

            const blob = new Blob([liveText], { type: "text/plain;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "lantern_reflection.txt";
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);

            if (typeof setStatus === "function") setStatus("Downloaded TXT.");
          } catch (err) {
            if (typeof setStatus === "function") {
              setStatus(String((err && err.message) || err || "Download failed."));
            }
          }
        }
      }, true);
    }

    const p1 = root.querySelector("#rv-persona-1");
    const p2 = root.querySelector("#rv-persona-2");
    const userBox = root.querySelector("#rv-user-message");
    const historyList = root.querySelector("#rv-history-list");

    const continueBtn = root.querySelector("#rv-continue");
    const endBtn = root.querySelector("#rv-end");
    const finishBtn = root.querySelector("#rv-finish");
    const copyBtn = root.querySelector("#rv-copy");
    const exportBtn = root.querySelector("#rv-export");
    const archiveBtn = root.querySelector("#rv-archive");
    const sendBtn = root.querySelector("#rv-send");

    function setButtonState(el, enabled) {
      if (!el) return;
      el.disabled = !enabled;
      el.style.opacity = enabled ? "1" : ".42";
      el.style.cursor = enabled ? "pointer" : "not-allowed";
      el.style.filter = enabled ? "none" : "saturate(.55)";
    }

    function setSessionUi(active, hasContent) {
      setButtonState(continueBtn, active);
      setButtonState(endBtn, active);
      setButtonState(sendBtn, active);
      setButtonState(finishBtn, hasContent);

      setButtonState(copyBtn, hasContent);
      setButtonState(exportBtn, hasContent);
      setButtonState(archiveBtn, hasContent);
    }

    function setStatus(text) {
      status.textContent = text || "";
    }

    function polishTranscriptDom() {
      transcript.style.display = "flex";
      transcript.style.flexDirection = "column";
      transcript.style.gap = "14px";

      const blocks = Array.from(transcript.children);

      blocks.forEach((el) => {
        if (!(el instanceof HTMLElement)) return;

        const raw = (el.textContent || "").trim();
        const compact = raw.replace(/\s+/g, " ");
        const lower = compact.toLowerCase();

        const isDivider =
          lower === "lantern replies" ||
          lower === "you share more" ||
          lower === "new reflection" ||
          lower === "new session";

        const isFocus = lower.startsWith("focus");
        const isLantern = lower.startsWith("lantern");
        const isTakeaway = lower.startsWith("takeaway");
        const isYou = lower.startsWith("you") || lower.startsWith("donna");

        el.style.margin = "0";
        el.style.transition = "all .18s ease";
        el.style.overflowWrap = "anywhere";

        if (isDivider) {
          el.style.alignSelf = "center";
          el.style.padding = "6px 14px";
          el.style.borderRadius = "999px";
          el.style.border = "1px solid rgba(168, 85, 247, .45)";
          el.style.background = "rgba(76, 29, 149, .14)";
          el.style.color = "#e9d5ff";
          el.style.fontSize = "13px";
          el.style.fontWeight = "800";
          el.style.letterSpacing = ".06em";
          el.style.textTransform = "uppercase";
          el.style.boxShadow = "0 0 0 1px rgba(255,255,255,.02) inset";
          return;
        }

        el.style.padding = isFocus ? "18px 22px" : "20px 22px";
        el.style.borderRadius = "22px";
        el.style.lineHeight = "1.58";
        el.style.boxShadow = "inset 0 1px 0 rgba(255,255,255,.03), 0 10px 26px rgba(0,0,0,.16)";

        if (isFocus) {
          el.style.border = "1px solid rgba(196, 181, 253, .22)";
          el.style.borderLeft = "4px solid rgba(196, 181, 253, .58)";
          el.style.background = "linear-gradient(180deg, rgba(46, 36, 64, .76), rgba(28, 22, 40, .92))";
        } else if (isTakeaway) {
          el.style.border = "1px solid rgba(245, 158, 11, .20)";
          el.style.borderLeft = "4px solid rgba(245, 158, 11, .72)";
          el.style.background = "linear-gradient(180deg, rgba(54, 36, 18, .78), rgba(35, 24, 13, .94))";
        } else if (isLantern) {
          el.style.border = "1px solid rgba(244, 114, 182, .18)";
          el.style.borderLeft = "4px solid rgba(244, 114, 182, .72)";
          el.style.background = "linear-gradient(180deg, rgba(43, 29, 50, .78), rgba(28, 21, 36, .94))";
        } else if (isYou) {
          el.style.border = "1px solid rgba(96, 165, 250, .18)";
          el.style.borderLeft = "4px solid rgba(96, 165, 250, .70)";
          el.style.background = "linear-gradient(180deg, rgba(27, 35, 53, .78), rgba(20, 27, 39, .94))";
        } else {
          el.style.border = "1px solid rgba(168, 85, 247, .16)";
          el.style.borderLeft = "4px solid rgba(168, 85, 247, .50)";
          el.style.background = "linear-gradient(180deg, rgba(38, 28, 53, .76), rgba(25, 19, 35, .92))";
        }
      });

      transcript.querySelectorAll("strong, b").forEach((node) => {
        node.style.display = "block";
        node.style.marginBottom = "10px";
        node.style.fontWeight = "800";
        node.style.letterSpacing = "-0.01em";
      });

      transcript.querySelectorAll("pre").forEach((node) => {
        node.style.margin = "0";
        node.style.whiteSpace = "pre-wrap";
        node.style.fontFamily = "inherit";
        node.style.background = "transparent";
      });

      transcript.querySelectorAll("p").forEach((node) => {
        node.style.margin = "0";
      });
    }

    function setTranscript(text) {
      transcript.innerHTML = renderTranscriptHtml(text || "");
      polishTranscriptDom();
      requestAnimationFrame(() => {
        transcript.scrollTop = transcript.scrollHeight;
      });
      state.lastTranscript = String(text || "");
      state.pendingDividerLabel = "";
    }

    function fillPersonas() {
      const modes = [
        { key: "be_heard", label: "Be heard — talk it out without pressure" },
        { key: "get_clear", label: "Get clear — untangle what is going on" },
        { key: "calm_down", label: "Calm down — steady yourself first" },
        { key: "prepare", label: "Prepare — get ready for a conversation" },
        { key: "reflect", label: "Reflect — journal and notice patterns" },
        { key: "spiritual", label: "Spiritual — meaning, grief, hope, conscience" }
      ];

      const styles = [
        { key: "gentle", label: "Gentle — warm, validating, soft landing" },
        { key: "practical", label: "Practical — clear, grounded, useful" },
        { key: "direct", label: "Direct — kind, honest, no fluff" },
        { key: "deep", label: "Deep — reflective, layered, insight-oriented" },
        { key: "spiritual", label: "Spiritual — reverent, compassionate, hopeful" }
      ];

      p1.innerHTML = modes.map(item =>
        `<option value="${item.key}">${escapeHtml(item.label)}</option>`
      ).join("");

      p2.innerHTML = styles.map(item =>
        `<option value="${item.key}">${escapeHtml(item.label)}</option>`
      ).join("");

      p1.value = "be_heard";
      p2.value = "gentle";
    }

    function renderHistoryList() {
      if (!state.history.length) {
        historyList.innerHTML = `<div style="opacity:.75;">No saved reflections yet.</div>`;
        return;
      }

      historyList.innerHTML = state.history.map(item => {
        const when = item.created_at ? new Date(item.created_at).toLocaleString() : "";
        const scene = item.scene ? item.scene : "";
        return `
          <div style="
            margin-bottom:10px;
            padding:10px;
            border:1px solid rgba(120,120,140,.28);
            border-radius:10px;
            background: rgba(255,255,255,.02);
          ">
            <div style="font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-weight:700; color:#f3e8ff; margin-bottom:4px;">${escapeHtml(item.title || "Archived session")}</div>
            <div style="font-size:12px; opacity:.8; margin-bottom:4px;">${escapeHtml(when)}</div>
            <div style="font-size:12px; opacity:.8; margin-bottom:8px;">${escapeHtml(scene)}</div>
            <div style="display:flex; gap:8px;">
              <button data-load-id="${escapeHtml(item.id)}" style="padding:7px 10px; border-radius:10px; cursor:pointer; border:1px solid #7c3aed; background:rgba(76, 29, 149, .18); color:#e9d5ff; font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-weight:700;">Open</button>
              <button data-delete-id="${escapeHtml(item.id)}" style="padding:7px 10px; border-radius:10px; cursor:pointer; border:1px solid #7c3aed; background:rgba(76, 29, 149, .18); color:#e9d5ff; font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-weight:700;">Remove</button>
            </div>
          </div>
        `;
      }).join("");

      historyList.querySelectorAll("[data-load-id]").forEach(btn => {
        btn.addEventListener("click", async () => {
          try {
            const id = btn.getAttribute("data-load-id");
            const data = await api("history/load", {
              method: "POST",
              body: JSON.stringify({ id })
            });

            const entry = data.entry || {};
            const turnsEach = root.querySelector("#rv-turns-each").value;

            if (entry.persona_1) p1.value = entry.persona_1;
            if (entry.persona_2) p2.value = entry.persona_2;
            if (entry.scene) root.querySelector("#rv-scene").value = entry.scene;

            const resumed = await api("session/start", {
              method: "POST",
              body: JSON.stringify({
                persona_1: entry.persona_1 || p1.value,
                persona_2: entry.persona_2 || p2.value,
                scene: entry.scene || root.querySelector("#rv-scene").value.trim(),
                turns_each: parseInt(turnsEach, 10),
                messages_per_batch: turnsEachToMessages(turnsEach),
                seed_transcript: entry.transcript_text || "",
                resume: true
              })
            });

            state.viewMode = "live";
            state.pendingDividerLabel = "";
            userBox.value = "";

            const transcriptText = resumed.transcript || entry.transcript_text || "";
            setTranscript(transcriptText);
            if (typeof setSessionUi === "function") {
              setSessionUi(true, Boolean(String(transcriptText).trim()));
            }
            setStatus("Session resumed");
          } catch (err) {
            setStatus("Resume failed");
            setTranscript(String(err));
          }
        });
      });

      historyList.querySelectorAll("[data-delete-id]").forEach(btn => {
        btn.addEventListener("click", async () => {
          try {
            const id = btn.getAttribute("data-delete-id");
            const data = await api("history/delete", {
              method: "POST",
              body: JSON.stringify({ id })
            });
            state.history = data.history || [];
            renderHistoryList();
            setStatus("Journal entry removed");
          } catch (err) {
            setStatus("Remove failed");
          }
        });
      });
    }

    async function loadPersonas() {
      state.personas = [];
      fillPersonas();
    }

    async function loadHistory() {
      const data = await api("history");
      state.history = data.history || [];
      renderHistoryList();
    }

    function getLatestHistoryEntry() {
      if (!Array.isArray(state.history) || !state.history.length) return null;
      return [...state.history].sort((a, b) => {
        const ad = new Date(a.created_at || 0).getTime();
        const bd = new Date(b.created_at || 0).getTime();
        return bd - ad;
      })[0] || null;
    }

    async function refreshState() {
      const data = await api("session/state");
      const s = data.state || {};
      state.viewMode = "live";
      const transcriptText = s.transcript_text || "";
      setTranscript(transcriptText);
      setSessionUi(Boolean(s.active), Boolean(String(transcriptText).trim()));
      setStatus("Ready");
    }

    root.querySelector("#rv-start").addEventListener("click", async () => {
      try {
        state.viewMode = "live";
        state.pendingDividerLabel = "";
        setStatus("Starting...");
        const turnsEach = root.querySelector("#rv-turns-each").value;

        await api("session/start", {
          method: "POST",
          body: JSON.stringify({
            persona_1: p1.value,
            persona_2: p2.value,
            scene: root.querySelector("#rv-scene").value.trim(),
            turns_each: parseInt(turnsEach, 10),
            messages_per_batch: turnsEachToMessages(turnsEach)
          })
        });

        userBox.value = "";
        setTranscript("Session started. Share what feels most important.");
        state.lastTranscript = "";
        setSessionUi(true, false);
        setStatus("Ready — share what feels most important");
        requestAnimationFrame(() => userBox.focus());
      } catch (err) {
        setStatus("Error");
        setTranscript(String(err));
      }
    });

    root.querySelector("#rv-continue").addEventListener("click", async () => {
      try {
        state.viewMode = "live";
        state.pendingDividerLabel = "Next batch";
        setStatus("Continuing...");
        const data = await api("session/continue", { method: "POST" });
        const transcriptText = data.transcript || "";
        setTranscript(transcriptText);
        setSessionUi(true, Boolean(String(transcriptText).trim()));
        setStatus("Ready");
      } catch (err) {
        setStatus("Error");
        setTranscript(String(err));
      }
    });

    root.querySelector("#rv-send").addEventListener("click", async () => {
      try {
        const msg = userBox.value.trim();
        if (!msg) {
          setStatus("Type a message first.");
          return;
        }
        state.viewMode = "live";
        state.pendingDividerLabel = "Donna steps in";
        setStatus("Sending...");
        const data = await api("session/user_message", {
          method: "POST",
          body: JSON.stringify({ user_message: msg })
        });
        userBox.value = "";
        const transcriptText = data.transcript || "";
        setTranscript(transcriptText);
        setSessionUi(true, Boolean(String(transcriptText).trim()));
        setStatus("Ready");
      } catch (err) {
        setStatus("Error");
        setTranscript(String(err));
      }
    });



    root.querySelector("#rv-end").addEventListener("click", async () => {
      try {
        setStatus("Pausing...");

        if (state.lastTranscript && state.lastTranscript.trim()) {
          try {
            const saveData = await api("history/save", {
              method: "POST",
              body: JSON.stringify({})
            });
            state.history = saveData.history || state.history || [];
            renderHistoryList();
          } catch (saveErr) {
            console.warn("Save on pause failed", saveErr);
          }
        }

        state.viewMode = "live";
        state.pendingDividerLabel = "";
        userBox.value = "";

        if (typeof setSessionUi === "function") {
          setSessionUi(false, Boolean(String(state.lastTranscript || "").trim()));
        }

        setStatus("Paused. Resume anytime.");
      } catch (err) {
        setStatus("Error");
        setTranscript(String(err));
      }
    });


    root.querySelector("#rv-clear").addEventListener("click", async () => {
      try {
        if (!String(state.lastTranscript || "").trim()) {
          setStatus("Nothing to resume.");
          return;
        }

        state.viewMode = "live";
        state.pendingDividerLabel = "";
        userBox.value = "";

        if (typeof setSessionUi === "function") {
          setSessionUi(true, Boolean(String(state.lastTranscript || "").trim()));
        }

        setStatus("Ready");
      } catch (err) {
        setStatus("Resume failed");
        setTranscript(String(err));
      }
    });


    root.querySelector("#rv-finish").addEventListener("click", async () => {
      try {
        setStatus("Ending...");
        try {
          await api("session/end", {
            method: "POST",
            body: JSON.stringify({ clear: true })
          });
        } catch (e) {}

        state.viewMode = "live";
        state.lastTranscript = "";
        state.pendingDividerLabel = "";
        userBox.value = "";
        setTranscript("");

        if (typeof setSessionUi === "function") {
          setSessionUi(false, false);
        }

        setStatus("Session ended");
      } catch (err) {
        setStatus("Error");
        setTranscript(String(err));
      }
    });

    root.addEventListener("click", async (e) => {
      const copyBtn = e.target.closest("#rv-copy");
      const exportBtn = e.target.closest("#rv-export");

      if (!copyBtn && !exportBtn) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      const liveText = String(
        (transcript && (transcript.innerText || transcript.textContent)) ||
        state.lastTranscript ||
        ""
      ).trim();

      if (copyBtn) {
        try {
          if (!liveText) {
            setStatus("Nothing to copy.");
            return;
          }

          const ta = document.createElement("textarea");
          ta.value = liveText;
          ta.setAttribute("readonly", "true");
          ta.style.position = "fixed";
          ta.style.left = "-9999px";
          ta.style.top = "0";
          document.body.appendChild(ta);
          ta.focus();
          ta.select();

          const ok = document.execCommand("copy");
          ta.remove();

          if (!ok) {
            throw new Error("Copy failed.");
          }

          setStatus("Reflection copied.");
        } catch (err) {
          setStatus(String((err && err.message) || err || "Copy failed."));
        }
        return;
      }

      if (exportBtn) {
        try {
          if (!liveText) {
            setStatus("Nothing to download.");
            return;
          }

          const blob = new Blob([liveText], { type: "text/plain;charset=utf-8" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `lantern_${timestampForFilename()}.txt`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);

          setStatus("Downloaded TXT.");
        } catch (err) {
          setStatus(String((err && err.message) || err || "Download failed."));
        }
      }
    }, true);

    root.querySelector("#rv-archive")#rv-archive").addEventListener("click", async () => {
      try {
        if (!state.lastTranscript.trim()) {
          setStatus("No saved reflections yet.");
          return;
        }
        const data = await api("history/save", {
          method: "POST",
          body: JSON.stringify({})
        });
        state.history = data.history || [];
        renderHistoryList();
        setStatus("Saved to Journal.");
      } catch (err) {
        setStatus("Journal save failed");
      }
    });

    root.querySelector("#rv-refresh-history").addEventListener("click", async () => {
      try {
        await loadHistory();
        setStatus("Journal refreshed");
      } catch (err) {
        setStatus("Refresh failed");
      }
    });

    (async () => {
      try {
        setStatus("Loading...");
        await loadPersonas();
        await loadHistory();
        await refreshState();
      } catch (err) {
        setStatus("Error");
        setTranscript(String(err));
      }
    })();
  }

  const ROOT_ID = "lantern-app-root";
  let routeWatcher = null;

  function isLanternRoute() {
    return (window.location.hash || "").startsWith("#apps/lantern");
  }

  function unmount() {
    const existing = document.getElementById(ROOT_ID);
    if (existing) {
      existing.style.pointerEvents = "none";
      existing.style.opacity = "0";
      existing.style.visibility = "hidden";
      existing.remove();
    }
  }

  function mount() {
    let root = document.getElementById(ROOT_ID);
    let isNew = false;

    if (!root) {
      root = document.createElement("div");
      root.id = ROOT_ID;
      document.body.appendChild(root);
      isNew = true;
    }

    root.style.position = "fixed";
    root.style.left = "76px";
    root.style.right = "16px";
    root.style.top = "92px";
    root.style.bottom = "16px";
    root.style.overflow = "auto";
    root.style.zIndex = "1";
    root.style.pointerEvents = "auto";

    if (isNew) {
      render(root);
    }
  }

  function syncRoute() {
    if (isLanternRoute()) {
      mount();
    } else {
      unmount();
    }
  }

  function boot() {
    syncRoute();

    if (routeWatcher) clearInterval(routeWatcher);
    routeWatcher = setInterval(syncRoute, 120);
  }

  window.addEventListener("hashchange", syncRoute);
  window.addEventListener("popstate", syncRoute);
  document.addEventListener("click", () => setTimeout(syncRoute, 60), true);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();

/* LANTERN_ROUTE_BOUNCER_PATCH */
(() => {
  if (window.__LANTERN_ROUTE_BOUNCER_PATCH__) return;
  window.__LANTERN_ROUTE_BOUNCER_PATCH__ = true;

  function isLanternRoute() {
    return (window.location.hash || "").startsWith("#apps/lantern");
  }

  function isLanternApiUrl(url) {
    const u = String(url || "");
    return u.includes("/api/plugin/lantern/");
  }

  const originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = function(input, init) {
      try {
        const url = String((input && input.url) || input || "");
        if (isLanternApiUrl(url) && !isLanternRoute()) {
          console.warn("[Lantern] Blocked API call outside Lantern route:", url);
          return Promise.resolve(new Response(
            JSON.stringify({ ok: false, error: "Lantern route inactive" }),
            {
              status: 409,
              headers: { "Content-Type": "application/json" }
            }
          ));
        }
      } catch (e) {}
      return originalFetch.apply(this, arguments);
    };
  }

  const xhrOpen = XMLHttpRequest.prototype.open;
  const xhrSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this.__lantern_url = url;
    return xhrOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function(body) {
    try {
      if (isLanternApiUrl(this.__lantern_url) && !isLanternRoute()) {
        console.warn("[Lantern] Blocked XHR outside Lantern route:", this.__lantern_url);
        throw new Error("Lantern route inactive");
      }
    } catch (e) {
      throw e;
    }
    return xhrSend.call(this, body);
  };

  document.addEventListener("click", (e) => {
    if (isLanternRoute()) return;

    const btn = e.target && e.target.closest ? e.target.closest("button") : null;
    if (!btn) return;

    const t = String(btn.textContent || "").trim().toLowerCase();
    if (
      t.includes("start lantern") ||
      t.includes("share with lantern") ||
      t === "resume" ||
      t.includes("guide me further")
    ) {
      e.preventDefault();
      e.stopImmediatePropagation();
      console.warn("[Lantern] Blocked leaked button action outside Lantern route:", t);
    }
  }, true);
})();
