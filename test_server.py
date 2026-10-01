import copy
import json
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
from datetime import datetime, timedelta, timezone
from pathlib import Path
from server import create_app


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "test.sqlite3"
        self.app = create_app(self.path)
        self.app.testing = True
        self.owner = self.user("owner")
        self.other = self.user("other")
        self.outsider = self.user("outsider")
        self.gid = self.action(self.owner, "group.create", name="우리 가족").json[
            "group"
        ]
        self.f = self.state(self.owner)["groups"][0]
        self.mid = self.f["me"]
        self.type = self.f["types"][0]["id"]
        invitation = self.action(self.owner, "invite.create").json
        self.action(self.other, "group.join", code=invitation["code"])
        self.othermid = self.state(self.other)["groups"][0]["me"]

    def tearDown(self):
        self.tmp.cleanup()

    def user(self, name):
        c = self.app.test_client()
        r = c.post(
            "/api/register",
            json={
                "email": name + "@example.com",
                "password": "strong-password-123",
                "name": name,
            },
            headers={"X-Family24": "1"},
        )
        self.assertEqual(r.status_code, 200, r.json)
        c.csrf = r.json["csrf"]
        return c

    def state(self, c):
        r = c.get("/api/state")
        self.assertEqual(r.status_code, 200, r.json)
        return r.json

    def action(self, c, op, expected=200, **data):
        r = c.post(
            "/api/action",
            json={"op": op, "group": getattr(self, "gid", None), **data},
            headers={"X-Family24": "1", "X-CSRF-Token": c.csrf},
        )
        self.assertEqual(r.status_code, expected, r.json)
        return r

    def event(self, **extra):
        return dict(
            title="가족 저녁",
            description="함께",
            date="2026-10-01",
            start="18:00",
            end="19:00",
            type=self.type,
            status="제안",
            priority="일반",
            visibility="family",
            participants=[self.mid, self.othermid],
            place="집",
            address="",
            locationMemo="",
            repeat={"freq": "none"},
            anniversary=False,
            **extra
        )

    def create(self, value=None):
        return self.action(self.owner, "event.save", event=value or self.event()).json[
            "id"
        ]

    def test_personal_schedule_target_and_visibility(self):
        value = self.event()
        value.update(type="personal", participants=[self.othermid])
        eid = self.create(value)
        self.assertIn(eid, [e["id"] for e in self.state(self.other)["events"]])
        value.update(visibility="private")
        private_id = self.create(value)
        self.assertNotIn(
            private_id, [e["id"] for e in self.state(self.other)["events"]]
        )
        self.assertIn(private_id, [e["id"] for e in self.state(self.owner)["events"]])
        value.update(participants=[self.mid, self.othermid])
        self.action(self.owner, "event.save", event=value, expected=400)
        self.action(self.owner, "type.delete", id="personal", expected=400)

    def test_personal_schedule_for_member_without_account(self):
        self.action(self.owner, "member.add", name="아이")
        profile = next(
            m
            for m in self.state(self.owner)["groups"][0]["members"]
            if m["name"] == "아이"
        )
        value = self.event()
        value.update(type="personal", participants=[profile["id"]])
        eid = self.create(value)
        saved = next(e for e in self.state(self.owner)["events"] if e["id"] == eid)
        self.assertEqual(saved["participants"], [profile["id"]])

    def test_personal_type_migration_preserves_existing_data(self):
        self.create()
        with sqlite3.connect(self.path) as db:
            original = json.loads(
                db.execute(
                    "SELECT data FROM families WHERE id=?", (self.gid,)
                ).fetchone()[0]
            )
            original["types"] = [t for t in original["types"] if t["id"] != "personal"]
            db.execute(
                "UPDATE families SET data=? WHERE id=?",
                (json.dumps(original), self.gid),
            )
        create_app(self.path)
        create_app(self.path)
        with sqlite3.connect(self.path) as db:
            migrated = json.loads(
                db.execute(
                    "SELECT data FROM families WHERE id=?", (self.gid,)
                ).fetchone()[0]
            )
        self.assertEqual(
            len([t for t in migrated["types"] if t["id"] == "personal"]), 1
        )
        migrated["types"] = [t for t in migrated["types"] if t["id"] != "personal"]
        self.assertEqual(original, migrated)

    def test_member_colors_unique_and_persisted(self):
        self.action(self.owner, "member.add", name="아이")
        members = self.state(self.owner)["groups"][0]["members"]
        self.assertEqual(len({m["color"] for m in members}), len(members))
        self.assertEqual(members, self.state(self.other)["groups"][0]["members"])
        with sqlite3.connect(self.path) as db:
            f = json.loads(
                db.execute(
                    "SELECT data FROM families WHERE id=?", (self.gid,)
                ).fetchone()[0]
            )
            for m in f["members"]:
                m["color"] = "#4f7669"
            db.execute(
                "UPDATE families SET data=? WHERE id=?", (json.dumps(f), self.gid)
            )
        create_app(self.path)
        colors = [m["color"] for m in self.state(self.owner)["groups"][0]["members"]]
        self.assertEqual(len(set(colors)), len(colors))
        create_app(self.path)
        self.assertEqual(
            colors, [m["color"] for m in self.state(self.owner)["groups"][0]["members"]]
        )

    def test_personal_categories_saved_and_validated(self):
        value = self.event()
        value.update(type="personal", participants=[self.mid], category=" 운동 ", date="2026-10-17")
        eid = self.create(value)
        saved = next(e for e in self.state(self.owner)["events"] if e["id"] == eid)
        self.assertEqual(saved["category"], "운동")
        self.assertEqual(saved["date"], "2026-10-17")
        value["category"] = "업무"
        self.action(self.owner, "event.save", id=eid, version=saved["version"], event=value)
        saved = next(e for e in self.state(self.owner)["events"] if e["id"] == eid)
        self.assertEqual(saved["category"], "업무")
        for invalid in ["x" * 31, None, ["운동"]]:
            value["category"] = invalid
            self.action(self.owner, "event.save", event=value, expected=400)

    def test_login_logout_csrf(self):
        self.assertEqual(
            self.owner.post(
                "/api/action", json={"op": "group.create"}, headers={"X-Family24": "1"}
            ).status_code,
            403,
        )
        self.assertEqual(
            self.owner.post(
                "/api/action",
                json={},
                headers={
                    "X-Family24": "1",
                    "X-CSRF-Token": self.owner.csrf,
                    "Origin": "https://evil.test",
                },
            ).status_code,
            403,
        )
        r = self.owner.post(
            "/api/logout",
            json={},
            headers={"X-Family24": "1", "X-CSRF-Token": self.owner.csrf},
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.owner.get("/api/state").status_code, 401)

    def test_password_storage_and_login(self):
        with sqlite3.connect(self.path) as db:
            password = db.execute("SELECT password FROM users LIMIT 1").fetchone()[0]
        self.assertTrue(password.startswith("scrypt:"))
        self.assertNotIn("strong-password", password)
        c = self.app.test_client()
        self.assertEqual(
            c.post(
                "/api/login",
                json={"email": "owner@example.com", "password": "strong-password-123"},
                headers={"X-Family24": "1"},
            ).status_code,
            200,
        )

    def test_group_isolation_private_and_notifications(self):
        value = self.event()
        value["visibility"] = "private"
        eid = self.create(value)
        self.assertEqual(self.state(self.other)["events"], [])
        self.assertEqual(self.state(self.other)["notifications"], [])
        self.action(self.other, "event.delete", id=eid, expected=404)
        self.action(self.outsider, "member.add", name="침입", expected=403)
        second = self.action(self.owner, "group.create", name="친척").json["group"]
        self.assertNotEqual(second, self.gid)
        self.action(self.owner, "event.delete", group=second, id=eid, expected=404)

    def test_selected_visibility(self):
        value = self.event()
        value.update(visibility="selected", participants=[self.mid])
        self.create(value)
        self.assertFalse(self.state(self.other)["events"])

    def test_invite_profile_single_use(self):
        self.action(self.owner, "member.add", name="할머니")
        m = self.state(self.owner)["groups"][0]["members"][-1]
        invite = self.action(self.owner, "invite.create", profile=m["id"]).json
        self.action(self.outsider, "group.join", code=invite["token"])
        self.assertEqual(self.state(self.outsider)["groups"][0]["me"], m["id"])
        self.action(self.other, "group.join", code=invite["token"], expected=400)

    def test_expired_invitation(self):
        invite = self.action(self.owner, "invite.create").json
        with sqlite3.connect(self.path) as db:
            db.execute("UPDATE invites SET expires=0")
        self.action(self.outsider, "group.join", code=invite["code"], expected=400)

    def test_roles_and_types(self):
        self.action(
            self.other, "member.role", member=self.othermid, role="admin", expected=403
        )
        self.action(self.owner, "member.role", member=self.othermid, role="admin")
        self.action(
            self.other, "member.role", member=self.mid, role="member", expected=403
        )
        self.action(self.other, "member.role", member=self.othermid, role="member")
        self.action(
            self.other,
            "type.save",
            type={"name": "운동", "color": "#abcdef", "icon": "⚽"},
        )
        self.action(
            self.other,
            "type.save",
            type={"id": self.type, "name": "변경", "color": "#abcdef", "icon": "⚽"},
            expected=403,
        )

    def test_event_validation_and_conflict(self):
        value = self.event()
        value["end"] = "17:00"
        self.action(self.owner, "event.save", event=value, expected=400)
        eid = self.create()
        value = self.event()
        value["title"] = "변경"
        self.action(self.owner, "event.save", id=eid, version=1, event=value)
        self.action(
            self.owner, "event.save", id=eid, version=1, event=value, expected=409
        )
        self.action(
            self.other, "event.save", id=eid, version=2, event=value, expected=403
        )

    def test_confirm_edit_recoordinates(self):
        eid = self.create()
        self.action(
            self.owner,
            "event.confirm",
            id=eid,
            start="18:00",
            end="19:00",
            date="2026-10-01",
        )
        e = self.state(self.owner)["events"][0]
        e["place"] = "식당"
        self.action(self.owner, "event.save", id=eid, version=e["version"], event=e)
        saved = self.state(self.owner)["events"][0]
        self.assertEqual(saved["status"], "조율 중")
        self.assertTrue(saved["history"])

    def test_availability_comments_responses(self):
        eid = self.create()
        self.action(
            self.other,
            "event.availability",
            id=eid,
            slot={
                "date": "2026-10-01",
                "start": "18:00",
                "end": "20:00",
                "status": "가능",
            },
        )
        self.action(
            self.other,
            "event.comment",
            id=eid,
            content="<script>not executable</script>",
        )
        e = self.state(self.owner)["events"][0]
        cid = e["comments"][0]["id"]
        self.action(
            self.owner,
            "event.comment",
            id=eid,
            commentId=cid,
            content="수정",
            expected=403,
        )
        self.action(self.owner, "event.comment.delete", id=eid, commentId=cid)
        self.action(self.other, "event.response", id=eid, status="불참", reason="수업")
        self.assertEqual(
            self.state(self.owner)["events"][0]["responses"][self.othermid]["status"],
            "불참",
        )

    def test_recurrence_one_and_following(self):
        value = self.event()
        value["repeat"] = {"freq": "weekly", "interval": 1, "count": 10}
        eid = self.create(value)
        value["date"] = "2026-10-08"
        self.action(
            self.owner,
            "event.save",
            id=eid,
            version=1,
            event=value,
            scope="one",
            occurrence="2026-10-08",
        )
        events = self.state(self.owner)["events"]
        self.assertEqual(len(events), 2)
        self.assertIn("2026-10-08", events[0]["repeat"]["exceptions"])
        self.assertEqual(events[1]["repeat"]["freq"], "none")

    def test_following_preserves_remaining_count(self):
        value = self.event()
        value["repeat"] = {"freq": "weekly", "interval": 1, "count": 10}
        eid = self.create(value)
        value["date"] = "2026-10-15"
        self.action(
            self.owner,
            "event.save",
            id=eid,
            version=1,
            event=value,
            scope="following",
            occurrence="2026-10-15",
        )
        events = self.state(self.owner)["events"]
        self.assertEqual(events[0]["repeat"]["until"], "2026-10-14")
        self.assertEqual(events[1]["repeat"]["count"], 8)

    def test_invalid_occurrence_cannot_split(self):
        value = self.event()
        value["repeat"] = {"freq": "weekly", "count": 3}
        eid = self.create(value)
        self.action(
            self.owner,
            "event.save",
            id=eid,
            version=1,
            event=value,
            scope="one",
            occurrence="2026-10-02",
            expected=400,
        )

    def test_confirm_only_one_recurring_occurrence(self):
        value = self.event()
        value["repeat"] = {"freq": "weekly", "count": 3}
        eid = self.create(value)
        r = self.action(
            self.owner,
            "event.confirm",
            id=eid,
            date="2026-10-08",
            start="19:00",
            end="20:00",
        )
        events = self.state(self.owner)["events"]
        self.assertEqual(events[0]["status"], "제안")
        self.assertIn("2026-10-08", events[0]["repeat"]["exceptions"])
        self.assertEqual(events[1]["id"], r.json["id"])
        self.assertEqual(events[1]["status"], "확정")
        self.assertEqual(events[1]["repeat"]["freq"], "none")

    def test_availability_preserves_unaffected_ranges(self):
        eid = self.create()
        self.action(
            self.owner,
            "event.availability",
            id=eid,
            slot={
                "date": "2026-10-01",
                "start": "09:00",
                "end": "18:00",
                "status": "가능",
            },
        )
        self.action(
            self.owner,
            "event.availability",
            id=eid,
            slot={
                "date": "2026-10-01",
                "start": "12:00",
                "end": "13:00",
                "status": "불가능",
            },
        )
        slots = self.state(self.owner)["events"][0]["availability"]
        self.assertEqual(len(slots), 3)
        self.assertIn(("09:00", "12:00"), [(a["start"], a["end"]) for a in slots])

    def test_delete_restore_and_cleanup(self):
        eid = self.create()
        self.action(self.owner, "event.delete", id=eid)
        self.action(self.owner, "event.restore", id=eid)
        self.assertIsNone(self.state(self.owner)["events"][0]["deletedAt"])
        self.action(self.owner, "event.delete", id=eid)
        with sqlite3.connect(self.path) as db:
            f = json.loads(
                db.execute(
                    "SELECT data FROM families WHERE id=?", (self.gid,)
                ).fetchone()[0]
            )
            f["events"][0]["deletedAt"] = (
                datetime.now(timezone.utc) - timedelta(days=31)
            ).isoformat()
            f["notifications"][0]["createdAt"] = (
                datetime.now(timezone.utc) - timedelta(days=91)
            ).isoformat()
            db.execute(
                "UPDATE families SET data=? WHERE id=?", (json.dumps(f), self.gid)
            )
        self.app.cleanup()
        self.assertEqual(self.state(self.owner)["events"], [])

    def test_reset_invalidates_sessions(self):
        r = self.action(self.owner, "member.reset", member=self.othermid)
        self.assertEqual(self.other.get("/api/state").status_code, 401)
        c = self.app.test_client()
        reply = c.post(
            "/api/reset",
            json={
                "email": "other@example.com",
                "password": "new-password-123",
                "code": r.json["code"],
            },
            headers={"X-Family24": "1"},
        )
        self.assertEqual(reply.status_code, 200, reply.json)
        reply = c.post(
            "/api/reset",
            json={
                "email": "other@example.com",
                "password": "new-password-456",
                "code": r.json["code"],
            },
            headers={"X-Family24": "1"},
        )
        self.assertEqual(reply.status_code, 400)

    def test_preferences_persist_and_static_restrictions(self):
        self.action(self.owner, "preferences", preferences={"theme": "dark"})
        self.assertEqual(self.state(self.owner)["preferences"]["theme"], "dark")
        self.assertEqual(self.state(self.other)["preferences"], {})
        for path in ["/server.py", "/.git/config", "/data/family24.sqlite3"]:
            self.assertEqual(self.owner.get(path).status_code, 404)
        self.assertIn("2026-10-03", self.owner.get("/api/holidays?year=2026").json)

    def test_deleted_group_restore(self):
        self.action(self.owner, "group.delete")
        self.action(self.other, "group.restore", expected=403)
        self.action(self.owner, "group.restore")
        self.assertFalse(self.state(self.owner)["groups"][0]["deletedAt"])


