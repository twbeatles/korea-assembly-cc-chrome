# TypeScript 7 전환 검토 (korea-assembly-cc-chrome)

| 항목 | 내용 |
|------|------|
| 작성일 | 2026-07-13 |
| 대상 저장소 | `korea-assembly-cc-chrome` (Chrome Extension MV3) |
| 현재 TypeScript | **typecheck: 7.0.2** (`typescript-7`) + **API/lint: 6.0.3** (`typescript`) — Phase 1–3 완료, Phase 4 부분 완료 (2026-07-13) |
| 검토 대상 | TypeScript **6.0(교량 릴리스)** → **7.0(Go 네이티브 컴파일러)** |
| 문서 성격 | ROI·장기 필요성·성능·리스크·권장 로드맵 + Phase 1–4 실행 기록 |

---

## 1. 요약 (Executive Summary)

**한 줄 결론:**  
이 프로젝트에서 TypeScript 7로의 전환은 **장기적으로는 거의 필수**이지만, **지금 당장 “성능 ROI”만으로 급히 올릴 필요는 낮다.** 체감 이득은 주로 **개발자 경험(typecheck·에디터 반응성)** 쪽이며, **확장 프로그램 런타임 성능·번들 크기에는 영향이 없다.**

| 관점 | 평가 | 근거 |
|------|------|------|
| 런타임 성능 (사용자 체감) | **변화 없음** | Vite/esbuild가 emit·번들; `tsc`는 `noEmit` typecheck 전용 |
| CI/로컬 typecheck 속도 | **측정됨 ~4.5x** | 본기 벤치: TS6 ~7.9s → TS7 ~1.7s (3회 평균, Windows/Node 24) |
| 에디터(LSP) 반응성 | **개선 여지 있음** | 네이티브 language service + 병렬 처리. 소형 프로젝트에서는 체감이 제한적일 수 있음 |
| 언어/타입 기능 이득 | **간접적** | 7.0 타입 의미론은 6.0과 구조적으로 동일. 실질 변경은 6.0 기본값·폐기 옵션 정리 |
| 생태계/유지보수 | **장기적으로 중요** | 6.0이 JS 기반 마지막 메이저. 7.x가 이후 주류. 5.8 고정은 점진적 기술 부채 |
| 전환 비용 (현재 시점) | **중간** | 설정 자체는 이미 현대적. 병목은 `typescript-eslint` 등 **programmatic API 의존 도구**와 5→6 교량 작업 |
| 권장 시점 | **단계적 (권장)** | ① 6.0 정렬 → ② typecheck만 7 병행 시험 → ③ 생태계(ESLint API) 안정 후 단일화 |

**권장 의사결정 (실행 후 갱신):**  
- **현재 상태:** dual-track 정착 — `npm run typecheck` = TS7, ESLint API = TS6.  
- **즉시 할 일:** 없음 (verify 게이트에 TS7 typecheck 포함됨).  
- **남은 단일화:** `typescript-eslint` peer가 TS7을 허용하고 7.1+ 안정 API가 나온 뒤 `typescript` 패키지를 7로 합친다.

---

## 2. TypeScript 7이 무엇인가

### 2.1 배경

- TypeScript **6.0**: JavaScript로 구현된 컴파일러/언어 서비스의 **마지막 메이저**. 7.0 정렬을 위한 기본값·폐기(deprecation) 정리가 핵심.
- TypeScript **7.0**: 기존 구현을 **Go로 포팅**한 네이티브 컴파일러·도구 체인(Project Corsa / typescript-go 계열).  
  - 목표: 네이티브 속도 + 공유 메모리 병렬화로 **typecheck/빌드·에디터 시작**을 크게 단축.  
  - Microsoft 측 메시징: TypeScript 6.0 대비 **종종 약 10배 빠른** 수준.  
  - 타입 검사 로직은 6.0과 **구조적으로 동일**하도록 포팅(의미론 호환 우선).
- 2026-06 전후 **7.0 RC**, 2026-07 전후 **7.0 정식** 발표 흐름. 본 문서는 공개 릴리스 노트·업그레이드 가이드를 기준으로 한다.

### 2.2 “10x”가 의미하는 것 / 의미하지 않는 것

| 의미하는 것 | 의미하지 않는 것 |
|-------------|------------------|
| `tsc` typecheck 시간 | Chrome 확장 **실행 속도** |
| 에디터 프로젝트 로드·일부 LSP 응답 | Vite **프로덕션 번들 시간**(esbuild 경로) |
| watch/incremental 반응성 | 자막 수집 DOM/observer **런타임 로직** |
| 메모리 사용량 감소(대형 프로젝트에서 체감) | 스토어 제출 패키지 크기 자동 감소 |

공식 벤치마크 예시(대규모 오픈소스 기준, 시기별 수치는 소폭 차이 있음):

| 코드베이스 (대략) | 기존(JS TS) | Native(TS 7) | 배속 |
|-------------------|-------------|--------------|------|
| VS Code (~1.5M LOC) | ~78–89s | ~7.5–8.7s | ~10x |
| Playwright (~356K LOC) | ~11s | ~1.1s | ~10x |
| TypeORM (~270K LOC) | ~17.5s | ~1.3s | ~13x |

→ **스케일이 클수록 절대 시간 절감이 크다.** 본 저장소는 이 표의 1/10~1/50 규모다.

