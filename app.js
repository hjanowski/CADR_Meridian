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
  const MARGIN = { top: 30, right: 56, bottom: 54, left: 62 };
  const PLOT_W = VIEW_W - MARGIN.left - MARGIN.right;
  const PLOT_H = VIEW_H - MARGIN.top - MARGIN.bottom;
  const PLOT_X0 = MARGIN.left;
  const PLOT_X1 = MARGIN.left + PLOT_W;
  const PLOT_Y0 = MARGIN.top;
  const PLOT_Y1 = MARGIN.top + PLOT_H;

  const X_MAX = 10;     // data-space x max (touchpoints)
  const Y_MAX = 1.15;   // fixed y scale so curves don't jump between modes
  const SAMPLES = 80;   // same count across modes -> SVG d transitions smoothly

  // ----- State --------------------------------------------------------------
  const state = {
    mode: "neutral",
    avgPaid: 3,
    avgOwned: 3,
  };

  // ----- Math ---------------------------------------------------------------
  function neutralY(x, src) {
    return src.a * (1 - Math.exp(-src.k * x));
  }

  // Decay factor driving the aware-mode roll-off. Own-media dominates, cross
  // media adds a secondary penalty.
  function decayFor(panel, avgPaid, avgOwned) {
    const WITHIN = 0.032;
    const CROSS = 0.014;
    if (panel === "paid") return WITHIN * avgPaid + CROSS * avgOwned;
    return WITHIN * avgOwned + CROSS * avgPaid;
  }

  function curveY(x, src, mode, decay) {
    const base = neutralY(x, src);
    if (mode === "neutral") return base;
    return base * Math.exp(-decay * x);
  }

  // ----- Coordinate helpers -------------------------------------------------
  const xToPx = (x) => PLOT_X0 + (x / X_MAX) * PLOT_W;
  const yToPx = (y) => PLOT_Y1 - (Math.max(0, y) / Y_MAX) * PLOT_H;
  const pxToX = (px) => ((px - PLOT_X0) / PLOT_W) * X_MAX;

  function samplePath(src, mode, decay) {
    let d = "";
    for (let i = 0; i <= SAMPLES; i++) {
      const x = (i / SAMPLES) * X_MAX;
      const y = curveY(x, src, mode, decay);
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
    for (let i = 1; i <= 4; i++) {
      const gy = PLOT_Y0 + (i / 5) * PLOT_H;
      svgEl.appendChild(svg("line", {
        class: "grid-line",
        x1: PLOT_X0, x2: PLOT_X1, y1: gy, y2: gy,
      }));
    }

    // --- axes
    // X axis
    svgEl.appendChild(svg("line", {
      class: "axis-line",
      x1: PLOT_X0, y1: PLOT_Y1,
      x2: PLOT_X1 + 14, y2: PLOT_Y1,
    }));
    // X arrow
    svgEl.appendChild(svg("polygon", {
      class: "axis-arrow",
      points: `${PLOT_X1 + 14},${PLOT_Y1} ${PLOT_X1 + 8},${PLOT_Y1 - 4} ${PLOT_X1 + 8},${PLOT_Y1 + 4}`,
    }));
    // X label (below right end)
    const xLabel = svg("text", {
      class: "axis-label",
      x: PLOT_X1 + 6,
      y: PLOT_Y1 + 20,
      "text-anchor": "end",
    });
    xLabel.textContent = panel.xLabel;
    svgEl.appendChild(xLabel);

    // Y axis
    svgEl.appendChild(svg("line", {
      class: "axis-line",
      x1: PLOT_X0, y1: PLOT_Y1,
      x2: PLOT_X0, y2: PLOT_Y0 - 14,
    }));
    // Y arrow
    svgEl.appendChild(svg("polygon", {
      class: "axis-arrow",
      points: `${PLOT_X0},${PLOT_Y0 - 14} ${PLOT_X0 - 4},${PLOT_Y0 - 8} ${PLOT_X0 + 4},${PLOT_Y0 - 8}`,
    }));
    // Y label (above axis)
    const yLabel = svg("text", {
      class: "axis-label",
      x: PLOT_X0 - 4,
      y: PLOT_Y0 - 20,
      "text-anchor": "start",
    });
    yLabel.textContent = panel.yLabel;
    svgEl.appendChild(yLabel);

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

    // --- curves + hit regions (hit underneath, visible path on top)
    const hitGroup = svg("g", { "data-hit-group": "" });
    const curveGroup = svg("g", { "data-curve-group": "" });
    panel.sources.forEach((src) => {
      const hit = svg("path", {
        class: "hit-region",
        "data-hit": src.id,
      });
      hitGroup.appendChild(hit);

      const path = svg("path", {
        class: "curve",
        "data-curve": src.id,
        stroke: src.color,
      });
      curveGroup.appendChild(path);
    });
    svgEl.appendChild(hitGroup);
    svgEl.appendChild(curveGroup);

    // Build legend
    const legend = document.querySelector(`[data-legend="${panelKey}"]`);
    legend.innerHTML = "";
    panel.sources.forEach((src) => {
      const item = document.createElement("div");
      item.className = "legend__item";
      item.dataset.legend = src.id;
      item.innerHTML = `
        <span class="legend__swatch" style="background:${src.color}"></span>
        <span>${src.name}</span>
      `;
      item.addEventListener("mouseenter", () => highlightCurve(panelKey, src.id));
      item.addEventListener("mouseleave", () => highlightCurve(panelKey, null));
      legend.appendChild(item);
    });
  }

  // ----- Render (state -> DOM) ---------------------------------------------
  function render() {
    ["paid", "owned"].forEach((panelKey) => {
      const decay = decayFor(panelKey, state.avgPaid, state.avgOwned);
      const panel = PANELS[panelKey];
      const svgEl = document.querySelector(`[data-chart="${panelKey}"]`);

      // Paths
      panel.sources.forEach((src) => {
        const d = samplePath(src, state.mode, decay);
        svgEl.querySelector(`[data-curve="${src.id}"]`).setAttribute("d", d);
        svgEl.querySelector(`[data-hit="${src.id}"]`).setAttribute("d", d);
      });

      // AVG marker
      const avg = panelKey === "paid" ? state.avgPaid : state.avgOwned;
      const clamped = Math.min(Math.max(avg, 0), X_MAX);
      const px = xToPx(clamped);
      svgEl.querySelector("[data-avg-line]").setAttribute("x1", px);
      svgEl.querySelector("[data-avg-line]").setAttribute("x2", px);
      svgEl.querySelector("[data-avg-line]").setAttribute("y1", PLOT_Y0);
      svgEl.querySelector("[data-avg-line]").setAttribute("y2", PLOT_Y1);
      const label = svgEl.querySelector("[data-avg-label]");
      label.setAttribute("x", px);
      label.textContent = `AVG ${avg}`;
    });

    // Cross-channel callout visibility
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
    const curves = svgEl.querySelectorAll(".curve");
    curves.forEach((c) => {
      c.classList.remove("is-highlighted", "is-dimmed");
      if (sourceId) {
        if (c.dataset.curve === sourceId) c.classList.add("is-highlighted");
        else c.classList.add("is-dimmed");
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

      const decay = decayFor(panelKey, state.avgPaid, state.avgOwned);
      const yAware = curveY(dataX, src, state.mode, decay);
      const yNeutral = neutralY(dataX, src);
      const pct = (yAware * 100).toFixed(1);

      const unit = panelKey === "paid" ? "conv/$" : "opens";
      let html = `
        <div class="tooltip__title">
          <span class="tooltip__dot" style="background:${src.color}"></span>
          ${src.name}
        </div>
        <div class="tooltip__value">
          At ${dataX.toFixed(1)} ${panelKey === "paid" ? "spend" : "sends"}: <strong>${pct}</strong> index (${unit})
        </div>`;

      if (state.mode === "aware") {
        const delta = ((yAware - yNeutral) / Math.max(yNeutral, 1e-6)) * 100;
        const sign = delta < 0 ? "" : "+";
        html += `<div class="tooltip__delta">${sign}${delta.toFixed(1)}% vs. Neutral (cross-channel)</div>`;
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
    // Perspective toggle
    const options = document.querySelectorAll(".segmented__option");
    options.forEach((opt) => {
      opt.addEventListener("click", () => {
        if (state.mode === opt.dataset.mode) return;
        state.mode = opt.dataset.mode;
        options.forEach((o) => {
          const isActive = o === opt;
          o.classList.toggle("is-active", isActive);
          o.setAttribute("aria-selected", isActive ? "true" : "false");
        });
        render();
      });
    });

    // AVG inputs
    ["paid", "owned"].forEach((panelKey) => {
      const input = document.querySelector(`[data-avg-input="${panelKey}"]`);
      const apply = () => {
        let v = parseFloat(input.value);
        if (!Number.isFinite(v) || v < 0) v = 0;
        if (v > X_MAX) v = X_MAX;
        input.value = v;
        if (panelKey === "paid") state.avgPaid = v;
        else state.avgOwned = v;
        render();
      };
      input.addEventListener("input", apply);
      input.addEventListener("change", apply);
    });

    // Pencil icons focus the input
    document.querySelectorAll(".avg-edit__pencil").forEach((btn) => {
      btn.addEventListener("click", () => {
        const control = btn.closest("[data-avg-control]");
        const input = control.querySelector("input");
        input.focus();
        input.select();
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