class DeploymentTests(unittest.TestCase):
    def test_render_https_origin_secure_session_and_persistence(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(
            "os.environ",
            {
                "RENDER_EXTERNAL_URL": "https://family24-test.onrender.com",
                "FAMILY24_SECURE_COOKIE": "1",
                "FAMILY24_ORIGIN": "",
            },
        ):
            path = Path(directory) / "persistent.sqlite3"
            app = create_app(path)
            client = app.test_client()
            origin = "https://family24-test.onrender.com"
            self.assertEqual(client.get("/healthz").json, {"status": "ok"})
            data = {
                "name": "배포 검사",
                "email": "deploy@example.com",
                "password": "deployment-test-123",
            }
            headers = {"X-Family24": "1", "Origin": origin}
            response = client.post(
                "/api/register", json=data, headers=headers, base_url=origin
            )
            self.assertEqual(response.status_code, 200, response.json)
            cookie = response.headers["Set-Cookie"]
            self.assertIn("Secure", cookie)
            self.assertIn("HttpOnly", cookie)
            self.assertIn(
                "max-age=31536000", response.headers["Strict-Transport-Security"]
            )
            self.assertEqual(client.get("/api/state", base_url=origin).status_code, 200)
            self.assertEqual(
                client.post(
                    "/api/login",
                    json=data,
                    headers={**headers, "Origin": "https://untrusted.example"},
                    base_url=origin,
                ).status_code,
                403,
            )
            restarted = create_app(path).test_client()
            self.assertEqual(
                restarted.post(
                    "/api/login", json=data, headers=headers, base_url=origin
                ).status_code,
                200,
            )

    def test_custom_origin_overrides_platform_url(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(
            "os.environ",
            {
                "FAMILY24_ORIGIN": "https://calendar.example.com/",
                "RENDER_EXTERNAL_URL": "https://other.onrender.com",
            },
        ):
            app = create_app(Path(directory) / "test.sqlite3")
            self.assertEqual(
                app.config["PUBLIC_ORIGIN"], "https://calendar.example.com"
            )


if __name__ == "__main__":
    unittest.main()