### 2.3 7.0에서 특히 알아둘 엔지니어링 포인트

1. **CLI `tsc`는 네이티브 바이너리** — 설치/사용 방식은 기존 `npm install -D typescript`와 유사하게 유지되는 방향.
2. **병렬화 플래그**
   - `--checkers N` (기본 4): 타입체커 워커 수. 늘리면 속도↑·메모리↑ 가능.
   - `--builders N`: project references 병렬 빌드.
   - `--singleThreaded`: 디버깅·6 vs 7 비교·저사양 CI용.
3. **Programmatic API**
   - 7.0 시점: **안정적인 기존 TS API 호환 레이어가 아직 완전하지 않음**.  
   - Microsoft: **7.1 이후**에 새로운/안정 API를 기대.  
   - 전환기: `@typescript/typescript6` + npm alias로 **6.x API를 side-by-side** 유지 권장.
4. **의미론**
   - 6.0을 `stableTypeOrdering` 등으로 맞춘 코드는 7.0과 동일하게 컴파일되도록 설계.
   - 템플릿 리터럴 타입의 유니코드 코드 포인트 처리 등 **소수 의도적 차이** 존재.
5. **JS 지원 재작업**
   - JSDoc/Closure 스타일 일부 제거·엄격화. 본 프로젝트는 `allowJs: false`라 **직접 영향 거의 없음**.

---

## 3. 현재 프로젝트 현황 (As-Is)

### 3.1 스택과 TypeScript 역할

| 영역 | 도구 | TS 역할 |
|------|------|---------|
| 번들/빌드 | Vite 6 + `@crxjs/vite-plugin` + esbuild | 트랜스파일·번들 (typecheck 아님) |
| 타입 검사 | `tsc -p … --noEmit` (이중 프로젝트) | 정적 검증만 |
| 테스트 | Vitest 3 | 타입은 TS/Vite 경로 의존 |
| 린트 | ESLint 9 + `typescript-eslint` ^8.26 | **TS compiler API 의존** |
| UI | React 18 | JSX (`react-jsx`) |

`package.json` 스크립트:

```text
typecheck = tsc -p tsconfig.json --noEmit && tsc -p tsconfig.node.json --noEmit
verify    = check:version → check:injected → lint → typecheck → test → build
```

### 3.2 규모 (2026-07-13 워크스페이스 스냅샷)

| 지표 | 값 |
|------|-----|
| `.ts` / `.tsx` 파일 | 약 146 / 13 (합 ~159) |
| 대략 라인 수 (`src` + `tests`) | ~28,000 lines |
| 앱 성격 | 단일 패키지 Chrome Extension (모노레포·project references 아님) |

→ VS Code/Playwright급 “10x가 수 분→수십 초” 시나리오가 **아님**.  
현실적으로 typecheck가 이미 **수 초 이내~십 수 초**라면, 7.0 이후에도 절대 이득은 **수 초 단축** 수준일 가능성이 높다. (정확한 수치는 로컬 벤치 필요 — 아래 §8.)

### 3.3 tsconfig 준비도 (6/7 관점)

**`tsconfig.json` (앱/테스트):**

| 옵션 | 현재 값 | 6.0/7.0 관점 |
|------|---------|----------------|
| `strict` | `true` | 이미 신규 기본과 일치 ✅ |
| `target` | `ES2022` | `es5` 폐기와 무관 ✅ |
| `module` | `ESNext` | 신규 기본 방향과 일치 ✅ |
| `moduleResolution` | `Bundler` | `node`/`classic` 폐기와 무관 ✅ |
| `esModuleInterop` / `allowSyntheticDefaultImports` | `true` | 강제 true 방향과 일치 ✅ |
| `noEmit` | `true` | emit/`rootDir` 이슈 회피 ✅ |
| `types` | `["chrome", "vitest/globals"]` | 이미 명시적 ✅ (6.0 기본 `[]` 대비 유리) |
| `baseUrl` | 없음 | 폐기 옵션 미사용 ✅ |
| `allowJs` | `false` | JS 지원 변경 회피 ✅ |
| `skipLibCheck` | `true` | 유지 가능 (성능·호환 완충) |

**`tsconfig.node.json` (Vite/Vitest/scripts):**

| 옵션 | 현재 값 | 비고 |
|------|---------|------|
| `types` | `["node"]` | 명시적 ✅ |
| `strict` | **미설정** | 6.0부터 기본 `true`면 스크립트/설정 파일에서 새 오류 가능 ⚠️ |
| `include` | `vite.config.ts`, `vitest.config.ts`, `eslint.config.js`, `scripts/**/*.mjs` | `.mjs`/JS 혼재 — 7.0 JS 규칙 변화 시 간접 영향 가능 |

**종합:** 앱 본문 tsconfig는 **이미 6/7 “모던 기본값”에 가깝다.**  
전환 시 설정 충돌보다 **의존성 peer 범위·eslint API·node tsconfig strict** 쪽이 실질 리스크다.

### 3.4 의존성 제약 (중요)

- `typescript-eslint` 계열 peer: lock 기준 **`typescript` >=4.8.4 `<6.0.0`** 구간이 보임.  
  → **5.8 → 6.0/7.0 직행 시 lint 패키지 업그레이드 또는 dual-install(alias) 전략이 필요.**
