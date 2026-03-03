const METRICS_KEY = "tri_metrics_v2";
const CHECKS_KEY_PREFIX = "tri_checks_v2_week_";

function parseISODate(s){
  const [y,m,d] = (s || "").split("-").map(n => parseInt(n, 10));
  if(!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function startOfDay(dt){
  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
}

function daysBetween(a, b){
  const ms = startOfDay(b) - startOfDay(a);
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function weekIndexFromStart(planStartDate, today){
  const day = daysBetween(planStartDate, today);
  return Math.max(0, Math.floor(day / 7));
}

function parseCSV(text){
  const lines = text.split(/\r?\n/).filter(l => l.trim().length);
  if(lines.length < 2) return [];

  const header = splitCSVLine(lines[0]).map(h => h.trim());
  const rows = [];

  for(let i=1;i<lines.length;i++){
    const cols = splitCSVLine(lines[i]);
    const obj = {};
    header.forEach((h, idx) => obj[h] = (cols[idx] ?? "").trim());
    rows.push(obj);
  }
  return rows;
}

function splitCSVLine(line){
  const out = [];
  let cur = "";
  let inQ = false;
  for(let i=0;i<line.length;i++){
    const c = line[i];
    if(c === '"'){ inQ = !inQ; continue; }
    if(c === "," && !inQ){ out.push(cur); cur=""; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

function loadLocalMetrics(defaults){
  const raw = localStorage.getItem(METRICS_KEY);
  if(!raw) return defaults;
  try { return { ...defaults, ...JSON.parse(raw) }; }
  catch { return defaults; }
}

function saveLocalMetrics(m){
  localStorage.setItem(METRICS_KEY, JSON.stringify(m));
}

function loadChecks(weekKey){
  const raw = localStorage.getItem(CHECKS_KEY_PREFIX + weekKey);
  if(!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

function saveChecks(weekKey, checks){
  localStorage.setItem(CHECKS_KEY_PREFIX + weekKey, JSON.stringify(checks));
}

function formatCSS(sec){
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2,"0")}`;
}

function ftpRange(ftp, lo, hi){
  const a = Math.round(ftp * lo);
  const b = Math.round(ftp * hi);
  return `${Math.round(lo*100)} to ${Math.round(hi*100)} percent FTP (${a} to ${b}w)`;
}

function paceFromSeconds(secPerMile){
  const m = Math.floor(secPerMile / 60);
  const s = Math.round(secPerMile % 60);
  return `${m}:${String(s).padStart(2,"0")}/mi`;
}

function paceRange(baseSecPerMile, addLo, addHi){
  const lo = baseSecPerMile + addLo;
  const hi = baseSecPerMile + addHi;
  return `${paceFromSeconds(lo)} to ${paceFromSeconds(hi)}`;
}

function fiveKPaceSecPerMile(fiveKMinutes){
  const miles = 3.106856;
  const totalSec = fiveKMinutes * 60;
  return totalSec / miles;
}

function cleanWeirdText(s){
  return (s || "")
    .replaceAll("â€“", "–")
    .replaceAll("â†’", "→")
    .replaceAll("â€™", "’")
    .trim();
}

function getWeekNum(row){
  const raw = row["Week"];
  if(raw === undefined || raw === null) return null;
  const n = parseInt(String(raw).trim(), 10);
  return Number.isFinite(n) ? n : null;
}

function init(){
  Promise.all([
    fetch("./data/workouts.csv").then(r => r.text()),
    fetch("./data/metrics.json").then(r => r.json())
  ]).then(([csvText, defaultMetrics]) => {
    const workouts = parseCSV(csvText).map(r => {
      Object.keys(r).forEach(k => r[k] = cleanWeirdText(r[k]));
      return r;
    });

    const metrics = loadLocalMetrics(defaultMetrics);

    const ftpInput = document.getElementById("ftp");
    const fivekInput = document.getElementById("fivek");
    const cssInput = document.getElementById("css");

    ftpInput.value = metrics.ftp;
    fivekInput.value = metrics.fiveK_time_minutes;
    cssInput.value = metrics.css_per_100_seconds;

    const weekNums = Array.from(
      new Set(workouts.map(getWeekNum).filter(n => n !== null))
    ).sort((a,b) => a - b);

    if(weekNums.length === 0){
      document.getElementById("summary").innerHTML = "No weeks found. Your CSV Week column is busted.";
      return;
    }

    const maxWeek = Math.max(...weekNums);

    const weekOptions = weekNums.map(n => {
      const label = (n === maxWeek) ? "Race Week" : `Week ${n + 1}`;
      const key = String(n);
      return { key, label, num: n };
    });

    const weekSelect = document.getElementById("weekSelect");
    weekSelect.innerHTML = "";
    weekOptions.forEach(w => {
      const opt = document.createElement("option");
      opt.value = w.key;
      opt.textContent = w.label;
      weekSelect.appendChild(opt);
    });

    const today = new Date();
    const planStart = parseISODate(defaultMetrics.plan_start_date);

    let suggestedNum = weekOptions[0].num;
    if(planStart){
      const idx = weekIndexFromStart(planStart, today);
      const clamped = Math.min(maxWeek, Math.max(0, idx));
      suggestedNum = clamped;
    }

    const suggestedKey = String(suggestedNum);
    weekSelect.value = suggestedKey;

    function intensityTextForRule(type, rule, m){
      const t = (type || "").toUpperCase().trim();
      const r = (rule || "").trim();

      if(t === "FTP"){
        if(r === "FTP:TEST") return "FTP test, 20 minute max effort";
        if(r === "FTP:0.65-0.75") return ftpRange(m.ftp, 0.65, 0.75);
        if(r === "FTP:0.80-0.90") return ftpRange(m.ftp, 0.80, 0.90);
        if(r === "FTP:0.90-1.00") return ftpRange(m.ftp, 0.90, 1.00);
        if(r === "FTP:0.95-1.00") return ftpRange(m.ftp, 0.95, 1.00);
        if(r === "FTP:0.95-1.05") return ftpRange(m.ftp, 0.95, 1.05);
        if(r === "FTP:1.05-1.15") return ftpRange(m.ftp, 1.05, 1.15);
        if(r === "FTP:1.05-1.10") return ftpRange(m.ftp, 1.05, 1.10);
        if(r === "FTP:1.20-1.40") return ftpRange(m.ftp, 1.20, 1.40);
        if(r === "FTP:0.80-0.85") return ftpRange(m.ftp, 0.80, 0.85);
        if(r === "FTP:0.60-0.70") return ftpRange(m.ftp, 0.60, 0.70);
        if(r === "FTP:0.85-1.05") return ftpRange(m.ftp, 0.85, 1.05);
      }

      if(t === "CSS"){
        const base = m.css_per_100_seconds;

        if(r === "CSS:TEST" || r === "CSS:TT") return "CSS test, update CSS after";
        if(r === "CSS:RACE") return `Race effort around ${formatCSS(base)} per 100`;
        if(r === "CSS:0") return `CSS steady around ${formatCSS(base)} per 100`;

        const match = r.match(/CSS:([+-]?\d+)-([+-]?\d+)/);
        if(match){
          const a = parseInt(match[1], 10);
          const b = parseInt(match[2], 10);
          const lo = base + a;
          const hi = base + b;
          return `${formatCSS(lo)} to ${formatCSS(hi)} per 100`;
        }

        if(r === "CSS:SHARP") return "Short sharp efforts, faster than CSS";
        if(r === "CSS:BUILD") return "Build within set from steady to faster than CSS";
        if(r === "CSS:MIXED" || r === "MIXED") return "Mixed CSS efforts";
      }

      if(t === "RUN_PACE" || t === "FTP/RUN" || t === "FTP/RUN_PACE"){
        const base = fiveKPaceSecPerMile(m.fiveK_time_minutes);

        if(r === "RUN:TEST" || r === "RUN:TT") return "Time trial, hard controlled effort";

        if(r === "RUN:5K") return `5K pace around ${paceRange(base, -5, 10)}`;
        if(r === "RUN:THRESHOLD") return `Threshold pace around ${paceRange(base, 25, 45)}`;
        if(r === "RUN:AEROBIC") return `Aerobic pace around ${paceRange(base, 75, 120)}`;
        if(r === "RUN:RECOVERY") return `Recovery pace around ${paceRange(base, 110, 150)}`;
        if(r === "RUN:RELAXED") return `Easy relaxed pace around ${paceRange(base, 90, 140)}`;

        if(r === "RUN:RACE70.3" || r === "RACE70.3") return `70.3 pace around ${paceRange(base, 45, 70)}`;

        if(r === "RUN:MIXED") return `Mixed run, threshold to 5K pace zones based on your 5K`;
        if(r.startsWith("RUN:7:")) return `Target pace ${r.replace("RUN:", "")}/mi`;
      }

      return "";
    }

    function sectionIntensity(row, section, m){
      const type = row["Intensity Type"] || "";
      const fallback = row["Intensity Rule"] || "";

      let rule = fallback;
      if(section === "warm") rule = row["Warm Up Intensity Rule"] || fallback;
      if(section === "main") rule = row["Main Set Intensity Rule"] || fallback;
      if(section === "cool") rule = row["Cool Down Intensity Rule"] || fallback;

      const computed = intensityTextForRule(type, rule, m);
      if(computed) return computed;

      const display = row["Intensity Display"] || row["Intensity Guidance (%)"] || "";
      return display;
    }

    function render(){
      const weekKey = weekSelect.value;
      const weekNum = parseInt(weekKey, 10);

      const m = {
        ftp: parseFloat(ftpInput.value || metrics.ftp),
        fiveK_time_minutes: parseFloat(fivekInput.value || metrics.fiveK_time_minutes),
        css_per_100_seconds: parseInt(cssInput.value || metrics.css_per_100_seconds, 10)
      };

      const checks = loadChecks(weekKey);
      const weekWorkouts = workouts.filter(w => getWeekNum(w) === weekNum);

      const doneCount = weekWorkouts.filter(w => checks[w["Workout ID"]] === true).length;

      const labelObj = weekOptions.find(x => x.key === weekKey);
      const weekLabel = labelObj ? labelObj.label : `Week ${weekNum + 1}`;

      const suggestedLabelObj = weekOptions.find(x => x.key === suggestedKey);
      const suggestedLabel = suggestedLabelObj ? suggestedLabelObj.label : "";

      document.getElementById("summary").innerHTML = `
        <div class="kpi">
          <span>Week: ${weekLabel}</span>
          ${suggestedLabel ? `<span>Suggested: ${suggestedLabel}</span>` : ``}
          <span>Workouts: ${doneCount}/${weekWorkouts.length}</span>
          <span>FTP: ${m.ftp}w</span>
          <span>5K: ${m.fiveK_time_minutes} min</span>
          <span>CSS: ${formatCSS(m.css_per_100_seconds)} per 100</span>
        </div>
      `;

      const list = document.getElementById("list");
      list.innerHTML = "";

      weekWorkouts.forEach(w => {
        const id = w["Workout ID"];
        const title = w["Session Type"] || "";
        const sport = w["Sport"] || "";
        const totalDur = w["Total Duration"] || "";
        const totalDist = w["Total Distance"] || "";

        const warmText = w["Warm Up"] || "";
        const mainText = w["Workout Description (Original Structure)"] || "";
        const coolText = w["Cool Down"] || "";
        const restText = w["Recovery Rest"] || "";

        const warmIntensity = sectionIntensity(w, "warm", m);
        const mainIntensity = sectionIntensity(w, "main", m);
        const coolIntensity = sectionIntensity(w, "cool", m);

        const item = document.createElement("div");
        item.className = "item";

        item.innerHTML = `
          <div class="itemTop">
            <div>
              <div class="badge">${sport}</div>
              <div class="title">${title}</div>
              <div class="small">ID ${id}</div>
              ${totalDur || totalDist ? `<div class="small">${[totalDur, totalDist].filter(Boolean).join(" , ")}</div>` : ``}
            </div>
          </div>

          ${warmText ? `<div class="small"><b>Warm up</b> ${warmText}${warmIntensity ? ` <span class="muted">(${warmIntensity})</span>` : ``}</div>` : ``}

          ${mainText ? `<div class="small"><b>Main set</b> ${mainText}${mainIntensity ? ` <span class="muted">(${mainIntensity})</span>` : ``}</div>` : ``}

          ${restText ? `<div class="small"><b>Rest</b> ${restText}</div>` : ``}

          ${coolText ? `<div class="small"><b>Cool down</b> ${coolText}${coolIntensity ? ` <span class="muted">(${coolIntensity})</span>` : ``}</div>` : ``}

          <label class="check">
            <input type="checkbox" ${checks[id] ? "checked" : ""} />
            Completed
          </label>
        `;

        const cb = item.querySelector("input[type=checkbox]");
        cb.addEventListener("change", () => {
          checks[id] = cb.checked;
          saveChecks(weekKey, checks);
          render();
        });

        list.appendChild(item);
      });
    }

    document.getElementById("saveMetrics").addEventListener("click", () => {
      const m = {
        ftp: parseFloat(ftpInput.value),
        fiveK_time_minutes: parseFloat(fivekInput.value),
        css_per_100_seconds: parseInt(cssInput.value, 10)
      };
      saveLocalMetrics(m);
      render();
    });

    document.getElementById("resetChecks").addEventListener("click", () => {
      const weekKey = weekSelect.value;
      localStorage.removeItem(CHECKS_KEY_PREFIX + weekKey);
      render();
    });

    weekSelect.addEventListener("change", render);
    ftpInput.addEventListener("input", render);
    fivekInput.addEventListener("input", render);
    cssInput.addEventListener("input", render);

    render();
  }).catch(err => {
    document.body.innerHTML = `<pre style="padding:16px;white-space:pre-wrap;">Error loading files: ${String(err)}</pre>`;
  });
}

init();