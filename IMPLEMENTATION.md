# 구현 및 운영 메모

## API

모든 변경 요청은 JSON과 `X-Family24: 1` 헤더를 사용합니다. 로그인 후에는 `/api/state`가 반환하는 `csrf`를 `X-CSRF-Token`으로 전달합니다. 계정 세션은 HttpOnly, SameSite=Lax 쿠키이며 서버에는 토큰의 SHA-256 해시를 저장합니다. 비밀번호는 Werkzeug scrypt 해시로 저장합니다. 로그인·가입·복구 요청은 IP당 15분 40회 제한을 공유합니다.

| 경로                          | 용도                                     |
| ----------------------------- | ---------------------------------------- |
| POST `/api/register`          | name, email, password로 가입             |
| POST `/api/login`             | email, password로 로그인                 |
| POST `/api/reset`             | email, code, password로 일회용 코드 소비 |
| POST `/api/logout`            | 현재 세션 폐기                           |
| GET `/api/state`              | 계정, 접근 가능한 그룹·일정·알림·설정    |
| GET `/api/holidays?year=2026` | 오프라인 한국 공휴일 계산                |
| POST `/api/action`            | op와 group 및 작업별 입력                |

작업 이름:

- `group.create`, `group.join`, `group.rename`, `group.delete`, `group.restore`
- `member.add`, `member.role`, `member.reset`
- `invite.create`, `invite.revoke`
- `type.save`, `type.delete`
- `event.save`, `event.confirm`, `event.delete`, `event.restore`, `event.purge`
- `event.availability`, `event.response`, `event.comment`, `event.comment.delete`
- `notification.read`, `preferences`

일정 수정에는 `id`, 마지막 조회의 `version`, `event` 객체를 보냅니다. 반복 수정에는 `scope` (`one`, `following`, `series`)와 원래 회차의 `occurrence` 날짜를 추가합니다. 일정의 핵심 정보가 변경되면 재조율 상태로 바뀝니다. 충돌은 409, 권한 실패는 403, 접근할 수 없는 일정은 404를 반환합니다.

## 실행 환경

| 환경 변수                | 기본값                  | 설명                                    |
| ------------------------ | ----------------------- | --------------------------------------- |
| `HOST`                   | `127.0.0.1`             | 수신 주소                               |
| `PORT`                   | `8080`                  | 수신 포트                               |
| `FAMILY24_DB`            | `data/family24.sqlite3` | SQLite 파일 경로                        |
| `FAMILY24_ORIGIN`        | Render 공개 URL 또는 요청의 origin           | 외부 배포 시 실제 HTTPS origin으로 고정 |
| `FAMILY24_SECURE_COOKIE` | 비활성                  | HTTPS 배포 시 `1`                       |

Waitress는 TLS를 직접 제공하지 않습니다. 외부 서비스에는 HTTPS 프록시와 지속 디스크가 필요합니다. 기본 실행은 localhost에만 바인딩합니다. 브라우저에서 `.html`을 직접 열면 API가 없으므로 실제 서비스는 동작하지 않습니다.

`python server.py` 실행 방식에는 시작 시/매시간 정리 작업이 포함됩니다. 다른 WSGI 실행 방식을 사용할 경우 별도 스케줄러에서 `create_app().cleanup()`을 정기 실행해야 합니다. 종료 중에는 DB 파일을 그대로 보존하세요. 실행 중 백업은 SQLite backup API를 사용해 일관된 복사본을 생성합니다.

한국 공휴일은 고정 버전 `holidays` 패키지로 계산합니다. 외부 API를 호출하지 않으며, 추후 지정되는 임시 공휴일은 패키지 갱신 및 회귀검사가 필요합니다. 일시는 날짜/벽시계 시간으로 저장하며 서비스 UI는 한국 가족 사용을 기본으로 합니다. 변경 이력은 UTC로 저장하고 브라우저 현지 시간으로 표시합니다.

## 검증 범위

- 실제 SQLite 파일을 사용한 Flask 클라이언트 통합 검사: 인증·CSRF·권한·가족 격리·공개 범위·초대 만료/소비·관리자·유형·수정 충돌·재조율·댓글·응답·반복 분리·부분 가용 시간 보존·삭제·복구·정리·재설정·개인 설정
- Node 기본 테스트 러너: 월말·윤년·격주·요일·N번째 요일·예외·횟수·검색·집계·XLSX
- XLSX: ZIP CRC와 XML 구문 검사. 외부 Excel 앱에서의 모든 서식 호환성은 전수 검증하지 않았습니다.
- 브라우저 검증은 실제 사용자 데이터와 분리된 `test-results/browser.sqlite3`를 사용했습니다. 테스트 계정과 산출물은 Git에서 제외됩니다.

## 알려진 범위

- 실시간 서버 푸시가 아닌 명시적 새로고침 방식입니다.
- 후보 비교는 선택 날짜의 1시간 단위입니다. 여러 날/가변 길이 최적화나 AI 추천은 제외합니다.
- 다중 그룹은 소속 그룹을 전환하며, 서로 다른 그룹의 일정을 합쳐 노출하지 않습니다.
- 기념일은 명시적 체크 항목입니다. 매년 반복 여부는 별도로 선택합니다.
- 그룹별 문서 저장 구조는 소규모 가족 사용을 목표로 합니다. 대규모 운영 전에는 이벤트 테이블 분리·검색 인덱스·페이지네이션과 부하 검증이 필요합니다.
- 독립적인 외부 보안 감사, 실제 HTTPS 배포, 이메일 소유권 검증은 이번 구현에 포함하지 않습니다. PRD와 같이 이메일/SMS 발송은 사용하지 않습니다.