- 프로젝트 코드가 `import … from "typescript"`로 컴파일러 API를 직접 쓰는 패턴은 **사실상 없음** (eslint 경유만 해당).
- 빌드는 Vite; **TS 버전 변경이 프로덕션 아티팩트를 자동으로 바꾸지는 않음** (타입이 통과하는 한).

---

## 4. 성능·품질 개선 가능성

### 4.1 사용자(확장 실행) 관점

| 항목 | TS 7 영향 |
|------|-----------|
| 자막 수집 latency | 없음 |
| 패널 렌더/스크롤 | 없음 |
| IndexedDB/storage | 없음 |
| 패키지 용량 | 거의 없음 (타입 이레이저 후 JS는 동일 계열 툴체인 산출) |

**결론:** 스토어 사용자 KPI 개선을 이유로 TS 7를 올리는 것은 **정당화하기 어렵다.**

### 4.2 개발자·CI 관점

| 항목 | 기대 효과 | 본 저장소 현실성 |
|------|-----------|------------------|
| `npm run typecheck` | 배수 개선 가능 | 절대 시간이 작으면 ROI 체감 제한 |
| `npm run verify` 전체 | typecheck 비중만큼만 단축 | lint/test/build가 더 길 수 있음 |
| `vite build` | 직접 이득 없음 | esbuild 경로 유지 |
| IDE 자동완성/오류 표시 | 대형 프로젝트에서 뚜렷 | ~2.8만 LOC에서는 체감 개인차 |
| `--watch` typecheck | Parcel 기반 watcher 개선 언급 | 일상 워크플로가 Vite HMR 중심이면 부가 |
| 메모리 | 대형 코드베이스에서 절감 | 로컬 개발 머신에서 병목일 가능성 낮음 |

### 4.3 “성능 개선”을 과장하지 않는 추정

가정(가설, 벤치 전):

| 가정 | 값 |
|------|-----|
| 현재 full typecheck (두 tsconfig) | 예: 4–12초 |
| TS 7 후 (이상적 5–10x) | 예: 0.5–3초 |
| 하루 typecheck 실행 횟수 | 예: 20–50회 |
| 일일 절감 | 대략 **1–8분** 수준 (낙관~중립) |

반면 마이그레이션 1회 비용:

| 항목 | 추정 공수 |
|------|-----------|
| 6.0 업그레이드 + 설정/오류 정리 | 0.5–2일 |
| 7.0 typecheck 병행·벤치·회귀 | 0.5–1.5일 |
| eslint dual / peer 정리 | 0.5–2일 (도구 성숙도에 좌우) |
| 문서·CI·팀 습관 정리 | 0.5일 |
| **합계** | **대략 2–6 인일** (큰 사고 없을 때) |

→ **순수 시간 ROI만 보면 수 주~수 개월 사용 후에야 회수**되는 규모.  
ROI의 본체는 “초 단위 절약”보다 **생태계 정합·보안/지원 수명·장기 유지보수**에 가깝다.

### 4.4 언어·타입 품질 측면의 이득

- 7.0 자체가 새로운 타입 시스템 “기능 폭격” 릴리스는 아님.  
- 실질 품질 변화는 주로 **6.0 정렬**에서 발생:
  - 더 엄격한 기본값
  - 폐기 옵션 제거로 설정 단순화
  - (해당 시) 추론/`this` 없는 함수 컨텍스트 민감도 개선 등 6.0 개선점
- 본 프로젝트는 이미 `strict: true`라 **엄격성 점프 폭은 작다.**
- 템플릿 리터럴·문자열 유틸 타입이 UTF-16 코드 유닛에 의존하면 깨질 수 있음 → 코드베이스 내 해당 패턴 사용 여부 점검 권장(사용 빈도는 낮을 가능성).

---

## 5. ROI 프레임

### 5.1 이득 (Benefit)

| ID | 이득 | 크기(본 프로젝트) | 시점 |
|----|------|-------------------|------|
| B1 | typecheck 벽시계 시간 단축 | 낮음~중간 | 7.0 CLI 도입 즉시 |
| B2 | 에디터 반응성·LSP 안정성 | 낮음~중간 | 네이티브 preview/7 LSP 사용 시 |
| B3 | 메인라인 컴파일러 추적 (보안·버그픽스) | **중간~높음 (장기)** | 6→7 정착 후 지속 |
| B4 | 미래 도구(에디터/CI/AI 보조)와의 정합 | 중간 | 생태계 이동에 따라 |
| B5 | 설정 현대화(6.0 기본값)로 onboarding 단순화 | 낮음 | 이미 상당 부분 달성됨 |
| B6 | 병렬 typecheck 옵션으로 CI 튜닝 여지 | 낮음 | 단일 패키지·소규모라 우선순위 낮음 |

### 5.2 비용 (Cost)

| ID | 비용 | 크기 | 비고 |
|----|------|------|------|
| C1 | 5.8 → 6.0 호환 작업 | 중간 | 기본값·폐기 정리. 본 repo는 상대적 유리 |
| C2 | 6.0 → 7.0 의미론/ordering 미세 차이 | 낮음~중간 | `stableTypeOrdering`으로 사전 진단 가능 |
| C3 | `typescript-eslint` / API 의존 도구 | **중간~높음** | 7.1 API 전 dual package 권장 |
| C4 | lockfile/peer/CI 매트릭스 복잡도 | 중간 | 병행 기간 동안 |
| C5 | 회귀 검증 (`verify` 풀 스위트) | 중간 | 필수 |
| C6 | 학습·문서·팀 혼선 | 낮음 | 1인 또는 소수 유지 시 작음 |

