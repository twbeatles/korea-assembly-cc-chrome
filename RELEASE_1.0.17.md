# Release 1.0.17

생성일: 2026-11-05 (Asia/Seoul). Chrome Web Store 제출용 로컬 패키지이며 스토어 업로드·심사 제출은 하지 않았다.

## 패키지

- 파일: `korea-assembly-cc-chrome-1.0.17-cws.zip` (프로젝트 루트)
- 크기: **203,996 bytes**
- 내부 파일: **33개**, `manifest.json`이 ZIP 최상위에 위치
- SHA-256: `7ab016b94033d67ec74879f080a6b273bc514b5c0b1c55c1ec9debd99c19b6a0`
- 버전: package / manifest / lockfile 최상위·root package / dist manifest 모두 **1.0.17**
- ZIP은 기존 `.gitignore` 정책에 따라 Git에 포함하지 않는다. 소스·문서·버전 변경은 커밋한다.

검증한 항목: ZIP CRC, 중복·절대·상위 디렉터리 경로 없음, 내부 경로 `/` 사용, source map 없음, manifest의 background/content/페이지/icon/공개 리소스 파일 존재, ZIP 파일 집합과 각 파일 내용이 production `dist/`와 일치.

위 해시는 이번 생성물에 대한 값이다. 다시 빌드·압축하면 ZIP 시간 정보 등으로 해시가 달라질 수 있으므로 새 생성물의 해시를 다시 기록한다. 재생성 절차는 [DEPLOYMENT.md §5](DEPLOYMENT.md#5-내부-공유용-배포)를 따른다.

## 포함된 수정

- 저장소 장애·복구 시 최신 기록·사용자 편집 보존, 동시 폴백 저장 및 인덱스 복구.
- 삭제·종료 저장 실패 처리, 대기 자막 보존, 백업 완전성 및 용량 제한 안내.
- 설정 동시 변경·오래 열린 Options의 덮어쓰기 방지, 구버전 설정 로딩, 저장 실패 후 메모리 일관성.
- SW 재시작·빠른 다운로드 완료 시 Blob URL 정리.
- 릴리스 검증 중 History 재로드 직후 목록을 즉시 검사하던 E2E 타이밍 문제 수정. 목록 렌더링을 기다린 뒤 기존 3건 보존 검사를 수행한다. 제품 데이터 경로나 기대값은 변경하지 않았다.

자세한 근거: [저장소 감사 개선 기록](AUDIT_REMEDIATION.md), [추가 감사](PROJECT_AUDIT_ROUND2.md), [릴리스 노트](DEPLOYMENT.md#11-릴리스-노트).

## 검증 결과

- Node **26.13.0**, Windows, 임시 Chromium 프로필·synthetic 방송 DOM fixture 사용.
- `npm run verify`: **통과**. 버전·의존성 동기화, injected 생성/검사, calibration/parity, format/lint, TS7/TS6, coverage, production audit, build 포함.
- **82 test files / 539 tests passed**. coverage: statements 78.12%, branches 69.63%, functions 79.79%, lines 78.24%.
- production dependency audit: **0 vulnerabilities**. 의존성 설치·버전 변경 없음.
- 최신 1.0.17 production build로 headless `node scripts/extension-smoke.mjs`: **통과**. 첫 실행의 비동기 목록 assertion 실패를 보완한 뒤 통과했으며, 수정한 스크립트의 format·lint도 통과했다.
- 브라우저 검증 범위: DOM+iframe 수집, IndexedDB 재조회, 6종 export, 재시작, JSON/library 복원, SW/History 동시 폴백, Offscreen Blob의 SW 중단 후 유지·취소 후 해제, 확장 페이지 렌더링.
- 실제 사용자 데이터는 사용하지 않았다. 실제 생중계 장시간 운전·macOS/Linux·OS 강제 종료는 이번 실행 범위에 포함하지 않았다.

## 문서 갱신

README의 현재 버전·변경 요약, DEPLOYMENT의 Node 26·lockfile 버전 동기화·검증/압축 절차·권한·릴리스 노트, CLAUDE/GEMINI의 현재 운영 기준을 갱신했다. 기존 감사 보고서의 당시 버전은 역사적 증거로 유지했다.
