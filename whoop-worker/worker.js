// دفتر الجيم ↔ WHOOP bridge (Cloudflare Worker).
// Keeps the WHOOP client secret server-side, runs the OAuth flow and returns today's recovery.
//
// Required settings on the Worker:
//   Secrets:    WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET
//   KV binding: TOKENS
//   Variable:   APP_ORIGIN (optional, defaults to the GitHub Pages origin below)
//
// Routes:
//   GET  /login?key=…&return=…  → redirects to WHOOP consent
//   GET  /callback              → WHOOP redirect URI (register exactly this path in the WHOOP dashboard)
//   GET  /today?key=…           → { connected, recovery, sleep, cycle, workouts, missing }
//   GET  /recovery?key=…        → { connected, state, score, hrv, rhr, date } (older app versions)
//   POST /disconnect?key=…      → forgets the stored tokens

const WHOOP_AUTH = "https://api.prod.whoop.com/oauth/oauth2/auth";
const WHOOP_TOKEN = "https://api.prod.whoop.com/oauth/oauth2/token";
const WHOOP_API = "https://api.prod.whoop.com/developer/v2";
const SCOPES = "offline read:recovery read:cycles read:sleep read:workout";
const DEFAULT_ORIGIN = "https://islamyaseen91-design.github.io";

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = env.APP_ORIGIN || DEFAULT_ORIGIN;
    const cors = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
    };
    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });

    if (req.method === "OPTIONS") return new Response(null, { headers: cors });

    try {
      if (url.pathname === "/login") {
        const key = url.searchParams.get("key") || "";
        const ret = url.searchParams.get("return") || origin;
        if (!validKey(key)) return text("Invalid key", 400);
        if (!ret.startsWith(origin)) return text("Return URL is not allowed", 400);
        const state = randomHex(16);
        await env.TOKENS.put(`state:${state}`, JSON.stringify({ key, ret }), { expirationTtl: 600 });
        const auth = new URL(WHOOP_AUTH);
        auth.searchParams.set("response_type", "code");
        auth.searchParams.set("client_id", env.WHOOP_CLIENT_ID);
        auth.searchParams.set("redirect_uri", `${url.origin}/callback`);
        auth.searchParams.set("scope", SCOPES);
        auth.searchParams.set("state", state);
        return Response.redirect(auth.toString(), 302);
      }

      if (url.pathname === "/callback") {
        const state = url.searchParams.get("state") || "";
        const saved = await env.TOKENS.get(`state:${state}`, "json");
        if (!saved) return text("The login link expired. Go back to the app and press Connect again.", 400);
        await env.TOKENS.delete(`state:${state}`);
        const back = new URL(saved.ret);
        if (url.searchParams.get("error")) { back.hash = "whoop-denied"; return Response.redirect(back.toString(), 302); }
        const tok = await tokenRequest(env, {
          grant_type: "authorization_code",
          code: url.searchParams.get("code") || "",
          redirect_uri: `${url.origin}/callback`,
        });
        await saveTokens(env, saved.key, tok);
        back.hash = "whoop-ok";
        return Response.redirect(back.toString(), 302);
      }

      if (url.pathname === "/recovery") {
        const key = url.searchParams.get("key") || "";
        if (!validKey(key)) return json({ error: "invalid_key" }, 400);
        const token = await accessToken(env, key);
        if (!token) return json({ connected: false });
        const r = await fetch(`${WHOOP_API}/recovery?limit=1`, { headers: { Authorization: `Bearer ${token}` } });
        if (r.status === 401) { await env.TOKENS.delete(`tok:${key}`); return json({ connected: false }); }
        if (!r.ok) return json({ connected: true, error: `whoop_${r.status}` }, 502);
        const rec = ((await r.json()).records || [])[0];
        if (!rec) return json({ connected: true, state: "NONE" });
        return json({
          connected: true,
          state: rec.score_state, // SCORED | PENDING_SCORE | UNSCORABLE
          score: rec.score ? rec.score.recovery_score : null,
          hrv: rec.score ? Math.round(rec.score.hrv_rmssd_milli) : null,
          rhr: rec.score ? rec.score.resting_heart_rate : null,
          date: rec.created_at,
        });
      }

      if (url.pathname === "/today") {
        const key = url.searchParams.get("key") || "";
        if (!validKey(key)) return json({ error: "invalid_key" }, 400);
        const token = await accessToken(env, key);
        if (!token) return json({ connected: false });
        const since = new Date(Date.now() - 3 * 86400000).toISOString();
        const get = path => fetch(`${WHOOP_API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
        const [rr, sr, cr, wr] = await Promise.all([
          get("/recovery?limit=1"), get("/activity/sleep?limit=5"), get("/cycle?limit=1"),
          get(`/activity/workout?limit=25&start=${encodeURIComponent(since)}`),
        ]);
        if (rr.status === 401) { await env.TOKENS.delete(`tok:${key}`); return json({ connected: false }); }
        const body = async r => (r.ok ? (await r.json()).records || [] : null);
        const [recs, sleeps, cycles, works] = await Promise.all([body(rr), body(sr), body(cr), body(wr)]);
        const missing = [];
        if (sleeps === null) missing.push("sleep");
        if (works === null) missing.push("workout");
        const min = ms => (typeof ms === "number" ? Math.round(ms / 60000) : null);
        const rec = recs && recs[0];
        const sl = sleeps && sleeps.find(x => !x.nap);
        const st = sl && sl.score && sl.score.stage_summary, need = sl && sl.score && sl.score.sleep_needed;
        const cyc = cycles && cycles[0];
        return json({
          connected: true,
          missing,
          recovery: rec ? {
            state: rec.score_state, date: rec.created_at,
            score: rec.score ? rec.score.recovery_score : null,
            hrv: rec.score ? Math.round(rec.score.hrv_rmssd_milli) : null,
            rhr: rec.score ? rec.score.resting_heart_rate : null,
          } : null,
          sleep: sl ? {
            state: sl.score_state, start: sl.start, end: sl.end,
            inBed: st ? min(st.total_in_bed_time_milli) : null,
            asleep: st ? min(st.total_light_sleep_time_milli + st.total_slow_wave_sleep_time_milli + st.total_rem_sleep_time_milli) : null,
            deep: st ? min(st.total_slow_wave_sleep_time_milli) : null,
            rem: st ? min(st.total_rem_sleep_time_milli) : null,
            light: st ? min(st.total_light_sleep_time_milli) : null,
            awake: st ? min(st.total_awake_time_milli) : null,
            need: need ? min(need.baseline_milli + need.need_from_sleep_debt_milli + need.need_from_recent_strain_milli + need.need_from_recent_nap_milli) : null,
            performance: sl.score ? sl.score.sleep_performance_percentage ?? null : null,
            efficiency: sl.score ? sl.score.sleep_efficiency_percentage ?? null : null,
          } : null,
          cycle: cyc ? { start: cyc.start, end: cyc.end, strain: cyc.score ? cyc.score.strain : null } : null,
          workouts: (works || []).filter(x => x.score_state === "SCORED" && x.score).map(x => ({
            id: x.id, start: x.start, end: x.end, sport: x.sport_name || "",
            strain: x.score.strain, avgHr: x.score.average_heart_rate, maxHr: x.score.max_heart_rate,
            kcal: typeof x.score.kilojoule === "number" ? Math.round(x.score.kilojoule / 4.184) : null,
          })),
        });
      }

      if (url.pathname === "/disconnect" && req.method === "POST") {
        const key = url.searchParams.get("key") || "";
        if (validKey(key)) await env.TOKENS.delete(`tok:${key}`);
        return json({ ok: true });
      }

      return text("دفتر الجيم ↔ WHOOP: the server is running.", 200);
    } catch (e) {
      return json({ error: "server_error", detail: String(e && e.message || e) }, 500);
    }
  },
};

const text = (body, status) => new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
const validKey = k => /^[a-f0-9]{32,64}$/.test(k);
function randomHex(bytes) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function tokenRequest(env, params) {
  const body = new URLSearchParams({ ...params, client_id: env.WHOOP_CLIENT_ID, client_secret: env.WHOOP_CLIENT_SECRET });
  const r = await fetch(WHOOP_TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  if (!r.ok) throw new Error(`token_${r.status}: ${await r.text()}`);
  return r.json();
}

async function saveTokens(env, key, tok) {
  await env.TOKENS.put(`tok:${key}`, JSON.stringify({
    access: tok.access_token,
    refresh: tok.refresh_token,
    exp: Date.now() + (tok.expires_in || 3600) * 1000 - 60000,
  }));
}

// Returns a valid access token, refreshing it (refresh tokens rotate) when it has expired.
async function accessToken(env, key) {
  const t = await env.TOKENS.get(`tok:${key}`, "json");
  if (!t) return null;
  if (Date.now() < t.exp) return t.access;
  if (!t.refresh) return null;
  try {
    const tok = await tokenRequest(env, { grant_type: "refresh_token", refresh_token: t.refresh, scope: "offline" });
    await saveTokens(env, key, tok);
    return tok.access_token;
  } catch (e) {
    await env.TOKENS.delete(`tok:${key}`);
    return null;
  }
}
