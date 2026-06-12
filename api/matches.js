// Spoiler-free World Cup 2026 highlights API (self-contained, single file).
//
// Returns ONLY safe match metadata + a clean YouTube videoId for the official
// FIFA extended-highlights upload. Scores, goal clips, interviews and any title
// containing a scoreline are filtered out before anything reaches the browser.

const OPENFOOTBALL_URL =
  "https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json";
const YT_API_KEY = process.env.YOUTUBE_API_KEY || "";

// Official UK broadcaster channels that post the FULL ~8-10 min match highlights.
// (FIFA only posts short clips, so it's deliberately not used.)
// ITV titles are score-free ("HIGHLIGHTS - X v Y | ..."); BBC titles include the
// score ("X 2-0 Y ... Highlights") — the player overlay on the page hides both.
const ITV_CHANNEL = "UCBzDz6beXDfMtfxQdEutD_w";
const BBC_CHANNEL = "UCli0KmmXMDjcgqvsheHfv-Q";
const SOURCES = [
  { name: "itv", priority: 0, uploads: "UU" + ITV_CHANNEL.slice(2),
    rss: `https://www.youtube.com/feeds/videos.xml?channel_id=${ITV_CHANNEL}`, pages: 3 },
  { name: "bbc", priority: 1, uploads: "UU" + BBC_CHANNEL.slice(2),
    rss: `https://www.youtube.com/feeds/videos.xml?channel_id=${BBC_CHANNEL}`, pages: 3 },
];

// Full match highlights run ~8-12 min. Require 5-30 min to exclude goal clips
// (1-2 min) and full-match replays / post-match shows.
const MIN_DURATION = 300;   // 5 min
const MAX_DURATION = 1800;  // 30 min

// A highlights video must be published at/after kickoff and within this window —
// stops old re-uploads or same-fixture matches from other tournaments matching.
const MATCH_BEFORE_MS = 3 * 60 * 60 * 1000;   // small slack before kickoff
const MATCH_AFTER_MS = 6 * 24 * 60 * 60 * 1000; // up to 6 days after

