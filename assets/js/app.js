(function () {
  "use strict";

  const DATA = window.LIDU_DATA;
  if (!DATA) {
    document.body.innerHTML =
      '<p style="padding:40px;font-family:serif">未能读取互文数据，请确认 assets/js/data.js 存在。</p>';
    return;
  }

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const people = {
    li: { name: "李白", short: "白", css: "li" },
    du: { name: "杜甫", short: "甫", css: "du" },
  };

  const poemIndex = {
    li: new Map(),
    du: new Map(),
  };
  const edgeList = [];
  const lineRelations = {
    li: new Map(),
    du: new Map(),
  };
  const poemRelations = new Map();
  const poemPairs = [];
  const poemPairMap = new Map();

  const state = {
    threshold: 8000,
    focusPerson: "li",
    focusPid: 114,
    liPid: 114,
    duPid: 41003,
    activeEdgeId: 0,
    currentEdgeIds: [],
  };

  let graphController = null;
  let searchActiveIndex = -1;
  let searchMatches = [];
  let toastTimer = null;

  function poemKey(person, pid) {
    return `${person}:${pid}`;
  }

  function lineKey(person, pid, sid) {
    return `${person}:${pid}:${sid}`;
  }

  function formatScore(score) {
    return (score / 100).toFixed(2);
  }

  function formatCount(value) {
    return Number(value).toLocaleString("zh-CN");
  }

  function getPoem(person, pid) {
    return poemIndex[person].get(Number(pid));
  }

  for (const person of ["li", "du"]) {
    for (const [pidText, poem] of Object.entries(DATA.poems[person])) {
      const pid = Number(pidText);
      const lineMap = new Map(poem.lines.map(([sid, text]) => [sid, text]));
      poemIndex[person].set(pid, {
        ...poem,
        person,
        pid,
        lineMap,
      });
    }
  }

  DATA.edges.forEach((edge, id) => {
    const [liPid, liSid, duPid, duSid, score] = edge;
    const item = { id, liPid, liSid, duPid, duSid, score };
    edgeList.push(item);

    const liLine = lineKey("li", liPid, liSid);
    const duLine = lineKey("du", duPid, duSid);
    if (!lineRelations.li.has(liLine)) lineRelations.li.set(liLine, []);
    if (!lineRelations.du.has(duLine)) lineRelations.du.set(duLine, []);
    lineRelations.li.get(liLine).push(item);
    lineRelations.du.get(duLine).push(item);

    const pairKey = `${liPid}|${duPid}`;
    let pair = poemPairMap.get(pairKey);
    if (!pair) {
      pair = {
        key: pairKey,
        liPid,
        duPid,
        edgeIds: [],
        count: 0,
        maxScore: 0,
        totalScore: 0,
      };
      poemPairMap.set(pairKey, pair);
      poemPairs.push(pair);
    }
    pair.edgeIds.push(id);
    pair.count += 1;
    pair.maxScore = Math.max(pair.maxScore, score);
    pair.totalScore += score;
  });

  for (const group of Object.values(lineRelations)) {
    for (const items of group.values()) {
      items.sort((a, b) => b.score - a.score);
    }
  }

  const nodeStats = new Map();
  for (const pair of poemPairs) {
    const liKey = poemKey("li", pair.liPid);
    const duKey = poemKey("du", pair.duPid);

    if (!nodeStats.has(liKey)) {
      nodeStats.set(liKey, { edgeCount: 0, pairCount: 0, maxScore: 0, neighbors: new Map() });
    }
    if (!nodeStats.has(duKey)) {
      nodeStats.set(duKey, { edgeCount: 0, pairCount: 0, maxScore: 0, neighbors: new Map() });
    }

    const liStats = nodeStats.get(liKey);
    const duStats = nodeStats.get(duKey);

    for (const side of [
      [liStats, duKey],
      [duStats, liKey],
    ]) {
      side[0].edgeCount += pair.count;
      side[0].pairCount += 1;
      side[0].maxScore = Math.max(side[0].maxScore, pair.maxScore);
      side[0].neighbors.set(side[1], (side[0].neighbors.get(side[1]) || 0) + pair.count);
    }

    if (!poemRelations.has(liKey)) poemRelations.set(liKey, []);
    if (!poemRelations.has(duKey)) poemRelations.set(duKey, []);
    poemRelations.get(liKey).push({
      pair,
      opponentPerson: "du",
      opponentPid: pair.duPid,
    });
    poemRelations.get(duKey).push({
      pair,
      opponentPerson: "li",
      opponentPid: pair.liPid,
    });
  }

  for (const relations of poemRelations.values()) {
    relations.sort(
      (a, b) =>
        b.pair.maxScore - a.pair.maxScore ||
        b.pair.count - a.pair.count ||
        a.opponentPid - b.opponentPid,
    );
  }

  function getPair(liPid, duPid) {
    return poemPairMap.get(`${liPid}|${duPid}`);
  }

  function getPairEdges(pair) {
    if (!pair) return [];
    return pair.edgeIds
      .map((id) => edgeList[id])
      .sort((a, b) => b.score - a.score);
  }

  function strongestLineRelation(person, pid, sid) {
    const relations = lineRelations[person].get(lineKey(person, pid, sid));
    return relations?.[0] || null;
  }

  function relatedCountForLine(person, pid, sid) {
    return lineRelations[person].get(lineKey(person, pid, sid))?.length || 0;
  }

  function fillDataSummary() {
    $("#liGraphCount").textContent = `${formatCount(DATA.meta.liPoemCount)} 首诗`;
    $("#duGraphCount").textContent = `${formatCount(DATA.meta.duPoemCount)} 首诗`;
    $("#aboutStats").innerHTML = [
      `数据关系 ${formatCount(DATA.meta.relationCount)} 条`,
      `李白诗作 ${formatCount(DATA.meta.liPoemCount)} 首 / ${formatCount(DATA.meta.liLineCount)} 句`,
      `杜甫诗作 ${formatCount(DATA.meta.duPoemCount)} 首 / ${formatCount(DATA.meta.duLineCount)} 句`,
    ]
      .map((text) => `<span>${text}</span>`)
      .join("");
  }

  function buildPoemLines(person, pid) {
    const poem = getPoem(person, pid);
    const container = $(`#${person}PoemLines`);
    if (!poem || !container) return;

    const title = $(`#${person}PoemTitle`);
    const meta = $(`#${person}PoemMeta`);
    title.textContent = poem.title;
    meta.textContent = `诗号 ${poem.pid} · ${poem.lines.length} 句`;

    const currentEdges = state.currentEdgeIds.map((id) => edgeList[id]);
    const counts = new Map();

    for (const edge of currentEdges) {
      const sid = person === "li" ? edge.liSid : edge.duSid;
      counts.set(sid, (counts.get(sid) || 0) + 1);
    }

    const activeEdge = edgeList[state.activeEdgeId];
    const activeSid = activeEdge
      ? person === "li"
        ? activeEdge.liSid
        : activeEdge.duSid
      : null;

    const fragment = document.createDocumentFragment();

    poem.lines.forEach(([sid, text], index) => {
      const count = counts.get(sid) || 0;
      const element = document.createElement(count ? "button" : "div");
      element.className = "poem-line";
      element.dataset.person = person;
      element.dataset.pid = String(pid);
      element.dataset.sid = String(sid);

      if (count) {
        element.type = "button";
        element.classList.add("is-linked");
        element.setAttribute(
          "aria-label",
          `${text}，${count} 条互文关系，点击查看`,
        );
        element.addEventListener("click", () => {
          const candidates = currentEdges.filter((edge) => {
            return (
              (person === "li" ? edge.liSid : edge.duSid) === sid
            );
          });
          if (candidates.length) setActiveEdge(candidates[0].id, true);
        });
      }

      if (sid === activeSid) element.classList.add("is-active");

      const number = document.createElement("span");
      number.className = "poem-line-number";
      number.textContent = String(index + 1).padStart(2, "0");

      const lineText = document.createElement("span");
      lineText.className = "poem-line-text";
      lineText.textContent = text;

      const badge = document.createElement("span");
      badge.className = "poem-line-badge";
      badge.textContent = count > 1 ? String(count) : count ? "照" : "";
      badge.setAttribute("aria-hidden", "true");

      element.append(number, lineText, badge);
      fragment.append(element);
    });

    container.replaceChildren(fragment);
  }

  function updateColumnFocus() {
    $("#liColumn").classList.toggle(
      "is-focus",
      state.focusPerson === "li" && Number(state.focusPid) === state.liPid,
    );
    $("#duColumn").classList.toggle(
      "is-focus",
      state.focusPerson === "du" && Number(state.focusPid) === state.duPid,
    );
  }

  function renderRelatedSelect() {
    const select = $("#relatedSelect");
    const focusPerson = state.focusPerson;
    const focusPid = Number(state.focusPid);
    const focusKey = poemKey(focusPerson, focusPid);
    const relations = poemRelations.get(focusKey) || [];
    const oppositePerson = focusPerson === "li" ? "du" : "li";
    const selectedPid = oppositePerson === "li" ? state.liPid : state.duPid;

    const options = relations.map(({ pair, opponentPid }) => {
      const poem = getPoem(oppositePerson, opponentPid);
      const option = document.createElement("option");
      option.value = String(opponentPid);
      option.textContent = poem?.title || `诗号 ${opponentPid}`;
      option.title = poem?.title || `诗号 ${opponentPid}`;
      option.dataset.maxScore = String(pair.maxScore);
      option.dataset.count = String(pair.count);
      if (opponentPid === selectedPid) option.selected = true;
      return option;
    });

    select.replaceChildren(...options);
    select.disabled = options.length === 0;
    select.setAttribute(
      "aria-label",
      `切换${people[oppositePerson].name}的对照诗作`,
    );
  }

  function renderMatchList() {
    const list = $("#matchList");
    const currentEdges = state.currentEdgeIds
      .map((id) => edgeList[id])
      .sort((a, b) => b.score - a.score);
    const fragment = document.createDocumentFragment();

    currentEdges.forEach((edge, index) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "match-row";
      row.dataset.edgeId = String(edge.id);
      row.setAttribute(
        "aria-label",
        `互文 ${index + 1}，相似度 ${formatScore(edge.score)}%，${getPoem("li", edge.liPid).lineMap.get(edge.liSid)}对${getPoem("du", edge.duPid).lineMap.get(edge.duSid)}`,
      );
      if (edge.id === state.activeEdgeId) row.classList.add("is-active");

      const rowIndex = document.createElement("span");
      rowIndex.className = "match-row-index";
      rowIndex.textContent = String(index + 1).padStart(2, "0");

      const liText = document.createElement("span");
      liText.className = "match-row-line";
      liText.textContent = getPoem("li", edge.liPid).lineMap.get(edge.liSid);

      const mark = document.createElement("span");
      mark.className = "match-row-mark";
      mark.textContent = "照";
      mark.setAttribute("aria-hidden", "true");

      const duText = document.createElement("span");
      duText.className = "match-row-line";
      duText.textContent = getPoem("du", edge.duPid).lineMap.get(edge.duSid);

      const score = document.createElement("span");
      score.className = "match-row-score";
      score.textContent = `${formatScore(edge.score)}%`;

      row.append(rowIndex, liText, mark, duText, score);
      row.addEventListener("click", () => setActiveEdge(edge.id, true));
      fragment.append(row);
    });

    list.replaceChildren(fragment);
    $("#matchCount").textContent = `${currentEdges.length} 条`;
  }

  function updateMatchDetails() {
    const edge = edgeList[state.activeEdgeId];
    if (!edge) return;

    const liText = getPoem("li", edge.liPid).lineMap.get(edge.liSid);
    const duText = getPoem("du", edge.duPid).lineMap.get(edge.duSid);
    const score = formatScore(edge.score);
    const scoreOrbit = $("#scoreOrbit");

    $("#activeScore").textContent = score;
    $("#scoreCaption").textContent = `相近文本 · ${edge.score}`;
    $("#activeLiQuote").textContent = liText;
    $("#activeDuQuote").textContent = duText;
    scoreOrbit.style.setProperty("--score-angle", `${edge.score * 0.036}deg`);

    $$(".poem-line.is-active").forEach((line) => line.classList.remove("is-active"));
    for (const [person, sid] of [
      ["li", edge.liSid],
      ["du", edge.duSid],
    ]) {
      const line = $(
        `[data-person="${person}"][data-pid="${person === "li" ? edge.liPid : edge.duPid}"][data-sid="${sid}"]`,
      );
      if (line) line.classList.add("is-active");
    }

    $$(".match-row").forEach((row) => {
      row.classList.toggle("is-active", Number(row.dataset.edgeId) === edge.id);
    });

    drawThreads();
  }

  function updatePairHeading() {
    const liPoem = getPoem("li", state.liPid);
    const duPoem = getPoem("du", state.duPid);
    if (!liPoem || !duPoem) return;

    $("#readerPairLabel").textContent = `${liPoem.title} × ${duPoem.title}`;
    $("#readerShell").hidden = false;
    $("#readerEmpty").hidden = true;
  }

  function renderReader(options = {}) {
    const liPoem = getPoem("li", state.liPid);
    const duPoem = getPoem("du", state.duPid);
    if (!liPoem || !duPoem) return;

    const pair = getPair(state.liPid, state.duPid);
    state.currentEdgeIds = pair ? pair.edgeIds.slice() : [];
    if (
      !state.currentEdgeIds.includes(state.activeEdgeId) &&
      state.currentEdgeIds.length
    ) {
      state.activeEdgeId = getPairEdges(pair)[0].id;
    }

    updatePairHeading();
    buildPoemLines("li", state.liPid);
    buildPoemLines("du", state.duPid);
    updateColumnFocus();
    renderRelatedSelect();
    renderMatchList();
    updateMatchDetails();

    requestAnimationFrame(() => {
      drawThreads();
      if (options.scrollActive) {
        const edge = edgeList[state.activeEdgeId];
        if (edge) scrollLineIntoView("li", edge.liSid);
      }
    });
  }

  function setActiveEdge(edgeId, scroll = false) {
    if (!state.currentEdgeIds.includes(edgeId)) return;
    state.activeEdgeId = edgeId;
    updateMatchDetails();
    if (scroll) {
      const edge = edgeList[edgeId];
      scrollLineIntoView("li", edge.liSid);
      scrollLineIntoView("du", edge.duSid);
    }
  }

  function scrollLineIntoView(person, sid) {
    const pid = person === "li" ? state.liPid : state.duPid;
    const line = $(
      `[data-person="${person}"][data-pid="${pid}"][data-sid="${sid}"]`,
    );
    if (!line) return;
    const container = line.closest(".poem-lines");
    if (!container) return;

    const lineTop = line.offsetTop;
    const target = Math.max(0, lineTop - container.clientHeight * 0.42);
    container.scrollTo({
      top: target,
      behavior: reducedMotion ? "auto" : "smooth",
    });
  }

  function setPairFromEdge(edgeId, focusPerson = "li", options = {}) {
    const edge = edgeList[edgeId];
    if (!edge) return;

    state.liPid = edge.liPid;
    state.duPid = edge.duPid;
    state.focusPerson = focusPerson;
    state.focusPid = focusPerson === "li" ? edge.liPid : edge.duPid;
    state.activeEdgeId = edgeId;

    renderReader();
    graphController?.setSelection(
      poemKey("li", edge.liPid),
      poemKey("du", edge.duPid),
    );

    if (options.scroll) {
      requestAnimationFrame(() => {
        $("#reader").scrollIntoView({
          behavior: reducedMotion ? "auto" : "smooth",
          block: "start",
        });
        setTimeout(() => {
          const activeEdge = edgeList[state.activeEdgeId];
          if (activeEdge) {
            scrollLineIntoView("li", activeEdge.liSid);
            scrollLineIntoView("du", activeEdge.duSid);
          }
        }, reducedMotion ? 0 : 450);
      });
    }
  }

  function setPoemPair(focusPerson, focusPid, opponentPid, options = {}) {
    const liPid = focusPerson === "li" ? Number(focusPid) : Number(opponentPid);
    const duPid = focusPerson === "du" ? Number(focusPid) : Number(opponentPid);
    const pair = getPair(liPid, duPid);
    if (!pair) return;

    const edges = getPairEdges(pair);
    state.liPid = liPid;
    state.duPid = duPid;
    state.focusPerson = focusPerson;
    state.focusPid = Number(focusPid);
    state.activeEdgeId = edges[0]?.id ?? -1;
    state.currentEdgeIds = pair.edgeIds.slice();

    renderReader();
    graphController?.setSelection(
      poemKey("li", liPid),
      poemKey("du", duPid),
    );

    if (options.scroll) {
      $("#reader").scrollIntoView({
        behavior: reducedMotion ? "auto" : "smooth",
        block: "start",
      });
    }
  }

  function selectPoem(person, pid, preferredOpponentPid = null) {
    const key = poemKey(person, Number(pid));
    const relations = poemRelations.get(key);
    if (!relations?.length) {
      showToast("这首诗暂未出现在互文关系表中");
      return;
    }

    const chosen =
      relations.find(
        ({ opponentPid }) => opponentPid === Number(preferredOpponentPid),
      ) || relations[0];

    state.focusPerson = person;
    state.focusPid = Number(pid);
    setPoemPair(person, Number(pid), chosen.opponentPid, { scroll: true });
  }

  function drawThreads() {
    const svg = $("#threadSvg");
    const stage = $("#readerStage");
    if (!svg || !stage) return;
    if (window.getComputedStyle(svg).display === "none") {
      svg.replaceChildren();
      return;
    }

    const stageBox = stage.getBoundingClientRect();
    const width = stageBox.width;
    const height = stageBox.height;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

    const paths = new Map();
    const currentEdges = state.currentEdgeIds.map((id) => edgeList[id]);

    for (const edge of currentEdges) {
      const liLine = $(
        `[data-person="li"][data-pid="${edge.liPid}"][data-sid="${edge.liSid}"]`,
      );
      const duLine = $(
        `[data-person="du"][data-pid="${edge.duPid}"][data-sid="${edge.duSid}"]`,
      );
      if (!liLine || !duLine) continue;

      const liBox = liLine.getBoundingClientRect();
      const duBox = duLine.getBoundingClientRect();
      const x1 = liBox.right - stageBox.left - 5;
      const y1 = liBox.top - stageBox.top + liBox.height / 2;
      const x2 = duBox.left - stageBox.left + 5;
      const y2 = duBox.top - stageBox.top + duBox.height / 2;
      const bend = Math.max(36, (x2 - x1) * 0.46);

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute(
        "d",
        `M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${(x1 + bend).toFixed(1)} ${y1.toFixed(1)}, ${(x2 - bend).toFixed(1)} ${y2.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`,
      );
      path.dataset.edgeId = String(edge.id);
      path.style.opacity =
        edge.score >= 8500 ? "0.46" : edge.score >= 8000 ? "0.32" : "0.21";
      if (edge.id === state.activeEdgeId) path.classList.add("is-selected");
      paths.set(edge.id, path);
    }

    svg.replaceChildren(...paths.values());
  }

  function createGraph() {
    const canvas = $("#starCanvas");
    const stage = $("#graphStage");
    const tooltip = $("#graphTooltip");
    if (!canvas || !stage || !tooltip) return null;

    const ctx = canvas.getContext("2d");
    const nodes = [];
    const nodeMap = new Map();
    const maxDegree = Math.max(
      1,
      ...Array.from(nodeStats.values(), (stats) => stats.edgeCount),
    );

    const ordered = {
      li: Array.from(poemIndex.li.values()),
      du: Array.from(poemIndex.du.values()),
    };

    function hashNumber(value) {
      let hash = 2166136261;
      const text = String(value);
      for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
      return hash >>> 0;
    }

    for (const person of ["li", "du"]) {
      const poems = ordered[person];
      poems.sort((a, b) => a.pid - b.pid);

      poems.forEach((poem, index) => {
        const key = poemKey(person, poem.pid);
        const stats = nodeStats.get(key) || {
          edgeCount: 0,
          pairCount: 0,
          maxScore: 0,
        };
        const hash = hashNumber(key);
        const randomA = (hash & 0xffff) / 0xffff;
        const randomB = ((hash >>> 16) & 0xffff) / 0xffff;
        const importance = Math.min(1, Math.sqrt(stats.edgeCount / maxDegree));
        const y = 0.13 + (index / Math.max(1, poems.length - 1)) * 0.74;
        const spread = 0.065 + 0.115 * randomB * (1 - importance * 0.28);
        const rawX = person === "li" ? 0.34 - spread : 0.66 + spread;
        const x =
          person === "li"
            ? Math.max(0.055, Math.min(0.385, rawX))
            : Math.max(0.615, Math.min(0.945, rawX));

        const node = {
          key,
          person,
          pid: poem.pid,
          title: poem.title,
          lineCount: poem.lines.length,
          degree: stats.edgeCount,
          pairCount: stats.pairCount,
          maxScore: stats.maxScore,
          nx: x,
          ny: Math.min(0.905, Math.max(0.095, y + (randomA - 0.5) * 0.018)),
          phase: randomA * Math.PI * 2,
          radius: 1.15 + importance * 2.1,
          positions: { x: 0, y: 0 },
        };
        nodes.push(node);
        nodeMap.set(key, node);
      });
    }

    const dust = Array.from({ length: 120 }, (_, index) => {
      const seed = hashNumber(`dust-${index}`);
      return {
        nx: (seed & 0xffff) / 0xffff,
        ny: ((seed >>> 16) & 0xffff) / 0xffff,
        size: 0.4 + ((seed >>> 4) % 100) / 100,
        phase: (seed % 1000) / 1000 * Math.PI * 2,
      };
    });

    let width = 0;
    let height = 0;
    let dpr = 1;
    let animationFrame = 0;
    let visible = true;
    let hoveredNode = null;
    let activeGraphEdges = [];
    let activeDegree = new Map();
    let selection = { focus: null, opponent: null };
    let ready = false;

    function refreshGraphEdges() {
      activeGraphEdges = poemPairs.filter(
        (pair) => pair.maxScore >= state.threshold,
      );
      activeDegree = new Map();
      for (const pair of activeGraphEdges) {
        const liKey = poemKey("li", pair.liPid);
        const duKey = poemKey("du", pair.duPid);
        activeDegree.set(liKey, (activeDegree.get(liKey) || 0) + 1);
        activeDegree.set(duKey, (activeDegree.get(duKey) || 0) + 1);
      }
    }

    function resize() {
      const rect = stage.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function nodePosition(node, time) {
      const driftScale = reducedMotion ? 0 : 1;
      return {
        x:
          node.nx * width +
          Math.sin(time * 0.00022 + node.phase) * 1.15 * driftScale,
        y:
          node.ny * height +
          Math.cos(time * 0.00019 + node.phase) * 1.25 * driftScale,
      };
    }

    function draw(time = 0) {
      if (!width || !height) return;
      ctx.clearRect(0, 0, width, height);

      for (const mote of dust) {
        const flicker = reducedMotion
          ? 0.3
          : 0.15 + 0.22 * (0.5 + 0.5 * Math.sin(time * 0.001 + mote.phase));
        ctx.beginPath();
        ctx.fillStyle = `rgba(63, 81, 73, ${flicker})`;
        ctx.arc(mote.nx * width, mote.ny * height, mote.size, 0, Math.PI * 2);
        ctx.fill();
      }

      for (const pair of activeGraphEdges) {
        const liNode = nodeMap.get(poemKey("li", pair.liPid));
        const duNode = nodeMap.get(poemKey("du", pair.duPid));
        if (!liNode || !duNode) continue;
        const p1 = nodePosition(liNode, time);
        const p2 = nodePosition(duNode, time);
        const selected =
          selection.focus &&
          (liNode.key === selection.focus || duNode.key === selection.focus);
        let alpha =
          0.025 +
          Math.pow(Math.max(0, pair.maxScore - 7000) / 3000, 1.25) * 0.2;
        let stroke = "74, 94, 83";
        let lineWidth = 0.55 + (pair.maxScore - 7000) / 5000;

        if (selection.focus && !selected) {
          alpha *= 0.14;
        } else if (selected) {
          alpha = Math.min(0.68, alpha + 0.38);
          stroke = "143, 82, 66";
          lineWidth = Math.max(0.9, lineWidth + 0.65);
        }

        const bend = Math.abs(p2.y - p1.y) * 0.16 + 12;
        const midX = width / 2;
        ctx.beginPath();
        ctx.strokeStyle = `rgba(${stroke}, ${alpha})`;
        ctx.lineWidth = lineWidth;
        ctx.moveTo(p1.x, p1.y);
        ctx.bezierCurveTo(
          p1.x + (midX - p1.x) * 0.6,
          p1.y + bend,
          p2.x - (p2.x - midX) * 0.6,
          p2.y - bend,
          p2.x,
          p2.y,
        );
        ctx.stroke();
      }

      for (const node of nodes) {
        const pos = nodePosition(node, time);
        node.positions = pos;
        const degree = activeDegree.get(node.key) || 0;
        const highlighted =
          node.key === selection.focus || node.key === selection.opponent;
        const hovered = node === hoveredNode;
        const baseAlpha = degree ? 0.68 : 0.16;

        if (highlighted) {
          const glow = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, 14);
          glow.addColorStop(0, "rgba(156, 63, 52, 0.3)");
          glow.addColorStop(1, "rgba(156, 63, 52, 0)");
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, 14, 0, Math.PI * 2);
          ctx.fill();
        }

        const color =
          node.person === "li"
            ? `rgba(55, 82, 69, ${baseAlpha})`
            : `rgba(119, 78, 63, ${baseAlpha})`;
        ctx.beginPath();
        ctx.fillStyle = highlighted ? "rgba(145, 52, 42, 0.96)" : color;
        ctx.arc(
          pos.x,
          pos.y,
          node.radius + (hovered ? 2.8 : highlighted ? 2.3 : 0),
          0,
          Math.PI * 2,
        );
        ctx.fill();

        if (hovered && !highlighted) {
          ctx.strokeStyle = "rgba(45, 62, 52, 0.5)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, node.radius + 4.5, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    function animate(time) {
      if (visible) draw(time);
      animationFrame = requestAnimationFrame(animate);
    }

    function nearestNode(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      let best = null;
      let bestDistance = 15;

      for (const node of nodes) {
        const dx = node.positions.x - x;
        const dy = node.positions.y - y;
        const distance = Math.hypot(dx, dy);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = node;
        }
      }
      return best;
    }

    function positionTooltip(clientX, clientY, node) {
      const rect = stage.getBoundingClientRect();
      const x = Math.max(12, Math.min(rect.width - 286, clientX - rect.left + 16));
      const y = Math.max(12, Math.min(rect.height - 116, clientY - rect.top - 18));
      tooltip.style.left = `${x}px`;
      tooltip.style.top = `${y}px`;
      tooltip.innerHTML = "";

      const title = document.createElement("strong");
      title.textContent = node.title;
      const meta = document.createElement("span");
      meta.textContent = `${people[node.person].name} · 诗号 ${node.pid} · ${node.lineCount} 句`;
      const stats = document.createElement("small");
      stats.textContent = `关联 ${node.pairCount} 首 · ${node.degree} 条关系 · 最高 ${formatScore(node.maxScore)}%`;
      tooltip.append(title, meta, stats);
      tooltip.hidden = false;
    }

    canvas.addEventListener("pointermove", (event) => {
      const node = nearestNode(event.clientX, event.clientY);
      hoveredNode = node;
      if (node) {
        canvas.style.cursor = "pointer";
        positionTooltip(event.clientX, event.clientY, node);
      } else {
        canvas.style.cursor = "crosshair";
        tooltip.hidden = true;
      }
    });

    canvas.addEventListener("pointerleave", () => {
      hoveredNode = null;
      tooltip.hidden = true;
      canvas.style.cursor = "crosshair";
    });

    canvas.addEventListener("pointerup", (event) => {
      const node = nearestNode(event.clientX, event.clientY);
      if (!node) return;
      selectPoem(node.person, node.pid);
    });

    const resizeObserver = new ResizeObserver(() => {
      resize();
      draw(performance.now());
    });
    resizeObserver.observe(stage);

    const visibilityObserver = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
      },
      { rootMargin: "120px" },
    );
    visibilityObserver.observe(stage);

    document.addEventListener("visibilitychange", () => {
      visible = !document.hidden;
    });

    resize();
    refreshGraphEdges();
    animationFrame = requestAnimationFrame(animate);

    window.setTimeout(() => {
      ready = true;
      stage.classList.add("is-ready");
    }, 450);

    return {
      refresh() {
        refreshGraphEdges();
        draw(performance.now());
      },
      setSelection(liKey, duKey) {
        selection = { focus: state.focusPerson === "li" ? liKey : duKey, opponent: state.focusPerson === "li" ? duKey : liKey };
        draw(performance.now());
      },
      destroy() {
        cancelAnimationFrame(animationFrame);
        resizeObserver.disconnect();
        visibilityObserver.disconnect();
      },
      isReady() {
        return ready;
      },
    };
  }

  function updateThreshold(value, announce = false) {
    state.threshold = Number(value);
    const range = $("#scoreRange");
    range.value = String(state.threshold);
    range.style.setProperty(
      "--range-progress",
      `${((state.threshold - 7000) / 2000) * 100}%`,
    );
    $("#scoreOutput").textContent = formatScore(state.threshold);

    const pairCount = poemPairs.filter(
      (pair) => pair.maxScore >= state.threshold,
    ).length;
    const edgeCount = edgeList.filter(
      (edge) => edge.score >= state.threshold,
    ).length;

    $("#graphPairCount").textContent = formatCount(pairCount);
    $("#graphEdgeCount").textContent = formatCount(edgeCount);
    graphController?.refresh();

    if (announce) {
      showToast(`已显示 ${formatScore(state.threshold)} 分以上的关系`);
    }
  }

  function buildSearchRecords() {
    const records = [];
    for (const person of ["li", "du"]) {
      for (const poem of poemIndex[person].values()) {
        for (const [sid, text] of poem.lines) {
          const relations = lineRelations[person].get(lineKey(person, poem.pid, sid));
          if (!relations?.length) continue;
          records.push({
            person,
            pid: poem.pid,
            sid,
            title: poem.title,
            text,
            relations,
          });
        }
      }
    }
    return records;
  }

  const searchRecords = buildSearchRecords();

  function appendHighlightedText(container, text, query) {
    if (!query) {
      container.textContent = text;
      return;
    }
    const index = text.indexOf(query);
    if (index === -1) {
      container.textContent = text;
      return;
    }
    container.append(document.createTextNode(text.slice(0, index)));
    const mark = document.createElement("mark");
    mark.textContent = text.slice(index, index + query.length);
    container.append(mark, document.createTextNode(text.slice(index + query.length)));
  }

  function hideSearchResults() {
    $("#searchResults").hidden = true;
    $("#searchInput").setAttribute("aria-expanded", "false");
    searchActiveIndex = -1;
  }

  function setSearchActive(index) {
    const buttons = $$(".search-result", $("#searchResults"));
    if (!buttons.length) return;
    searchActiveIndex = (index + buttons.length) % buttons.length;
    buttons.forEach((button, buttonIndex) => {
      button.classList.toggle("is-active", buttonIndex === searchActiveIndex);
      button.setAttribute(
        "aria-selected",
        buttonIndex === searchActiveIndex ? "true" : "false",
      );
    });
    buttons[searchActiveIndex].scrollIntoView({ block: "nearest" });
  }

  function renderSearchResults(query) {
    const results = $("#searchResults");
    const normalized = query.trim();
    searchMatches = [];

    if (!normalized) {
      hideSearchResults();
      return;
    }

    const lower = normalized.toLocaleLowerCase("zh-CN");
    const scored = [];

    for (const record of searchRecords) {
      const text = record.text.toLocaleLowerCase("zh-CN");
      const title = record.title.toLocaleLowerCase("zh-CN");
      const textIndex = text.indexOf(lower);
      const titleIndex = title.indexOf(lower);
      if (textIndex === -1 && titleIndex === -1) continue;

      const firstRelation = record.relations[0];
      let relevance = textIndex >= 0 ? 100 - Math.min(textIndex, 60) : 40;
      if (text === lower) relevance += 40;
      if (record.relations.length > 1) relevance += Math.min(10, record.relations.length);
      if (titleIndex >= 0) relevance += 5;
      scored.push({ record, relevance });
    }

    scored.sort(
      (a, b) =>
        b.relevance - a.relevance ||
        b.record.relations[0].score - a.record.relations[0].score ||
        a.record.text.length - b.record.text.length,
    );
    searchMatches = scored.slice(0, 12).map((item) => item.record);

    if (!searchMatches.length) {
      const empty = document.createElement("p");
      empty.className = "search-empty";
      empty.textContent = "暂未在互文诗句中找到这个关键词";
      results.replaceChildren(empty);
      results.hidden = false;
      $("#searchInput").setAttribute("aria-expanded", "true");
      return;
    }

    const fragment = document.createDocumentFragment();
    searchMatches.forEach((record, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "search-result";
      button.id = `search-result-${index}`;
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", "false");

      const author = document.createElement("span");
      author.className = "search-author";
      author.textContent = people[record.person].name;

      const copy = document.createElement("span");
      copy.className = "search-result-copy";

      const line = document.createElement("span");
      line.className = "search-line";
      appendHighlightedText(line, record.text, normalized);

      const meta = document.createElement("span");
      meta.className = "search-meta";
      const title = document.createElement("span");
      title.textContent = `《${record.title}》`;
      const count = document.createElement("span");
      count.textContent = `${record.relations.length} 条互文`;
      meta.append(title, count);

      const relation = record.relations[0];
      const relatedText =
        record.person === "li"
          ? getPoem("du", relation.duPid).lineMap.get(relation.duSid)
          : getPoem("li", relation.liPid).lineMap.get(relation.liSid);
      const related = document.createElement("span");
      related.className = "search-related";
      related.textContent = `${relatedText} · ${formatScore(relation.score)}%`;

      copy.append(line, meta, related);
      button.append(author, copy);
      button.addEventListener("click", () => {
        const edge = record.relations[0];
        setPairFromEdge(edge.id, record.person, { scroll: true });
        $("#searchInput").blur();
        hideSearchResults();
      });
      fragment.append(button);
    });

    results.replaceChildren(fragment);
    results.hidden = false;
    $("#searchInput").setAttribute("aria-expanded", "true");
    setSearchActive(0);
  }

  function debounce(callback, delay) {
    let timer = 0;
    return (...args) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => callback(...args), delay);
    };
  }

  const debouncedSearch = debounce((value) => renderSearchResults(value), 90);

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.classList.remove("is-visible");
    }, 2300);
  }

  function bindSearch() {
    const form = $("#searchForm");
    const input = $("#searchInput");
    const clear = $("#searchClear");

    input.addEventListener("input", () => {
      clear.classList.toggle("is-visible", Boolean(input.value));
      debouncedSearch(input.value);
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSearchActive(searchActiveIndex + 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setSearchActive(searchActiveIndex - 1);
      } else if (event.key === "Enter") {
        const active = $(".search-result.is-active", $("#searchResults"));
        if (active) {
          event.preventDefault();
          active.click();
        }
      } else if (event.key === "Escape") {
        hideSearchResults();
        input.blur();
      }
    });

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const active = $(".search-result.is-active", $("#searchResults"));
      if (active) active.click();
      else renderSearchResults(input.value);
    });

    clear.addEventListener("click", () => {
      input.value = "";
      clear.classList.remove("is-visible");
      hideSearchResults();
      input.focus();
    });

    document.addEventListener("pointerdown", (event) => {
      if (!form.contains(event.target)) hideSearchResults();
    });

    document.addEventListener("focusin", (event) => {
      if (!form.contains(event.target)) hideSearchResults();
    });
  }

  function bindControls() {
    $("#scoreRange").addEventListener("input", (event) => {
      updateThreshold(event.target.value);
    });

    $("#useStrongButton").addEventListener("click", () => {
      updateThreshold(8500, true);
    });

    $("#relatedSelect").addEventListener("change", (event) => {
      setPoemPair(
        state.focusPerson,
        state.focusPid,
        Number(event.target.value),
      );
    });

    $("#liPoemLines").addEventListener("scroll", drawThreads, { passive: true });
    $("#duPoemLines").addEventListener("scroll", drawThreads, { passive: true });
    window.addEventListener("resize", drawThreads);

    const openAbout = () => {
      const dialog = $("#aboutDialog");
      if (typeof dialog.showModal === "function") dialog.showModal();
    };
    $("#aboutOpen").addEventListener("click", openAbout);
    $("#aboutClose").addEventListener("click", () => $("#aboutDialog").close());
    $("#aboutDialog").addEventListener("click", (event) => {
      if (event.target === $("#aboutDialog")) $("#aboutDialog").close();
    });

    $("#emptyBackButton").addEventListener("click", () => {
      $("#constellation").scrollIntoView({
        behavior: reducedMotion ? "auto" : "smooth",
      });
    });
  }

  function bindReveal() {
    const elements = $$(".reveal");
    if (!("IntersectionObserver" in window) || reducedMotion) {
      elements.forEach((element) => element.classList.add("is-visible"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: "0px 0px -7% 0px" },
    );

    elements.forEach((element) => observer.observe(element));
  }

  function bindAtmosphere() {
    if (reducedMotion) return;
    const root = document.documentElement;
    const hero = $("#top");
    let frame = 0;

    const updateScroll = () => {
      frame = 0;
      const progress = hero
        ? Math.min(1.6, Math.max(0, window.scrollY / Math.max(1, hero.offsetHeight)))
        : 0;
      root.style.setProperty("--hero-scroll", progress.toFixed(3));
    };

    window.addEventListener(
      "scroll",
      () => {
        if (!frame) frame = requestAnimationFrame(updateScroll);
      },
      { passive: true },
    );

    if (hero && window.matchMedia("(pointer: fine)").matches) {
      hero.addEventListener(
        "pointermove",
        (event) => {
          const rect = hero.getBoundingClientRect();
          const x = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
          const y = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
          root.style.setProperty("--pointer-x", x.toFixed(3));
          root.style.setProperty("--pointer-y", y.toFixed(3));
        },
        { passive: true },
      );

      hero.addEventListener("pointerleave", () => {
        root.style.setProperty("--pointer-x", "0");
        root.style.setProperty("--pointer-y", "0");
      });
    }

    updateScroll();
  }

  function init() {
    fillDataSummary();
    bindSearch();
    bindControls();
    bindReveal();
    bindAtmosphere();

    graphController = createGraph();
    updateThreshold(8000);

    const firstEdge = edgeList.find(
      (edge) => edge.liPid === 114 && edge.duPid === 41003 && edge.liSid === 1,
    ) || edgeList[0];

    setPairFromEdge(firstEdge.id, "li");

    document.documentElement.dataset.ready = "true";
  }

  init();
})();
