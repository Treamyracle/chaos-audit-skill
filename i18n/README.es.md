<p align="center">
  <img src="../docs/assets/hero-banner.svg" alt="chaos-audit-skill banner" width="900">
</p>

<h1 align="center">chaos-audit (Español)</h1>

<p align="center">
  <a href="../README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a> ·
  <a href="README.tr.md">Türkçe</a> ·
  <b>Español</b> ·
  <a href="README.fr.md">Français</a> ·
  <a href="README.de.md">Deutsch</a> ·
  <a href="README.pt-BR.md">Português</a> ·
  <a href="README.vi.md">Tiếng Việt</a> ·
  <a href="README.ru.md">Русский</a>
</p>

<p align="center">
  <b>Tu agente de código lanzó la funcionalidad en 10 minutos. ¿También lanzó una condición de carrera de doble gasto?</b><br>
  Skill de ingeniería de fiabilidad y caos adversarial en 6 fases para Claude Code, Codex, Cursor y Google Antigravity.<br>
  Cada hallazgo <code>confirmed</code> debe sobrevivir a un verificador adversarial y ejecutarse con una prueba determinista que falle.
</p>

<p align="center">
  <img src="../docs/assets/reproducer-proof.svg" alt="Deterministic reproducer output" width="900">
</p>

## Qué Detecta

- **Condiciones de carrera TOCTOU**: Lectura previa a un `await` seguida de escritura sin bloqueo ni CAS.
- **Webhooks y colas no idempotentes**: Reintentos con el mismo `eventId` que acreditan o cobran dos veces.
- **Llamadas HTTP sin timeout**: Dependencias externas lentas que bloquean indefinidamente los sockets del servidor.
- **Interbloqueos (deadlocks), write skew y escrituras parciales en disco o múltiples bases de datos.**
- **Fallos en pipelines de agentes LLM**: Reintentos duplicados de herramientas y bloqueos de tuberías `stdio` en servidores MCP.

## Instalación y Pruebas Locales

```bash
npx skills add https://github.com/Treamyracle/chaos-audit-skill --skill chaos-audit
```

```bash
node --test skills/chaos-audit/validate-fault-ledger.test.cjs skills/chaos-audit/validate-findings.test.cjs
node --test examples/vulnerable-checkout/reproducers/*.repro.test.cjs
```

Consulta el [README principal en inglés](../README.md) y la tabla de verificación en [STATUS.md](../docs/STATUS.md) ([Licencia MIT](../LICENSE)).
