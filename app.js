// ---------------------------------------------------------------------------
// Diminishing Returns Planner · Meridian Integration
// Single-page synthetic dashboard. All math is intentionally tunable.
// ---------------------------------------------------------------------------

(function () {
  "use strict";

  // ----- Channel definitions ------------------------------------------------
  // a  = asymptote (max y in neutral mode, arbitrary units)
  // k  = saturation rate (higher = reaches plateau faster)
  // w  = share of the AVG value allocated to this source
  const PAID_SOURCES = [
    { id: "meta",     name: "Meta Ads",    color: "#1877F2", a: 1.00, k: 0.55, w: 0.30 },
    { id: "google",   name: "Google Ads",  color: "#E8A100", a: 0.98, k: 0.48, w: 0.25 },
    { id: "linkedin", name: "LinkedIn",    color: "#0A66C2", a: 0.85, k: 0.34, w: 0.15 },
    { id: "tiktok",   name: "TikTok Ads",  color: "#FF2D55", a: 0.92, k: 0.42, w: 0.15 },
    { id: "youtube",  name: "YouTube Ads", color: "#FF4A3F", a: 0.95, k: 0.28, w: 0.15 },
  ];

  const OWNED_SOURCES = [
    { id: "email",    name: "Email",    color: "#0176D3", a: 1.00, k: 0.50, w: 0.50 },
    { id: "whatsapp", name: "WhatsApp", color: "#25D366", a: 0.90, k: 0.42, w: 0.30 },
    { id: "sms",      name: "SMS",      color: "#9B59B6", a: 0.82, k: 0.30, w: 0.20 },
  ];

  const PANELS = {
    paid: {
      sources: PAID_SOURCES,
      xLabel: "Spend",
      yLabel: "Conversions",
      xUnit: "imp/indvdl",
    },
    owned: {
      sources: OWNED_SOURCES,
      xLabel: "Sends",
      yLabel: "Opens",
      xUnit: "sends/indvdl",
    },
  };

  // ----- Chart geometry -----------------------------------------------------
  const VIEW_W = 640;
  const VIEW_H = 360;
  const MARGIN = { top: 30, right: 56, bottom: 58, left: 62 };
  const PLOT_W = VIEW_W - MARGIN.left - MARGIN.right;
  const PLOT_H = VIEW_H - MARGIN.top - MARGIN.bottom;
  const PLOT_X0 = MARGIN.left;
  const PLOT_X1 = MARGIN.left + PLOT_W;
  const PLOT_Y0 = MARGIN.top;
  const PLOT_Y1 = MARGIN.top + PLOT_H;

  const X_MAX = 20;     // data-space x max (touchpoints)
  const Y_MAX = 1.15;   // fixed y scale so curves don't jump between modes
  const SAMPLES = 80;   // same count across modes -> SVG d transitions smoothly
  const X_TICKS = [0, 4, 8, 12, 16, 20];
  const Y_TICKS = [0, 0.25, 0.5, 0.75, 1.0]; // displayed as index × 100

  // ----- State --------------------------------------------------------------
  // `mode` controls cross-media pressure (global Neutral | Channel-Aware).
  // `internalPaid` / `internalOwned` control within-media pressure, per panel.
  // The two are independent: within-media and cross-media effects can each
  // be toggled on/off separately.
  const state = {
    mode: "neutral",
    internalPaid: "neutral",
    internalOwned: "neutral",
    avgPaid: 3,
    avgOwned: 3,
  };

  // ----- Math ---------------------------------------------------------------
  function neutralY(x, src) {
    return src.a * (1 - Math.exp(-src.k * x));
  }

  // Returns a per-panel decay coefficient built from two optional parts:
  //   within: applied when this panel's Internal toggle is "aware"
  //   cross:  applied when the global Perspective is "aware"
  function decayFor(panel, s) {
    const WITHIN = 0.022;
    const CROSS = 0.010;
    const ownAvg = panel === "paid" ? s.avgPaid : s.avgOwned;
    const otherAvg = panel === "paid" ? s.avgOwned : s.avgPaid;
    const internal = panel === "paid" ? s.internalPaid : s.internalOwned;
    const within = internal === "aware" ? WITHIN * ownAvg : 0;
    const cross = s.mode === "aware" ? CROSS * otherAvg : 0;
    return within + cross;
  }

  // When decay > 0 the curve a(1-e^-kx)·e^-dx has a peak; otherwise it is a
  // monotonic saturation.
  function curveY(x, src, decay) {
    const base = neutralY(x, src);
    return decay > 0 ? base * Math.exp(-decay * x) : base;
  }

  // Where the curve plateaus. decay == 0: x at which y reaches 95% of the
  // asymptote. decay > 0: location of the peak (dy/dx = 0). Clamped to
  // the visible x range.
  function plateauFor(src, decay) {
    const k = src.k;
    if (decay <= 0) {
      const xRaw = Math.log(20) / k;                       // 95% saturation
      const x = Math.min(X_MAX, xRaw);
      return { x, y: neutralY(x, src) };
    }
    const xRaw = (1 / k) * Math.log((k + decay) / decay);  // peak of a(1-e^-kx)e^-dx
    const x = Math.min(X_MAX, Math.max(0.001, xRaw));
    return { x, y: curveY(x, src, decay) };
  }

  // ----- Coordinate helpers -------------------------------------------------
  const xToPx = (x) => PLOT_X0 + (x / X_MAX) * PLOT_W;
  const yToPx = (y) => PLOT_Y1 - (Math.max(0, y) / Y_MAX) * PLOT_H;
  const pxToX = (px) => ((px - PLOT_X0) / PLOT_W) * X_MAX;

  function samplePath(src, decay) {
    let d = "";
    for (let i = 0; i <= SAMPLES; i++) {
      const x = (i / SAMPLES) * X_MAX;
      const y = curveY(x, src, decay);
      const px = xToPx(x).toFixed(2);
      const py = yToPx(y).toFixed(2);
      d += (i === 0 ? "M" : "L") + px + " " + py + " ";
    }
    return d.trim();
  }

  // ----- SVG construction ---------------------------------------------------
  const SVG_NS = "http://www.w3.org/2000/svg";
  function svg(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      for (const k in attrs) el.setAttribute(k, attrs[k]);
    }
    return el;
  }

  function buildChart(panelKey) {
    const svgEl = document.querySelector(`[data-chart="${panelKey}"]`);
    svgEl.innerHTML = "";
    const panel = PANELS[panelKey];

    // --- grid lines (subtle horizontal)
    Y_TICKS.forEach((yv) => {
      if (yv === 0) return;
      const gy = yToPx(yv);
      svgEl.appendChild(svg("line", {
        class: "grid-line",
        x1: PLOT_X0, x2: PLOT_X1, y1: gy, y2: gy,
      }));
    });

    // --- axes
    svgEl.appendChild(svg("line", {
      class: "axis-line",
      x1: PLOT_X0, y1: PLOT_Y1,
      x2: PLOT_X1 + 14, y2: PLOT_Y1,
    }));
    svgEl.appendChild(svg("polygon", {
      class: "axis-arrow",
      points: `${PLOT_X1 + 14},${PLOT_Y1} ${PLOT_X1 + 8},${PLOT_Y1 - 4} ${PLOT_X1 + 8},${PLOT_Y1 + 4}`,
    }));
    const xLabel = svg("text", {
      class: "axis-label",
      x: PLOT_X1 + 6,
      y: PLOT_Y1 + 36,
      "text-anchor": "end",
    });
    xLabel.textContent = panel.xLabel;
    svgEl.appendChild(xLabel);

    svgEl.appendChild(svg("line", {
      class: "axis-line",
      x1: PLOT_X0, y1: PLOT_Y1,
      x2: PLOT_X0, y2: PLOT_Y0 - 14,
    }));
    svgEl.appendChild(svg("polygon", {
      class: "axis-arrow",
      points: `${PLOT_X0},${PLOT_Y0 - 14} ${PLOT_X0 - 4},${PLOT_Y0 - 8} ${PLOT_X0 + 4},${PLOT_Y0 - 8}`,
    }));
    const yLabel = svg("text", {
      class: "axis-label",
      x: PLOT_X0 - 4,
      y: PLOT_Y0 - 20,
      "text-anchor": "start",
    });
    yLabel.textContent = panel.yLabel;
    svgEl.appendChild(yLabel);

    // --- X-axis ticks + numeric labels
    X_TICKS.forEach((xv) => {
      const px = xToPx(xv);
      svgEl.appendChild(svg("line", {
        class: "axis-tick-line",
        x1: px, x2: px, y1: PLOT_Y1, y2: PLOT_Y1 + 4,
      }));
      const t = svg("text", {
        class: "axis-tick",
        x: px,
        y: PLOT_Y1 + 16,
        "text-anchor": "middle",
      });
      t.textContent = xv;
      svgEl.appendChild(t);
    });

    // --- Y-axis ticks + numeric labels (scaled 0-100 index)
    Y_TICKS.forEach((yv) => {
      const py = yToPx(yv);
      svgEl.appendChild(svg("line", {
        class: "axis-tick-line",
        x1: PLOT_X0 - 4, x2: PLOT_X0, y1: py, y2: py,
      }));
      const t = svg("text", {
        class: "axis-tick",
        x: PLOT_X0 - 7,
        y: py + 3,
        "text-anchor": "end",
      });
      t.textContent = Math.round(yv * 100);
      svgEl.appendChild(t);
    });

    // --- AVG marker (vertical dashed)
    const avgLine = svg("line", { class: "avg-marker-line", "data-avg-line": "" });
    svgEl.appendChild(avgLine);
    const avgText = svg("text", {
      class: "avg-marker-label",
      "data-avg-label": "",
      y: PLOT_Y0 - 2,
      "text-anchor": "middle",
    });
    avgText.textContent = "AVG";
    svgEl.appendChild(avgText);

    // --- curves + hit regions
    const hitGroup = svg("g", { "data-hit-group": "" });
    const curveGroup = svg("g", { "data-curve-group": "" });
    const plateauGroup = svg("g", { "data-plateau-group": "" });
    panel.sources.forEach((src) => {
      hitGroup.appendChild(svg("path", {
        class: "hit-region",
        "data-hit": src.id,
      }));
      curveGroup.appendChild(svg("path", {
        class: "curve",
        "data-curve": src.id,
        stroke: src.color,
      }));
      plateauGroup.appendChild(svg("circle", {
        class: "plateau-dot",
        "data-plateau-dot": src.id,
        r: 3.5,
        stroke: src.color,
      }));
      const label = svg("text", {
        class: "plateau-label",
        "data-plateau-label": src.id,
        fill: src.color,
      });
      plateauGroup.appendChild(label);
    });
    svgEl.appendChild(hitGroup);
    svgEl.appendChild(curveGroup);
    svgEl.appendChild(plateauGroup);

    // Build legend shell (values filled in render())
    const legend = document.querySelector(`[data-legend="${panelKey}"]`);
    legend.innerHTML = "";
    panel.sources.forEach((src) => {
      const item = document.createElement("div");
      item.className = "legend__item";
      item.dataset.legend = src.id;
      item.innerHTML = `
        <span class="legend__swatch" style="background:${src.color}"></span>
        <span class="legend__name">${src.name}</span>
        <span class="legend__plateau" data-legend-plateau="${src.id}"></span>
      `;
      item.addEventListener("mouseenter", () => highlightCurve(panelKey, src.id));
      item.addEventListener("mouseleave", () => highlightCurve(panelKey, null));
      legend.appendChild(item);
    });

  }

  // ----- Render (state -> DOM) ---------------------------------------------
  function render() {
    ["paid", "owned"].forEach((panelKey) => {
      const decay = decayFor(panelKey, state);
      const panel = PANELS[panelKey];
      const svgEl = document.querySelector(`[data-chart="${panelKey}"]`);
      const avg = panelKey === "paid" ? state.avgPaid : state.avgOwned;

      // Curves
      panel.sources.forEach((src) => {
        const d = samplePath(src, decay);
        svgEl.querySelector(`[data-curve="${src.id}"]`).setAttribute("d", d);
        svgEl.querySelector(`[data-hit="${src.id}"]`).setAttribute("d", d);
      });

      // Plateau dots, labels, and legend values
      const plateaus = panel.sources.map((src) => ({
        src,
        point: plateauFor(src, decay),
      }));

      // Lay labels out top-to-bottom in pixel space, nudging any that would
      // overlap so every number stays readable.
      const layout = plateaus
        .map(({ src, point }) => {
          const px = xToPx(point.x);
          const py = yToPx(point.y);
          const flip = px > PLOT_X1 - 74;
          return {
            src,
            point,
            px,
            py,
            labelX: flip ? px - 7 : px + 7,
            labelY: py - 6,
            anchor: flip ? "end" : "start",
          };
        })
        .sort((a, b) => a.labelY - b.labelY);

      const LABEL_MIN_GAP = 13;
      for (let i = 1; i < layout.length; i++) {
        const needed = layout[i - 1].labelY + LABEL_MIN_GAP;
        if (layout[i].labelY < needed) layout[i].labelY = needed;
      }

      layout.forEach(({ src, point, px, py, labelX, labelY, anchor }) => {
        const dot = svgEl.querySelector(`[data-plateau-dot="${src.id}"]`);
        dot.setAttribute("cx", px);
        dot.setAttribute("cy", py);

        const label = svgEl.querySelector(`[data-plateau-label="${src.id}"]`);
        label.setAttribute("x", labelX);
        label.setAttribute("y", Math.max(PLOT_Y0 + 10, Math.min(PLOT_Y1 - 2, labelY)));
        label.setAttribute("text-anchor", anchor);
        label.textContent = Math.round(point.y * 100);

        const legendVal = document.querySelector(`[data-legend-plateau="${src.id}"]`);
        if (legendVal) {
          const word = decay > 0 ? "peak" : "plateau";
          legendVal.innerHTML = `· ${word} <strong>${Math.round(point.y * 100)}</strong> @ x=${point.x.toFixed(1)}`;
        }
      });

      // AVG marker
      const clamped = Math.min(Math.max(avg, 0), X_MAX);
      const px = xToPx(clamped);
      const avgLine = svgEl.querySelector("[data-avg-line]");
      avgLine.setAttribute("x1", px);
      avgLine.setAttribute("x2", px);
      avgLine.setAttribute("y1", PLOT_Y0);
      avgLine.setAttribute("y2", PLOT_Y1);
      const avgLabel = svgEl.querySelector("[data-avg-label]");
      avgLabel.setAttribute("x", px);
      avgLabel.textContent = `AVG ${avg}`;

      // Sync slider + numeric readout + button disabled states
      const slider = document.querySelector(`[data-avg-slider="${panelKey}"]`);
      if (slider) {
        if (document.activeElement !== slider) slider.value = avg;
        slider.style.setProperty("--fill", (avg / X_MAX) * 100 + "%");
      }
      const valueEl = document.querySelector(`[data-avg-value="${panelKey}"]`);
      if (valueEl) valueEl.textContent = avg;

      document
        .querySelectorAll(`[data-avg-delta="${panelKey}"]`)
        .forEach((btn) => {
          const d = parseInt(btn.dataset.delta, 10);
          btn.disabled =
            (d < 0 && avg <= 0) || (d > 0 && avg >= X_MAX);
        });
    });

    // Cross-channel callout
    const callout = document.querySelector("[data-cross-callout]");
    const total = document.querySelector("[data-total-touchpoints]");
    if (state.mode === "aware") {
      callout.hidden = false;
      total.textContent = (state.avgPaid + state.avgOwned).toString();
    } else {
      callout.hidden = true;
    }
  }

  // ----- Interactions -------------------------------------------------------
  function highlightCurve(panelKey, sourceId) {
    const svgEl = document.querySelector(`[data-chart="${panelKey}"]`);
    svgEl.querySelectorAll(".curve").forEach((c) => {
      c.classList.remove("is-highlighted", "is-dimmed");
      if (sourceId) {
        if (c.dataset.curve === sourceId) c.classList.add("is-highlighted");
        else c.classList.add("is-dimmed");
      }
    });
    svgEl.querySelectorAll(".plateau-dot").forEach((d) => {
      d.classList.remove("is-highlighted", "is-dimmed");
      if (sourceId) {
        if (d.dataset.plateauDot === sourceId) d.classList.add("is-highlighted");
        else d.classList.add("is-dimmed");
      }
    });
    svgEl.querySelectorAll(".plateau-label").forEach((l) => {
      l.classList.remove("is-dimmed");
      if (sourceId && l.dataset.plateauLabel !== sourceId) {
        l.classList.add("is-dimmed");
      }
    });
  }

  function attachTooltip(panelKey) {
    const svgEl = document.querySelector(`[data-chart="${panelKey}"]`);
    const tooltipEl = document.querySelector(`[data-tooltip="${panelKey}"]`);
    const panel = PANELS[panelKey];

    function showTooltipFor(sourceId, evt) {
      const src = panel.sources.find((s) => s.id === sourceId);
      if (!src) return;

      // Map client x to data x
      const rect = svgEl.getBoundingClientRect();
      const svgX = ((evt.clientX - rect.left) / rect.width) * VIEW_W;
      const dataX = Math.max(0.05, Math.min(X_MAX, pxToX(svgX)));

      const decay = decayFor(panelKey, state);
      const yAware = curveY(dataX, src, decay);
      const yNeutral = neutralY(dataX, src);
      const pct = (yAware * 100).toFixed(1);

      const xUnit = panelKey === "paid" ? "spend units" : "sends";
      const yUnit = panelKey === "paid" ? "conv. index" : "opens index";
      let html = `
        <div class="tooltip__title">
          <span class="tooltip__dot" style="background:${src.color}"></span>
          ${src.name}
        </div>
        <div class="tooltip__value">
          x = ${dataX.toFixed(1)} ${xUnit} &nbsp;·&nbsp; y = <strong>${pct}</strong> ${yUnit}
        </div>`;

      if (decay > 0) {
        const delta = ((yAware - yNeutral) / Math.max(yNeutral, 1e-6)) * 100;
        const sign = delta < 0 ? "" : "+";
        html += `<div class="tooltip__delta">${sign}${delta.toFixed(1)}% vs. pure Neutral</div>`;
      }

      tooltipEl.innerHTML = html;
      tooltipEl.hidden = false;
      tooltipEl.classList.add("is-visible");

      // Position above the cursor, relative to the chart container
      const chartBox = tooltipEl.parentElement.getBoundingClientRect();
      tooltipEl.style.left = (evt.clientX - chartBox.left) + "px";
      tooltipEl.style.top = (evt.clientY - chartBox.top - 8) + "px";
    }

    function hideTooltip() {
      tooltipEl.classList.remove("is-visible");
      tooltipEl.hidden = true;
      highlightCurve(panelKey, null);
    }

    panel.sources.forEach((src) => {
      const hit = svgEl.querySelector(`[data-hit="${src.id}"]`);
      hit.addEventListener("mouseenter", (e) => {
        highlightCurve(panelKey, src.id);
        showTooltipFor(src.id, e);
      });
      hit.addEventListener("mousemove", (e) => showTooltipFor(src.id, e));
      hit.addEventListener("mouseleave", hideTooltip);
    });
  }

  function attachControls() {
    // Global Perspective toggle (Neutral | Channel-Aware)
    const globalOptions = document.querySelectorAll(
      ".segmented:not(.segmented--sm) .segmented__option"
    );
    globalOptions.forEach((opt) => {
      opt.addEventListener("click", () => {
        if (state.mode === opt.dataset.mode) return;
        state.mode = opt.dataset.mode;
        globalOptions.forEach((o) => {
          const isActive = o === opt;
          o.classList.toggle("is-active", isActive);
          o.setAttribute("aria-selected", isActive ? "true" : "false");
        });
        render();
      });
    });

    // Per-panel Internal toggle (Neutral | Aware)
    document.querySelectorAll("[data-internal]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const panelKey = btn.dataset.internal;      // "paid" | "owned"
        const nextMode = btn.dataset.internalMode;  // "neutral" | "aware"
        const stateKey = panelKey === "paid" ? "internalPaid" : "internalOwned";
        if (state[stateKey] === nextMode) return;
        state[stateKey] = nextMode;

        document
          .querySelectorAll(`[data-internal="${panelKey}"]`)
          .forEach((other) => {
            const isActive = other.dataset.internalMode === nextMode;
            other.classList.toggle("is-active", isActive);
            other.setAttribute("aria-selected", isActive ? "true" : "false");
          });
        render();
      });
    });

    // AVG setter shared by slider + buttons
    const setAvg = (panelKey, raw) => {
      let v = Math.round(Number(raw));
      if (!Number.isFinite(v) || v < 0) v = 0;
      if (v > X_MAX) v = X_MAX;
      if (panelKey === "paid") {
        if (state.avgPaid === v) return;
        state.avgPaid = v;
      } else {
        if (state.avgOwned === v) return;
        state.avgOwned = v;
      }
      render();
    };

    // Range sliders
    document.querySelectorAll("[data-avg-slider]").forEach((slider) => {
      const panelKey = slider.dataset.avgSlider;
      slider.addEventListener("input", () => setAvg(panelKey, slider.value));
      slider.addEventListener("change", () => setAvg(panelKey, slider.value));
    });

    // +/- buttons
    document.querySelectorAll("[data-avg-delta]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const panelKey = btn.dataset.avgDelta;
        const delta = parseInt(btn.dataset.delta, 10);
        const current = panelKey === "paid" ? state.avgPaid : state.avgOwned;
        setAvg(panelKey, current + delta);
      });
    });
  }

  // ----- Init ---------------------------------------------------------------
  function init() {
    buildChart("paid");
    buildChart("owned");
    attachTooltip("paid");
    attachTooltip("owned");
    attachControls();
    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
