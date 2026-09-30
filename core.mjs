export const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const date = (s) => new Date(s + "T12:00:00");
export const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function visible(e, user) {
  return (
    e.visibility === "family" ||
    e.creator === user ||
    (e.visibility === "selected" && e.participants.includes(user))
  );
}
export function occurrences(events, from, to) {
  const out = [];
  const last = date(to);
  for (const e of events.filter((e) => !e.deletedAt)) {
    const start = date(e.date),
      r = e.repeat || { freq: "none" },
      interval = Math.max(1, Number(r.interval) || 1);
    let count = 0;
    if (start > last) continue;
    for (let d = new Date(start); d <= last; d.setDate(d.getDate() + 1)) {
      const ds = iso(d),
        days = Math.round((d - start) / 86400000),
        months =
          (d.getFullYear() - start.getFullYear()) * 12 +
          d.getMonth() -
          start.getMonth();
      if (r.until && ds > r.until) break;
      let hit = ds === e.date;
      if (r.freq === "daily") hit = days % interval === 0;
      if (r.freq === "weekly") {
        const week = Math.floor((days + ((start.getDay() + 6) % 7)) / 7);
        hit =
          week % interval === 0 &&
          (r.weekdays?.length ? r.weekdays : [start.getDay()]).includes(
            d.getDay(),
          );
      }
      if (r.freq === "monthly")
        hit =
          months % interval === 0 &&
          (r.monthMode === "nth"
            ? d.getDay() === start.getDay() &&
              Math.ceil(d.getDate() / 7) === Math.ceil(start.getDate() / 7)
            : d.getDate() === start.getDate());
      if (r.freq === "yearly")
        hit =
          (d.getFullYear() - start.getFullYear()) % interval === 0 &&
          d.getMonth() === start.getMonth() &&
          d.getDate() === start.getDate();
      if (!hit) continue;
      count++;
      if (r.count && count > Number(r.count)) break;
      if (ds >= from && !(r.exceptions || []).includes(ds))
        out.push({ ...e, occurrenceDate: ds });
      if (r.freq === "none") break;
    }
  }
  return out.sort(
    (a, b) =>
      a.occurrenceDate.localeCompare(b.occurrenceDate) ||
      (a.start || "").localeCompare(b.start || ""),
  );
}
export function query(
  events,
  {
    group,
    user,
    from,
    to,
    text = "",
    type = "",
    status = "",
    visibility = "",
    member = "",
    place = "",
    priority = "",
    sort = "date",
  },
) {
  let result = occurrences(
    events.filter((e) => e.group === group && visible(e, user)),
    from,
    to,
  ).filter(
    (e) =>
      (!text ||
        `${e.title} ${e.description}`
          .toLocaleLowerCase()
          .includes(text.toLocaleLowerCase())) &&
      (!type || e.type === type) &&
      (!status || e.status === status) &&
      (!visibility || e.visibility === visibility) &&
      (!member || e.participants.includes(member)) &&
      (!place ||
        (e.place || "")
          .toLocaleLowerCase()
          .includes(place.toLocaleLowerCase())) &&
      (!priority || e.priority === priority),
  );
  if (sort === "title")
    result.sort((a, b) => a.title.localeCompare(b.title, "ko"));
  if (sort === "desc") result.reverse();
  return result;
}
export function stats(events, types, members) {
  const tally = (items, key) =>
    items.map((x) => ({ ...x, count: events.filter((e) => key(e, x)).length }));
  return {
    total: events.length,
    confirmed: events.filter((e) => e.status === "확정").length,
    types: tally(types, (e, x) => e.type === x.id),
    members: tally(members, (e, x) => e.participants.includes(x.id)),
    weekdays: Array.from({ length: 7 }, (_, i) => ({
      name: ["일", "월", "화", "수", "목", "금", "토"][i],
      count: events.filter((e) => date(e.occurrenceDate).getDay() === i).length,
    })),
  };
}
// Dependency-free OOXML workbook, stored ZIP entries with CRC32.
const enc = new TextEncoder();
function crc(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function zip(files) {
  let offset = 0;
  const parts = [],
    central = [];
  for (const [name, content] of Object.entries(files)) {
    const n = enc.encode(name),
      b = enc.encode(content),
      h = new Uint8Array(30 + n.length),
      v = new DataView(h.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint32(14, crc(b), true);
    v.setUint32(18, b.length, true);
    v.setUint32(22, b.length, true);
    v.setUint16(26, n.length, true);
    h.set(n, 30);
    parts.push(h, b);
    const c = new Uint8Array(46 + n.length),
      w = new DataView(c.buffer);
    w.setUint32(0, 0x02014b50, true);
    w.setUint16(4, 20, true);
    w.setUint16(6, 20, true);
    w.setUint32(16, crc(b), true);
    w.setUint32(20, b.length, true);
    w.setUint32(24, b.length, true);
    w.setUint16(28, n.length, true);
    w.setUint32(42, offset, true);
    c.set(n, 46);
    central.push(c);
    offset += h.length + b.length;
  }
  const size = central.reduce((a, b) => a + b.length, 0),
    end = new Uint8Array(22),
    v = new DataView(end.buffer);
  v.setUint32(0, 0x06054b50, true);
  v.setUint16(8, central.length, true);
  v.setUint16(10, central.length, true);
  v.setUint32(12, size, true);
  v.setUint32(16, offset, true);
  const all = [...parts, ...central, end],
    result = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
  let p = 0;
  for (const b of all) {
    result.set(b, p);
    p += b.length;
  }
  return result;
}
const xml = (s) =>
  escape(String(s ?? "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ""));
export function workbook(sheets) {
  const files = {
    "_rels/.rels":
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  };
  files["[Content_Types].xml"] =
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    sheets
      .map(
        (_, i) =>
          `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join("") +
    "</Types>";
  files["xl/workbook.xml"] =
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
    sheets
      .map(
        (s, i) =>
          `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
      )
      .join("") +
    "</sheets></workbook>";
  files["xl/_rels/workbook.xml.rels"] =
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    sheets
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join("") +
    "</Relationships>";
  sheets.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] =
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
      s.rows
        .map(
          (r, j) =>
            `<row r="${j + 1}">` +
            r
              .map((c) =>
                typeof c === "number"
                  ? `<c><v>${c}</v></c>`
                  : `<c t="inlineStr"><is><t xml:space="preserve">${xml(c)}</t></is></c>`,
              )
              .join("") +
            "</row>",
        )
        .join("") +
      "</sheetData></worksheet>";
  });
  return zip(files);
}
