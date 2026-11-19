/* Pure formatting helpers for the dashboard.
 *
 * Everything here is a total function of its arguments: no DOM access, no
 * module-level mutable state, no reading of `window` or `Date.now()` other than
 * through an explicit `now` parameter where the value is time-dependent. That is
 * what makes the module testable under `node --test` (issue #723) without a
 * browser or a DOM shim, and it is why the countdown/relative-time helpers take
 * `now` instead of calling the clock themselves.
 *
 * A note on separators: the em dash and ellipsis below are the values the
 * dashboard has always rendered. They are written as escapes rather than
 * literals so a copy/paste or an editor that mangles non-ASCII cannot silently
 * change what a merchant sees.
 */

/** Placeholder for an absent value. */
export const EMPTY = "—";

/** Public explorer used for the transaction link in the detail panel. */
export const EXPLORER_TX_BASE =
  "https://stellar.expert/explorer/public/tx/";

/**
 * Localised timestamp for an ISO-8601 instant.
 *
 * An unparseable value is echoed back verbatim rather than rendered as
 * "Invalid Date": the raw string is far more useful to an operator debugging a
 * bad `expires_at` than the browser's own error text.
 */
export function fmtTime(iso, zone) {
  if (!iso) return EMPTY;
  var d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  if (zone === "utc") {
    return d.toLocaleString(undefined, { timeZone: "UTC" }) + " UTC";
  }
  if (zone === "local") {
    return d.toLocaleString(undefined, { timeZoneName: "short" });
  }
  return d.toLocaleString();
}

/**
 * ISO-8601 instant rendered in `zone` for the CSV export (#783): "utc" gives a
 * `Z` suffix, anything else a local time with an explicit +hh:mm offset. An
 * absent or unparseable value is returned unchanged.
 */
export function isoInZone(iso, zone) {
  if (!iso) return iso;
  var d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  if (zone !== "local") return d.toISOString().replace(/\.\d{3}Z$/, "Z");
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  var off = -d.getTimezoneOffset();
  var sign = off < 0 ? "-" : "+";
  off = Math.abs(off);
  return (
    d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
    "T" + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()) +
    sign + pad(Math.floor(off / 60)) + ":" + pad(off % 60)
  );
}

/**
 * Locale-aware amount for display (#784). Fraction digits are capped at the
 * Stellar precision of 7 and trailing zeros are dropped, matching
 * `formatAmount`. The decimal *string* is handed to Intl so no float rounding
 * is introduced. CSV and URIs must keep using the locale-neutral helpers.
 */
export function formatAmountLocale(amount, asset, locale) {
  var s = String(amount === undefined || amount === null ? "" : amount).trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return formatAmount(amount, asset);
  var out;
  try {
    out = new Intl.NumberFormat(locale || undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 7,
    }).format(s);
  } catch (e) {
    return formatAmount(amount, asset);
  }
  return out + " " + asset;
}

/**
 * Compare two non-negative/negative decimal strings exactly (#782), without
 * converting to Number. Returns -1, 0, 1, or NaN if either is not a decimal.
 */
export function compareDecimal(a, b) {
  var re = /^(-?)(\d*)(?:\.(\d*))?$/;
  var x = re.exec(String(a).trim());
  var y = re.exec(String(b).trim());
  if (!x || !y || (!x[2] && !x[3]) || (!y[2] && !y[3])) return NaN;
  function parts(m) {
    var int = (m[2] || "").replace(/^0+/, "");
    var frac = (m[3] || "").replace(/0+$/, "");
    var zero = !int && !frac;
    return { neg: m[1] === "-" && !zero, int: int, frac: frac };
  }
  var p = parts(x), q = parts(y);
  if (p.neg !== q.neg) return p.neg ? -1 : 1;
  var sign = p.neg ? -1 : 1;
  if (p.int.length !== q.int.length) return (p.int.length < q.int.length ? -1 : 1) * sign;
  if (p.int !== q.int) return (p.int < q.int ? -1 : 1) * sign;
  var n = Math.max(p.frac.length, q.frac.length);
  var pf = p.frac.padEnd(n, "0"), qf = q.frac.padEnd(n, "0");
  if (pf === qf) return 0;
  return (pf < qf ? -1 : 1) * sign;
}

/**
 * Keep payments whose amount lies in [min, max] (#782). A blank or invalid
 * bound is ignored. Filters the loaded rows; the list API has no amount filter.
 */
