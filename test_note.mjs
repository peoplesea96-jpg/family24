import test from "node:test";
import assert from "node:assert/strict";
import {parseNote,parseNotes,endAfterHour} from "./note-parser.mjs";
const now = new Date("2026-10-01T14:30:00Z");
test("tomorrow uses Seoul date and asks AM/PM",()=>{const p=parseNote("내일 3시 미팅",now);assert.equal(p.date,"2026-10-02");assert.equal(p.title,"미팅");assert.equal(p.start,"");assert.deepEqual(p.ambiguous,{am:"03:00",pm:"15:00"});});
test("midnight rollover and year boundary",()=>{assert.equal(parseNote("내일 오후 3시 미팅",new Date("2026-12-31T16:00:00Z")).date,"2027-01-02");});
test("explicit time and half hour",()=>{assert.equal(parseNote("내일 오후 3시 반 운동",now).start,"15:30");assert.equal(parseNote("오늘 오전 12시 점검",now).start,"00:00");assert.equal(parseNote("오늘 15:20 미팅",now).start,"15:20");});
test("next Monday and invalid date",()=>{assert.equal(parseNote("다음 주 월요일 오후 2시 운동",now).date,"2026-10-05");assert.equal(parseNote("2026-02-30 오후 3시 운동",now).date,"");});
test("missing/invalid time and unsupported input require review",()=>{assert.equal(parseNote("미팅",now).date,"");assert.equal(parseNote("내일 25시 미팅",now).start,"");assert.equal(endAfterHour("23:30"),"");assert.equal(endAfterHour("15:30"),"16:30");});

test("holiday name resolves this year's actual date and strips date phrase",()=>{
  for (const phrase of ["개천절 공연", "개천절날 공연", "개천절날에 공연", "개천절에 공연"]) {
    const p=parseNote(phrase,now);assert.equal(p.date,"2026-10-03");assert.equal(p.title,"공연");
  }
  const p=parseNote("개천절날 오전 9시 공연",now);
  assert.equal(p.date,"2026-10-03");assert.equal(p.start,"09:00");assert.equal(p.title,"공연");assert.deepEqual(p.warnings,[]);
});
test("holiday default year never jumps to next year after holiday passes",()=>{
  assert.equal(parseNote("개천절 공연",new Date("2026-11-01T00:00:00Z")).date,"2026-10-03");
  assert.equal(parseNote("개천절 공연",new Date("2026-12-31T15:00:00Z")).date,"2027-10-03");
  assert.equal(parseNote("내년 개천절 공연",now).date,"2027-10-03");
  assert.equal(parseNote("2028년 개천절 공연",now).date,"2028-10-03");
});
test("other fixed holidays and substitute holidays",()=>{
  assert.equal(parseNote("한글날 오후 2시 독서",now).date,"2026-10-09");
  assert.equal(parseNote("크리스마스 저녁 7시 모임",now).date,"2026-12-25");
  assert.equal(parseNote("개천절 대체공휴일 공연",now).date,"");
});

test("date and time ranges preserve both endpoints",()=>{
 const [p]=parseNotes("다음주 수요일부터 목요일까지 오후1시부터 5시까지 파견근무",now);
 assert.equal(p.date,"2026-10-07");assert.equal(p.repeat.until,"2026-10-08");assert.equal(p.repeat.freq,"daily");assert.equal(p.start,"13:00");assert.equal(p.end,"17:00");assert.equal(p.title,"파견근무");
});
test("recurrence and multiple notes",()=>{
 const p=parseNotes("매주 화요일 저녁 7시 운동 4회\n내일 오전 9시부터 11시까지 미팅\n매일 오후 2시 독서",now);
 assert.equal(p.length,3);assert.equal(p[0].date,"2026-10-06");assert.equal(p[0].repeat.freq,"weekly");assert.equal(p[0].repeat.count,4);assert.equal(p[0].title,"운동");assert.equal(p[1].end,"11:00");assert.equal(p[2].repeat.count,12);
});
test("explicit periods and repeat limits",()=>{
 assert.equal(parseNotes("10월 3일부터 10월 5일까지 오후 2시 여행",now)[0].repeat.until,"2026-10-05");
 assert.equal(parseNotes("매일 오후 2시 공부 10월 31일까지",now)[0].repeat.until,"2026-10-31");
 assert.throws(()=>parseNotes("10월 5일부터 10월 3일까지 오후 2시 여행",now));
 assert.throws(()=>parseNotes("매일 오후 2시 공부 1001회",now));
});