### 5.3 리스크

| 리스크 | 영향 | 완화 |
|--------|------|------|
| ESLint type-aware 규칙이 7 단독 설치에서 깨짐 | lint CI 적색 | `@typescript/typescript6` alias / peer 분리 |
| `tsconfig.node` strict 기본 변경으로 설정 파일 오류 | typecheck 실패 | 명시 `strict` 또는 오류 수정 |
| Vitest/Vite 플러그인이 특정 TS 버전 가정 | 빌드/테스트 이슈 | 공식 peer 확인 후 병행 시험 |
| “10x” 기대와 실제 체감 괴리 | 의사결정 후회 | 사전 벤치(§8)로 기대치 고정 |
| RC/초기 7.0 회귀 | 잘못된 타입 통과/실패 | 6.0 기준선 유지 + diff |

### 5.4 ROI 판정 (본 저장소 특화)

```text
즉시 성능 ROI          :  ★★☆☆☆  (낮음~보통)
장기 유지보수 ROI      :  ★★★★☆  (높음)
지금 당장 필수 여부    :  아니오
12개월 내 권장 여부    :  예 (단계적)
기능 로드맵 대비 우선순위:  자막 수집·저장·export 안정성 이슈보다 낮음
```

**해석:**  
“전환이 필요 없다”가 아니라 **“지금 전면 전환을 최우선으로 둘 이유는 약하다”.**  
다만 **5.8에 영구 고정**은 12–24개월 관점에서 비권장이다. JS 기반 라인(6.x) 지원 종료·생태계 이전 후 보안·도구 지원이 줄어든다.

---

## 6. 장기적으로 전환이 필요한가?

### 6.1 필요성 스펙트럼

| 질문 | 답 |
|------|----|
| 확장이 오늘 당장 동작하려면 7이 필요한가? | **아니오** |
| 5.8을 2년 더 고정해도 되는가? | **비권장** (도구 peer·보안 패치·채용/온보딩 비용) |
| 7.x 메인라인 진입이 언젠가 필요한가? | **예** — 업계 기본 궤적 |
| 그 경로에 6.0이 필수 교량인가? | **사실상 예** — 폐기 옵션·기본값 정렬 |

### 6.2 전략 옵션 비교

| 옵션 | 설명 | 장점 | 단점 | 추천 |
|------|------|------|------|------|
| A. Stay on 5.8 | 현 상태 유지 | 리스크 0, 기능 집중 | 기술 부채 누적 | 단기만 |
| B. 6.0 only | JS 마지막 메이저로 정렬 | 7 준비 완료, 생태계 친화 | 성능 이득 제한 | **단기 권장 1순위** |
| C. Dual: typecheck 7 + lint 6 | 공식 권장 병행 패턴 | 성능 실험·점진 전환 | package alias 복잡도 | **중기 권장** |
| D. Full 7 single | 모든 도구 7 단일화 | 단순 최종 상태 | API/ eslint 성숙 대기 | **7.1+ 이후** |
| E. Skip 6, jump 5→7 | 한 번에 점프 | 단계 수 감소 | 문제 원인 분리 어려움 | 비권장 |

### 6.3 본 프로젝트에 대한 권장 포지션

1. **필수 여부는 “장기 Yes / 즉시 No”.**  
2. **성능만이 아니라 “메인라인 추적”이 전환 명분.**  
3. 설정 부채가 적어 **기술적으로 전환 난이도는 중간 이하**이나, **도구 체인 병행이 핵심 작업.**  
4. 제품 로드맵(수집 안정성, export, history, diagnostics)과 충돌하지 않게 **스파이크 → 교량 → 본 전환** 순서를 권장.

---

## 7. 마이그레이션 로드맵 (권장)

### Phase 0 — 기준선 측정 (0.5일)

- `npm run typecheck` 3회 평균 시간 (cold / warm)
- `npm run verify` 전체 시간 분해 (lint / typecheck / test / build)
- Node·OS·CPU 코어 수 기록
- 결과 표를 이 문서 §8에 채움

### Phase 1 — TypeScript 6.0 교량 (0.5–2일) — ✅ 완료 (2026-07-13)

목표: 7.0이 하드 에러로 막는 폐기 옵션·기본값을 **6.0에서 선제 정리**.

체크리스트:

- [x] `typescript`를 6.x로 올리고 `npm run typecheck` 통과 → **6.0.3**
- [x] `ignoreDeprecations` 없이 경고/에러 0 지향
- [x] `tsconfig.node.json`에 `strict` / `noEmit` / `esModuleInterop` / `noUncheckedSideEffectImports` 명시
- [x] `types` 배열 유지 (`chrome`, `vitest/globals`, `node`)
- [x] `typescript-eslint` → **^8.63.0** (peer `typescript >=4.8.4 <6.1.0`)
- [x] `npm run verify` 전체 통과 (315 tests, build OK)
- [x] (선택) `stableTypeOrdering` typecheck 통과 — 오류 0

**Phase 1에서 실제로 고친 것:**

