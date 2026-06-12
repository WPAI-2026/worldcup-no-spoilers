// Spoiler-free World Cup 2026 highlights API (self-contained, single file).
//
// Returns ONLY safe match metadata + a clean YouTube videoId for the official
// FIFA extended-highlights upload. Scores, goal clips, interviews and any title
// containing a scoreline are filtered out before anything reaches the browser.

const FIFA_CHANNEL_ID = "UCpcTrCXblq78GZrTUTLWeBw";
const FIFA_UPLOADS_PLAYLIST = "UU" + FIFA_CHANNEL_ID.slice(2);
const RSS_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${FIFA_CHANNEL_ID}`;
const OPENFOOTBALL_URL =
  "https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json";
const YT_API_KEY = process.env.YOUTUBE_API_KEY || "";
const MAX_UPLOAD_PAGES = 3; // 3 x 50 = up to 150 most-recent uploads

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

const TITLE_BLOCKLIST = [
  "goal", "interview", "press conference", "conference", "feature", "reaction",
  "react", "preview", "analysis", "q&a", "takes questions", "concert", "build-up",
  "buildup", "behind the scenes", "mascot", "ceremony", "song", "trophy",
  "prediction", "predict", "draw", "fan ", "fans", "vlog", "tactical", "best of",
  "every goal", "all goals", "top 10", "top ten", "greatest", "relive", "classic",
  "throwback", "post-match", "pre-match", "matchday live",
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
async function fetchVideosViaApi() {
  const vids = [];
  let pageToken = "";
  for (let page = 0; page < MAX_UPLOAD_PAGES; page++) {
    const url = "https://www.googleapis.com/youtube/v3/playlistItems?part=snippet" +
      "&maxResults=50&playlistId=" + FIFA_UPLOADS_PLAYLIST +
      "&key=" + encodeURIComponent(YT_API_KEY) + (pageToken ? "&pageToken=" + pageToken : "");
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) { if (page === 0) throw new Error("YT API " + r.status); break; }
    const d = await r.json();
    for (const it of d.items || []) {
      const sn = it.snippet || {};
      const id = sn.resourceId && sn.resourceId.videoId;
      const title = decodeEntities(sn.title);
      if (!id || !title) continue;
      vids.push({ id, title, titleNorm: norm(title), published: sn.publishedAt });
    }
    if (!d.nextPageToken) break;
    pageToken = d.nextPageToken;
  }
  return vids;
}
async function fetchVideosViaRss() {
  const r = await fetch(RSS_URL, { signal: AbortSignal.timeout(8000) });
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
    vids.push({ id, title, titleNorm: norm(title), published });
  }
  return vids;
}
async function fetchVideos() {
  if (YT_API_KEY) {
    try { return { videos: await fetchVideosViaApi(), source: "youtube-api" }; }
    catch (e) {}
  }
  return { videos: await fetchVideosViaRss(), source: "rss" };
}
function isCleanHighlight(v) {
  if (SCORE_RE.test(v.title)) return false;
  for (const bad of TITLE_BLOCKLIST) if (v.titleNorm.includes(bad)) return false;
  return v.title.includes("\u{1F19A}") || /\bvs\b/.test(v.titleNorm) || v.titleNorm.includes("highlights");
}
function pickVideoForFixture(fixture, videos) {
  const v1 = nameVariants(fixture.team1), v2 = nameVariants(fixture.team2);
  const matches = videos.filter((v) => isCleanHighlight(v) &&
    v1.some((n) => titleHasName(v.titleNorm, n)) && v2.some((n) => titleHasName(v.titleNorm, n)));
  if (!matches.length) return null;
  matches.sort((a, b) => {
    const va = a.title.includes("\u{1F19A}") ? 1 : 0, vb = b.title.includes("\u{1F19A}") ? 1 : 0;
    if (va !== vb) return vb - va;
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
    const videos = vresult.videos;
    const now = Date.now();
    const FINISH_AFTER = 115 * 60 * 1000;
    const out = fixtures.map((f) => {
      const ko = parseKickoff(f.date, f.time);
      let status = "scheduled";
      if (ko) status = now < ko.epoch ? "upcoming" : (now < ko.epoch + FINISH_AFTER ? "live" : "finished");
      const t1 = teamInfo(f.team1), t2 = teamInfo(f.team2);
      let videoId = null;
      if (status === "finished" && t1.real && t2.real) videoId = pickVideoForFixture(f, videos);
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
