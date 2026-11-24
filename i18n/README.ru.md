<p align="center">
  <img src="../docs/assets/hero-banner.svg" alt="chaos-audit-skill banner" width="900">
</p>

<h1 align="center">chaos-audit (Русский)</h1>

<p align="center">
  <a href="../README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a> ·
  <a href="README.tr.md">Türkçe</a> ·
  <a href="README.es.md">Español</a> ·
  <a href="README.fr.md">Français</a> ·
  <a href="README.de.md">Deutsch</a> ·
  <a href="README.pt-BR.md">Português</a> ·
  <a href="README.vi.md">Tiếng Việt</a> ·
  <b>Русский</b>
</p>

<p align="center">
  <b>Кодинг-агент выкатил фичу за 10 минут. А не выкатил ли он заодно гонку двойного списания?</b><br>
  Шестифазный навык состязательного аудита надёжности и хаос-инжиниринга для Claude Code, Codex, Cursor и Google Antigravity.<br>
  Каждый баг со статусом <code>confirmed</code> должен пройти независимого опровергателя и подтвердиться запуском детерминированного воспроизводящего теста.
</p>

<p align="center">
  <img src="../docs/assets/reproducer-proof.svg" alt="Deterministic reproducer output" width="900">
</p>

## Что находит `chaos-audit`

- **Состояния гонки TOCTOU**: чтение баланса перед `await` и последующая перезапись без блокировки или CAS.
- **Неидемпотентные вебхуки и повторы очередей**: повторная доставка `eventId` начисляет средства дважды.
- **Внешние HTTP-вызовы без таймаута**: зависание воркеров при сбое внешнего сервиса.
- **Взаимоблокировки БД (deadlock), write skew и неатомарная запись файлов.**
- **Сбои LLM-пайплайнов**: дублирование вызовов инструментов и блокировки `stdio` в MCP-серверах.

## Установка и проверка

```bash
npx skills add https://github.com/Treamyracle/chaos-audit-skill --skill chaos-audit
```

```bash
node --test skills/chaos-audit/validate-fault-ledger.test.cjs skills/chaos-audit/validate-findings.test.cjs
node --test examples/vulnerable-checkout/reproducers/*.repro.test.cjs
```

Подробности приведены в [основном README на английском](../README.md) и в [STATUS.md](../docs/STATUS.md) ([лицензия MIT](../LICENSE)).