test("abbreviated day range anchored to next week",()=>{
 for(const phrase of ["다음주 6~10일 동안", "다음 주 6일~10일", "다음주 6일부터 10일까지"]){
  const [p]=parseNotes(`${phrase} 오후 3시에 정기 미팅`,now);
  assert.equal(p.date,"2026-10-06");assert.equal(p.repeat.until,"2026-10-10");assert.equal(p.repeat.freq,"daily");assert.equal(p.start,"15:00");assert.equal(p.end,"16:00");assert.equal(p.title,"정기 미팅");assert.deepEqual(p.warnings,[]);
 }
});
test("abbreviated ranges handle month and year boundaries",()=>{
 const p=parseNotes("다음주 30~2일 동안 오후 3시에 미팅",new Date("2026-11-27T00:00:00Z"))[0];
 assert.equal(p.date,"2026-11-30");assert.equal(p.repeat.until,"2026-12-02");
 const q=parseNotes("다음주 1~3일 동안 오후 3시 미팅",new Date("2026-12-24T00:00:00Z"))[0];
 assert.equal(q.date,"2027-01-01");assert.equal(q.repeat.until,"2027-01-03");
 assert.equal(parseNotes("10월 6~10일 오후 3시 미팅",now)[0].date,"2026-10-06");
 assert.throws(()=>parseNotes("다음주 20~25일 오후 3시 미팅",now));
 assert.throws(()=>parseNotes("2월 30~31일 오후 3시 미팅",now));
});

test("dictionary days and durations",()=>{
 const cases={내일:'2026-10-02',내일모레:'2026-10-03',모레:'2026-10-03',글피:'2026-10-04',그글피:'2026-10-05','사흘 뒤':'2026-10-04','보름 뒤':'2026-10-16','이틀 전':'2026-09-29'};
 for(const [term,expected] of Object.entries(cases))assert.equal(parseNotes(`${term} 오후 세시에 미팅`,now)[0].date,expected,term);
 const p=parseNotes('다다음주 한주동안 오전 8시부터 2시간동안 체육관가서 운동',now)[0];
 assert.equal(p.date,'2026-10-12');assert.equal(p.repeat.until,'2026-10-18');assert.equal(p.start,'08:00');assert.equal(p.end,'10:00');assert.equal(p.title,'체육관가서 운동');
 assert.equal(parseNotes('내일부터 보름 동안 오후 3시 운동',now)[0].repeat.until,'2026-10-16');
 assert.equal(parseNotes('글피 정오 미팅',now)[0].start,'12:00');
 assert.ok(parseNotes('보름 오후 3시 미팅',now)[0].warnings.some(x=>x.includes('보름')));
});
test("week dictionary boundaries and duration validation",()=>{
 assert.equal(parseNotes('다다음 주 화요일 오전 9시 회의',now)[0].date,'2026-10-13');
 assert.equal(parseNotes('다다음주 13~15일 오후 3시 회의',now)[0].date,'2026-10-13');
 assert.equal(parseNotes('다음달 말일 오전 9시 회의',now)[0].date,'2026-11-30');
 assert.equal(parseNotes('글피 오전 9시 회의',new Date('2026-12-30T15:00:00Z'))[0].date,'2027-01-03');
 assert.equal(parseNotes('내일 오후 3시부터 한 시간 반 동안 운동',now)[0].end,'16:30');
 assert.equal(parseNotes('내일 밤 11시부터 두 시간 동안 운동',now)[0].end,'');
 assert.throws(()=>parseNotes('내일 오전 9시 0시간 동안 운동',now));
});

test("every registered relative day and duration is exercised",async()=>{
 const {timeLexicon}=await import('./korean-time.mjs');
 const shift=n=>new Date(Date.UTC(2026,9,1+n)).toISOString().slice(0,10);
 for(const [term,n] of Object.entries(timeLexicon.relativeDays)){
  assert.equal(parseNotes(`${term} 오전 9시 회의`,now)[0].date,shift(n),term);
 }
 for(const [term,n] of Object.entries(timeLexicon.days)){
  assert.equal(parseNotes(`${term} 뒤 오전 9시 회의`,now)[0].date,shift(n),term);
  assert.equal(parseNotes(`내일부터 ${term} 동안 오전 9시 회의`,now)[0].repeat.until,shift(n),term);
 }
 for(const [term,n] of Object.entries(timeLexicon.weeks)){
  assert.equal(parseNotes(`${term} 주 월요일 오전 9시 회의`,now)[0].date,shift(-3+n*7),term);
 }
});

test("bare day chooses next occurrence and timeless notes are all day",()=>{
 const p=parseNotes('15일 부여 출장',now)[0];assert.equal(p.date,'2026-10-15');assert.equal(p.title,'부여 출장');assert.equal(p.allDay,true);assert.equal(p.start,'');assert.equal(p.end,'');assert.deepEqual(p.warnings,[]);
 for(const [base,want] of [['2026-09-16','2026-10-15'],['2026-09-15','2026-09-15'],['2026-12-16','2027-01-15']])assert.equal(parseNotes('15일날 미팅',new Date(base+'T00:00:00Z'))[0].date,want);
 assert.equal(parseNotes('31일 출장',new Date('2026-04-01T00:00:00Z'))[0].date,'2026-05-31');
 assert.equal(parseNotes('이번달 15일 미팅',new Date('2026-09-16T00:00:00Z'))[0].date,'2026-09-15');
 assert.equal(parseNotes('10월 15일 출장',now)[0].date,'2026-10-15');
 assert.equal(parseNotes('15일 3시 미팅',now)[0].allDay,false);
 assert.equal(parseNotes('15일 25시 미팅',now)[0].allDay,false);
 assert.equal(parseNotes('내일 두 시간 동안 운동',now)[0].allDay,false);
 assert.equal(parseNotes('다음주 6~10일 출장',now)[0].allDay,true);
});
