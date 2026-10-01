export function fmtTime(sec: number, precise = false) {
  const s = Math.max(0, sec);
  const hours = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  const secs = precise ? rest.toFixed(2).padStart(5, "0") : String(Math.floor(rest)).padStart(2, "0");
  return hours ? `${hours}:${String(mins).padStart(2, "0")}:${secs}` : `${mins}:${secs}`;
}

// "754.5", "12:34.5" or "1:02:03" -> seconds (NaN if unreadable)
export function parseTime(text: string) {
  const parts = text.trim().split(":");
  if (!parts[0] || parts.length > 3) return NaN;
  const nums = parts.map(Number);
  if (nums.some((n) => Number.isNaN(n) || n < 0)) return NaN;
  return nums.reduce((acc, n) => acc * 60 + n, 0);
}

export function fmtDuration(ms: number) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") return u.pathname.slice(1, 12) || null;
    if (u.searchParams.get("v")) return u.searchParams.get("v");
    const m = u.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]{11})/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

// e.g. "20261002-153012-dQw4w9WgXcQ": sortable, and the workflows only
// accept [A-Za-z0-9_-] so it's safe in file names.
export function requestId(suffix?: string | null) {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  const rand = Math.random().toString(36).slice(2, 6);
  return `${stamp}-${(suffix || rand).replace(/[^\w-]/g, "")}`;
}

export function idDate(id: string) {
  const m = id.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/);
  if (!m) return "";
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// Analysis ids end with the YouTube video id (see requestId)
export function videoIdFromRequest(id: string) {
  const videoId = id.split("-").slice(2).join("-");
  return videoId.length === 11 ? videoId : null;
}