export function filterByAmount(payments, min, max) {
  var lo = String(min || "").trim();
  var hi = String(max || "").trim();
  var hasLo = lo !== "" && !isNaN(compareDecimal(lo, "0"));
  var hasHi = hi !== "" && !isNaN(compareDecimal(hi, "0"));
  if (!hasLo && !hasHi) return payments || [];
  return (payments || []).filter(function (p) {
    var amt = p && p.amount;
    if (hasLo && !(compareDecimal(amt, lo) >= 0)) return false;
    if (hasHi && !(compareDecimal(amt, hi) <= 0)) return false;
    return true;
  });
}

/** Ids in `payments` that are not in the `seen` set (#781). */
export function newPaymentIds(seen, payments) {
  var out = [];
  (payments || []).forEach(function (p) {
    if (p && p.id && !seen[p.id]) out.push(p.id);
  });
  return out;
}

/**
 * Truncate an opaque identifier for display. Anything 12 characters or shorter
 * is already short enough to show in full, which keeps UUID-shaped test ids
 * readable while still clipping real 64-character transaction hashes.
 */
export function shortId(id) {
  return typeof id === "string" && id.length > 12
    ? id.slice(0, 8) + "..."
    : id;
}

/**
 * Render a decimal amount with its asset code, trimming the trailing zeros that
 * `toFixed` leaves behind so "10.0000000 XLM" displays as "10 XLM".
 *
 * A non-numeric amount is passed through with the asset appended rather than
 * replaced by NaN: the amount column must never render the string "NaN", since
 * that reads as a real value to whoever is reconciling it against the chain.
 */
export function formatAmount(amount, asset) {
  var n = Number(amount);
  if (!isFinite(n)) return String(amount) + " " + asset;
  return trimZeros(n.toFixed(7)) + " " + asset;
}

/** Strip trailing zeros (and a bare trailing decimal point) from a fixed-7 string. */
function trimZeros(fixed) {
  return fixed.replace(/\.?0+$/, "");
}

/**
 * Coarse time remaining until `iso`, e.g. "45s", "12m", "3h", "2d".
 *
 * `now` is injected so the output is deterministic under test. An instant in the
 * past clamps to "0s" rather than going negative — an expired intent showing
 * "-3m left" would be actively misleading while the operator is triaging it.
 * A non-finite `now` (a malformed clock) yields "" so the caller can omit the
 * whole suffix instead of printing a guess.
 */
export function countdown(iso, now) {
  var d = new Date(iso);
  var at = now === undefined ? Date.now() : now;
  if (!isFinite(at) || isNaN(d.getTime())) return "";
  var seconds = Math.floor((d.getTime() - at) / 1000);
  if (seconds < 0) seconds = 0;
  return coarseDuration(seconds);
}

/**
 * Coarse time elapsed since `iso`, e.g. "just now"-ish "12s ago", "5m ago".
 *
 * Rounds rather than floors, and returns "never" for an absent value, which is
 * the honest rendering for a delivery that has not been attempted yet.
 */
export function relativeTime(iso, now) {
  if (!iso) return "never";
  var d = new Date(iso);
  var at = now === undefined ? Date.now() : now;
  if (isNaN(d.getTime()) || !isFinite(at)) return String(iso);
  var seconds = Math.round((at - d.getTime()) / 1000);
  if (seconds < 60) return seconds + "s ago";
  if (seconds < 3600) return Math.round(seconds / 60) + "m ago";
  if (seconds < 86400) return Math.round(seconds / 3600) + "h ago";
  return Math.round(seconds / 86400) + "d ago";
}

/** Shared bucket boundaries for countdown() and relativeTime(). */
function coarseDuration(seconds) {
  if (seconds < 60) return seconds + "s";
  if (seconds < 3600) return Math.floor(seconds / 60) + "m";
  if (seconds < 86400) return Math.floor(seconds / 3600) + "h";
  return Math.floor(seconds / 86400) + "d";
}

/**
 * Map a payment or webhook-delivery status onto a pill modifier class.
 *
 * The class is composed from a fixed table rather than interpolated from the
 * status string, so a status a merchant controls can never inject a class name.
 */
export function pillClass(status) {
  switch (status) {
    case "completed":
    case "delivered":
      return "pill pill-ok";
    case "pending":
    case "underpaid":
      return "pill pill-warn";
    case "expired":
    case "failed":
      return "pill pill-err";
    default:
      return "pill pill-idle";
  }
}

/** Explorer deep link for a transaction hash. The hash is encoded, never trusted. */
export function explorerTx(txHash) {
  return EXPLORER_TX_BASE + encodeURIComponent(String(txHash));
}

/** Column order of the CSV export (issue #706). */
export const CSV_COLUMNS = [
  "id",
  "status",
  "amount",
  "asset",
  "asset_issuer",
  "memo",
  "destination_address",
  "created_at",
  "expires_at",
];

