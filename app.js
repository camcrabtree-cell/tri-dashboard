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
    .replaceAll("‚Äì", "–")
    .replaceAll("‚Üí", "→")
    .replaceAll("â€\"", "—")
    .replaceAll("â€²", "'")
    .replaceAll("â€³", '"')
    .replaceAll("�", "")
    .trim();
}

function getWeekNum(row){
  const raw = row["Week"];
  if(raw === undefined || raw === null) return null;
  const n = parseInt(String(raw).trim(), 10);
  return Number.isFinite(n) ? n : null;
}

function roundToNearest(value, step){
  if(!Number.isFinite(value)) return 0;
  return Math.round(value / step) * step;
}

function parseDurationMinutes(s){
  const raw = cleanWeirdText(s || "").toLowerCase();
  if(!raw) return null;

  const rangeMinMatch = raw.match(/(\d+(?:\.\d+)?)\s*[–-]\s*(\d+(?:\.\d+)?)\s*min/);
  if(rangeMinMatch){
    const a = parseFloat(rangeMinMatch[1]);
    const b = parseFloat(rangeMinMatch[2]);
    return (a + b) / 2;
  }

  const singleMinMatch = raw.match(/(\d+(?:\.\d+)?)\s*min/);
  if(singleMinMatch){
    return parseFloat(singleMinMatch[1]);
  }

  const hourColonMatch = raw.match(/(\d+)\s*:\s*(\d+)\s*hr/);
  if(hourColonMatch){
    const h = parseInt(hourColonMatch[1], 10);
    const m = parseInt(hourColonMatch[2], 10);
    return h * 60 + m;
  }

  const singleHourMatch = raw.match(/(\d+(?:\.\d+)?)\s*hr/);
  if(singleHourMatch){
    return parseFloat(singleHourMatch[1]) * 60;
  }

  return null;
}

function parseDistanceParts(s){
  const raw = cleanWeirdText(s || "").toLowerCase();
  if(!raw) return [];

  const parts = raw.split("+").map(x => x.trim()).filter(Boolean);
  const out = [];

  for(const part of parts){
    const match = part.match(/(\d+(?:\.\d+)?)\s*(km|m)\b/);
    if(match){
      out.push({
        value: parseFloat(match[1]),
        unit: match[2]
      });
    }
  }

  return out;
}

function getSessionLabel(row){
  return cleanWeirdText((row["Session Type"] || "") + " " + (row["Workout Type"] || ""));
}

function getRunPaceSecPerMileForRule(row, metrics){
  const base5k = fiveKPaceSecPerMile(metrics.fiveK_time_minutes);
  const rule = cleanWeirdText(row["Intensity Rule"] || "");
  const session = getSessionLabel(row).toLowerCase();

  if(rule === "RUN:THRESHOLD" || session.includes("threshold") || session.includes("tempo")){
    return base5k + 35;
  }
  if(rule === "RUN:RACE70.3" || rule === "RACE70.3" || session.includes("race pace")){
    return base5k + 55;
  }
  if(rule === "RUN:RECOVERY"){
    return base5k + 130;
  }
  if(rule === "RUN:RELAXED"){
    return base5k + 115;
  }
  if(rule === "RUN:AEROBIC" || session.includes("aerobic")){
    return base5k + 100;
  }
  if(rule === "RUN:5K" || session.includes("interval") || session.includes("speed")){
    return base5k;
  }
  if(rule.startsWith("RUN:7:")){
    const paceText = rule.replace("RUN:", "");
    const m = paceText.match(/(\d+):(\d+)/);
    if(m){
      return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    }
  }

  return base5k + 100;
}

function classifyWorkoutIntensity(row){
  const sport = cleanWeirdText(row["Sport"] || "").toLowerCase();
  const session = getSessionLabel(row).toLowerCase();
  const rule = cleanWeirdText(row["Intensity Rule"] || "").toUpperCase();

  if(sport === "brick") return "hard";

  if(
    session.includes("time trial") ||
    session.includes("threshold") ||
    session.includes("interval") ||
    session.includes("speed") ||
    session.includes("over/under") ||
    session.includes("climb") ||
    session.includes("hill")
  ){
    return "hard";
  }

  if(
    session.includes("tempo") ||
    session.includes("race pace") ||
    rule.includes("TEST") ||
    rule.includes("TT") ||
    rule.includes("RACE70.3")
  ){
    return "moderate";
  }

  if(
    session.includes("aerobic") ||
    session.includes("endurance") ||
    session.includes("steady") ||
    session.includes("recovery") ||
    session.includes("easy")
  ){
    return "easy";
  }

  return "moderate";
}

