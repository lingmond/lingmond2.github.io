const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const sourceDir = path.join(root, "李杜", "李杜");
const outputFile = path.join(root, "assets", "js", "data.js");

function parseCsv(source) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];

    if (char === '"') {
      if (quoted && next === '"') {
        field += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (char === "," && !quoted) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(field);
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((value) => value.length > 0)) rows.push(row);
  }

  return rows;
}

function readCsv(name) {
  const file = path.join(sourceDir, name);
  return parseCsv(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function buildPoems(rows, expectedHeader, author) {
  const poems = {};
  const lineLookup = new Map();

  for (const row of rows) {
    if (row.length < 4) continue;
    const title = row[0].trim();
    const text = row[1].trim();
    const poemId = Number.parseInt(row[2], 10);
    const lineId = Number.parseInt(row[3], 10);

    if (
      title === expectedHeader[0] ||
      !Number.isFinite(poemId) ||
      !Number.isFinite(lineId)
    ) {
      continue;
    }

    if (!poems[poemId]) {
      poems[poemId] = { id: poemId, title: title || "无题", lines: [] };
    }

    const dedupeKey = `${poemId}:${lineId}`;
    if (lineLookup.has(dedupeKey)) continue;

    poems[poemId].lines.push([lineId, text]);
    lineLookup.set(dedupeKey, text);
  }

  for (const poem of Object.values(poems)) {
    poem.lines.sort((a, b) => a[0] - b[0]);
  }

  return { poems, lineLookup, author };
}

const liRows = readCsv("李白.csv");
const duRows = readCsv("杜甫.csv");
const relationRows = readCsv("李白-杜甫.csv");

const li = buildPoems(liRows, ["题目", "诗句", "诗歌ID", "诗句ID"], "李白");
const du = buildPoems(duRows, ["题目", "诗句", "诗歌ID", "诗句ID"], "杜甫");

const edges = [];
const edgeKeys = new Set();
let invalidEdges = 0;
let textMismatches = 0;

for (const row of relationRows) {
  if (row.length < 11) continue;

  const score = Number.parseInt(row[6], 10);
  const liPoemId = Number.parseInt(row[7], 10);
  const liLineId = Number.parseInt(row[8], 10);
  const duPoemId = Number.parseInt(row[9], 10);
  const duLineId = Number.parseInt(row[10], 10);

  if (![score, liPoemId, liLineId, duPoemId, duLineId].every(Number.isFinite)) {
    continue;
  }

  const liPoem = li.poems[liPoemId];
  const duPoem = du.poems[duPoemId];
  const liLine = liPoem?.lines.find((line) => line[0] === liLineId);
  const duLine = duPoem?.lines.find((line) => line[0] === duLineId);

  if (!liLine || !duLine) {
    invalidEdges += 1;
    continue;
  }

  if (liLine[1] !== row[2] || duLine[1] !== row[5]) {
    textMismatches += 1;
  }

  const key = `${liPoemId}:${liLineId}:${duPoemId}:${duLineId}`;
  if (edgeKeys.has(key)) continue;

  edgeKeys.add(key);
  edges.push([liPoemId, liLineId, duPoemId, duLineId, score]);
}

const lineCount = (poems) =>
  Object.values(poems).reduce((total, poem) => total + poem.lines.length, 0);

const connectedLi = new Set();
const connectedDu = new Set();
for (const [liPoemId, , duPoemId] of edges) {
  connectedLi.add(liPoemId);
  connectedDu.add(duPoemId);
}

const payload = {
  meta: {
    title: "李杜互文",
    generatedBy: "scripts/preprocess.js",
    relationCount: edges.length,
    liPoemCount: Object.keys(li.poems).length,
    duPoemCount: Object.keys(du.poems).length,
    liLineCount: lineCount(li.poems),
    duLineCount: lineCount(du.poems),
    connectedLiPoemCount: connectedLi.size,
    connectedDuPoemCount: connectedDu.size,
    minScore: 7000,
    maxScore: 10000,
    invalidEdges,
    textMismatches,
  },
  poems: {
    li: li.poems,
    du: du.poems,
  },
  edges,
};

fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(
  outputFile,
  `window.LIDU_DATA = ${JSON.stringify(payload)};\n`,
  "utf8",
);

console.log(
  JSON.stringify(
    {
      output: path.relative(root, outputFile),
      bytes: fs.statSync(outputFile).size,
      ...payload.meta,
    },
    null,
    2,
  ),
);
