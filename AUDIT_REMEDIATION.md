# Audit Remediation

대상: [PROJECT_AUDIT.md](PROJECT_AUDIT.md), 2026-11-05. 감사 본문은 수정 전 증거로 보존한다. 사용자 요청에 따라 main에서 구현했으며 Spec Kit은 사용하지 않는다.

설정·다운로드 및 캡처/브리지 추가 감사·수정 기록은 [PROJECT_AUDIT_ROUND2.md](PROJECT_AUDIT_ROUND2.md)에 이어진다.

## 제안별 대응

| 감사 제안                         | 대응                                                                                                                      | 검증                                                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| ISSUE-001 양 백엔드 상태 조정     | transaction 전 폴백 read, transaction 내 최신 IDB와 비교, 실패 시 읽은 IDB를 폴백 mutator에 전달; 버전 조건부 복사본 정리 | `session-store-failover.test.ts`: 메모·tags·교정 원문·entry note/labels·새 자막 보존, IDB→폴백 write 실패, storage read 실패 |
| ISSUE-002 공용 인덱스 직렬화·복구 | 별도 공용 Web Lock, 세션→공용 잠금 순서, durable 키에서 index/metadata 재구성, 중단된 migration의 최신 key 보존           | 독립 모듈 A/B 테스트, 실제 Chromium SW+History 폴백 저장·재로드                                                              |
| ISSUE-003 삭제 실패 전달          | 세션 잠금 안에서 삭제, IDB 오류 전파, 삭제 확인 후 폴백·큐·tombstone 처리                                                 | IDB delete 오류 주입→실패→원본 확인→재시도 제거                                                                              |
| 저장 실패·quota·캐시              | 읽기 실패를 부재로 오판하지 않음; 영속화 성공 후 메모리 확정; 실패한 삭제/전체 정리에서 메모리부터 비우지 않음            | failover 장애 주입·기존 storage/recovery 테스트                                                                              |
| 분할 중 종료                      | drain 중 새 rollover 차단; 추가로 발견한 대기 이벤트 누락을 수정                                                          | `runtime-stop-recovery.test.ts`: 임계 도달 상태에서 복수 대기 자막 모두 최종 snapshot 반영                                   |
| 종료 실패 후 재실행               | failed-stopped guard와 함께 durable 종료 큐 적재 시도                                                                     | `stopped-session-durability.test.ts`, 기존 replay/tombstone/startup 테스트                                                   |
| 백업 중 동시 변경                 | 시작 시 대상 ID union 고정; hydration 누락은 오류; IDB·폴백 목록 읽기 실패 시 불완전한 성공 방지                          | membership 변경 테스트, 누락 record 거부, 실제 전체 bundle 다운로드·JSON 복원                                                |
| 25 MiB 초과 백업                  | 안전한 세그먼트 전체 JSON 개별 저장·파일별 복원 절차를 오류와 README에 명시                                               | 기존 크기 한도·parser·import 테스트. 같은 ID 부분 JSON 병합을 안내하지 않음                                                  |
| 구조·테스트 가능성                | 기존 최신 record 선택 정책 재사용, 명명된 공통 잠금 helper, 완료 큐 정리; production 테스트 전용 API 추가 없음            | 타입 검사·lock brand/실패 복구·독립 환경 회귀                                                                                |
| 문서 불일치                       | README·현재 CLAUDE·coverage 주석 Node 26 기준, 과거 delta는 이력으로 구분                                                 | 툴체인 보정·version 검사                                                                                                     |
| OS/타임존 검증                    | Windows/Linux/macOS CI job, UTC/KST 경계의 storage·파일명·CSV·backup 회귀                                                 | 로컬 Windows 검증과 원격 CI 실행을 구분                                                                                      |
| 장시간·절전·실중계                | 수동 운영 체크리스트 보강, 복구 보장 경계 명시                                                                            | 이번에는 실중계·OS 강제 종료를 실행하지 않음                                                                                 |

## 보존 정책과 한계

- 새 DB schema·백업 포맷·의존성을 도입하지 않는다. 기존 IDB/폴백 record 및 backup v1을 유지한다.
- 원본 IDB를 읽지 못한 캡처 폴백에는 내부 조정 표식을 남긴다. 복구 시 기존 편집을 보존하되 폴백에서 명시적으로 변경·비운 메타데이터를 우선한다. 이 표식은 공개 JSON·정상 IDB 저장 정규화에서 제거한다.
- 폴백 index/metadata는 검색용 파생 상태이며 durable 본문을 기준으로 복구한다. 손상된 개별 본문을 자동 삭제하지 않는다.
- Web Locks가 없는 환경에서는 메모리 큐와 durable 키 재발견으로 보완하지만, 지원 Chrome의 cross-context 잠금과 동등한 원자성을 주장하지 않는다.
- 백업은 전체 라이브러리의 완전한 시점 snapshot이 아니다. 시작 시 대상 ID 집합을 고정하고, 내용은 각 record를 읽을 때의 상태다.
- 25 MiB 전체 제한은 유지한다. 안내된 우회는 각 세그먼트 전체 파일이 25 MiB 이하일 때 유효하다. 단일 세그먼트 초과 복원·동일 ID 부분 JSON 자동 병합은 지원하지 않는다.
- Chrome storage까지 실패하거나 OS가 미저장 상태를 즉시 종료하면 마지막 데이터 완전 복구는 보장할 수 없다. 실패 guard와 진단은 유지한다.
- macOS/Linux·실중계·장기 절전·OS 강제 종료 결과를 로컬 성공으로 기재하지 않는다.

## 검증 결과

- `npm run verify`: **통과**. depsync/version/injected/coverage 보정/형제 저장소 parity/format/lint/TS7/coverage/TS6/production audit/build 전체 실행.
- 단위·통합 테스트: **80 files / 531 tests passed** (기존 516개 대비 15개 추가).
- 핵심 저장 장애 6개와 분할 중 종료 누락은 수정 전 실패를 확인했다. 새 안내 문구 때문에 실패한 기존 UI 테스트도 안내 내용과 안전한 개별 백업 절차를 검증하도록 갱신했다.
- 커버리지: statements **77.59%**, branches **69.23%**, functions **79.34%**, lines **77.68%**. 폴백 저장 statements는 **23.41% → 71.49%**, branches는 **18.33% → 63.12%**. 기존 coverage 제외 범위·임계값은 완화하지 않았다.
- production 의존성 감사: **0 vulnerabilities**. 새 의존성 설치·lockfile 변경 없음.
- 최신 production build로 `EXTENSION_E2E_HEADLESS=1; node scripts/extension-smoke.mjs`: **통과**. 기존 6종 출력·재시작 검증에 전체 library bundle 왕복 및 SW/History 독립 환경 폴백 저장·재조회 추가.
- `TZ=Asia/Seoul`, `TZ=UTC` 각각 timeline/CSV/backup **14 tests passed**. 로컬 OS는 Windows다.
- OS matrix는 CI 설정에 추가했다. 원격 macOS/Linux 실행 결과 및 실중계·장기 절전·OS 강제 종료의 성공을 여기서 주장하지 않는다.
- 실제 사용자 데이터는 사용하지 않았다. 감사 본문과 이 문서의 차이는 수정 전 발견과 수정 후 검증의 차이다.
