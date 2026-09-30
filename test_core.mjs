import test from "node:test";
import assert from "node:assert/strict";
import { occurrences, query, stats, workbook } from "./core.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
const base = {
  id: "1",
  group: "g",
  creator: "me",
  title: "가족 모임",
  description: "저녁",
  date: "2026-01-01",
  start: "18:00",
  participants: ["me"],
  visibility: "family",
  type: "t",
  status: "확정",
  repeat: { freq: "none" },
};
test("monthly skips invalid days; leap years remain correct", () => {
  const e = {
    ...base,
    date: "2024-01-31",
    repeat: { freq: "monthly", interval: 1 },
  };
  assert.deepEqual(
    occurrences([e], "2024-01-01", "2024-04-30").map((x) => x.occurrenceDate),
    ["2024-01-31", "2024-03-31"],
  );
  assert.equal(
    occurrences(
      [{ ...e, date: "2024-02-29", repeat: { freq: "yearly" } }],
      "2024-01-01",
      "2028-12-31",
    ).length,
    2,
  );
});
test("weekly weekdays, count, exclusion, and interval", () => {
  const e = {
    ...base,
    date: "2026-09-28",
    repeat: {
      freq: "weekly",
      interval: 2,
      weekdays: [1, 3],
      count: 4,
      exceptions: ["2026-09-30"],
    },
  };
  assert.deepEqual(
    occurrences([e], "2026-09-01", "2026-11-01").map((x) => x.occurrenceDate),
    ["2026-09-28", "2026-10-12", "2026-10-14"],
  );
});
test("nth weekday monthly recurrence", () => {
  const e = {
    ...base,
    date: "2026-09-08",
    repeat: { freq: "monthly", monthMode: "nth" },
  };
  assert.deepEqual(
    occurrences([e], "2026-09-01", "2026-11-30").map((x) => x.occurrenceDate),
    ["2026-09-08", "2026-10-13", "2026-11-10"],
  );
});
test("query excludes other groups, private events, deleted events and applies filters", () => {
  const list = [
    base,
    { ...base, id: "2", group: "other" },
    { ...base, id: "3", creator: "other", visibility: "private" },
    { ...base, id: "4", deletedAt: "2026-01-02" },
  ];
  assert.equal(
    query(list, {
      group: "g",
      user: "me",
      from: "2026-01-01",
      to: "2026-12-31",
      text: "저녁",
      type: "t",
    }).length,
    1,
  );
  assert.equal(
    query(list, {
      group: "g",
      user: "me",
      from: "2026-01-01",
      to: "2026-12-31",
      text: "없음",
    }).length,
    0,
  );
});
test("stats count occurrences and participant counts", () => {
  const s = stats(
    occurrences(
      [{ ...base, repeat: { freq: "daily", count: 3 } }],
      "2026-01-01",
      "2026-02-01",
    ),
    [{ id: "t" }],
    [{ id: "me" }],
  );
  assert.equal(s.total, 3);
  assert.equal(s.confirmed, 3);
  assert.equal(s.members[0].count, 3);
});
test("workbook contains valid ZIP with unicode, escaped values and safe formula strings", () => {
  const bytes = workbook([
    {
      name: "일정",
      rows: [
        ["제목", "건수"],
        ["가족 & <친구>", 3],
        ['=HYPERLINK("bad")', 0],
      ],
    },
    { name: "통계", rows: [["합계", 3]] },
  ]);
  assert.equal(new DataView(bytes.buffer).getUint32(0, true), 0x04034b50);
  mkdirSync("test-results", { recursive: true });
  writeFileSync("test-results/workbook.xlsx", bytes);
});