| 변경 | 이유 |
|------|------|
| `typescript` `^5.8.2` → `^6.0.3` | 교량 메이저 채택 |
| `typescript-eslint` `^8.26.0` → `^8.63.0` | TS 6 peer 지원 |
| `src/css-modules.d.ts` 추가 | TS 6 기본 `noUncheckedSideEffectImports: true` — `import "./…css"` 4건 |
| `tsconfig.json`에 `noUncheckedSideEffectImports: true` 명시 | 기본값 의존 제거 |
| `tsconfig.node.json`에 `strict` 등 정렬 | 6.0 기본값 대비 설정 파일 검사 강화 |

본 repo에서 이미 유리했던 항목: `strict`, `Bundler`, `ESNext`, 명시적 `types`, `noEmit`, non-es5 target.

### Phase 2 — TypeScript 7 typecheck 병행 (0.5–1.5일) — ✅ 완료 (2026-07-13)

실제 채택 패턴 (`@typescript/typescript6` 별칭 대신 **명시 dual 패키지**):

```json
{
  "devDependencies": {
    "typescript": "^6.0.3",
    "typescript-7": "npm:typescript@^7.0.2"
  },
  "scripts": {
    "typecheck": "node scripts/run-tsc.mjs 7",
    "typecheck:ts6": "node scripts/run-tsc.mjs 6",
    "typecheck:ts7": "node scripts/run-tsc.mjs 7"
  }
}
```

- [x] `typescript-7`의 `tsc`로 두 tsconfig `--noEmit` 실행 (`scripts/run-tsc.mjs`)
- [x] TS6 vs TS7 오류 집합 동일 (둘 다 통과, 소스 추가 수정 없음)
- [x] typecheck 벤치 재측정 (§8) — **~4.5x**
- [x] 기본 `typecheck` / `verify` 를 TS7로 승격 (blocking)
- [x] lint는 `typescript@6.0.3` API 경로 유지

**왜 npm alias `@typescript/typescript6`를 쓰지 않았나:**  
해당 패키지가 `@typescript/old`(typescript@6)를 끌어오며 `.bin/tsc` 충돌을 일으킴.  
`typescript@6` + `typescript-7@npm:typescript@7` + 경로 고정 헬퍼가 더 안정적.

**부가 수정:** clean lockfile 재생성 시 `@crxjs` rollup 2 override가 Vite의 rollup까지 2.x로 dedupe 되어  
`rollup/parseAst` 오류 발생 → `overrides`에 `vite`/`vitest` → `rollup@^4.34` 명시로 복구.

### Phase 3 — 에디터/로컬 DX (선택, 저비용) — ✅ 문서화 완료 (2026-07-13)

- [x] VS Code **TypeScript Native Preview** 사용 안내
- [x] CLI typecheck = TS7, 비교 = `typecheck:ts6`, lint API = TS6 임을 문서화