// ---- team data: flag emoji + alternate spellings seen in YouTube titles ----
const SPECIAL_FLAGS = {
  ENG: "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}",
  SCT: "\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}",
};
function flagFromIso(iso) {
  if (!iso) return "\u{1F3F3}️";
  if (SPECIAL_FLAGS[iso]) return SPECIAL_FLAGS[iso];
  if (iso.length !== 2) return "\u{1F3F3}️";
  const A = 0x1f1e6;
  return String.fromCodePoint(A + (iso.charCodeAt(0) - 65)) +
         String.fromCodePoint(A + (iso.charCodeAt(1) - 65));
}
const COUNTRIES = {
  "Algeria": { iso: "DZ", aliases: [] },
  "Argentina": { iso: "AR", aliases: [] },
  "Australia": { iso: "AU", aliases: ["Socceroos"] },
  "Austria": { iso: "AT", aliases: [] },
  "Belgium": { iso: "BE", aliases: [] },
  "Bosnia & Herzegovina": { iso: "BA", aliases: ["Bosnia and Herzegovina", "Bosnia"] },
  "Brazil": { iso: "BR", aliases: [] },
  "Canada": { iso: "CA", aliases: [] },
  "Cape Verde": { iso: "CV", aliases: ["Cabo Verde"] },
  "Colombia": { iso: "CO", aliases: [] },
  "Croatia": { iso: "HR", aliases: [] },
  "Curaçao": { iso: "CW", aliases: ["Curacao"] },
  "Czech Republic": { iso: "CZ", aliases: ["Czechia"] },
  "DR Congo": { iso: "CD", aliases: ["Congo DR", "Democratic Republic of the Congo", "Congo"] },
  "Ecuador": { iso: "EC", aliases: [] },
  "Egypt": { iso: "EG", aliases: [] },
  "England": { iso: "ENG", aliases: [] },
  "France": { iso: "FR", aliases: [] },
  "Germany": { iso: "DE", aliases: [] },
  "Ghana": { iso: "GH", aliases: [] },
  "Haiti": { iso: "HT", aliases: [] },
  "Iran": { iso: "IR", aliases: ["IR Iran"] },
  "Iraq": { iso: "IQ", aliases: [] },
  "Ivory Coast": { iso: "CI", aliases: ["Cote d'Ivoire", "Côte d'Ivoire"] },
  "Japan": { iso: "JP", aliases: [] },
  "Jordan": { iso: "JO", aliases: [] },
  "Mexico": { iso: "MX", aliases: ["México"] },
  "Morocco": { iso: "MA", aliases: [] },
  "Netherlands": { iso: "NL", aliases: ["Holland"] },
  "New Zealand": { iso: "NZ", aliases: [] },
  "Norway": { iso: "NO", aliases: [] },
  "Panama": { iso: "PA", aliases: [] },
  "Paraguay": { iso: "PY", aliases: [] },
  "Portugal": { iso: "PT", aliases: [] },
  "Qatar": { iso: "QA", aliases: [] },
  "Saudi Arabia": { iso: "SA", aliases: ["KSA"] },
  "Scotland": { iso: "SCT", aliases: [] },
  "Senegal": { iso: "SN", aliases: [] },
  "South Africa": { iso: "ZA", aliases: [] },
  "South Korea": { iso: "KR", aliases: ["Korea Republic", "Republic of Korea", "Korea"] },
  "Spain": { iso: "ES", aliases: [] },
  "Sweden": { iso: "SE", aliases: [] },
  "Switzerland": { iso: "CH", aliases: [] },
  "Tunisia": { iso: "TN", aliases: [] },
  "Turkey": { iso: "TR", aliases: ["Turkiye", "Türkiye"] },
  "USA": { iso: "US", aliases: ["United States", "United States of America", "U.S.A."] },
  "Uruguay": { iso: "UY", aliases: [] },
  "Uzbekistan": { iso: "UZ", aliases: [] },
};

// Things that are NOT a single-match highlights package, even if "highlights"
// appears in the title. (We also require the word "highlights" + a 5-30 min
// runtime, and restrict to the official ITV/BBC channels.)
const TITLE_BLOCKLIST = [
  "roundup", "round up", "post match", "post-match", "pre-match", "full match",
  "full game", "reaction", "preview", "build-up", "buildup", "watchalong",
  "press conference", "interview", "podcast", "football daily", "analysis",
  "every goal", "all the goals", "best goals", "top 10", "top ten", "best of",
  "u21", "u-21", "u23", "women", "wsl", "efl", "premier league", "champions league",
  "relive", "classic", "throwback", "vs the world", "challenge", "documentary",
];
const SCORE_RE = /\b\d{1,2}\s*[-–:]\s*\d{1,2}\b/;

