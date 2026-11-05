// Fetch a page and reduce it to text. Shared by fetch_page (the agent's
// tool) and checks/links_resolve.ts (the verifier's check), so both judge a
// page the same way. Requests go through the egress proxy (HTTPS_PROXY, with
// NODE_USE_ENV_PROXY set by the runner).

export type Page = {
  url: string;
  final_url: string;
  status: number;
  content_type: string;
  title: string;
  text: string;
  soft_404: boolean;
  soft_404_reason?: string;
};

export type PageError = { url: string; error: string; message: string };

const UA = "tap-deep-research/0.1 (+https://tap.hiddenfield.dev)";
const MAX_BYTES = 2 << 20;

// Titles and headings that say "not found" while the status says 200.
const NOT_FOUND =
  /\b(404|page not found|not found|page (?:does not|doesn't|cannot be found|can't be found|no longer exists)|no longer available|page unavailable|nothing (?:was )?found|this page isn't available|content (?:is )?not available)\b/i;
const NOT_FOUND_PATH = /\/(?:404|not[-_]?found|page[-_]?not[-_]?found|error)(?:[/.?#]|$)/i;

const ENTITIES: Record<string, string> = {
  nbsp: " ", lt: "<", gt: ">", quot: '"', apos: "'", minus: "−", ndash: "–", mdash: "—", hellip: "…",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", laquo: "«", raquo: "»", euro: "€", pound: "£", deg: "°",
  times: "×", middot: "·", copy: "©", reg: "®", trade: "™", eacute: "é", egrave: "è", agrave: "à", ccedil: "ç",
};

// decode replaces character references; &amp; last, so "&amp;lt;" stays "&lt;".
export function decode(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => (name.toLowerCase() === "amp" ? m : (ENTITIES[name] ?? ENTITIES[name.toLowerCase()] ?? m)))
    .replace(/&amp;/gi, "&");
}

const stripTags = (s: string) => decode(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

// tableToText keeps a table's structure, which flattening would lose: with a
// header row, each data row becomes "Header: value; Header: value", so every
// figure stays next to its label; otherwise each row is "cell | cell".
export function tableToText(table: string): string {
  const caption = stripTags(/<caption[^>]*>([\s\S]*?)<\/caption>/i.exec(table)?.[1] ?? "");
  const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((r) =>
    [...r[1]!.matchAll(/<(t[hd])[^>]*>([\s\S]*?)<\/\1>/gi)].map((c) => ({ head: c[1]!.toLowerCase() === "th", text: stripTags(c[2]!) })),
  );
  const lines: string[] = caption ? [caption] : [];
  const header = rows[0]?.every((c) => c.head) ? rows[0]!.map((c) => c.text) : null;
  for (const row of header ? rows.slice(1) : rows) {
    if (row.length === 0) continue;
    if (header && row.length === header.length) {
      lines.push(row.map((c, i) => `${header[i]}: ${c.text}`).join("; "));
    } else if (header && row.length === header.length + 1 && row[0]!.head) {
      // A row header first ("2023 | ..."), then one cell per column.
      lines.push(`${row[0]!.text}: ` + row.slice(1).map((c, i) => `${header[i]}: ${c.text}`).join("; "));
    } else {
      lines.push(row.map((c) => c.text).join(" | "));
    }
  }
  if (header && rows.length === 1) lines.push(header.join(" | "));
  return lines.join("\n");
}

export function htmlToText(html: string): { title: string; h1: string; text: string } {
  const title = stripTags(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "");
  const h1 = stripTags(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? "");
  const body = html
    .replace(/<(script|style|noscript|svg|template|nav|footer|header)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    // The source's own line breaks mean nothing in HTML; only block ends do.
    .replace(/\s+/g, " ")
    .replace(/<table[^>]*>[\s\S]*?<\/table>/gi, (t) => `\n${tableToText(t).replace(/&/g, "&amp;").replace(/</g, "&lt;")}\n`)
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|caption|dt|dd|blockquote|pre)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const text = decode(body)
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  return { title, h1, text };
}

// softNotFound says why a 2xx page is really an error page, or "".
export function softNotFound(finalUrl: string, title: string, h1: string, text: string): string {
  if (NOT_FOUND.test(title)) return `the page title says "${title.slice(0, 80)}"`;
  if (NOT_FOUND.test(h1)) return `the page heading says "${h1.slice(0, 80)}"`;
  try {
    if (NOT_FOUND_PATH.test(new URL(finalUrl).pathname)) return `it redirects to an error page (${finalUrl})`;
  } catch {}
  if (text.length < 100) return `the page has almost no text (${text.length} characters)`;
  return "";
}

export async function fetchPage(url: string, timeoutMs = 15_000): Promise<Page | PageError> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { url, error: "invalid_url", message: "not a URL" };
  }
  if (u.protocol !== "https:") return { url, error: "not_https", message: "only https URLs can be fetched" };
  let res: Response;
  try {
    res = await fetch(u, {
      redirect: "follow",
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const err = e as Error & { cause?: { code?: string; message?: string } };
    const why = err.name === "TimeoutError" ? "timed out" : (err.cause?.code ?? err.cause?.message ?? err.message);
    return { url, error: "unreachable", message: String(why).slice(0, 200) };
  }
  const contentType = res.headers.get("content-type") ?? "";
  const buf = new Uint8Array(await res.arrayBuffer()).slice(0, MAX_BYTES);
  const raw = new TextDecoder().decode(buf);
  const finalUrl = res.url || url;
  const isHtml = /html|xml/i.test(contentType) || /^\s*</.test(raw);
  const { title, h1, text } = isHtml ? htmlToText(raw) : { title: "", h1: "", text: raw.replace(/\s+\n/g, "\n").trim() };
  const page: Page = { url, final_url: finalUrl, status: res.status, content_type: contentType, title, text, soft_404: false };
  if (res.ok) {
    const why = softNotFound(finalUrl, title, h1, text);
    if (why) Object.assign(page, { soft_404: true, soft_404_reason: why });
  }
  return page;
}

export function isPageError(p: Page | PageError): p is PageError {
  return "error" in p;
}