| 경로 | 버전 | 명령/도구 |
|------|------|-----------|
| CI/로컬 typecheck (정본) | **7.0.2** | `npm run typecheck` (= `typecheck:ts7`) |
| 비교/회귀 typecheck | 6.0.3 | `npm run typecheck:ts6` |
| ESLint (`typescript-eslint`) | 6.0.3 API | `npm run lint` — `require("typescript")` |
| 에디터 (선택) | 네이티브 7 | [TypeScript Native Preview](https://marketplace.visualstudio.com/items?itemName=TypeScriptTeam.native-preview) |

주의: 에디터에 Native Preview를 켜면 CLI와 대체로 맞지만, lint 규칙이 보는 타입 API는 여전히 TS6이다.  
불일치 의심 시 `typecheck:ts6`와 `typecheck`를 둘 다 돌려 분리한다.

### Phase 4 — 단일화 (7.1+ · eslint 정식 지원 후) — ⚠️ 부분 완료 / 완전 단일화 보류

| 항목 | 상태 |
|------|------|
| typecheck 메인라인을 TS7로 | ✅ 완료 |
| lint / `typescript` 패키지 TS6 유지 | ✅ 의도적 dual |
| `typescript` 단일 7.x | ⏸️ 보류 — `typescript-eslint@8.63.0` peer `<6.1.0`, 7.1 안정 API 대기 |
| 최종 `verify` | ✅ 통과 (315 tests + build) |

**재검토 트리거**

- `typescript-eslint` peer가 TypeScript 7을 공식 허용
- TypeScript 7.1+ 안정 programmatic API 발표
- 그 시점에 `typescript-7` 별칭 제거 → `typescript@^7`, scripts 단순화

### 의도적으로 하지 말 것

- Selenium/legacy PyQt 경로를 다시 끌어오지 않기 (기존 프로젝트 규칙).
- “TS 7 때문에” Vite emit을 `tsc` emit으로 되돌리지 않기 — 현 구조(`noEmit` + Vite) 유지가 맞음.
- typecheck 속도만 보고 테스트·lint를 제거하지 않기.
- eslint peer를 무시하고 `typescript@7` 단독 설치하지 않기 (현재).

---

## 8. 벤치마크 템플릿 (실행 후 채울 표)

로컬에서 `node_modules` 설치 후 아래를 채우면 ROI 논의가 수치화된다.

```powershell
# 예시 (PowerShell) — 환경에 맞게 조정
Measure-Command { npm run typecheck } | Select-Object TotalSeconds
Measure-Command { npm run lint } | Select-Object TotalSeconds
Measure-Command { npm run test } | Select-Object TotalSeconds
Measure-Command { npm run build } | Select-Object TotalSeconds
```

| 단계 | typecheck (s) | lint (s) | test (s) | build (s) | verify 합 (s) | 메모 |
|------|---------------|----------|----------|-----------|---------------|------|
| Baseline TS 5.8 | (미측정) | | | | | clean install 전 생략 |
| After TS 6.0 (`typecheck:ts6`) | **~7.9** (3회: 8.4 / 7.1 / 8.2) | (verify 내 포함) | ~32 (suite) | ~2 (vite) | ~52 (inject+verify) | Windows, Node 24, 2026-07-13 |
| After TS 7 (`typecheck` 기본) | **~1.7** (3회: 2.1 / 1.6 / 1.5) | 동일 | 동일 | 동일 | 동일 | **~4.5x vs TS6** |
| TS 7 `--singleThreaded` | **~1.4** (1회) | | | | | 이 규모에선 병렬 이득 작음 |

**해석 가이드:**

- typecheck가 verify의 **20% 미만**이면 7 도입의 CI 전체 단축은 제한적.
- typecheck가 **40% 이상**이면 7 도입 우선순위 상승.
- `--singleThreaded`와 기본 병렬 차이를 보면 이 머신에서 병렬화가 얼마나 먹히는지 알 수 있음.

---

## 9. 이 저장소 특화 체크포인트

### 9.1 설정·구조

- [x] 앱 코드 `strict` 이미 활성
- [x] `moduleResolution: "Bundler"` (Vite 정렬)
- [x] `types` 명시 (`chrome`, `vitest/globals`)
- [ ] `tsconfig.node.json` strict/기본값 명시 여부 재검토
- [ ] `include`된 `eslint.config.js` / `scripts/**/*.mjs`가 7.0 JS 분석 변경에 민감한지 확인

### 9.2 도구 체인

- [ ] `typescript-eslint` 버전과 TS 6/7 peer 매트릭스
- [ ] Vitest 3 + Vite 6의 권장 TypeScript 범위
- [ ] `@types/chrome` / `@types/node` / React types 호환
- [ ] CI(있다면) Node 버전과 네이티브 바이너리 플랫폼 매트릭스 (win/mac/linux)

### 9.3 제품 회귀 (전환 PR에 필수)

TS 버전만 바꿔도 “타입이 통과한다 ≠ 확장이 같다”이므로 기존 게이트 유지:

```text
npm run check:version
npm run check:injected
npm run lint
npm run typecheck
npm run test
npm run build
# 가능 시
npm run verify:e2e
# 또는
npm run test:e2e:extension
```

의미론 고정 영역(회귀 시 특히 민감):

- subtitle pipeline commit/preview 분리
- fallback materialize(2회 또는 400ms)
- session store IndexedDB/fallback merge
- export 시간 형식·filename sanitize
- frame-forward nonce

### 9.4 코드 패턴 스캔 (전환 전 가벼운 grep)

| 패턴 | 이유 |
|------|------|
| `module Foo {` (namespace 구식 문법) | 6/7에서 하드 에러 |
| `import … assert {` | `with`로 이전 |
| `baseUrl` in tsconfig | 폐기 |
| 템플릿 리터럴 타입으로 문자열 길이/UTF-16 조작 | 7.0 유니코드 처리 변경 |
| `// @ts-nocheck` 남용 | 6 strict 기본·정리 시 은폐 |

---

## 10. 의사결정 권고 (Decision Record 초안)

### 권고안

| 항목 | 내용 |
|------|------|
| 결정 | **typecheck 메인라인은 TS7, lint API는 TS6 dual-track으로 정착.** 완전 단일화는 eslint/7.1 API 이후. |
| 이유 | (1) 본기 벤치 ~4.5x typecheck 단축 (2) 의미론 회귀 0 (3) eslint peer <6.1.0 (4) Vite emit 경로 불변 (5) verify 전체 통과 |
| 재검토 트리거 | typescript-eslint가 TS7 공식 지원 / TS 7.1+ 안정 API / dual 패키지 유지 비용이 커질 때 |
| 비범위 | 번들러를 tsc emit으로 교체, legacy 데스크톱 스택 부활, 타입 시스템을 이유로 한 대규모 리팩터 |

### 한 줄 ADR

> **Ship TypeScript 7 as the default typechecker via typescript-7 + scripts/run-tsc.mjs; keep typescript@6 for ESLint until the ecosystem peer/API catches up; leave Vite emit unchanged.**

---

## 11. 참고 자료

- [Announcing TypeScript 6.0](https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/) — 교량 릴리스, 기본값·폐기 목록
- [Announcing TypeScript 7.0 RC](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0-rc/) — 네이티브 포팅, 병렬화, side-by-side, API 일정
- [TypeScript Native Port 발표](https://devblogs.microsoft.com/typescript/typescript-native-port/) — 성능 목표·초기 벤치
- [Progress on TypeScript 7 (Dec 2025)](https://devblogs.microsoft.com/typescript/progress-on-typescript-7-december-2025/) — 일정·parity
- [microsoft/typescript-go](https://github.com/microsoft/typescript-go) — 이슈 트래커·CHANGES
- 프로젝트 내부: `package.json`, `tsconfig.json`, `tsconfig.node.json`, `CLAUDE.md` 검증 게이트

---

## 12. 변경 이력

| 날짜 | 작성/수정 | 내용 |
|------|-----------|------|
| 2026-07-13 | 초안 | TS 5.8 기준 as-is, TS 6/7 공개 정보 기반 ROI·로드맵 정리 |
| 2026-07-13 | Phase 1 | TS 6.0.3 + eslint 8.63.0 적용, CSS 선언·tsconfig 정렬, verify 통과 |
| 2026-07-13 | Phase 2–4 | typescript-7 dual, run-tsc.mjs, typecheck 기본=7 (~4.5x), 에디터 안내, 완전 단일화 보류, rollup override 복구 |
| 2026-07-13 | 호환성 §13 | 기존 5.8 대비 런타임/데이터/빌드/개발 호환 매트릭스 추가; README·CLAUDE·GEMINI·DEPLOYMENT 반영 |

---

## 부록 A. 현재 핵심 설정 발췌

### `package.json` (관련 발췌, Phase 2 후)

- `typescript`: `^6.0.3` — ESLint / programmatic API
- `typescript-7`: `npm:typescript@^7.0.2` — 네이티브 typecheck
- `typescript-eslint`: `^8.63.0`
- `typecheck`: `node scripts/run-tsc.mjs 7`
- `typecheck:ts6` / `typecheck:ts7`: 명시 비교용
- overrides: `vite`/`vitest` → rollup `^4.34`, `@crxjs/vite-plugin` → rollup `2.80.0`
- 빌드: `vite build` (+ injected 스크립트 빌드)

### `tsconfig.json` (관련 발췌)

- `target`/`lib`: ES2022 + DOM  
- `strict`: true  
- `module`/`moduleResolution`: ESNext / Bundler  
- `noEmit`: true  
- `noUncheckedSideEffectImports`: true  
- `types`: chrome, vitest/globals  
- CSS ambient: `src/css-modules.d.ts`

### 해석 한 줄

> **typecheck는 TS7 메인라인으로 올렸고, 남은 단일화 병목은 ESLint programmatic API(및 peer)뿐이다.**

---

## 13. 기존 버전 대비 호환성 분석 (2026-07-13)

비교 기준: **이전 메인라인 TypeScript 5.8 + bare `tsc --noEmit`** vs **현재 dual-track (typecheck TS7 / lint API TS6)**.

### 13.1 한 줄 결론

| 대상 | 호환성 | 설명 |
|------|--------|------|
| **이미 설치된 확장 (스토어/로컬)** | **영향 없음** | 툴체인만 변경. 배포 아티팩트를 다시 올리지 않으면 사용자 환경은 그대로. |
| **재빌드한 확장 런타임** | **기능·의미론 동등** | emit은 계속 Vite/esbuild. TS는 typecheck만. |
| **저장 데이터 / export 포맷** | **호환** | schema·파일 형식·권한 변경 없음. |
| **개발자 워크플로** | **의도적 변경** | `typecheck`가 TS7 네이티브 CLI. 추가 패키지 `typescript-7` 필요. |
| **완전 TS7 단일 패키지** | **아직 비권장** | `typescript-eslint` peer·API 제약. |

### 13.2 런타임·사용자 영향 매트릭스

| 영역 | 변경 여부 | 근거 / 검증 |
|------|-----------|-------------|
| Manifest V3 권한·호스트 | 없음 | `manifest.json` 미변경 |
| content / background / offscreen 동작 | 없음 (의도) | 소스 비즈니스 로직 변경 없음; 315 tests + build 통과 |
| IndexedDB schema / session record | 없음 | storage 코드·버전 필드 미변경 |
| chrome.storage keys / replay queue | 없음 | 동일 |
| export TXT/SRT/VTT/JSON/MD/CSV | 없음 | exporter 코드 미변경; typecheck만 통과 |
| history / options / popup UI | 없음 | React 소스 미변경 |
| 지원 URL (`assembly` / `webcast` main·player) | 없음 | 상수·매칭 로직 미변경 |
| 확장 패키지 버전 번호 | 스토어 배포 시 `1.0.12` 로 범프 | 툴체인 전환 후 웹 스토어 제출용 릴리스 버전 |
| 사용자 기기 요구사항 | 없음 | 네이티브 `tsc`는 **개발/CI 머신**에만 설치 |

### 13.3 빌드 파이프라인 호환

| 단계 | 이전 | 현재 | 호환 메모 |
|------|------|------|-----------|
| 트랜스파일·번들 | Vite 6 + esbuild + crxjs | 동일 계열 | **TS 컴파일러가 JS를 만들지 않음** (`noEmit: true`) |
| injected observer | `scripts/build-injected.mjs` (esbuild) | 동일 | typecheck와 독립 |
| typecheck | `tsc` (TS 5.8 → Phase1 후 6.0) | `node scripts/run-tsc.mjs 7` | 정적 검증만; 실패 시 배포 게이트 차단 |
| lint | ESLint + typescript-eslint | 동일 계열, peer용 `typescript@6` | TS7 API 미사용 |
| test | Vitest | 동일 | rollup 4 override로 Vite 해석 복구 |
| 산출물 위치 | `dist/` | `dist/` | 배포 절차 동일 |

**중요:** TypeScript 7 네이티브 바이너리(`@typescript/typescript-win32-x64` 등 optional dep)는 **npm install 시 개발 환경에만** 내려받는다. 확장 zip/`dist/` 안에는 포함되지 않는다.

### 13.4 타입 검사 의미론 (5.8 / 6.0 / 7.0)

| 항목 | 본 저장소 영향 |
|------|----------------|
| TS6 기본값 `strict`, `module` ESNext, `moduleResolution` bundler | 이미 충족 → 앱 코드 깨짐 없음 |
| `noUncheckedSideEffectImports: true` | CSS side-effect import 4건 → `src/css-modules.d.ts`로 해결 (런타임 무관) |
| `target: es5` / `baseUrl` / classic resolution 폐기 | 미사용 |
| TS7 템플릿 리터럴 유니코드 추론 변경 | 해당 타입 유틸 미사용; typecheck 오류 0 |
| TS6 vs TS7 오류 집합 | **동일 통과** (`typecheck:ts6` · `typecheck`) |
| `stableTypeOrdering` (TS6 진단) | 오류 0 |

→ “타입체커가 더 엄격해져 기존 잘못된 코드를 새로 잡아내는” 케이스는 **현재 코드베이스에서 관측되지 않음**.  
만약 향후 잡히더라도 배포 전 게이트에서 막히며, **이미 배포된 바이너리에는 소급 적용되지 않음**.

### 13.5 데이터·API 하위 호환

| 데이터/API | 하위 호환 | 비고 |
|------------|-----------|------|
| 기존 IndexedDB 세션 | 예 | 마이그레이션 코드 경로 변경 없음 |
| JSON export/import | 예 | lineageId/segmentNumber 규칙 유지 |
| chrome.runtime 메시지 타입 | 예 | `message-types` 등 소스 미변경 |
| filenamePattern / settings keys | 예 | settings-store 미변경 |
| 스토어 설치 → 업데이트 시 | 예 | 본 변경만으로는 content script 계약 불변 |

### 13.6 개발·CI 환경 호환 (주의점)

| 항목 | 요구 / 변화 | 위험 | 완화 |
|------|-------------|------|------|
| Node | 기존과 같이 20+ 권장 (TS7 engines ≥16.20) | 구형 Node | README/DEPLOYMENT 명시 |
| `npm install` | `typescript` + `typescript-7` + 플랫폼 native optional | 오프라인/제한 환경에서 optional 실패 시 TS7 typecheck 실패 | CI에서 install 로그 확인; 임시 `typecheck:ts6` |
| bare `tsc` PATH | dual 설치 시 어느 버전인지 불안정할 수 있음 | 잘못된 컴파일러 호출 | **항상** `npm run typecheck` / `run-tsc.mjs` 사용 |
| ESLint type-aware (향후) | 현재 recommended 중심 | `typescript@7` 단독 시 peer 경고/깨짐 | `typescript@6` 유지 |
| lockfile / rollup | Vite는 rollup ^4, crxjs는 2.80.0 override | 잘못된 dedupe 시 `parseAst` 오류 | package.json overrides 유지 |
| 에디터 | 선택적 Native Preview | CLI(TS7) vs 에디터(내장 TS) 표시 차이 | 문서 안내; 게이트는 CLI |

### 13.7 회귀 검증으로 확인한 것

| 검증 | 결과 |
|------|------|
| `npm run typecheck` (TS7) | 통과 |
| `npm run typecheck:ts6` | 통과 |
| `npm run lint` | 통과 |
| `npm run test` | 315 tests 통과 |
| `npm run build` | `dist/` 생성 성공 |
| `npm run verify` (inject 포함) | 통과 |
| 소스 비즈니스 로직 diff | typecheck 헬퍼·tsconfig·CSS 선언·deps 외 제품 코드 변경 없음 |

### 13.8 의도적으로 바꾸지 않은 것 (호환 유지 장치)

1. **Vite emit 경로** — `tsc` emit / `outDir` 미도입.  
2. **확장 런타임 의존성** — production bundle에 TypeScript 런타임 없음.  
3. **세션·export·수집 파이프라인 시맨틱** — CLAUDE.md 고정 의미론 유지.  
4. **스토어 버전** — 웹 스토어 배포 시 `1.0.12` 로 범프 (`package.json` / `manifest.json` 동기화).

### 13.9 잔여 리스크 (낮음)

| 리스크 | 가능성 | 영향 | 대응 |
|--------|--------|------|------|
| TS7 패치 버전이 특정 플랫폼 binary 누락 | 낮음 | CI typecheck 실패 | optional dep 로그, `typecheck:ts6` 임시 폴백 |
| 향후 소스 추가 시 TS7만 오류 | 중간 | 머지 차단 | 정상 게이트 동작 |
| lockfile 재생성 시 rollup dedupe 재발 | 중간 | test/build 실패 | overrides 회귀 테스트로 감지 |
| eslint가 아직 TS7 API 미지원 | 확정 | dual 유지 필요 | Phase 4 트리거 대기 |

### 13.10 호환성 판정

```text
사용자(이미 설치)     :  호환 (무영향)
사용자(재빌드 배포)   :  호환 (기능 동등 기대, 게이트 통과)
개발자(신규 clone)    :  호환 (npm install + npm run typecheck)
데이터/export         :  호환
스토어 강제 업데이트  :  불필요 (툴체인 only)
```
