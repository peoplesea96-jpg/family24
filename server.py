"""Family24 application. Run with `python server.py`; persistent SQLite, Waitress WSGI."""

import copy
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import threading
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import holidays
from flask import Flask, g, jsonify, request, send_from_directory
from werkzeug.exceptions import HTTPException
from werkzeug.security import check_password_hash, generate_password_hash

ROOT = Path(__file__).parent


def now():
    return datetime.now(timezone.utc).isoformat()


def ident():
    return secrets.token_hex(16)


def digest(s):
    return hashlib.sha256(s.encode()).hexdigest()


def require(ok, message="권한이 없습니다.", status=403):
    if not ok:
        raise Problem(message, status)


class Problem(Exception):
    def __init__(self, message, status=400):
        self.message, self.status = message, status


def create_app(database=None):
    app = Flask(__name__, static_folder=None)
    app.config.update(
        MAX_CONTENT_LENGTH=256_000,
        DATABASE=str(
            database or os.getenv("FAMILY24_DB", ROOT / "data" / "family24.sqlite3")
        ),
    )
    Path(app.config["DATABASE"]).parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(app.config["DATABASE"]) as db:
        db.executescript(
            """PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password TEXT NOT NULL,reset TEXT,reset_until REAL,prefs TEXT NOT NULL DEFAULT '{}');
        CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL,csrf TEXT NOT NULL,expires REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS families(id TEXT PRIMARY KEY,data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS invites(token TEXT PRIMARY KEY,code TEXT UNIQUE,group_id TEXT,profile TEXT,expires REAL);
        CREATE TABLE IF NOT EXISTS attempts(key TEXT PRIMARY KEY,count INTEGER,expires REAL);
        """
        )

    def db():
        if "db" not in g:
            g.db = sqlite3.connect(app.config["DATABASE"], timeout=15)
            g.db.row_factory = sqlite3.Row
        return g.db

    @app.teardown_appcontext
    def close(error):
        if "db" in g:
            g.db.close()

    def family(gid):
        row = db().execute("SELECT data FROM families WHERE id=?", (gid,)).fetchone()
        require(row, "가족 그룹을 찾을 수 없습니다.", 404)
        f = json.loads(row["data"])
        m = next((m for m in f["members"] if m.get("user") == g.user["id"]), None)
        require(m)
        return f, m

    def save(f):
        db().execute(
            "UPDATE families SET data=? WHERE id=?",
            (json.dumps(f, ensure_ascii=False), f["id"]),
        )

    def allowed(e, m):
        return (
            e["visibility"] == "family"
            or e["creator"] == m["id"]
            or (e["visibility"] == "selected" and m["id"] in e["participants"])
        )

    def editable(e, m):
        return e["creator"] == m["id"] or m["role"] == "admin"

    def notification(f, e, message):
        recipients = (
            [m["id"] for m in f["members"]] if e.get("notifyAll") else e["participants"]
        )
        for m in f["members"]:
            if m["id"] in recipients and allowed(e, m):
                f["notifications"].append(
                    {
                        "id": ident(),
                        "member": m["id"],
                        "event": e["id"],
                        "message": message,
                        "createdAt": now(),
                        "read": False,
                    }
                )

    def audit(f, m, action):
        f["audit"].append({"by": m["name"], "action": action, "at": now()})

    def cleanup():
        with app.app_context():
            db().execute("BEGIN IMMEDIATE")
            cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
            notifycut = (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()
            for row in db().execute("SELECT data FROM families").fetchall():
                f = json.loads(row["data"])
                if f.get("deletedAt") and f["deletedAt"] < cutoff:
                    db().execute("DELETE FROM invites WHERE group_id=?", (f["id"],))
                    db().execute("DELETE FROM families WHERE id=?", (f["id"],))
                    continue
                old = (len(f["events"]), len(f["notifications"]))
                f["events"] = [
                    e
                    for e in f["events"]
                    if not e.get("deletedAt") or e["deletedAt"] >= cutoff
                ]
                f["notifications"] = [
                    n for n in f["notifications"] if n["createdAt"] >= notifycut
                ]
                if old != (len(f["events"]), len(f["notifications"])):
                    save(f)
            for table in ["sessions", "invites", "attempts"]:
                db().execute(f"DELETE FROM {table} WHERE expires<?", (time.time(),))
            db().commit()

    app.cleanup = cleanup

    @app.before_request
    def guard():
        if not request.path.startswith("/api/"):
            return
        if request.method == "POST":
            require(request.is_json, "JSON 요청만 허용됩니다.", 415)
            require(
                isinstance(request.get_json(), dict), "JSON 객체를 입력해 주세요.", 400
            )
            require(
                request.headers.get("X-Family24") == "1",
                "요청 형식이 올바르지 않습니다.",
                403,
            )
            if request.headers.get("Origin"):
                require(
                    request.headers["Origin"]
                    == os.getenv("FAMILY24_ORIGIN", request.host_url.rstrip("/")),
                    "다른 사이트의 요청은 허용하지 않습니다.",
                    403,
                )
        public = {"/api/login", "/api/register", "/api/reset"}
        if request.path in public:
            key = digest(request.remote_addr or "local")
            row = db().execute("SELECT * FROM attempts WHERE key=?", (key,)).fetchone()
            require(
                not row or row["expires"] < time.time() or row["count"] < 40,
                "잠시 후 다시 시도해 주세요.",
                429,
            )
            if not row or row["expires"] < time.time():
                db().execute(
                    "INSERT OR REPLACE INTO attempts VALUES (?,1,?)",
                    (key, time.time() + 900),
                )
            else:
                db().execute("UPDATE attempts SET count=count+1 WHERE key=?", (key,))
            db().commit()
            return
        token = request.cookies.get("family24", "")
        s = (
            db()
            .execute(
                "SELECT * FROM sessions WHERE token=? AND expires>?",
                (digest(token), time.time()),
            )
            .fetchone()
        )
        require(s, "로그인이 필요합니다.", 401)
        g.user = (
            db().execute("SELECT * FROM users WHERE id=?", (s["user_id"],)).fetchone()
        )
        require(
            g.user and not g.user["reset"], "비밀번호 재설정 후 로그인해 주세요.", 401
        )
        g.session = s
        if request.method == "POST":
            require(
                hmac.compare_digest(request.headers.get("X-CSRF-Token", ""), s["csrf"]),
                "세션이 만료되었습니다. 새로고침해 주세요.",
                403,
            )

    @app.after_request
    def headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
        )
        if request.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.errorhandler(Problem)
    def problem(e):
        return jsonify(error=e.message), e.status

    @app.errorhandler(HTTPException)
    def http_error(e):
        return jsonify(error=e.description), e.code

    @app.errorhandler(Exception)
    def unexpected(e):
        app.logger.exception("Request failed")
        return (
            jsonify(
                error="처리 중 오류가 발생했습니다. 입력과 서버 상태를 확인해 주세요."
            ),
            500,
        )

    def credentials(data):
        email = str(data.get("email", "")).strip().lower()
        password = str(data.get("password", ""))
        require(
            bool(re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email))
            and len(email) <= 254,
            "이메일을 확인해 주세요.",
            400,
        )
        require(10 <= len(password) <= 128, "비밀번호는 10~128자로 입력해 주세요.", 400)
        return email, password

    def login_response(user):
        token = secrets.token_urlsafe(32)
        csrf = secrets.token_urlsafe(32)
        db().execute(
            "INSERT INTO sessions VALUES (?,?,?,?)",
            (digest(token), user["id"], csrf, time.time() + 86400 * 7),
        )
        db().commit()
        response = jsonify(ok=True, csrf=csrf)
        response.set_cookie(
            "family24",
            token,
            max_age=86400 * 7,
            httponly=True,
            samesite="Lax",
            secure=os.getenv("FAMILY24_SECURE_COOKIE") == "1",
        )
        return response

    @app.post("/api/register")
    def register():
        data = request.get_json()
        email, password = credentials(data)
        name = str(data.get("name", "")).strip()
        require(1 <= len(name) <= 40, "이름은 1~40자로 입력해 주세요.", 400)
        try:
            uid = ident()
            db().execute(
                "INSERT INTO users(id,email,name,password) VALUES (?,?,?,?)",
                (uid, email, name, generate_password_hash(password, method="scrypt")),
            )
            db().commit()
        except sqlite3.IntegrityError:
            raise Problem("이미 사용 중인 이메일입니다.", 409)
        return login_response({"id": uid})

    @app.post("/api/login")
    def login():
        email, password = credentials(request.get_json())
        user = db().execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
        require(
            user and check_password_hash(user["password"], password),
            "이메일 또는 비밀번호가 올바르지 않습니다.",
            401,
        )
        require(
            not user["reset"],
            "관리자가 전달한 재설정 코드로 비밀번호를 변경해 주세요.",
            403,
        )
        return login_response(user)

    @app.post("/api/reset")
    def reset():
        data = request.get_json()
        email, password = credentials(data)
        user = db().execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
        require(
            user
            and user["reset"]
            and user["reset_until"] > time.time()
            and hmac.compare_digest(user["reset"], digest(str(data.get("code", "")))),
            "재설정 코드가 올바르지 않거나 만료되었습니다.",
            400,
        )
        db().execute(
            "UPDATE users SET password=?,reset=NULL,reset_until=NULL WHERE id=?",
            (generate_password_hash(password, method="scrypt"), user["id"]),
        )
        db().execute("DELETE FROM sessions WHERE user_id=?", (user["id"],))
        db().commit()
        return login_response(user)

    @app.post("/api/logout")
    def logout():
        db().execute("DELETE FROM sessions WHERE token=?", (g.session["token"],))
        db().commit()
        response = jsonify(ok=True)
        response.delete_cookie("family24")
        return response

    @app.get("/api/state")
    def state():
        groups = []
        events = []
        notifications = []
        for row in db().execute("SELECT data FROM families"):
            f = json.loads(row["data"])
            m = next((m for m in f["members"] if m.get("user") == g.user["id"]), None)
            if not m:
                continue
            visible = (
                [e for e in f["events"] if allowed(e, m)]
                if not f.get("deletedAt")
                else []
            )
            events.extend(visible)
            ids = {e["id"] for e in visible}
            notifications.extend(
                dict(n, group=f["id"])
                for n in f["notifications"]
                if n["member"] == m["id"] and n["event"] in ids
            )
            out = {
                k: f[k]
                for k in ["id", "name", "owner", "members", "types", "deletedAt"]
            }
            out["me"] = m["id"]
            out["audit"] = f["audit"][-100:] if m["role"] == "admin" else []
            out["invites"] = (
                [
                    dict(i)
                    for i in db().execute(
                        "SELECT code,profile,expires FROM invites WHERE group_id=? AND expires>?",
                        (f["id"], time.time()),
                    )
                ]
                if m["role"] == "admin"
                else []
            )
            groups.append(out)
        return jsonify(
            user={"id": g.user["id"], "name": g.user["name"], "email": g.user["email"]},
            csrf=g.session["csrf"],
            groups=groups,
            events=events,
            notifications=notifications,
            preferences=json.loads(g.user["prefs"]),
        )

    @app.get("/api/holidays")
    def holiday_list():
        year = int(request.args.get("year", date.today().year))
        require(1900 <= year <= 2100, "지원 연도: 1900~2100", 400)
        return jsonify(
            {
                d.isoformat(): name
                for d, name in holidays.KR(
                    years=[year - 1, year, year + 1], language="ko"
                ).items()
            }
        )

    @app.post("/api/action")
    def action():
        d = request.get_json()
        op = d.get("op")
        db().execute("BEGIN IMMEDIATE")
        result = {}
        if op == "preferences":
            p = d.get("preferences", {})
            require(
                isinstance(p, dict) and len(json.dumps(p)) < 5000,
                "설정 값이 너무 큽니다.",
                400,
            )
            db().execute(
                "UPDATE users SET prefs=? WHERE id=?", (json.dumps(p), g.user["id"])
            )
            db().commit()
            return jsonify(ok=True)
        if op == "group.create":
            name = str(d.get("name", "")).strip()
            require(1 <= len(name) <= 60, "가족 이름을 입력해 주세요.", 400)
            gid = ident()
            mid = ident()
            f = {
                "id": gid,
                "name": name,
                "owner": mid,
                "members": [
                    {
                        "id": mid,
                        "name": g.user["name"],
                        "user": g.user["id"],
                        "role": "admin",
                        "color": "#4f7669",
                    }
                ],
                "types": [
                    {
                        "id": ident(),
                        "name": "가족 모임",
                        "icon": "🍽️",
                        "color": "#4f7669",
                    },
                    {"id": ident(), "name": "기념일", "icon": "🎂", "color": "#b37a40"},
                ],
                "events": [],
                "notifications": [],
                "audit": [],
                "deletedAt": None,
            }
            db().execute("INSERT INTO families VALUES (?,?)", (gid, json.dumps(f)))
            db().commit()
            return jsonify(ok=True, group=gid)
        if op == "group.join":
            code = str(d.get("code", "")).strip()
            invite = (
                db()
                .execute(
                    "SELECT * FROM invites WHERE (code=? OR token=?) AND expires>?",
                    (code, digest(code), time.time()),
                )
                .fetchone()
            )
            require(invite, "초대가 만료되었거나 올바르지 않습니다.", 400)
            row = (
                db()
                .execute("SELECT data FROM families WHERE id=?", (invite["group_id"],))
                .fetchone()
            )
            require(row, "존재하지 않는 가족입니다.", 404)
            f = json.loads(row["data"])
            require(not f.get("deletedAt"), "삭제 예정인 그룹입니다.", 400)
            require(
                not any(m.get("user") == g.user["id"] for m in f["members"]),
                "이미 참여한 가족입니다.",
                409,
            )
            m = next((m for m in f["members"] if m["id"] == invite["profile"]), None)
            if m:
                require(not m.get("user"), "이미 연결된 프로필입니다.", 409)
                m["user"] = g.user["id"]
            else:
                f["members"].append(
                    {
                        "id": ident(),
                        "user": g.user["id"],
                        "name": g.user["name"],
                        "role": "member",
                        "color": "#4f7669",
                    }
                )
            db().execute("DELETE FROM invites WHERE token=?", (invite["token"],))
            save(f)
            db().commit()
            return jsonify(ok=True, group=f["id"])
        f, m = family(d.get("group"))
        admin = m["role"] == "admin"
        require(
            not f.get("deletedAt") or op == "group.restore",
            "삭제 예정인 그룹입니다. 먼저 복구해 주세요.",
            409,
        )
        if op == "group.rename":
            require(admin)
            name = str(d.get("name", "")).strip()
            require(1 <= len(name) <= 60, "가족 이름을 입력해 주세요.", 400)
            f["name"] = name
        elif op in ["group.delete", "group.restore"]:
            require(m["id"] == f["owner"])
            if op == "group.restore":
                require(
                    not f.get("deletedAt")
                    or datetime.fromisoformat(f["deletedAt"])
                    >= datetime.now(timezone.utc) - timedelta(days=30),
                    "그룹 복구 기간이 지났습니다.",
                    410,
                )
            f["deletedAt"] = now() if op == "group.delete" else None
        elif op == "member.add":
            require(admin)
            name = str(d.get("name", "")).strip()
            require(1 <= len(name) <= 40, "이름을 입력해 주세요.", 400)
            f["members"].append(
                {
                    "id": ident(),
                    "name": name,
                    "role": "member",
                    "user": None,
                    "color": "#b37a40",
                }
            )
        elif op == "member.role":
            target = next((x for x in f["members"] if x["id"] == d.get("member")), None)
            require(target, "구성원을 찾을 수 없습니다.", 404)
            role = d.get("role")
            require(role in ["admin", "member"], "역할을 확인해 주세요.", 400)
            require(
                admin
                if role == "admin"
                else (m["id"] == target["id"] or m["id"] == f["owner"])
            )
            require(
                target["id"] != f["owner"] or role == "admin",
                "최초 생성자는 관리자로 유지됩니다.",
                400,
            )
            target["role"] = role
        elif op == "member.reset":
            require(admin)
            target = next((x for x in f["members"] if x["id"] == d.get("member")), None)
            require(target and target.get("user"), "연결된 계정이 없습니다.", 400)
            require(target["id"] != f["owner"] or m["id"] == f["owner"])
            code = secrets.token_urlsafe(24)
            db().execute(
                "UPDATE users SET reset=?,reset_until=? WHERE id=?",
                (digest(code), time.time() + 3600, target["user"]),
            )
            db().execute("DELETE FROM sessions WHERE user_id=?", (target["user"],))
            result["code"] = code
        elif op == "invite.create":
            require(admin)
            profile = d.get("profile") or None
            require(
                not profile
                or any(x["id"] == profile and not x.get("user") for x in f["members"]),
                "연결할 수 없는 프로필입니다.",
                400,
            )
            token = secrets.token_urlsafe(32)
            code = secrets.token_hex(6).upper()
            db().execute(
                "INSERT INTO invites VALUES (?,?,?,?,?)",
                (digest(token), code, f["id"], profile, time.time() + 7 * 86400),
            )
            result.update(code=code, token=token)
        elif op == "invite.revoke":
            require(admin)
            db().execute(
                "DELETE FROM invites WHERE group_id=? AND code=?",
                (f["id"], d.get("code")),
            )
        elif op == "type.save":
            t = d.get("type", {})
            old = next((x for x in f["types"] if x["id"] == t.get("id")), None)
            require(not old or admin)
            name = str(t.get("name", "")).strip()
            color = t.get("color", "")
            icon = str(t.get("icon", ""))
            require(
                1 <= len(name) <= 30
                and re.fullmatch("#[0-9a-fA-F]{6}", color)
                and len(icon) <= 8,
                "유형 이름·색상·아이콘을 확인해 주세요.",
                400,
            )
            if old:
                old.update(name=name, color=color, icon=icon)
            else:
                f["types"].append(
                    {"id": ident(), "name": name, "color": color, "icon": icon}
                )
        elif op == "type.delete":
            require(admin)
            require(
                not any(e["type"] == d.get("id") for e in f["events"]),
                "사용 중인 유형입니다. 일정 유형을 먼저 변경해 주세요.",
                409,
            )
            f["types"] = [t for t in f["types"] if t["id"] != d.get("id")]
        elif op == "notification.read":
            for n in f["notifications"]:
                if n["member"] == m["id"] and (
                    d.get("id") == "all" or n["id"] == d.get("id")
                ):
                    n["read"] = True
        elif op.startswith("event."):
            eid = d.get("id")
            e = next((x for x in f["events"] if x["id"] == eid), None)
            if eid:
                require(e and allowed(e, m), "일정을 찾을 수 없습니다.", 404)
            if op == "event.save":
                require(not e or editable(e, m))
                value = validate_event(d.get("event", {}), f)
                if e:
                    require(
                        d.get("version") == e.get("version", 1),
                        "다른 사용자가 수정했습니다. 새로고침 후 다시 시도해 주세요.",
                        409,
                    )
                    require(
                        not e.get("deletedAt"), "휴지통에서 먼저 복구해 주세요.", 409
                    )
                    changes = [
                        {
                            "by": m["name"],
                            "at": now(),
                            "field": k,
                            "before": e.get(k),
                            "after": v,
                        }
                        for k, v in value.items()
                        if e.get(k) != v
                    ]
                    core = {
                        "date",
                        "start",
                        "end",
                        "participants",
                        "place",
                        "address",
                        "repeat",
                    }
                    if e["status"] == "확정" and any(
                        c["field"] in core for c in changes
                    ):
                        value["status"] = "조율 중"
                        changes.append(
                            {
                                "by": m["name"],
                                "at": now(),
                                "field": "status",
                                "before": "확정",
                                "after": "조율 중",
                            }
                        )
                    scope = d.get("scope", "series")
                    occurrence = d.get("occurrence")
                    if scope in ["one", "following"] and e["repeat"]["freq"] != "none":
                        dates = recurrence_dates(e, occurrence)
                        require(
                            occurrence in dates
                            and occurrence not in e["repeat"].get("exceptions", []),
                            "반복에 포함된 날짜를 선택해 주세요.",
                            400,
                        )
                        new = copy.deepcopy(e)
                        new.update(value)
                        new.update(
                            id=ident(),
                            createdAt=now(),
                            version=1,
                            history=changes,
                            comments=[],
                            availability=[],
                            responses={},
                        )
                        if scope == "one":
                            e["repeat"].setdefault("exceptions", []).append(occurrence)
                            new["repeat"] = {"freq": "none"}
                        else:
                            if (
                                e["repeat"].get("count")
                                and new["repeat"].get("count") == e["repeat"]["count"]
                            ):
                                new["repeat"]["count"] = int(
                                    e["repeat"]["count"]
                                ) - dates.index(occurrence)
                            new["repeat"]["exceptions"] = [
                                x
                                for x in new["repeat"].get("exceptions", [])
                                if x >= occurrence
                            ]
                            e["repeat"]["until"] = (
                                date.fromisoformat(occurrence) - timedelta(days=1)
                            ).isoformat()
                        e["version"] = e.get("version", 1) + 1
                        f["events"].append(new)
                        e = new
                    else:
                        e.update(value)
                        e["version"] = e.get("version", 1) + 1
                        e["history"].extend(changes)
                else:
                    e = dict(
                        value,
                        id=ident(),
                        group=f["id"],
                        creator=m["id"],
                        history=[],
                        comments=[],
                        availability=[],
                        responses={},
                        version=1,
                        createdAt=now(),
                    )
                    f["events"].append(e)
                e["updatedAt"] = now()
                notification(f, e, f"{e['title']} · {e['status']}")
                result["id"] = e["id"]
            else:
                require(e, "일정을 찾을 수 없습니다.", 404)
                if op in [
                    "event.delete",
                    "event.restore",
                    "event.purge",
                    "event.confirm",
                ]:
                    require(editable(e, m))
                    if op == "event.delete":
                        e["deletedAt"] = now()
                    elif op == "event.restore":
                        require(
                            not e.get("deletedAt")
                            or datetime.fromisoformat(e["deletedAt"])
                            >= datetime.now(timezone.utc) - timedelta(days=30),
                            "복구 기간이 지났습니다.",
                            410,
                        )
                        e["deletedAt"] = None
                    elif op == "event.purge":
                        require(
                            bool(e.get("deletedAt")),
                            "휴지통 일정만 영구 삭제할 수 있습니다.",
                            400,
                        )
                        f["events"].remove(e)
                    else:
                        require(not e.get("deletedAt"), "삭제된 일정입니다.", 400)
                        ds = d.get("date", e["date"])
                        candidate = dict(
                            e,
                            date=ds,
                            start=d.get("start", e["start"]),
                            end=d.get("end", e["end"]),
                            status="확정",
                        )
                        validate_event(candidate, f)
                        if e["repeat"]["freq"] != "none":
                            require(
                                ds in recurrence_dates(e, ds)
                                and ds not in e["repeat"].get("exceptions", []),
                                "반복에 포함된 날짜를 선택해 주세요.",
                                400,
                            )
                            e["repeat"].setdefault("exceptions", []).append(ds)
                            e["version"] = e.get("version", 1) + 1
                            instance = copy.deepcopy(e)
                            instance.update(
                                id=ident(),
                                date=ds,
                                repeat={"freq": "none"},
                                version=1,
                                createdAt=now(),
                            )
                            f["events"].append(instance)
                            e = instance
                            result["id"] = e["id"]
                        for key in ["date", "start", "end", "status"]:
                            if e.get(key) != candidate[key]:
                                e["history"].append(
                                    {
                                        "by": m["name"],
                                        "at": now(),
                                        "field": key,
                                        "before": e.get(key),
                                        "after": candidate[key],
                                    }
                                )
                                e[key] = candidate[key]
                        notification(f, e, e["title"] + " · 일정 확정")
                    e["version"] = e.get("version", 1) + 1
                elif op == "event.response":
                    require(not e.get("deletedAt") and m["id"] in e["participants"])
                    require(
                        d.get("status") in ["참여", "불참", "미정"],
                        "참여 상태를 확인해 주세요.",
                        400,
                    )
                    e["responses"][m["id"]] = {
                        "status": d["status"],
                        "reason": str(d.get("reason", ""))[:500],
                    }
                elif op == "event.availability":
                    require(not e.get("deletedAt") and m["id"] in e["participants"])
                    slot = d.get("slot", {})
                    ds = slot.get("date")
                    try:
                        date.fromisoformat(ds)
                    except (ValueError, TypeError):
                        raise Problem("날짜를 확인해 주세요.")
                    require(
                        re.fullmatch(
                            r"(?:[01]\d|2[0-3]):[0-5]\d", slot.get("start", "")
                        )
                        and re.fullmatch(
                            r"(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)", slot.get("end", "")
                        )
                        and slot["start"] < slot["end"],
                        "시작·종료 시간을 확인해 주세요.",
                        400,
                    )
                    require(
                        slot.get("status") in ["가능", "불가능", "미정"],
                        "가용 상태를 확인해 주세요.",
                        400,
                    )
                    remaining = []
                    for a in e["availability"]:
                        if (
                            a["member"] == m["id"]
                            and a["date"] == ds
                            and a["start"] < slot["end"]
                            and a["end"] > slot["start"]
                        ):
                            if a["start"] < slot["start"]:
                                remaining.append(dict(a, end=slot["start"]))
                            if a["end"] > slot["end"]:
                                remaining.append(dict(a, start=slot["end"]))
                        else:
                            remaining.append(a)
                    e["availability"] = remaining
                    e["availability"].append(dict(slot, member=m["id"]))
                    if e["status"] == "제안":
                        e["status"] = "조율 중"
                        e["version"] = e.get("version", 1) + 1
                        e["history"].append(
                            {
                                "by": m["name"],
                                "at": now(),
                                "field": "status",
                                "before": "제안",
                                "after": "조율 중",
                            }
                        )
                elif op in ["event.comment", "event.comment.delete"]:
                    require(not e.get("deletedAt"), "삭제된 일정입니다.", 400)
                    cid = d.get("commentId")
                    c = next((x for x in e["comments"] if x["id"] == cid), None)
                    if cid:
                        require(
                            c
                            and (
                                c["author"] == m["id"]
                                or (admin and op.endswith("delete"))
                            )
                        )
                    if op.endswith("delete"):
                        require(c, "댓글이 없습니다.", 404)
                        e["comments"].remove(c)
                    else:
                        content = str(d.get("content", "")).strip()
                        require(
                            1 <= len(content) <= 3000,
                            "댓글은 1~3000자로 입력해 주세요.",
                            400,
                        )
                        if c:
                            c.update(content=content, updatedAt=now())
                        else:
                            e["comments"].append(
                                {
                                    "id": ident(),
                                    "author": m["id"],
                                    "name": m["name"],
                                    "content": content,
                                    "at": now(),
                                }
                            )
                else:
                    raise Problem("지원하지 않는 작업입니다.")
        else:
            raise Problem("지원하지 않는 작업입니다.")
        if op.startswith(("member.", "group.", "invite.", "type.")):
            audit(f, m, op)
        save(f)
        db().commit()
        return jsonify(ok=True, **result)

    @app.get("/")
    def index():
        return send_from_directory(ROOT, "index.html")

    @app.get("/<path:path>")
    def static_file(path):
        require(
            path in {"app.mjs", "core.mjs", "style.css", "family_calendar_mockup.html"},
            "파일을 찾을 수 없습니다.",
            404,
        )
        return send_from_directory(
            ROOT, path, mimetype="text/javascript" if path.endswith(".mjs") else None
        )

    return app


