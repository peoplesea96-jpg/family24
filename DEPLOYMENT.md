# Family24 공개 배포

## 준비된 구성

`render.yaml`은 GitHub main 브랜치에서 Python 서버를 실행합니다. 싱가포르 리전, 512MB 단일 인스턴스, 1GB 영구 디스크를 사용합니다. 비용이 발생하는 구성이며 생성 화면의 실제 요금 확인 및 사용자 승인이 선행되어야 합니다.

- 시작 명령: `python server.py`
- 데이터: `/var/data/family24.sqlite3` (재배포 후 유지)
- HTTPS: Render의 자동 HTTPS
- 쿠키: Secure, HttpOnly, SameSite=Lax
- 요청 origin: Render가 제공하는 `RENDER_EXTERNAL_URL`로 자동 고정
- 상태 검사: `/healthz`, DB 조회가 가능하면 200 반환
- 자동 배포: GitHub 검사 통과 후 배포
- 정기 정리: 서버 시작 시 및 매시간

## 계정 연결 후 배포

1. Render 계정에서 GitHub 저장소 `peoplesea96-jpg/family24`에 접근을 허용합니다.
2. [Render Blueprint 생성](https://dashboard.render.com/select-repo?type=blueprint)에서 이 저장소의 `render.yaml`을 선택합니다.
3. 유료 서버와 1GB 영구 디스크의 표시 요금을 확인합니다. 기존 같은 이름의 서비스가 있다면 덮어쓰지 말고 먼저 확인합니다.
4. 배포 완료 후 Render가 반환한 실제 `https://….onrender.com` 주소로 접속합니다. 서비스 이름만으로 URL을 추측하지 않습니다.
5. `/healthz`, 회원가입, 로그인, 가족 생성, 일정 저장 및 재로그인 후 유지 여부를 확인합니다.

무료 웹 서비스는 영구 디스크를 지원하지 않아 현재 SQLite 구성에는 적합하지 않습니다. 이 파일을 GitHub에 올리는 것만으로 Render 서비스가 생성되지는 않습니다.

## 운영

- 새 공개 서비스는 빈 DB로 시작합니다. 로컬 계정·가족 일정·테스트 데이터는 자동 업로드하지 않습니다.
- 사용자 지정 도메인을 연결하면 `FAMILY24_ORIGIN=https://실제도메인`을 추가하고 재배포합니다.
- 단일 디스크 SQLite 구성은 인스턴스를 여러 대로 늘리지 않습니다. 확장이 필요하면 DB 구조를 전환합니다.
- 디스크 스냅샷만을 유일한 DB 백업으로 사용하지 않습니다. SQLite backup API로 일관된 사본을 만들고 별도 저장소에 보관합니다.
- 로컬 DB를 옮겨야 한다면 별도 승인된 이관 작업으로 처리합니다.

## 현재 상태

배포 설정 및 HTTPS 환경 검증까지 준비되었습니다. 호스팅 계정 연결 및 비용 승인이 완료되기 전에는 실제 배포 완료나 공개 주소가 있다고 간주하지 않습니다.

참고: [Render Blueprint](https://render.com/docs/blueprint-spec), [영구 디스크](https://render.com/docs/disks), [요금](https://render.com/pricing).