function estimateSwimMinutes(row, metrics){
  const parts = parseDistanceParts(row["Total Distance"] || "");
  const swimPart = parts.find(p => p.unit === "m");
  if(!swimPart) return null;

  const baseMinutes = ((swimPart.value / 100) * metrics.css_per_100_seconds) / 60;
  const session = getSessionLabel(row).toLowerCase();

  if(session.includes("time trial")) return baseMinutes;
  if(session.includes("interval")) return baseMinutes * 1.18;
  if(session.includes("mixed")) return baseMinutes * 1.15;
  if(session.includes("technique")) return baseMinutes * 1.08;
  if(session.includes("steady")) return baseMinutes * 1.08;
  if(session.includes("endurance")) return baseMinutes * 1.08;
  return baseMinutes * 1.05;
}

function estimateRunMinutes(row, metrics){
  const parts = parseDistanceParts(row["Total Distance"] || "");
  const runPart = parts.find(p => p.unit === "km");
  if(!runPart) return null;

  const secPerMile = getRunPaceSecPerMileForRule(row, metrics);
  const miles = runPart.value * 0.621371;
  return (miles * secPerMile) / 60;
}

function estimateBikeMinutes(row){
  const parts = parseDistanceParts(row["Total Distance"] || "");
  const bikePart = parts.find(p => p.unit === "km");
  if(!bikePart) return null;

  const intensity = classifyWorkoutIntensity(row);
  const session = getSessionLabel(row).toLowerCase();

  let kmh = 29;

  if(intensity === "easy") kmh = 28;
  if(intensity === "moderate") kmh = 30.5;
  if(intensity === "hard") kmh = 32;

  if(session.includes("aerobic long")) kmh = 28;
  if(session.includes("aerobic")) kmh = 28.5;
  if(session.includes("race pace")) kmh = 31;
  if(session.includes("tempo long")) kmh = 30.5;
  if(session.includes("threshold")) kmh = 31;
  if(session.includes("climb")) kmh = 27.5;
  if(session.includes("over/under")) kmh = 30;
  if(session.includes("time trial")) kmh = 31.5;

  return (bikePart.value / kmh) * 60;
}

function estimateBrickMinutes(row, metrics){
  const parts = parseDistanceParts(row["Total Distance"] || "");
  if(parts.length < 2) return null;

  const bikePart = parts.find(p => p.unit === "km");
  const runParts = parts.filter(p => p.unit === "km");
  if(!bikePart || runParts.length < 2) return null;

  const bikeKm = runParts[0].value;
  const runKm = runParts[1].value;

  const bikeMinutes = (bikeKm / 31) * 60;
  const runMiles = runKm * 0.621371;
  const runSecPerMile = fiveKPaceSecPerMile(metrics.fiveK_time_minutes) + 55;
  const runMinutes = (runMiles * runSecPerMile) / 60;

  return bikeMinutes + runMinutes;
}

function estimateWorkoutMinutes(row, metrics){
  const direct = parseDurationMinutes(row["Total Duration"] || "");
  if(direct !== null) return direct;

  const sport = cleanWeirdText(row["Sport"] || "").toLowerCase();

  if(sport === "swim") return estimateSwimMinutes(row, metrics);
  if(sport === "run") return estimateRunMinutes(row, metrics);
  if(sport === "bike") return estimateBikeMinutes(row);
  if(sport === "brick") return estimateBrickMinutes(row, metrics);

  return null;
}

function getRateRanges(sport, intensity){
  const s = (sport || "").toLowerCase();
  const i = intensity;

  if(s === "bike"){
    if(i === "easy") return { carbs:[20,40], sodium:[300,500], water:[12,20] };
    if(i === "moderate") return { carbs:[40,60], sodium:[500,800], water:[16,24] };
    return { carbs:[60,90], sodium:[700,1100], water:[20,32] };
  }

  if(s === "run"){
    if(i === "easy") return { carbs:[0,30], sodium:[300,500], water:[8,16] };
    if(i === "moderate") return { carbs:[30,50], sodium:[500,800], water:[12,22] };
    return { carbs:[40,70], sodium:[700,1000], water:[16,28] };
  }

  if(s === "swim"){
    if(i === "easy") return { carbs:[0,20], sodium:[0,200], water:[8,16] };
    if(i === "moderate") return { carbs:[20,40], sodium:[200,500], water:[12,24] };
    return { carbs:[20,50], sodium:[300,700], water:[16,28] };
  }

  if(s === "brick"){
    return { carbs:[60,90], sodium:[700,1100], water:[20,32] };
  }

  return { carbs:[20,40], sodium:[300,600], water:[12,20] };
}