function stripDiacritics(s) { return s.normalize("NFD").replace(/[̀-ͯ]/g, ""); }
function norm(s) { return stripDiacritics(String(s || "")).toLowerCase(); }
function decodeEntities(s) {
  return String(s || "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}
function nameVariants(team) {
  const c = COUNTRIES[team];
  const names = [team];
  if (c && c.aliases) names.push(...c.aliases);
  return names.map(norm).filter(Boolean);
}
function titleHasName(titleNorm, variant) {
  const re = new RegExp("(^|[^a-z])" + variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "($|[^a-z])");
  return re.test(titleNorm);
}
function parseKickoff(date, time) {
  const m = /(\d{1,2}):(\d{2})\s*UTC([+-]\d{1,2})/.exec(time || "");
  if (!date || !m) return null;
  const hh = m[1].padStart(2, "0"), mm = m[2], off = parseInt(m[3], 10);
  const offStr = (off < 0 ? "-" : "+") + String(Math.abs(off)).padStart(2, "0") + ":00";
  const iso = `${date}T${hh}:${mm}:00${offStr}`;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : { iso, epoch: t };
}
async function fetchFixtures() {
  try {
    const r = await fetch(OPENFOOTBALL_URL, { signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const d = await r.json();
      if (d && Array.isArray(d.matches) && d.matches.length) {
        return d.matches.map((m) => ({
          date: m.date, time: m.time, team1: m.team1, team2: m.team2,
          group: m.group || m.round, round: m.round, ground: m.ground,
        }));
      }
    }
  } catch (e) {}
  return [];
}
async function fetchUploadsViaApi(uploadsPlaylist, pages, priority, sourceName) {
  const vids = [];
  let pageToken = "";
  for (let page = 0; page < pages; page++) {
    const url = "https://www.googleapis.com/youtube/v3/playlistItems?part=snippet" +
      "&maxResults=50&playlistId=" + uploadsPlaylist +
      "&key=" + encodeURIComponent(YT_API_KEY) + (pageToken ? "&pageToken=" + pageToken : "");
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) { if (page === 0) throw new Error("YT API " + r.status); break; }
    const d = await r.json();
    for (const it of d.items || []) {
      const sn = it.snippet || {};
      const id = sn.resourceId && sn.resourceId.videoId;
      const title = decodeEntities(sn.title);
      if (!id || !title) continue;
      vids.push({ id, title, titleNorm: norm(title), published: sn.publishedAt, priority, src: sourceName });
    }
    if (!d.nextPageToken) break;
    pageToken = d.nextPageToken;
  }
  return vids;
}
async function fetchRss(url, priority, sourceName) {
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) return [];
  const xml = await r.text();
  const entries = xml.split("<entry>").slice(1);
  const vids = [];
  for (const e of entries) {
    const id = (/<yt:videoId>([^<]+)<\/yt:videoId>/.exec(e) || [])[1];
    const rawTitle = (/<title>([^<]*)<\/title>/.exec(e) || [])[1];
    const published = (/<published>([^<]+)<\/published>/.exec(e) || [])[1];
    if (!id || !rawTitle) continue;
    const title = decodeEntities(rawTitle);
    vids.push({ id, title, titleNorm: norm(title), published, priority, src: sourceName });
  }
  return vids;
}
async function fetchVideos() {
  if (YT_API_KEY) {
    try {
      const lists = await Promise.all(
        SOURCES.map((s) => fetchUploadsViaApi(s.uploads, s.pages, s.priority, s.name).catch(() => null))
      );
      if (lists.some(Boolean)) {
        const merged = [];
        lists.forEach((l) => { if (l) merged.push(...l); });
        await Promise.all(SOURCES.map(async (s, i) => {
          if (!lists[i]) merged.push(...await fetchRss(s.rss, s.priority, s.name).catch(() => []));
        }));
        return { videos: merged, source: "youtube-api" };
      }
    } catch (e) {}
  }
  const rssLists = await Promise.all(SOURCES.map((s) => fetchRss(s.rss, s.priority, s.name).catch(() => [])));
  return { videos: [].concat(...rssLists), source: "rss" };
}
function iso8601ToSeconds(d) {
  const m = /P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(d || "");
  if (!m) return null;
  return (+(m[1] || 0)) * 86400 + (+(m[2] || 0)) * 3600 + (+(m[3] || 0)) * 60 + (+(m[4] || 0));
}
// Batch-lookup durations for candidate video ids (50 per call, ~1 unit each).
async function fetchDurations(ids) {
  const out = {};
  if (!YT_API_KEY) return out;
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const url = "https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=" +
      batch.join(",") + "&key=" + encodeURIComponent(YT_API_KEY);
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) continue;
    const d = await r.json();
    for (const it of d.items || []) {
      out[it.id] = iso8601ToSeconds(it.contentDetails && it.contentDetails.duration);
    }
  }
  return out;
}
// A full single-match highlights package: says "highlights" and isn't one of the
// blocklisted non-highlight formats. (Duration is checked separately.)
function isHighlightShaped(v) {
  if (!v.titleNorm.includes("highlights")) return false;
  for (const bad of TITLE_BLOCKLIST) if (v.titleNorm.includes(bad)) return false;
  return true;
}
function withinMatchWindow(v, kickoffEpoch) {
  if (!kickoffEpoch) return true;
  if (!v.published) return true; // keep if we have no date (rare)
  const t = Date.parse(v.published);
  if (Number.isNaN(t)) return true;
  return t >= kickoffEpoch - MATCH_BEFORE_MS && t <= kickoffEpoch + MATCH_AFTER_MS;
}
function pickVideoForFixture(fixture, candidates, kickoffEpoch) {
  const v1 = nameVariants(fixture.team1), v2 = nameVariants(fixture.team2);
  const matches = candidates.filter((v) =>
    withinMatchWindow(v, kickoffEpoch) &&
    v1.some((n) => titleHasName(v.titleNorm, n)) && v2.some((n) => titleHasName(v.titleNorm, n)));
  if (!matches.length) return null;
  matches.sort((a, b) => {
    // 1) prefer a score-free title (ITV style) — extra safety even with the overlay
    const sa = SCORE_RE.test(a.title) ? 1 : 0, sb = SCORE_RE.test(b.title) ? 1 : 0;
    if (sa !== sb) return sa - sb;
    // 2) lower source priority (ITV before BBC)
    if ((a.priority || 0) !== (b.priority || 0)) return (a.priority || 0) - (b.priority || 0);
    // 3) longer cut, then newest
    if ((b.durationSec || 0) !== (a.durationSec || 0)) return (b.durationSec || 0) - (a.durationSec || 0);
    return (b.published || "").localeCompare(a.published || "");
  });
  return matches[0].id;
}
function teamInfo(name) {
  const c = COUNTRIES[name];
  return { name, flag: c ? flagFromIso(c.iso) : "", real: !!c };
}