def recurrence_dates(e, until):
    try:
        start = date.fromisoformat(e["date"])
        end = date.fromisoformat(until)
    except (ValueError, TypeError):
        raise Problem("반복 날짜를 확인해 주세요.")
    require(1900 <= end.year <= 2100, "지원 연도: 1900~2100", 400)
    r = e["repeat"]
    interval = max(1, int(r.get("interval", 1)))
    result = []
    current = start
    while current <= end:
        ds = current.isoformat()
        days = (current - start).days
        months = (current.year - start.year) * 12 + current.month - start.month
        if r.get("until") and ds > r["until"]:
            break
        hit = current == start
        freq = r["freq"]
        if freq == "daily":
            hit = days % interval == 0
        elif freq == "weekly":
            hit = ((days + start.weekday()) // 7) % interval == 0 and (
                current.weekday() + 1
            ) % 7 in (r.get("weekdays") or [(start.weekday() + 1) % 7])
        elif freq == "monthly":
            hit = months % interval == 0 and (
                current.weekday() == start.weekday()
                and (current.day - 1) // 7 == (start.day - 1) // 7
                if r.get("monthMode") == "nth"
                else current.day == start.day
            )
        elif freq == "yearly":
            hit = (
                (current.year - start.year) % interval == 0
                and current.month == start.month
                and current.day == start.day
            )
        if hit:
            if r.get("count") and len(result) >= int(r["count"]):
                break
            result.append(ds)
        if freq == "none":
            break
        current += timedelta(days=1)
    return result