function getPreWorkoutCarbs(minutes, intensity){
  if(!Number.isFinite(minutes)) return { low: 20, high: 40 };

  if(minutes < 45 && intensity === "easy") return { low: 15, high: 25 };
  if(minutes < 60 && intensity === "hard") return { low: 20, high: 40 };
  if(minutes < 60) return { low: 15, high: 30 };
  if(minutes < 90) return { low: 25, high: 45 };
  return { low: 40, high: 60 };
}

function formatMinuteEstimate(minutes){
  if(!Number.isFinite(minutes)) return "";
  const rounded = Math.round(minutes);
  if(rounded < 60) return `~${rounded} min`;
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  if(m === 0) return `~${h} hr`;
  return `~${h} hr ${m} min`;
}

function getNutritionTotals(row, metrics){
  const sport = cleanWeirdText(row["Sport"] || "");
  const intensity = classifyWorkoutIntensity(row);
  const minutes = estimateWorkoutMinutes(row, metrics);

  if(!Number.isFinite(minutes) || minutes <= 0) return null;

  const rates = getRateRanges(sport, intensity);
  const factor = minutes / 60;

  const carbsLow = roundToNearest(rates.carbs[0] * factor, 5);
  const carbsHigh = roundToNearest(rates.carbs[1] * factor, 5);

  const sodiumLow = roundToNearest(rates.sodium[0] * factor, 50);
  const sodiumHigh = roundToNearest(rates.sodium[1] * factor, 50);

  const waterLow = roundToNearest(rates.water[0] * factor, 2);
  const waterHigh = roundToNearest(rates.water[1] * factor, 2);

  const pre = getPreWorkoutCarbs(minutes, intensity);

  return {
    estimatedMinutes: minutes,
    estimatedLabel: formatMinuteEstimate(minutes),
    preCarbs: pre,
    carbs: { low: carbsLow, high: carbsHigh },
    sodium: { low: sodiumLow, high: sodiumHigh },
    water: { low: waterLow, high: waterHigh }
  };
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
        const nutrition = getNutritionTotals(w, m);

        const item = document.createElement("div");
        item.className = "item";

        item.innerHTML = `
          <div class="itemTop">
            <div>
              <div class="badge">${sport}</div>
              <div class="title">${title}</div>
              <div class="small">ID ${id}</div>
              ${totalDur || totalDist ? `<div class="small">${[totalDur, totalDist].filter(Boolean).join(" , ")}</div>` : ``}
              ${nutrition?.estimatedLabel ? `<div class="small">Estimated time: ${nutrition.estimatedLabel}</div>` : ``}
            </div>
          </div>

          ${warmText ? `<div class="small"><b>Warm up</b> ${warmText}${warmIntensity ? ` <span class="muted">(${warmIntensity})</span>` : ``}</div>` : ``}

          ${mainText ? `<div class="small"><b>Main set</b> ${mainText}${mainIntensity ? ` <span class="muted">(${mainIntensity})</span>` : ``}</div>` : ``}

          ${restText ? `<div class="small"><b>Rest</b> ${restText}</div>` : ``}

          ${coolText ? `<div class="small"><b>Cool down</b> ${coolText}${coolIntensity ? ` <span class="muted">(${coolIntensity})</span>` : ``}</div>` : ``}

          ${nutrition ? `
            <div class="small" style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.06);line-height:1.5;">
              <b>Fuel</b><br>
              Before: ${nutrition.preCarbs.low}–${nutrition.preCarbs.high}g carbs<br>
              During carbs: ${nutrition.carbs.low}–${nutrition.carbs.high}g<br>
              Sodium: ${nutrition.sodium.low}–${nutrition.sodium.high}mg<br>
              Water: ${nutrition.water.low}–${nutrition.water.high}oz
            </div>
          ` : ``}

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