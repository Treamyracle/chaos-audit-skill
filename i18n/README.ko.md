<p align="center">
  <img src="../docs/assets/hero-banner.svg" alt="chaos-audit-skill banner" width="900">
</p>

<h1 align="center">chaos-audit (한국어)</h1>

<p align="center">
  <a href="../README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <b>한국어</b> ·
  <a href="README.tr.md">Türkçe</a> ·
  <a href="README.es.md">Español</a> ·
  <a href="README.fr.md">Français</a> ·
  <a href="README.de.md">Deutsch</a> ·
  <a href="README.pt-BR.md">Português</a> ·
  <a href="README.vi.md">Tiếng Việt</a> ·
  <a href="README.ru.md">Русский</a>
</p>

<p align="center">
  <b>코딩 에이전트가 10분 만에 기능을 배포했습니다. 혹시 이중 결제(Double-Spend) 레이스 컨디션도 함께 배포되었나요?</b><br>
  Claude Code, Codex, Cursor, Google Antigravity를 위한 6단계 적대적 신뢰성·카오스 엔지니어링 스킬.<br>
  모든 <code>confirmed</code> 결함은 적대적 반증 에이전트 검증과 결정론적 재현 테스트 실행으로 증명됩니다.
</p>

<p align="center">
  <img src="../docs/assets/reproducer-proof.svg" alt="Deterministic reproducer output" width="900">
</p>

## 탐지 대상

- **TOCTOU 레이스 컨디션**: 락 없이 `잔액 조회 → await → 차감`하는 동시성 이중 결제
- **비멱등 Webhook 및 큐 재시도**: 동일한 `eventId` 재전송 시 중복 입금/처리 발생
- **타임아웃 누락된 외부 HTTP 요청**: 업스트림 지연 시 워커 및 소켓 무한 대기
- **DB 데드락, Write Skew, 비원자적 다중 저장소 쓰기**
- **AI 에이전트 파이프라인 장애**: LLM 도구 중복 호출, 스트리밍 JSON 파손, MCP `stdio` 파이프 데드락

## 6단계 감사 파이프라인

1. **1단계 — 정찰 ([`RECONNAISSANCE.md`](../skills/chaos-audit/RECONNAISSANCE.md))**: 4개의 병렬 리서치 에이전트가 상태 저장소·트랜잭션·타임아웃을 매핑해 `fault-ledger.json` 생성.
2. **2단계 — 커버리지 기반 헌팅 ([`HUNTING.md`](../skills/chaos-audit/HUNTING.md))**: 원장 단위별로 독립 헌터와 7개 도메인 플레이북을 투입하고 커버리지 비평 수행.
3. **3단계 — 적대적 반증 및 재현 실행 ([`VALIDATION-AND-REPORTING.md`](../skills/chaos-audit/VALIDATION-AND-REPORTING.md))**: 신규 검증자가 먼저 반증을 시도하고, 방어 로직이 없으면 샌드박스에서 실패 재현 테스트 실행.
4. **4단계 — 제로 의존성 스키마 게이트**: [`validate-findings.cjs`](../skills/chaos-audit/validate-findings.cjs)로 실제 파일 라인 범위와 원장 지문을 검증.
5. **5단계 — 독립 기록 검증**: 별도 에이전트가 `file:line` 추적과 테스트 실행 결과를 재확인.
6. **6단계 — 보고서 생성**: `REPORT.md`, `FINDINGS-DETAIL.md`, `REPRODUCERS.md`, `NEEDS-VALIDATION.md` 생성.

## 설치 및 테스트

```bash
npx skills add https://github.com/Treamyracle/chaos-audit-skill --skill chaos-audit
```

```bash
node --test skills/chaos-audit/validate-fault-ledger.test.cjs skills/chaos-audit/validate-findings.test.cjs
node --test examples/vulnerable-checkout/reproducers/*.repro.test.cjs
```

자세한 내용은 [영문 README](../README.md) 및 [검증 현황](../docs/STATUS.md)([MIT 라이선스](../LICENSE))을 참고하세요.
