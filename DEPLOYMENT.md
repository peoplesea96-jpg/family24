# Family24 공개 배포

## 현재 서비스

- 공개 주소: https://family24-production.up.railway.app/
- 호스팅: Railway / delightful-courage / production / family24
- 소스: peoplesea96-jpg/family24, main
- 빌드: Railpack, `pip install -r requirements.txt`
- 실행: `python server.py`, 단일 인스턴스
- 영구 볼륨: family24-family24-data, `/var/data`, 5GB, Amsterdam
- 상태 검사: `/healthz` (SQLite 조회 성공 시 200)
- HTTPS와 인증서: Railway 제공

## 환경 변수

| 변수 | 값 |
| --- | --- |
| HOST | 0.0.0.0 |
| PORT | 8080 |
| FAMILY24_DB | /var/data/family24.sqlite3 |
| FAMILY24_ORIGIN | https://family24-production.up.railway.app |
| FAMILY24_SECURE_COOKIE | 1 |
| PYTHONUNBUFFERED | 1 |

외부 프록시가 접근할 수 있도록 HOST를 지정하고, HTTPS 주소를 요청 origin 검사에 사용합니다. 로그인 쿠키에는 Secure, HttpOnly, SameSite=Lax가 적용됩니다. 기존 볼륨과 서비스를 보존하여 설정을 수정했습니다.

## 확인 기록

2026-09-30 UTC: Railway 배포 성공 및 상태 검사 통과. 외부 HTTPS `/healthz`에서 200과 `{"status":"ok"}`를 확인하고 브라우저에서 로그인 화면을 확인했습니다. 서버 자동 검사 21개도 통과했습니다. 운영 데이터로 회원가입·일정 저장·재배포 유지 전체 흐름을 별도로 시험한 것은 아닙니다.

## 운영

- 공개 서버로 로컬 계정·가족 일정·테스트 DB를 업로드하지 않았습니다. 사용자가 공개 주소에서 회원가입하여 시작합니다.
- 데이터는 지정된 영구 볼륨에 보관합니다. 볼륨을 삭제하거나 마운트 경로를 변경하지 않습니다.
- SQLite 단일 디스크 구성에서는 인스턴스를 여러 대로 늘리지 않습니다.
- 사용자 지정 도메인으로 바꾸면 FAMILY24_ORIGIN도 실제 HTTPS 주소로 변경합니다.
- 정기 정리는 서버 시작 시와 매시간 실행됩니다.
- 별도 자동 백업은 아직 구성하지 않았습니다. SQLite backup API로 일관된 사본을 만들고 별도 저장소에 보관해야 합니다.
- 사용량과 비용은 Railway 계정의 요금제 및 사용량 화면에서 확인합니다. 이번 작업에서 구독 요금제를 변경하지 않았습니다.
- `render.yaml`은 Render 대체 배포 설정이며, 현재 서비스는 Railway에서 실행합니다.