def validate_event(d, f):
    require(isinstance(d, dict), "일정 정보를 입력해 주세요.", 400)
    value = {
        k: d.get(k, "")
        for k in [
            "title",
            "description",
            "date",
            "start",
            "end",
            "type",
            "status",
            "priority",
            "visibility",
            "place",
            "address",
            "locationMemo",
        ]
    }
    require(
        isinstance(value["title"], str) and 1 <= len(value["title"].strip()) <= 120,
        "일정 제목은 1~120자로 입력해 주세요.",
        400,
    )
    for key in ["description", "place", "address", "locationMemo"]:
        require(
            isinstance(value[key], str) and len(value[key]) <= 5000,
            "입력 내용이 너무 깁니다.",
            400,
        )
    try:
        eventdate = date.fromisoformat(value["date"])
        require(1900 <= eventdate.year <= 2100, "지원 연도: 1900~2100", 400)
    except (ValueError, TypeError):
        raise Problem("날짜를 확인해 주세요.")
    start, end = value["start"], value["end"]
    require(
        (not start and not end)
        or (
            bool(re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", start))
            and bool(re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", end))
            and start < end
        ),
        "시작 시간은 종료 시간보다 빨라야 합니다.",
        400,
    )
    require(
        value["type"] in [t["id"] for t in f["types"]],
        "일정 유형을 선택해 주세요.",
        400,
    )
    require(
        value["status"] in ["제안", "조율 중", "확정", "취소"]
        and value["priority"] in ["일반", "필수"]
        and value["visibility"] in ["family", "selected", "private"],
        "상태·우선순위·공개 범위를 확인해 주세요.",
        400,
    )
    members = d.get("participants", [])
    require(
        isinstance(members, list)
        and len(members) > 0
        and all(x in [m["id"] for m in f["members"]] for x in members),
        "참여 대상을 선택해 주세요.",
        400,
    )
    r = d.get("repeat", {"freq": "none"})
    require(
        isinstance(r, dict)
        and r.get("freq") in ["none", "daily", "weekly", "monthly", "yearly"],
        "반복 규칙을 확인해 주세요.",
        400,
    )
    try:
        require(1 <= int(r.get("interval", 1)) <= 52, "반복 간격은 1~52입니다.", 400)
        if r.get("count"):
            require(1 <= int(r["count"]) <= 1000, "반복 횟수는 1~1000입니다.", 400)
        if r.get("until"):
            require(
                date.fromisoformat(r["until"]) >= eventdate,
                "반복 종료일을 확인해 주세요.",
                400,
            )
        require(
            all(isinstance(x, int) and 0 <= x <= 6 for x in r.get("weekdays", [])),
            "반복 요일을 확인해 주세요.",
            400,
        )
        for exception in r.get("exceptions", []):
            date.fromisoformat(exception)
    except (ValueError, TypeError):
        raise Problem("반복 규칙을 확인해 주세요.")
    value.update(
        participants=list(dict.fromkeys(members)),
        repeat=r,
        anniversary=bool(d.get("anniversary")),
        notifyAll=bool(d.get("notifyAll")),
    )
    return value


if __name__ == "__main__":
    from waitress import serve

    app = create_app()
    app.cleanup()

    def housekeeping():
        while True:
            time.sleep(3600)
            try:
                app.cleanup()
            except Exception:
                app.logger.exception("Cleanup failed")

    threading.Thread(target=housekeeping, daemon=True).start()
    port = int(os.getenv("PORT", "8080"))
    print(f"Family24: http://127.0.0.1:{port}", flush=True)
    serve(
        app,
        host=os.getenv("HOST", "127.0.0.1"),
        port=port,
        threads=8,
        max_request_body_size=256000,
    )
