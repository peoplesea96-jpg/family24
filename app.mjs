import {
  iso,
  date,
  escape as esc,
  query,
  occurrences,
  stats,
  workbook,
} from "./core.mjs";
const $ = (s) => document.querySelector(s),
  app = $("#app"),
  modal = $("#modal");
let state,
  groupId,
  view = "calendar",
  mode = "month",
  anchor = date(iso(new Date())),
  selected = iso(new Date()),
  currentEvent = null,
  tab = "info",
  holidays = {},
  holidayYear = null,
  coordEvent = "",
  drag = null;
let filters = {
  text: "",
  type: "",
  status: "",
  visibility: "",
  member: "",
  place: "",
  priority: "",
  sort: "date",
  from: iso(new Date(new Date().getFullYear(), 0, 1)),
  to: iso(new Date(new Date().getFullYear(), 11, 31)),
};
const names = {
  family: "가족 전체",
  selected: "특정 가족",
  private: "나만 보기",
};
const fieldNames = {
  title: "제목",
  description: "설명",
  date: "날짜",
  start: "시작 시간",
  end: "종료 시간",
  type: "유형",
  status: "상태",
  priority: "우선순위",
  visibility: "공개 범위",
  place: "장소",
  address: "주소",
  locationMemo: "장소 메모",
  participants: "참여 대상",
  repeat: "반복 규칙",
  anniversary: "기념일",
  notifyAll: "전체 알림",
};
const actionNames = {
  "group.rename": "가족 이름 변경",
  "group.delete": "가족 삭제 예약",
  "group.restore": "가족 복구",
  "member.add": "구성원 프로필 추가",
  "member.role": "관리자 역할 변경",
  "member.reset": "비밀번호 재설정 요청",
  "invite.create": "초대 생성",
  "invite.revoke": "초대 폐기",
  "type.save": "일정 유형 저장",
  "type.delete": "일정 유형 삭제",
};
const freqNames = {
  none: "반복 없음",
  daily: "매일",
  weekly: "매주",
  monthly: "매월",
  yearly: "매년",
};
const navs = [
  ["calendar", "▦", "캘린더"],
  ["search", "⌕", "검색"],
  ["analytics", "▥", "통계"],
  ["anniversaries", "♡", "기념일"],
  ["notifications", "♧", "알림"],
  ["settings", "⚙", "설정"],
];
const group = () => state.groups.find((g) => g.id === groupId),
  me = () => group()?.members.find((m) => m.id === group()?.me),
  prefs = () => ({
    theme: "light",
    defaultView: "month",
    weekends: true,
    compact: false,
    showTime: true,
    showHolidays: true,
    dayStart: 8,
    ...state?.preferences,
  });
const typeOf = (e) =>
  group().types.find((t) => t.id === e.type) || {
    name: "미지정",
    icon: "",
    color: "#65766e",
  };
const memberName = (id) =>
  group().members.find((m) => m.id === id)?.name || "이전 구성원";
const canEdit = (e) => e.creator === group().me || me()?.role === "admin";
const btn = (action, label, cls = "", attrs = "") =>
  `<button type="button" data-action="${action}" class="${cls}" ${attrs}>${label}</button>`;
const field = (label, name, value = "", type = "text", attrs = "") =>
  `<label class="field">${label}<input name="${name}" type="${type}" value="${esc(value)}" ${attrs}></label>`;
const options = (items, value) =>
  items
    .map(
      ([v, n]) =>
        `<option value="${esc(v)}" ${String(value) === String(v) ? "selected" : ""}>${esc(n)}</option>`,
    )
    .join("");
const select = (label, name, items, value = "") =>
  `<label class="field">${label}<select name="${name}">${options(items, value)}</select></label>`;
const check = (label, name, checked, value = "1") =>
  `<label><input type="checkbox" name="${name}" value="${esc(value)}" ${checked ? "checked" : ""}>${esc(label)}</label>`;
const errorBox = '<p class="form-error" role="alert"></p>';
const submit = (label = "저장") =>
  `${errorBox}<div class="form-actions">${btn("close", "취소")}<button class="primary" type="submit">${label}</button></div>`;
