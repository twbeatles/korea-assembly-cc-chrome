# 국회 AI 자막 추출기

<p align="center">
  <img src="public/icons/icon128.png" alt="국회 AI 자막 추출기 아이콘" width="128" />
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/khchppfkjljacdhohihlpkbbkddmoghk">
    <img src="https://img.shields.io/badge/Chrome%20웹%20스토어-설치하기-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Chrome 웹 스토어에서 설치" />
  </a>
</p>

국회 의사중계 사이트의 **AI 자막을 실시간으로 모아** 저장·검색·내보내기하는 Chrome 확장 프로그램입니다.  
수집된 내용은 모두 **브라우저 안에만** 저장되며, 외부 서버로 전송하지 않습니다.

| | |
|---|---|
| **지원 사이트** | `assembly.webcast.go.kr`, `webcast.assembly.go.kr` |
| **내보내기** | TXT · SRT · VTT · JSON · MD · CSV |
| **저장 위치** | 로컬 (IndexedDB / 확장 저장소) |
| **현재 버전** | 1.0.13 |

**1.0.13 요약:** 발언자 표시·내보내기 옵션(기본 꺼짐, 패널 토글), MD/CSV 발언자 열 옵션 연동, multi-span 화자 분할, 환경설정 탭 UI 재구성·문구 정리. 자세한 항목은 [DEPLOYMENT.md §11](DEPLOYMENT.md#11-릴리스-노트).

---

## 이 저장소는?

Chrome 확장 **Manifest V3** 소스 코드입니다.

- UI: 페이지 안 우측 패널 + 팝업 + History / Options
- 수집: DOM 관찰(MutationObserver) + polling 폴백
- 저장: 확정 자막만 커밋, 긴 회의는 자동 분할(lineage)
- 스택: TypeScript · React · Vite · Vitest

일반 사용자는 [Chrome 웹 스토어](https://chromewebstore.google.com/detail/khchppfkjljacdhohihlpkbbkddmoghk) 설치를 권장합니다.  
개발·직접 빌드는 아래 [개발자용 설치](#개발자용-설치-로컬-빌드)를 참고하세요.

---

## 주요 기능

- **실시간 수집** — 플레이어 진입 시 자동 시작, AI 자막 레이어 자동 열기 시도
- **확정 자막만 저장** — 인식 중·로딩 문구 제외, 보정 시 제자리 갱신
- **우측 패널** — 실시간 미리보기 + 수집된 자막 목록, 복사·저장·내보내기
- **기록(History)** — 검색, 즐겨찾기, 메모, 부분 복사/내보내기, JSON 백업·복원
- **긴 회의 분할** — 문장 수·글자 수·시간 기준으로 같은 회의 단위 자동 분할
- **자동 저장·복구** — 수집 중 주기 저장, 페이지 이탈 시 저장, 재시작 시 복구

---

## 설치

### Chrome 웹 스토어 (권장)

1. [국회 AI 자막 추출기](https://chromewebstore.google.com/detail/khchppfkjljacdhohihlpkbbkddmoghk) 페이지에서 **Chrome에 추가**
2. 툴바에 아이콘을 핀 고정하면 사용하기 쉽습니다

### 개발자용 설치 (로컬 빌드)

**필요:** Node.js 20+, npm

```bash
npm install
npm run build
```

1. Chrome에서 `chrome://extensions` 열기  
2. **개발자 모드** 켜기  
3. **압축해제된 확장 프로그램을 로드합니다** → `dist/` 폴더 선택  
4. 이미 열려 있던 국회 탭은 **새로고침(F5)**

---

## 사용 방법

### 한눈에 보기

```text
의사중계 플레이어 접속
        ↓
오른쪽 「국회 자막 도우미」 패널 확인
        ↓
자막 자동 수집 (또는 패널에서 시작)
        ↓
수집된 자막 확인 · 중요 표시 · 복사
        ↓
저장 / TXT·SRT·VTT·JSON·MD·CSV 내보내기
        ↓
팝업 → 저장된 기록 에서 검색·백업·관리
```

### 1. 의사중계 사이트 접속

다음 중 하나의 **플레이어** 페이지로 이동합니다.

- https://assembly.webcast.go.kr  
- https://webcast.assembly.go.kr  

홈(`/main`)에서도 패널은 보이지만, **실제 수집은 플레이어**(`main/player*` 등)에서만 됩니다.

### 2. 우측 패널 확인

페이지 오른쪽에 패널이 자동으로 붙습니다.

| 영역 | 설명 |
|------|------|
| **실시간 내용** | 지금 인식 중인 미리보기 (아직 확정 전일 수 있음) |
| **수집된 자막** | 저장·내보내기 대상인 확정 자막 목록 |

패널이 안 보이면 확장 팝업에서 **페이지 패널 열기**를 누르세요.

### 3. 수집 시작·중지

- 플레이어 진입 시 **자동 시작**이 기본입니다 (옵션에서 끌 수 있음)
- AI 자막이 안 보이면 화면의 **AI 자막보기** 버튼을 한 번 눌러 주세요
- 팝업 또는 패널에서 **멈추기** → 수집 종료 후 저장 시도

### 4. 저장·내보내기

패널·팝업에서 바로 내보낼 수 있습니다.

| 형식 | 용도 |
|------|------|
| **TXT** | 텍스트 회의록 (타임스탬프·발언자 옵션) |
| **SRT / VTT** | 영상 자막 (세션 시작 기준 상대 시간, 발언자 옵션 시 cue 접두) |
| **JSON** | 기록 전체 백업·복원용 (발언자 메타 항상 보존) |
| **MD / CSV** | 문서·스프레드시트 (발언자 옵션 시 발언자 칸 채움) |

> **확정된 자막만** 저장됩니다. 화면에 잠깐 보이는 인식 중 문구는 들어가지 않습니다.  
> **CSV**는 UTF-8(BOM)로 저장되어 Excel에서도 한글이 깨지지 않도록 맞춰 두었습니다. 이미 깨진 파일은 다시 내보내기 하세요.  
> **발언자 옵션**을 켜면 TXT·SRT·VTT·복사 본문에 `[발언자 A]` 형태 접두가 붙고, MD/CSV 발언자 칸이 채워집니다.

### 5. 기록 관리 (History)

팝업 **저장된 기록**에서:

- 전체·기록 내부 검색, 최근 N줄 복사  
- 즐겨찾기 · 메모 · 태그  
- 항목 선택 복사 / TXT·SRT 등 부분 내보내기  
- 전체 JSON 백업·가져오기 (25 MiB 이하)  
- 선택 삭제 · 전체 삭제  

### 6. 팝업 메뉴

| 메뉴 | 하는 일 |
|------|---------|
| 페이지 패널 열기 | 접힌 우측 패널 다시 열기 |
| 지금 저장 | 현재까지 확정 자막 저장 |
| 멈추기 | 수집 종료 + 저장 |
| 저장된 기록 | History 화면 |
| 환경 설정 | 옵션 (자동 저장, 분할, 파일 이름 등) |
| 수집 진단 | 수집 방식·저장 복구 상태 확인 |

### 7. 자주 쓰는 설정

팝업 → **환경 설정**

| 설정 | 설명 |
|------|------|
| 자동 시작 / 자동 저장 / 자동 스크롤 | 수집·패널 동작 (자동 시작 시 플레이어 진입 후 다시 시작할 수 있음) |
| 최근 N줄 복사 | 한 번에 복사할 줄 수 |
| 파일 이름 규칙 | `{date}` `{time}` `{committee}` |
| 내보내기·복사에 발언자 포함 | 기본 꺼짐. TXT·SRT·VTT·복사 접두, MD/CSV 칸 (패널에서도 토글) |
| 수집 패널에 발언자 색 표시 | 기본 꺼짐. 패널·History 색 띠·A/B 뱃지 (패널에서도 토글) |
| 노이즈 필터 | 숫자·기호만 있는 짧은 줄 제외 |
| 세그먼트 preset · 임계값 | 긴 회의 자동 분할 기준 |

---

## 권한 (요약)

| 권한 | 이유 |
|------|------|
| storage | 설정·기록·메모 로컬 저장 |
| downloads | 파일 내보내기 |
| offscreen | 큰 파일 Blob 처리 |
| activeTab / scripting | 탭 연결·재주입 |
| sidePanel | 실험용 측면 패널 |
| 호스트 | 위 두 의사중계 도메인만 |

---

## 알아 두면 좋은 점

- 국회 사이트 HTML 구조가 바뀌면 자막 인식이 달라질 수 있습니다  
- 확장 설치 **전**에 열어 둔 탭은 새로고침이 필요할 수 있습니다  
- 전체 JSON 백업·복원은 **25 MiB 이하**  
- 매우 큰 단일 내보내기는 Blob 우선, data URL 폴백은 약 2 MiB까지  
- 자동 시작 시 자막 레이어를 켜려고 할 수 있습니다 (옵션에서 끌 수 있음)  
- 노이즈 필터는 한글·영문 중심입니다. 외국어 원문을 남기려면 필터를 끄세요  
- **같은 회의를 여러 탭에서 동시에 모으면** 기록이 둘로 나뉠 수 있습니다. 패널에 안내가 뜨면 한 탭만 쓰는 것이 좋습니다  
- 수집·브리지는 **의사중계 페이지를 신뢰**하는 전제입니다. 해당 페이지에 임의 스크립트가 주입된 환경은 지원 범위 밖입니다  


---

## 개발

```bash
npm install
npm run dev          # 개발 서버 (+ injected 빌드)
npm run build        # dist/ 생성
npm run verify       # version · injected · lint · typecheck · test · build
```

| 명령 | 설명 |
|------|------|
| `npm run typecheck` | TypeScript 7 typecheck |
| `npm run test` | Vitest 단위 테스트 |
| `npm run verify:e2e` | 빌드 후 확장 smoke |

자세한 배포 절차·툴체인·안정성 문서는 아래를 참고하세요.

- [배포 가이드](DEPLOYMENT.md)  
- [TypeScript 7 전환 검토](TYPESCRIPT_7_MIGRATION_REVIEW.md)  
- [장시간 세션 보존·안정성](CAPTURE_RETENTION_AND_STABILITY.md)  
- [개인정보처리방침 초안](PRIVACY_POLICY_DRAFT_KO.md)  
- AI/기여자용 컨텍스트: `CLAUDE.md`  

---

## 라이선스·기여

이슈와 PR은 저장소에서 환영합니다.  
기능 변경 시 `npm run verify` 통과를 권장합니다.