module.exports = async function handler(req, res) {
  try {
    const [fixtures, vresult] = await Promise.all([fetchFixtures(), fetchVideos()]);
    const now = Date.now();
    const FINISH_AFTER = 115 * 60 * 1000;

    // Candidate highlights = the right title shape, from the official channels.
    let candidates = vresult.videos.filter(isHighlightShaped);
    // De-duplicate by video id.
    const byId = new Map();
    for (const v of candidates) if (!byId.has(v.id)) byId.set(v.id, v);
    candidates = [...byId.values()];
    // Confirm they're full-length (5-30 min) using real durations from the API.
    if (YT_API_KEY && candidates.length) {
      const dur = await fetchDurations(candidates.map((v) => v.id));
      candidates = candidates.filter((v) => {
        v.durationSec = dur[v.id];
        return v.durationSec != null && v.durationSec >= MIN_DURATION && v.durationSec <= MAX_DURATION;
      });
    }

    const out = fixtures.map((f) => {
      const ko = parseKickoff(f.date, f.time);
      let status = "scheduled";
      if (ko) status = now < ko.epoch ? "upcoming" : (now < ko.epoch + FINISH_AFTER ? "live" : "finished");
      const t1 = teamInfo(f.team1), t2 = teamInfo(f.team2);
      let videoId = null;
      if (status === "finished" && t1.real && t2.real) videoId = pickVideoForFixture(f, candidates, ko ? ko.epoch : null);
      return {
        date: f.date, kickoff: ko ? ko.iso : null, team1: t1, team2: t2,
        group: f.group, round: f.round, venue: f.ground, status,
        videoId, hasHighlights: !!videoId,
      };
    });
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=1800");
    res.status(200).json({ generatedAt: new Date().toISOString(), source: vresult.source, count: out.length, matches: out });
  } catch (err) {
    res.status(500).json({ error: "Failed to build match list", detail: String((err && err.message) || err) });
  }
};