function toast(text) {
  $("#toast").textContent = text;
  $("#toast").style.display = "block";
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ($("#toast").style.display = "none"), 4500);
}
async function api(path, body) {
  const r = await fetch("/api/" + path, {
    method: body ? "POST" : "GET",
    headers: body
      ? {
          "Content-Type": "application/json",
          "X-Family24": "1",
          "X-CSRF-Token": state?.csrf || "",
        }
      : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json();
  if (!r.ok) {
    const e = new Error(d.error || "요청을 처리하지 못했습니다.");
    e.status = r.status;
    throw e;
  }
  return d;
}
async function refresh(renderNow = true) {
  state = await api("state");
  if (!state.groups.some((g) => g.id === groupId))
    groupId = state.preferences.lastGroup || state.groups[0]?.id;
  if (!state.groups.some((g) => g.id === groupId))
    groupId = state.groups[0]?.id;
  if (renderNow) render();
}
async function mutate(op, data = {}, message = "저장했습니다.") {
  const r = await api("action", { op, group: groupId, ...data });
  if (r.group) groupId = r.group;
  await refresh();
  if (message) toast(message);
  return r;
}
function openModal(title, body) {
  modal.innerHTML = `<div class="dialog-head"><h2>${esc(title)}</h2>${btn("close", "✕", "ghost", 'aria-label="닫기"')}</div>${body}`;
  if (!modal.open) modal.showModal();
}
function closeModal() {
  modal.close();
}
function getRange() {
  if (view === "calendar" && mode === "month") {
    const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const end = new Date(start);
    end.setDate(end.getDate() + 41);
    return [iso(start), iso(end)];
  }
  if (view === "calendar" && mode === "week") {
    const start = new Date(anchor);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return [iso(start), iso(end)];
  }
  return [filters.from, filters.to];
}
function results() {
  const [from, to] = getRange();
  return query(state.events, {
    ...filters,
    from,
    to,
    group: groupId,
    user: group().me,
  });
}
function memberColor(id) {
  const color = group().members.find(m => m.id === id)?.color;
  return /^#[0-9a-f]{6}$/i.test(color || "") ? color : "#65766e";
}
function memberBadges(ids) {
  return `<span class="member-badges">${ids.map(id => `<span class="member-badge"><span class="member-dot" style="--member-color:${memberColor(id)}" aria-hidden="true"></span>${esc(memberName(id))}</span>`).join("")}</span>`;
}
function memberLegend() {
  return `<div class="member-legend" aria-label="구성원별 일정 색상"><small>구성원 색상</small>${memberBadges(group().members.map(m => m.id))}</div>`;
}
function eventButton(e) {
  const t = typeOf(e);
  return btn(
    "detail",
    `${esc(t.icon)} ${prefs().showTime && e.start ? esc(e.start) + " " : ""}${esc(e.title)}${memberBadges(e.participants)}`,
    "event",
    `style="--event-color:${memberColor(e.participants[0])}" data-id="${e.id}" data-date="${e.occurrenceDate || e.date}" title="${esc(e.title + ' · ' + e.participants.map(memberName).join(', '))}"`,
  );
}
function eventList(events, empty = "아직 일정이 없습니다.") {
  return events.length
    ? `<div class="list">${events.map((e) => `<div class="listitem"><div><button class="title" data-action="detail" data-id="${e.id}" data-date="${e.occurrenceDate || e.date}">${esc(typeOf(e).icon)} ${esc(e.title)}</button><p class="muted">${esc(e.occurrenceDate || e.date)} · ${esc(e.start || "시간 미정")} · ${esc(e.place || "장소 미정")}</p><small>${memberBadges(e.participants)}</small></div><span class="badge">${esc(e.status)}</span></div>`).join("")}</div>`
    : `<div class="empty">${empty}${btn("new", "첫 일정 만들기", "primary")}</div>`;
}
function render() {
  const p = prefs();
  document.body.className = [
    p.theme === "dark" ? "dark" : "",
    p.compact ? "compact" : "",
    !p.weekends ? "hide-weekends" : "",
  ].join(" ");
  if (!state.groups.length) {
    onboard();
    return;
  }
  const unread = state.notifications.filter((n) => !n.read).length;
  app.innerHTML = `<div class="layout"><aside class="sidebar"><div class="brand">family<span>24</span><div class="eyebrow">OUR TIME, TOGETHER</div></div><div><label class="field">가족 그룹<select id="groupSelect" class="group-select">${options(
    state.groups.map((g) => [
      g.id,
      g.name + (g.deletedAt ? " (삭제 예정)" : ""),
    ]),
    groupId,
  )}</select></label></div><nav aria-label="주요 메뉴">${navs.map(([id, icon, label]) => btn("nav", `<span class="nav-icon">${icon}</span><span>${label}${id === "notifications" && unread ? ` <span class="count">${unread}</span>` : ""}</span>`, view === id ? "active" : "", `data-view="${id}"`)).join("")}</nav><footer><strong>${esc(state.user.name)}</strong><br>${esc(state.user.email)}<div class="row">${btn("theme", p.theme === "dark" ? "☀ 라이트" : "☾ 다크", "small")}${btn("logout", "로그아웃", "small")}</div><p style="margin-top:18px">가족의 일상에<br>함께할 시간을 더해요.</p></footer></aside><main class="main"><header class="topbar"><div><div class="eyebrow">${esc(group().name)} / FAMILY SPACE</div><h1>${view === "detail" ? "일정 상세" : navs.find((n) => n[0] === view)?.[2] || "캘린더"}</h1><p class="muted">${view === "calendar" ? "각자의 하루를 모아, 우리의 시간을 만듭니다." : "함께 계획하고, 더 여유롭게."}</p></div><div class="row">${btn("refresh", "↻", "", 'aria-label="새로고침"')}${btn("new", "＋ 일정 만들기", "primary")}</div></header><div id="content"></div></main></div>`;
  $("#groupSelect").onchange = async (e) => {
    groupId = e.target.value;
    filters.type = "";
    filters.member = "";
    currentEvent = null;
    coordEvent = "";
    view = "calendar";
    render();
    await savePrefs({ lastGroup: groupId }, false);
  };
  if (group().deletedAt) {
    $("#content").innerHTML =
      `<div class="panel empty">이 그룹은 삭제 대기 중입니다. 삭제일로부터 30일 이내에 복구할 수 있습니다.${group().owner === group().me ? btn("restoreGroup", "그룹 복구", "primary") : ""}</div>`;
    return;
  }
  const renderers = {
    calendar: calendar,
    search: search,
    analytics: analytics,
    anniversaries: anniversaries,
    settings: settings,
    notifications: notifications,
    detail: detail,
  };
  renderers[view]();
}
function onboard() {
  app.innerHTML = `<div class="onboard panel"><div class="brand">family24</div><h1 style="margin-top:25px">우리 가족의 공간 만들기</h1><p class="muted">${esc(state.user.name)}님, 가족을 만들거나 초대로 합류하세요.</p>${groupForms()}${btn("logout", "로그아웃", "ghost")}</div>`;
}
function groupForms() {
  return `<div class="stack"><form data-form="group"><h3>새 가족 그룹</h3>${field("가족 이름", "name", "", "text", 'required maxlength="60"')}${errorBox}<button class="primary" type="submit">가족 만들기</button></form><hr><form data-form="join"><h3>초대로 참여하기</h3>${field("초대 코드 또는 링크", "code", new URLSearchParams(location.search).get("invite") || "", "text", "required")}${errorBox}<button type="submit">가족에 참여</button></form></div>`;
}
function auth(mode = "login") {
  state = null;
  const label =
    mode === "register"
      ? "회원가입"
      : mode === "reset"
        ? "비밀번호 재설정"
        : "로그인";
  app.innerHTML = `<div class="auth"><section class="auth-art"><div class="brand">family<span>24</span></div><h1>서로의 하루가<br>만나는 시간.</h1><p>바쁜 일상 속에서도 놓치고 싶지 않은 가족의 순간들.<br>일정을 모으고, 시간을 맞추고, 함께하세요.</p></section><section class="auth-card"><div><div class="eyebrow">WELCOME TO FAMILY24</div><h2>${label}</h2><p class="muted">이메일로 우리 가족의 시간을 연결하세요.</p><form data-form="auth" data-mode="${mode}">${mode === "register" ? field("이름", "name", "", "text", 'required maxlength="40" autocomplete="name"') : ""}${field("이메일", "email", "", "email", 'required autocomplete="username"')}${mode === "reset" ? field("관리자에게 받은 재설정 코드", "code", "", "text", "required") : ""}${field(mode === "reset" ? "새 비밀번호" : "비밀번호", "password", "", "password", `required minlength="10" maxlength="128" autocomplete="${mode === "login" ? "current-password" : "new-password"}"`)}<small>비밀번호는 10자 이상입니다.</small>${errorBox}<button type="submit" class="primary">${label}</button></form><div class="row">${[
    "login",
    "register",
    "reset",
  ]
    .filter((x) => x !== mode)
    .map((x) =>
      btn(
        "auth",
        { login: "로그인", register: "회원가입", reset: "비밀번호 재설정" }[x],
        "ghost",
        `data-mode="${x}"`,
      ),
    )
    .join("")}</div></div></section></div>`;
}
function filterBar(advanced = false) {
  return `<form data-form="filters"><div class="filters">${field("제목·내용 검색", "text", filters.text, "search")}${select("일정 유형", "type", [["", "모든 유형"], ...group().types.map((t) => [t.id, t.icon + " " + t.name])], filters.type)}${select("가족 구성원", "member", [["", "모든 구성원"], ...group().members.map((m) => [m.id, m.name])], filters.member)}${select("상태", "status", [["", "모든 상태"], ...["제안", "조율 중", "확정", "취소"].map((x) => [x, x])], filters.status)}${select("공개 범위", "visibility", [["", "모든 공개 범위"], ...Object.entries(names)], filters.visibility)}${
    advanced
      ? `${field("시작일", "from", filters.from, "date", "required")}${field("종료일", "to", filters.to, "date", "required")}${field("장소 포함", "place", filters.place)}${select(
          "우선순위",
          "priority",
          [
            ["", "모든 우선순위"],
            ["일반", "일반"],
            ["필수", "필수"],
          ],
          filters.priority,
        )}${select(
          "정렬",
          "sort",
          [
            ["date", "날짜 빠른 순"],
            ["desc", "날짜 늦은 순"],
            ["title", "제목 순"],
          ],
          filters.sort,
        )}`
      : ""
  }</div><div class="row" style="margin-bottom:18px"><button type="submit" class="small primary">조건 적용</button>${btn("clearFilters", "초기화", "small")}${advanced ? `${btn("csv", "CSV 내보내기", "small")}${btn("xlsx", "XLSX · 여러 시트", "small")}` : ""}<span class="muted" style="font-size:12px">접근 권한이 있는 일정만 표시합니다.</span></div>${errorBox}</form>`;
}
async function loadHolidays() {
  const y = anchor.getFullYear();
  if (holidayYear === y) return;
  holidayYear = y;
  try {
    holidays = await api("holidays?year=" + y);
    if (view === "calendar") calendar();
  } catch (e) {
    toast(e.message);
    holidayYear = null;
  }
}
function calendar() {
  $("#content").innerHTML =
    `<div class="toolbar">${btn("prev", "‹", "", 'aria-label="이전 기간"')}<h2 style="margin:0 8px">${anchor.getFullYear()}년 ${anchor.getMonth() + 1}월</h2>${btn("next", "›", "", 'aria-label="다음 기간"')}${btn("today", "오늘", "small")}<div style="flex:1"></div>${[
      ["month", "월간"],
      ["week", "주간"],
      ["agenda", "목록"],
    ]
      .map(([v, n]) =>
        btn("mode", n, mode === v ? "active" : "", `data-mode="${v}"`),
      )
      .join(
        "",
      )}${btn("xlsx", "내보내기", "small")}</div>${matchMedia("(max-width:760px)").matches ? '<details class="mobile-filters"><summary>일정 검색·필터</summary>' + filterBar(false) + "</details>" : filterBar(false)}${memberLegend()}<div id="calendarBody"></div>`;
  loadHolidays();
  const events = results();
  if (mode === "agenda") {
    $("#calendarBody").innerHTML = eventList(events);
    return;
  }
  if (mode === "week") {
    week(events);
    return;
  }
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  first.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  let html = ["월", "화", "수", "목", "금", "토", "일"]
    .map((x, i) => `<div class="day-head ${i > 4 ? "weekend" : ""}">${x}</div>`)
    .join("");
  for (let i = 0; i < 42; i++) {
    const d = new Date(first);
    d.setDate(d.getDate() + i);
    const ds = iso(d),
      ev = events.filter((e) => e.occurrenceDate === ds);
    html += `<div class="day ${d.getMonth() !== anchor.getMonth() ? "outside" : ""} ${ds === iso(new Date()) ? "today" : ""} ${ds === selected ? "selected" : ""} ${i % 7 > 4 ? "weekend" : ""}">${btn("day", String(d.getDate()), "datebtn", `data-date="${ds}" aria-label="${ds} 일정 보기"`)}<span class="holiday" title="${esc(holidays[ds] || "")}">${prefs().showHolidays ? esc(holidays[ds] || "") : ""}</span>${ev.slice(0, 3).map(eventButton).join("")}${ev.length > 3 ? btn("day", `+${ev.length - 3}개 더보기`, "small ghost", `data-date="${ds}"`) : ""}</div>`;
  }
  $("#calendarBody").innerHTML =
    `<div class="calendar-layout"><div class="calendar">${html}</div><aside class="panel date-panel"><div class="eyebrow">YOUR DAY</div><h2>${esc(selected)}</h2>${dayContent(selected, events)}</aside></div>`;
}
function dayContent(ds, events = results()) {
  return `${eventList(
    events.filter((e) => e.occurrenceDate === ds),
    "이날은 비어 있어요. 함께할 시간을 계획해 보세요.",
  )}${btn("new", "＋ 이 날짜에 일정 추가", "small", `data-date="${ds}"`)}`;
}
function week(events) {
  const [from] = getRange();
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = date(from);
    d.setDate(d.getDate() + i);
    return iso(d);
  });
  const candidates = state.events.filter(
    (e) =>
      e.group === groupId &&
      !e.deletedAt &&
      e.participants.includes(group().me),
  );
  if (!candidates.some((e) => e.id === coordEvent))
    coordEvent = candidates[0]?.id || "";
  const e = candidates.find((e) => e.id === coordEvent);
  let html =
    '<div class="weekhead">시간</div>' +
    days
      .map(
        (d) =>
          `<div class="weekhead">${esc(d.slice(5))} ${["일", "월", "화", "수", "목", "금", "토"][date(d).getDay()]}</div>`,
      )
      .join("");
  for (let h = Number(prefs().dayStart); h < 24; h++) {
    const start = String(h).padStart(2, "0") + ":00",
      end = String(h + 1).padStart(2, "0") + ":00";
    html += `<div>${start}</div>`;
    for (const ds of days) {
      const own = e?.availability.find(
        (a) =>
          a.member === group().me &&
          a.date === ds &&
          a.start <= start &&
          a.end >= end,
      );
      const responses = (e?.participants || [])
        .filter((id) => !filters.member || id === filters.member)
        .map((id) => ({
          name: memberName(id),
          status:
            e.availability.find(
              (a) =>
                a.member === id &&
                a.date === ds &&
                a.start <= start &&
                a.end >= end,
            )?.status || "미정",
        }));
      const summary = responses
        .map((a) => a.name + ": " + a.status)
        .join(" / ");
      const ev = events.filter(
        (x) =>
          x.occurrenceDate === ds &&
          (x.start?.slice(0, 2) === String(h).padStart(2, "0") ||
            (!x.start && h === Number(prefs().dayStart))),
      );
      html += `<div class="slot">${ev.map(eventButton).join("")}<button data-slot="1" data-date="${ds}" data-hour="${h}" class="${own?.status === "가능" ? "free" : own?.status === "불가능" ? "busy" : ""}" aria-label="${ds} ${start} 가용 시간 입력">${own?.status || "＋"}<br><span title="${esc(summary)}">가능 ${responses.filter((a) => a.status === "가능").length} · 불가 ${responses.filter((a) => a.status === "불가능").length}</span></button></div>`;
    }
  }
  $("#calendarBody").innerHTML =
    `<div class="notice">시간 칸을 클릭하거나 같은 날짜에서 드래그해 가용 시간을 입력하세요. 상세 화면에서 가족별 응답과 후보 시간을 비교할 수 있습니다.</div><div class="toolbar"><label class="field">조율할 일정<select id="coordSelect">${options([["", "일정 선택"], ...candidates.map((e) => [e.id, e.title])], coordEvent)}</select></label>${e ? btn("detail", "가족 응답 비교", "small", `data-id="${e.id}" data-date="${e.date}"`) : ""}</div><div class="weekwrap"><div class="week">${html}</div></div>`;
  $("#coordSelect").onchange = (ev) => {
    coordEvent = ev.target.value;
    week(events);
  };
}
function search() {
  $("#content").innerHTML =
    `${filterBar(true)}<p class="muted">${results().length}개의 일정</p>${eventList(results(), "검색 조건에 맞는 일정이 없습니다.")}`;
}
function chart(title, items) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return `<section class="panel"><h3>${title}</h3>${items.map((i) => `<div class="barrow"><span>${esc(i.name)}</span><div class="bar"><i style="width:${(i.count / max) * 100}%"></i></div><span>${i.count}</span></div>`).join("")}</section>`;
}
function analytics() {
  const events = results(),
    s = stats(events, group().types, group().members),
    busy = [...s.weekdays].sort((a, b) => b.count - a.count)[0];
  $("#content").innerHTML =
    `${filterBar(true)}<div class="metrics"><div class="panel metric"><small>기간 내 일정</small><strong>${s.total}<small> 건</small></strong></div><div class="panel metric"><small>확정 비율</small><strong>${s.total ? Math.round((s.confirmed / s.total) * 100) : 0}%</strong></div><div class="panel metric"><small>가장 바쁜 요일</small><strong>${s.total ? busy.name + "요일" : "—"}</strong></div></div><div class="notice">반복 일정은 발생 날짜별로 집계합니다. 현재 검색 조건과 공개 권한을 적용하며, 취소된 일정도 상태 필터로 제외하지 않으면 포함됩니다.</div><div class="chartgrid">${chart("일정 유형별", s.types)}${chart("가족 구성원별 참여 대상 일정", s.members)}${chart("요일별 일정 패턴", s.weekdays)}<section class="panel"><h3>월별 일정 밀도</h3>${chartMonths(events)}</section></div>`;
}
function chartMonths(events) {
  const bins = new Map();
  for (const e of events) {
    const month = e.occurrenceDate.slice(0, 7);
    bins.set(month, (bins.get(month) || 0) + 1);
  }
  return bins.size
    ? [...bins]
        .map(
          ([name, count]) =>
            `<p class="row between"><span>${name}</span><strong>${count}건</strong></p>`,
        )
        .join("")
    : '<p class="muted">일정이 쌓이면 월별 패턴을 확인할 수 있어요.</p>';
}
function anniversaries() {
  const events = results().filter((e) => e.anniversary),
    today = date(iso(new Date()));
  $("#content").innerHTML =
    `${filterBar(true)}<div class="notice">일정 만들기에서 ‘기념일’을 선택하세요. 매년 반복을 설정하면 다음 해에도 표시됩니다.</div><div class="anniversary">${
      events
        .map((e) => {
          const delta = Math.round((date(e.occurrenceDate) - today) / 86400000);
          return `<section class="panel"><small>${esc(e.occurrenceDate)}</small><strong>${delta === 0 ? "D-DAY" : delta > 0 ? "D−" + delta : "D+" + Math.abs(delta)}</strong>${btn("detail", `${esc(typeOf(e).icon)} ${esc(e.title)}`, "title", `data-id="${e.id}" data-date="${e.occurrenceDate}"`)}<p class="muted">${memberBadges(e.participants)}</p></section>`;
        })
        .join("") || '<div class="empty">등록된 기념일이 없습니다.</div>'
    }</div>`;
}
function notifications() {
  const list = state.notifications
    .filter((n) => n.group === groupId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  $("#content").innerHTML =
    `<div class="row" style="margin-bottom:18px">${btn("readAll", "모두 읽음", "small")}<small>알림은 90일 동안 보관됩니다.</small></div><div class="list">${list.map((n) => `<div class="listitem ${n.read ? "" : "unread"}"><div>${btn("notification", esc(n.message), "title", `data-id="${n.id}" data-event="${n.event}"`)}<p class="muted">${new Date(n.createdAt).toLocaleString("ko-KR")}</p></div><span class="badge">${n.read ? "읽음" : "새 알림"}</span></div>`).join("") || '<div class="empty">새 알림이 없습니다.</div>'}</div>`;
}
function detail() {
  const e = state.events.find(
    (x) => x.id === currentEvent?.id && x.group === groupId && !x.deletedAt,
  );
  if (!e) {
    $("#content").innerHTML =
      '<div class="empty">일정을 찾을 수 없습니다.</div>';
    return;
  }
  const ds = currentEvent.date || e.date;
  $("#content").innerHTML =
    `<div class="panel"><header class="detail-head"><div class="row between"><span class="badge">${esc(e.status)} · ${esc(e.priority)}</span><div class="row">${btn("nav", "캘린더로", "small", 'data-view="calendar"')}${canEdit(e) ? btn("edit", "수정", "small", `data-id="${e.id}"`) : ""}</div></div><h1 style="margin:18px 0">${esc(typeOf(e).icon)} ${esc(e.title)}</h1><p>${esc(ds)} · ${esc(e.start || "시간 미정")}${e.end ? "–" + esc(e.end) : ""}</p><p class="muted">${memberBadges(e.participants)} · ${esc(names[e.visibility])}</p></header><div class="tabs">${[
      ["info", "일정 정보"],
      ["coord", "시간 조율"],
      ["comments", "댓글"],
      ["history", "변경 이력"],
    ]
      .map(([v, n]) =>
        btn("tab", n, tab === v ? "active" : "", `data-tab="${v}"`),
      )
      .join("")}</div><div id="detailPane"></div></div>`;
  const pane = $("#detailPane");
  if (tab === "info")
    pane.innerHTML = `<dl class="kv"><dt>설명</dt><dd>${esc(e.description || "—")}</dd><dt>장소</dt><dd>${esc(e.place || "—")}<br>${esc(e.address)}<br>${esc(e.locationMemo)}</dd><dt>작성자</dt><dd>${esc(memberName(e.creator))}</dd><dt>반복</dt><dd>${esc(freqNames[e.repeat.freq])}${e.repeat.freq !== "none" ? ` · ${e.repeat.interval || 1} 간격 ${e.repeat.count ? " / " + e.repeat.count + "회" : ""} ${e.repeat.until ? " / " + e.repeat.until + "까지" : ""}` : ""}</dd></dl><h3>참여 응답</h3>${e.participants.map((id) => `<p>${esc(memberName(id))} · ${esc(e.responses[id]?.status || "미정")} <small>${esc(e.responses[id]?.reason || "")}</small></p>`).join("")}${
      e.participants.includes(group().me)
        ? `<form data-form="response" data-id="${e.id}" class="formgrid">${select(
            "나의 응답",
            "status",
            ["참여", "불참", "미정"].map((x) => [x, x]),
            e.responses[group().me]?.status || "미정",
          )}${field("불참 사유 (필수 일정은 입력 권장)", "reason", e.responses[group().me]?.reason || "")}<div><button type="submit">응답 저장</button>${errorBox}</div></form>`
        : ""
    }${canEdit(e) ? `<div class="form-actions">${btn("deleteEvent", "휴지통으로 이동", "danger", `data-id="${e.id}"`)}</div>` : ""}`;
  if (tab === "coord") pane.innerHTML = coordination(e, ds);
  if (tab === "comments")
    pane.innerHTML = `${e.comments.map((c) => `<div class="comment"><strong>${esc(c.name)}</strong> <small>${new Date(c.at).toLocaleString("ko-KR")}</small><p>${esc(c.content)}</p><div class="row">${c.author === group().me ? btn("editComment", "수정", "small", `data-id="${c.id}"`) : ""}${c.author === group().me || me().role === "admin" ? btn("deleteComment", "삭제", "small danger", `data-id="${c.id}"`) : ""}</div></div>`).join("") || '<p class="muted">첫 의견을 남겨 보세요.</p>'}<form data-form="comment" data-id="${e.id}"><label class="field">댓글<textarea name="content" maxlength="3000" required></textarea></label>${errorBox}<button type="submit" class="primary">댓글 등록</button></form>`;
  if (tab === "history")
    pane.innerHTML = e.history.length
      ? e.history
          .slice()
          .reverse()
          .map(
            (h) =>
              `<div class="comment"><strong>${esc(h.by)}</strong> <small>${new Date(h.at).toLocaleString("ko-KR")}</small><p>${esc(fieldNames[h.field] || h.field)}: ${esc(formatValue(h.before, h.field))} → ${esc(formatValue(h.after, h.field))}</p></div>`,
          )
          .join("")
      : '<p class="muted">주요 변경 이력이 없습니다.</p>';
}
function settings() {
  const f = group(),
    admin = me().role === "admin",
    p = prefs(),
    trash = state.events.filter((e) => e.group === groupId && e.deletedAt);
  $("#content").innerHTML =
    `<div class="chartgrid"><section class="panel"><h2>나의 화면 설정</h2><form data-form="preferences" class="stack">${select(
      "테마",
      "theme",
      [
        ["light", "라이트"],
        ["dark", "다크"],
      ],
      p.theme,
    )}${select(
      "기본 캘린더",
      "defaultView",
      [
        ["month", "월간"],
        ["week", "주간"],
        ["agenda", "목록"],
      ],
      p.defaultView,
    )}${select(
      "주간 시작 시간",
      "dayStart",
      Array.from({ length: 24 }, (_, i) => [i, i + "시"]),
      p.dayStart,
    )}<div class="checks">${check("주말 표시", "weekends", p.weekends)}${check("조밀한 월간 보기", "compact", p.compact)}${check("일정 시간 표시", "showTime", p.showTime)}${check("공휴일 표시", "showHolidays", p.showHolidays)}</div>${errorBox}<button type="submit" class="primary">설정 저장</button></form><hr><small>${esc(state.user.email)}</small><div class="row" style="margin-top:12px">${btn("logout", "로그아웃", "small")}</div></section><section class="panel"><h2>가족 구성원</h2>${f.members.map((m) => `<div class="card"><div class="row between"><strong>${memberBadges([m.id])}</strong><span class="badge">${m.id === f.owner ? "최초 생성자" : m.role === "admin" ? "관리자" : "구성원"}</span></div><p class="muted">${m.user ? "계정 연결됨" : "계정 없는 프로필"}</p><div class="row">${admin && m.role !== "admin" ? btn("role", "관리자 추가", "small", `data-id="${m.id}" data-role="admin"`) : ""}${m.role === "admin" && m.id !== f.owner && (m.id === f.me || f.me === f.owner) ? btn("role", "관리자 해제", "small", `data-id="${m.id}" data-role="member"`) : ""}${admin && m.user && (m.id !== f.owner || f.me === f.owner) ? btn("resetMember", "비밀번호 재설정", "small", `data-id="${m.id}"`) : ""}</div></div>`).join("")}${admin ? `<form data-form="member" class="row" style="margin-top:18px">${field("새 프로필 이름", "name", "", "text", 'required maxlength="40"')}<button type="submit">추가</button>${errorBox}</form>` : ""}</section><section class="panel"><h2>일정 유형 · 아이콘</h2>${f.types.map((t) => `<div class="card row between"><span style="color:${t.color}">${esc(t.icon)} ${esc(t.name)}</span>${admin ? `<div>${btn("editType", "수정", "small", `data-id="${t.id}"`)} ${t.id === "personal" ? '<small>기본 유형</small>' : btn("deleteType", "삭제", "small danger", `data-id="${t.id}"`)}</div>` : ""}</div>`).join("")}${btn("newType", "＋ 유형 추가", "small")}</section><section class="panel"><h2>가족 초대</h2>${admin ? `<p class="muted">초대는 7일간 유효하며, 참여 시 한 번 사용됩니다.</p><form data-form="invite">${select("연결할 프로필", "profile", [["", "새 구성원으로 참여"], ...f.members.filter((m) => !m.user).map((m) => [m.id, m.name])])}${errorBox}<button type="submit">초대 만들기</button></form>${f.invites.map((i) => `<div class="card"><code>${esc(i.code)}</code><p class="muted">${new Date(i.expires * 1000).toLocaleDateString("ko-KR")} 만료 · ${i.profile ? esc(memberName(i.profile)) : "새 구성원"}</p>${btn("copyInvite", "링크 복사", "small", `data-code="${i.code}"`)} ${btn("revokeInvite", "폐기", "small danger", `data-code="${i.code}"`)}</div>`).join("")}` : '<p class="muted">초대는 가족 관리자가 생성할 수 있습니다.</p>'}</section><section class="panel"><h2>휴지통</h2><p class="muted">삭제 후 30일간 보관합니다.</p>${trash.map((e) => `<div class="card"><strong>${esc(e.title)}</strong><p class="muted">${e.date} · ${Math.max(0, 30 - Math.floor((Date.now() - Date.parse(e.deletedAt)) / 86400000))}일 후 영구 삭제</p>${canEdit(e) ? `${btn("restoreEvent", "복구", "small", `data-id="${e.id}"`)} ${btn("purgeEvent", "영구 삭제", "small danger", `data-id="${e.id}"`)}` : ""}</div>`).join("") || '<p class="muted">휴지통이 비어 있습니다.</p>'}</section><section class="panel"><h2>가족 그룹 관리</h2>${admin ? `<form data-form="rename" class="stack">${field("가족 이름", "name", f.name, "text", 'required maxlength="60"')}<button type="submit">이름 변경</button>${errorBox}</form>` : ""}<details style="margin:18px 0"><summary>가족 추가·초대 참여</summary>${groupForms()}</details>${f.owner === f.me ? btn("deleteGroup", "가족 그룹 삭제 예약", "danger") : ""}<p class="muted" style="margin-top:10px">그룹 삭제는 30일 이내 복구할 수 있습니다.</p></section>${
      admin
        ? `<section class="panel full"><h2>운영 이력</h2>${
            f.audit
              .slice()
              .reverse()
              .map(
                (a) =>
                  `<p><strong>${esc(a.by)}</strong> · ${esc(actionNames[a.action] || a.action)} <small>${new Date(a.at).toLocaleString("ko-KR")}</small></p>`,
              )
              .join("") || '<p class="muted">운영 이력이 없습니다.</p>'
          }</section>`
        : ""
    }</div>`;
}
function editEvent(id, ds) {
  const e = state.events.find((e) => e.id === id),
    r = e?.repeat || { freq: "none" },
    f = group();
  const eventDate = ds || e?.date || selected;
  openModal(
    e ? "일정 수정" : "함께할 시간 만들기",
    `<form data-form="event" data-id="${e?.id || ""}" data-version="${e?.version || ""}" data-occurrence="${esc(ds || currentEvent?.date || e?.date || eventDate)}"><div class="formgrid"><div class="full">${field("일정 제목", "title", e?.title || "", "text", 'required maxlength="120"')}</div>${select(
      "일정 유형",
      "type",
      f.types.map((t) => [t.id, t.icon + " " + t.name]),
      e?.type || f.types[0]?.id,
    )}${select(
      "상태",
      "status",
      ["제안", "조율 중", "확정", "취소"].map((x) => [x, x]),
      e?.status || "제안",
    )}${field("날짜", "date", eventDate, "date", 'required min="1900-01-01" max="2100-12-31"')}${select(
      "우선순위",
      "priority",
      [
        ["일반", "일반"],
        ["필수", "필수"],
      ],
      e?.priority || "일반",
    )}${field("시작 시간 (선택)", "start", e?.start || "", "time")}${field("종료 시간 (선택)", "end", e?.end || "", "time")}<div class="full" data-participants><h3>참여 대상</h3><div class="checks">${f.members.map((m) => check(m.name, "participants", e ? e.participants.includes(m.id) : true, m.id)).join("")}</div></div>${field("장소명", "place", e?.place || "")}${field("주소", "address", e?.address || "")}<div class="full">${field("장소 메모", "locationMemo", e?.locationMemo || "")}</div><label class="field full">설명<textarea name="description" maxlength="5000">${esc(e?.description || "")}</textarea></label><div class="full"><details ${e ? "open" : ""}><summary>공개 범위 · 반복 · 기념일</summary><div class="formgrid">${select("공개 범위", "visibility", Object.entries(names), e?.visibility || "family")}${select("반복", "freq", Object.entries(freqNames), r.freq)}${field("반복 간격", "interval", r.interval || 1, "number", 'min="1" max="52" required')}${field("최대 반복 횟수 (선택)", "count", r.count || "", "number", 'min="1" max="1000"')}${field("반복 종료일 (선택)", "until", r.until || "", "date")}${select(
      "월간 반복 방식",
      "monthMode",
      [
        ["date", "같은 날짜"],
        ["nth", "같은 순서의 요일 (예: 둘째 화요일)"],
      ],
      r.monthMode || "date",
    )}<div class="full"><h3>주간 반복 요일 (미선택 시 시작 요일)</h3><div class="checks">${[1, 2, 3, 4, 5, 6, 0].map((i) => check(["일", "월", "화", "수", "목", "금", "토"][i], "weekdays", (r.weekdays || []).includes(i), String(i))).join("")}</div></div><div class="checks full">${check("기념일", "anniversary", e?.anniversary)}${check("가족 전체에 알림", "notifyAll", e?.notifyAll)}</div>${
      e && r.freq !== "none"
        ? select(
            "반복 수정 범위",
            "scope",
            [
              ["series", "전체 반복 일정"],
              ["one", "이번 일정만"],
              ["following", "이 일정 이후 반복분"],
            ],
            "one",
          )
        : ""
    }</div><p class="muted" style="margin:15px 0 0;font-size:12px">존재하지 않는 날짜(예: 2월 31일)는 건너뜁니다. 비공개 알림은 허용된 구성원에게만 전달됩니다.</p></details></div></div>${submit(e ? "변경 저장" : "일정 만들기")}</form>`,
  );
  const form = document.querySelector('[data-form="event"]');
  if (e?.type === "personal") updatePersonalTarget(form, true);
}
function updatePersonalTarget(form, initial = false) {
  const personal = form.elements.type.value === "personal";
  const area = form.querySelector("[data-participants]");
  if (!area) return;
  const current = new FormData(form).getAll("participants");
  const chosen = initial && current.length === 1 ? current[0] : group().me;
  area.innerHTML = personal
    ? `${select("누구의 일정인가요?", "participants", group().members.map(m => [m.id, m.name]), chosen)}<p class="muted">한 사람의 스케줄을 기록합니다. 공개 범위는 아래에서 별도로 선택하세요. ‘나만 보기’는 작성자 본인만 볼 수 있습니다.</p>`
    : `<h3>참여 대상</h3><div class="checks">${group().members.map(m => check(m.name, "participants", current.includes(m.id), m.id)).join("")}</div>`;
}
document.addEventListener("change", e => {
  const form = e.target.closest('[data-form="event"]');
  if (form && e.target.name === "type") updatePersonalTarget(form);
});
function editType(id) {
  const t = group().types.find((x) => x.id === id);
  openModal(
    t ? "유형 수정" : "새 일정 유형",
    `<form data-form="type" data-id="${t?.id || ""}"><div class="formgrid">${field("이름", "name", t?.name || "", "text", 'required maxlength="30"')}${field("아이콘 (이모지)", "icon", t?.icon || "📅", "text", 'maxlength="8"')}${field("색상", "color", t?.color || "#4f7669", "color")}</div>${submit()}</form>`,
  );
}
function availability(id, ds, start = "09:00", end = "10:00") {
  openModal(
    "나의 가용 시간",
    `<form data-form="availability" data-id="${id}"><div class="formgrid">${field("날짜", "date", ds, "date", "required")}${select(
      "상태",
      "status",
      ["가능", "불가능", "미정"].map((x) => [x, x]),
      "가능",
    )}${field("시작", "start", start, "time", "required")}${field("종료", "end", end === "24:00" ? "23:59" : end, "time", "required")}</div><p class="muted">선택한 시간 범위만 변경하며, 나머지 기존 응답은 유지됩니다.</p>${submit()}</form>`,
  );
}
function ask(title, text, op, data) {
  openModal(
    title,
    `<p>${esc(text)}</p><form data-form="confirm"><div class="form-actions">${btn("close", "취소")}<button type="submit" class="primary">확인</button></div>${errorBox}</form>`,
  );
  modal.querySelector("form")._command = { op, data };
}
async function savePrefs(p, renderNow = true) {
  await api("action", {
    op: "preferences",
    preferences: { ...state.preferences, ...p },
  });
  await refresh(renderNow);
}
function download(name, bytes, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportData(xlsx) {
  const events = results(),
    f = group(),
    s = stats(events, f.types, f.members);
  const rows = [
    [
      "제목",
      "설명",
      "유형",
      "상태",
      "우선순위",
      "공개 범위",
      "날짜",
      "시작",
      "종료",
      "장소",
      "주소",
      "장소 메모",
      "작성자",
      "참여 대상",
      "반복",
      "생성일",
      "수정일",
    ],
    ...events.map((e) => [
      e.title,
      e.description,
      typeOf(e).name,
      e.status,
      e.priority,
      names[e.visibility],
      e.occurrenceDate,
      e.start,
      e.end,
      e.place,
      e.address,
      e.locationMemo,
      memberName(e.creator),
      e.participants.map(memberName).join(", "),
      JSON.stringify(e.repeat),
      e.createdAt,
      e.updatedAt || e.createdAt,
    ]),
  ];
  if (!xlsx) {
    const csv = rows
      .map((r) =>
        r
          .map(
            (v) =>
              '"' +
              String(v ?? "")
                .replace(/^[=+\-@\t\r]/, "'$&")
                .replaceAll('"', '""') +
              '"',
          )
          .join(","),
      )
      .join("\r\n");
    download("family24-events.csv", "\ufeff" + csv, "text/csv;charset=utf-8");
    return;
  }
  const sheets = [
    { name: "일정", rows },
    {
      name: "구성원",
      rows: [
        ["이름", "역할", "참여 대상 일정 수"],
        ...s.members.map((m) => [
          m.name,
          m.role === "admin" ? "관리자" : "구성원",
          m.count,
        ]),
      ],
    },
    {
      name: "일정 유형",
      rows: [
        ["유형", "아이콘", "색상", "일정 수"],
        ...s.types.map((t) => [t.name, t.icon, t.color, t.count]),
      ],
    },
    {
      name: "통계",
      rows: [
        ["항목", "값"],
        ["가족", f.name],
        ["시작일", getRange()[0]],
        ["종료일", getRange()[1]],
        ["전체 일정", s.total],
        ["확정 일정", s.confirmed],
        ...s.weekdays.map((d) => [d.name + "요일", d.count]),
      ],
    },
    {
      name: "참여 응답",
      rows: [
        ["일정", "날짜", "구성원", "응답", "불참 사유"],
        ...events.flatMap((e) =>
          e.participants.map((id) => [
            e.title,
            e.occurrenceDate,
            memberName(id),
            e.responses?.[id]?.status || "미정",
            e.responses?.[id]?.reason || "",
          ]),
        ),
      ],
    },
  ];
  download(
    "family24.xlsx",
    workbook(sheets),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
}
async function handleAction(b) {
  const a = b.dataset.action,
    d = b.dataset;
  if (a === "close") return closeModal();
  if (a === "auth") return auth(d.mode);
  if (a === "logout") {
    await api("logout", {});
    closeModal();
    return auth();
  }
  if (a === "refresh") {
    await refresh();
    return toast("최신 내용으로 갱신했습니다.");
  }
  if (a === "nav") {
    view = d.view;
    currentEvent = null;
    render();
    return;
  }
  if (a === "theme")
    return savePrefs({ theme: prefs().theme === "dark" ? "light" : "dark" });
  if (a === "new") return editEvent(null, d.date || selected);
  if (a === "mode") {
    mode = d.mode;
    calendar();
    return;
  }
  if (["prev", "next", "today"].includes(a)) {
    if (a === "today") anchor = date(iso(new Date()));
    else if (mode === "week")
      anchor.setDate(anchor.getDate() + (a === "next" ? 7 : -7));
    else
      anchor = new Date(
        anchor.getFullYear(),
        anchor.getMonth() + (a === "next" ? 1 : -1),
        1,
      );
    calendar();
    return;
  }
  if (a === "day") {
    selected = d.date;
    calendar();
    openModal(selected, dayContent(selected));
    return;
  }
  if (a === "detail") {
    closeModal();
    currentEvent = { id: d.id, date: d.date };
    view = "detail";
    tab = "info";
    render();
    return;
  }
  if (a === "tab") {
    tab = d.tab;
    detail();
    return;
  }
  if (a === "edit") return editEvent(d.id, currentEvent?.date);
  if (a === "deleteEvent")
    return ask(
      "일정 삭제",
      "반복 일정은 전체 시리즈가 휴지통으로 이동합니다. 30일 안에 복구할 수 있습니다.",
      "event.delete",
      { id: d.id },
    );
  if (a === "restoreEvent") return mutate("event.restore", { id: d.id });
  if (a === "purgeEvent")
    return ask(
      "영구 삭제",
      "이 일정을 영구 삭제하면 복구할 수 없습니다.",
      "event.purge",
      { id: d.id },
    );
  if (a === "deleteGroup")
    return ask(
      "가족 그룹 삭제 예약",
      "가족 전체가 이 그룹을 사용할 수 없게 됩니다. 30일 뒤 영구 삭제됩니다.",
      "group.delete",
      {},
    );
  if (a === "restoreGroup") return mutate("group.restore");
  if (a === "clearFilters") {
    filters = {
      ...filters,
      text: "",
      type: "",
      status: "",
      visibility: "",
      member: "",
      place: "",
      priority: "",
      sort: "date",
    };
    render();
    return;
  }
  if (a === "availability") return availability(d.id, d.date);
  if (a === "confirm")
    return ask(
      "일정 확정",
      `${d.date} ${d.start}–${d.end}로 확정합니다. 반복 일정은 선택한 날짜 한 건만 확정합니다.`,
      "event.confirm",
      { id: d.id, date: d.date, start: d.start, end: d.end },
    );
  if (a === "editComment") {
    const e = state.events.find((e) => e.id === currentEvent.id),
      c = e.comments.find((c) => c.id === d.id);
    openModal(
      "댓글 수정",
      `<form data-form="comment" data-id="${e.id}" data-comment="${c.id}"><label class="field">댓글<textarea name="content" required maxlength="3000">${esc(c.content)}</textarea></label>${submit()}</form>`,
    );
    return;
  }
  if (a === "deleteComment")
    return ask("댓글 삭제", "이 댓글을 삭제합니다.", "event.comment.delete", {
      id: currentEvent.id,
      commentId: d.id,
    });
  if (a === "newType" || a === "editType") return editType(d.id);
  if (a === "deleteType")
    return ask(
      "유형 삭제",
      "사용 중인 유형은 삭제할 수 없습니다.",
      "type.delete",
      { id: d.id },
    );
  if (a === "role")
    return mutate("member.role", { member: d.id, role: d.role });
  if (a === "resetMember") {
    const r = await api("action", {
      op: "member.reset",
      group: groupId,
      member: d.id,
    });
    if (d.id === group().me) auth();
    else await refresh();
    openModal(
      "재설정 코드",
      `<p>본인 확인 후 해당 가족에게 전달하세요. 1시간 동안 유효하며 기존 로그인은 해제되었습니다.</p><code>${esc(r.code)}</code><p>사용자는 로그인 화면의 ‘비밀번호 재설정’에서 새 비밀번호를 직접 설정합니다.</p>`,
    );
    return;
  }
  if (a === "copyInvite") {
    await navigator.clipboard.writeText(location.origin + "/?invite=" + d.code);
    toast("초대 링크를 복사했습니다.");
    return;
  }
  if (a === "revokeInvite") return mutate("invite.revoke", { code: d.code });
  if (a === "readAll") return mutate("notification.read", { id: "all" });
  if (a === "notification") {
    await mutate("notification.read", { id: d.id }, "");
    const e = state.events.find((e) => e.id === d.event);
    if (e) {
      currentEvent = { id: e.id, date: e.date };
      view = "detail";
      tab = "info";
      render();
    }
    return;
  }
  if (a === "csv" || a === "xlsx") return exportData(a === "xlsx");
}
document.addEventListener("click", async (event) => {
  const b = event.target.closest("[data-action]");
  if (!b) return;
  try {
    await handleAction(b);
  } catch (e) {
    toast(e.message);
  }
});
document.addEventListener("submit", async (event) => {
  const form = event.target;
  if (!form.dataset.form) return;
  event.preventDefault();
  const error = form.querySelector(".form-error");
  if (error) error.textContent = "";
  const submitButton = form.querySelector("button[type=submit]");
  if (submitButton) submitButton.disabled = true;
  try {
    const data = new FormData(form),
      d = Object.fromEntries(data),
      kind = form.dataset.form;
    if (kind === "auth") {
      await api(form.dataset.mode, d);
      await refresh(false);
      mode = prefs().defaultView;
      view = "calendar";
      render();
      return;
    }
    if (kind === "group" || kind === "join") {
      if (kind === "join") {
        try {
          d.code = new URL(d.code).searchParams.get("invite") || d.code;
        } catch {}
      }
      await mutate(kind === "group" ? "group.create" : "group.join", d);
      history.replaceState(null, "", location.pathname);
      return;
    }
    if (kind === "filters") {
      if (
        d.from &&
        d.to &&
        (d.from > d.to || date(d.to) - date(d.from) > 366 * 5 * 86400000)
      )
        throw Error("검색 기간은 시작일 이후, 최대 5년으로 선택해 주세요.");
      filters = { ...filters, ...d };
      render();
      return;
    }
    if (kind === "event") {
      const participants = data.getAll("participants");
      if (!participants.length)
        throw Error("참여 대상을 한 명 이상 선택해 주세요.");
      const original = state.events.find((e) => e.id === form.dataset.id);
      const value = {
        ...d,
        participants,
        anniversary: data.has("anniversary"),
        notifyAll: data.has("notifyAll"),
        repeat: {
          freq: d.freq,
          interval: Number(d.interval),
          count: d.count ? Number(d.count) : null,
          until: d.until,
          monthMode: d.monthMode,
          weekdays: data.getAll("weekdays").map(Number),
          exceptions: original?.repeat?.exceptions || [],
        },
      };
      const r = await mutate("event.save", {
        id: form.dataset.id || null,
        version: Number(form.dataset.version),
        event: value,
        scope: d.scope || "series",
        occurrence: form.dataset.occurrence,
      });
      closeModal();
      currentEvent = { id: r.id, date: d.date };
      view = "detail";
      tab = "info";
      render();
      return;
    }
    if (kind === "preferences") {
      await savePrefs({
        ...d,
        dayStart: Number(d.dayStart),
        weekends: data.has("weekends"),
        compact: data.has("compact"),
        showTime: data.has("showTime"),
        showHolidays: data.has("showHolidays"),
      });
      toast("나의 설정을 저장했습니다.");
      return;
    }
    if (kind === "type") {
      await mutate("type.save", {
        type: { ...d, id: form.dataset.id || null },
      });
      closeModal();
      return;
    }
    if (kind === "member") return await mutate("member.add", d);
    if (kind === "rename") return await mutate("group.rename", d);
    if (kind === "invite") {
      const r = await mutate("invite.create", d, "");
      openModal(
        "가족 초대가 준비됐어요",
        `<p>초대 코드: <strong>${esc(r.code)}</strong></p><p>7일간 유효한 일회용 초대입니다.</p><code>${esc(location.origin + "/?invite=" + r.token)}</code><div class="form-actions">${btn("copyInvite", "초대 링크 복사", "primary", `data-code="${r.code}"`)}</div>`,
      );
      return;
    }
    if (kind === "confirm") {
      const r = await mutate(form._command.op, form._command.data);
      if (r.id && currentEvent) {
        currentEvent.id = r.id;
        render();
      }
      closeModal();
      return;
    }
    if (kind === "response")
      return await mutate("event.response", { ...d, id: form.dataset.id });
    if (kind === "availability") {
      await mutate("event.availability", { id: form.dataset.id, slot: d });
      closeModal();
      return;
    }
    if (kind === "comment") {
      await mutate("event.comment", {
        id: form.dataset.id,
        commentId: form.dataset.comment || null,
        content: d.content,
      });
      closeModal();
      return;
    }
  } catch (e) {
    if (error) error.textContent = e.message;
    else toast(e.message);
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
});
document.addEventListener("keydown", (e) => {
  const b = e.target.closest("[data-slot]");
  if (b && ["Enter", " "].includes(e.key)) {
    e.preventDefault();
    if (!coordEvent) return toast("조율할 일정을 먼저 선택하세요.");
    const h = Number(b.dataset.hour);
    availability(
      coordEvent,
      b.dataset.date,
      String(h).padStart(2, "0") + ":00",
      String(h + 1).padStart(2, "0") + ":00",
    );
  }
});
document.addEventListener("pointerdown", (e) => {
  const b = e.target.closest("[data-slot]");
  if (b) {
    if (!coordEvent) {
      toast("조율할 일정을 먼저 선택하세요.");
      return;
    }
    drag = {
      date: b.dataset.date,
      start: Number(b.dataset.hour),
      end: Number(b.dataset.hour),
    };
    e.preventDefault();
    b.classList.add("dragging");
  }
});
document.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const b = document
    .elementFromPoint(e.clientX, e.clientY)
    ?.closest("[data-slot]");
  if (b && b.dataset.date === drag.date) {
    drag.end = Number(b.dataset.hour);
    document
      .querySelectorAll("[data-slot]")
      .forEach((x) =>
        x.classList.toggle(
          "dragging",
          x.dataset.date === drag.date &&
            Number(x.dataset.hour) >= Math.min(drag.start, drag.end) &&
            Number(x.dataset.hour) <= Math.max(drag.start, drag.end),
        ),
      );
  }
});
document.addEventListener("pointerup", () => {
  if (!drag) return;
  const d = drag;
  drag = null;
  document
    .querySelectorAll(".dragging")
    .forEach((x) => x.classList.remove("dragging"));
  availability(
    coordEvent,
    d.date,
    String(Math.min(d.start, d.end)).padStart(2, "0") + ":00",
    String(Math.max(d.start, d.end) + 1).padStart(2, "0") + ":00",
  );
});
document.addEventListener("pointercancel", () => {
  drag = null;
  document
    .querySelectorAll(".dragging")
    .forEach((x) => x.classList.remove("dragging"));
});
try {
  await refresh(false);
  mode = prefs().defaultView;
  render();
} catch (e) {
  if (e.status === 401) auth();
  else {
    app.innerHTML = `<div class="panel onboard"><h1>서버 연결을 확인해 주세요</h1><p>${esc(e.message)}</p><p>이 서비스는 Family24 서버로 실행해야 합니다. 기존 정적 목업은 <a href="/family_calendar_mockup.html">여기</a>에서 볼 수 있습니다.</p></div>`;
  }
}
function formatValue(v, key) {
  if (key === "participants" && Array.isArray(v))
    return v.map(memberName).join(", ");
  if (key === "type")
    return group().types.find((t) => t.id === v)?.name || "이전 유형";
  if (key === "visibility") return names[v] || v;
  if (key === "repeat" && v)
    return (
      (freqNames[v.freq] || "") +
      " · " +
      (v.interval || 1) +
      " 간격" +
      (v.count ? " / " + v.count + "회" : "") +
      (v.until ? " / " + v.until + "까지" : "")
    );
  if (typeof v === "boolean") return v ? "사용" : "사용 안 함";
  return typeof v === "object" ? JSON.stringify(v) : String(v ?? "—");
}
function coordination(e, ds) {
  const slots = Array.from({ length: 15 }, (_, i) => {
    const start = String(i + 8).padStart(2, "0") + ":00",
      end = String(i + 9).padStart(2, "0") + ":00";
    const responses = e.participants.map((id) => ({
      name: memberName(id),
      status:
        e.availability.find(
          (a) =>
            a.member === id &&
            a.date === ds &&
            a.start <= start &&
            a.end >= end,
        )?.status || "미정",
    }));
    return {
      start,
      end,
      responses,
      yes: responses.filter((a) => a.status === "가능").length,
      no: responses.filter((a) => a.status === "불가능").length,
    };
  }).sort(
    (a, b) => b.yes - a.yes || a.no - b.no || a.start.localeCompare(b.start),
  );
  return `<div class="notice">후보는 ${esc(ds)}의 1시간 단위입니다. 가능 인원순으로 표시하며, 최종 시간은 작성자 또는 관리자가 직접 선택합니다. 반복 일정의 응답은 날짜별로 저장됩니다.</div>${e.participants.includes(group().me) ? btn("availability", "＋ 가능 시간 입력", "primary", `data-id="${e.id}" data-date="${ds}"`) : ""}<h3 style="margin-top:25px">추천 후보 시간</h3><div class="list">${slots
    .slice(0, 6)
    .map(
      (s) =>
        `<div class="listitem"><div><strong>${s.start}–${s.end}</strong><p>가능 ${s.yes} · 불가능 ${s.no} · 미정 ${e.participants.length - s.yes - s.no}</p><small>${s.responses.map((a) => esc(a.name) + ": " + a.status).join(" / ")}</small></div>${canEdit(e) ? btn("confirm", "이 시간으로 확정", "small", `data-id="${e.id}" data-date="${ds}" data-start="${s.start}" data-end="${s.end}"`) : ""}</div>`,
    )
    .join("")}</div><h3 style="margin-top:25px">등록된 가용 시간</h3>${
    e.availability
      .filter((a) => a.date === ds)
      .map(
        (a) =>
          `<p>${esc(memberName(a.member))} · ${a.start}–${a.end} · ${a.status}</p>`,
      )
      .join("") || '<p class="muted">아직 응답이 없습니다.</p>'
  }`;
}