/**
 * Quote one CSV field per RFC 4180: always quoted, with embedded quotes doubled.
 *
 * A memo is merchant-controlled and routinely contains commas and quotes, so
 * quoting every field unconditionally is both simpler and safer than
 * quote-only-when-needed.
 */
export function csvField(value) {
  return '"' + String(value === undefined || value === null ? "" : value).replace(/"/g, '""') + '"';
}

/** Serialise loaded payments to a CSV document, header row first. */
export function toCsv(payments, columns, zone) {
  var cols = columns || CSV_COLUMNS;
  var lines = [cols.map(csvField).join(",")];
  (payments || []).forEach(function (p) {
    lines.push(
      cols
        .map(function (key) {
          var v = p ? p[key] : "";
          if (zone && (key === "created_at" || key === "expires_at")) {
            v = isoInZone(v, zone);
          }
          return csvField(v);
        })
        .join(",")
    );
  });
  return lines.join("\n");
}

/**
 * Build the `/payments` query string from the current filter state.
 *
 * Every value is percent-encoded and the API base is *not* included: the caller
 * concatenates it, which keeps the version prefix defined in exactly one place
 * (pinned by `tests/dashboard_asset_tests.rs`). An absent filter is omitted
 * rather than sent empty, so the server keeps applying its own default.
 *
 * `search` is deliberately absent: the search box narrows the rows already
 * loaded (see `filterPayments`) rather than asking the server for a matching
 * set, so there is no `search` parameter to send. Adding one here would imply a
 * server-side filter the API does not offer.
 */
export function buildListQuery(filters) {
  var f = filters || {};
  var parts = ["limit=" + encodeURIComponent(f.pageSize || 25)];
  if (f.status) parts.push("status=" + encodeURIComponent(f.status));
  if (f.asset) parts.push("asset=" + encodeURIComponent(f.asset));
  if (f.createdAfter) {
    parts.push(
      "created_after=" + encodeURIComponent(f.createdAfter + "T00:00:00Z")
    );
  }
  if (f.createdBefore) {
    parts.push(
      "created_before=" + encodeURIComponent(f.createdBefore + "T23:59:59Z")
    );
  }
  if (f.cursor) parts.push("cursor=" + encodeURIComponent(f.cursor));
  return "/payments?" + parts.join("&");
}

/**
 * Build a SEP-7 `web+stellar:pay` URI for a payment intent.
 *
 * The URI encodes the destination, memo, amount and asset so a SEP-7-capable
 * wallet can prefill a payment directly from a QR code scan or a tap.
 *
 * Native XLM uses no asset_code/asset_issuer parameters; issued assets use
 * both so the wallet can verify the exact token. All values are percent-encoded
 * so memo text containing spaces, commas or special characters round-trips
 * correctly. Memo type is always MEMO_TEXT to match how the gateway generates
 * and matches memos (see `generate_unique_memo` in the backend).
 *
 * @param {object} payment  A payment record from the API.
 * @returns {string}        The full web+stellar:pay URI.
 */
export function buildSep7Uri(payment) {
  var p = payment || {};
  var params = [];
  if (p.destination_address) {
    params.push("destination=" + encodeURIComponent(p.destination_address));
  }
  if (p.amount) {
    // Strip trailing zeros the same way formatAmount does, so "10.0000000"
    // becomes "10" in the URI — wallets display this value to the user.
    var n = Number(p.amount);
    var amtStr = isFinite(n)
      ? n.toFixed(7).replace(/\.?0+$/, "")
      : String(p.amount);
    params.push("amount=" + encodeURIComponent(amtStr));
  }
  var asset = String(p.asset || "XLM").toUpperCase();
  if (asset !== "XLM") {
    // Issued asset: asset_code + asset_issuer required.
    params.push("asset_code=" + encodeURIComponent(asset));
    if (p.asset_issuer) {
      params.push("asset_issuer=" + encodeURIComponent(p.asset_issuer));
    }
  }
  if (p.memo) {
    params.push("memo=" + encodeURIComponent(p.memo));
    params.push("memo_type=MEMO_TEXT");
  }
  return "web+stellar:pay?" + params.join("&");
}

/**
 * Case-insensitive filter over the rows already loaded, matching a query against
 * the memo and the payment id.
 *
 * This is deliberately client-side: it narrows what the operator can currently
 * see without another round trip, and it is what the `/` shortcut focuses.
 */
export function filterPayments(payments, query) {
  var q = String(query || "").trim().toLowerCase();
  if (!q) return payments || [];
  return (payments || []).filter(function (p) {
    return (
      String(p && p.memo ? p.memo : "")
        .toLowerCase()
        .indexOf(q) >= 0 ||
      String(p && p.id ? p.id : "")
        .toLowerCase()
        .indexOf(q) >= 0
    );
  });
}
