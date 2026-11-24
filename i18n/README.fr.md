<p align="center">
  <img src="../docs/assets/hero-banner.svg" alt="chaos-audit-skill banner" width="900">
</p>

<h1 align="center">chaos-audit (Français)</h1>

<p align="center">
  <a href="../README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a> ·
  <a href="README.tr.md">Türkçe</a> ·
  <a href="README.es.md">Español</a> ·
  <b>Français</b> ·
  <a href="README.de.md">Deutsch</a> ·
  <a href="README.pt-BR.md">Português</a> ·
  <a href="README.vi.md">Tiếng Việt</a> ·
  <a href="README.ru.md">Русский</a>
</p>

<p align="center">
  <b>Votre agent de code a livré la fonctionnalité en 10 minutes. A-t-il aussi livré une race condition de double dépense ?</b><br>
  Une compétence d'audit de fiabilité et d'ingénierie du chaos en 6 phases pour Claude Code, Codex, Cursor et Google Antigravity.<br>
  Chaque anomalie <code>confirmed</code> doit résister à un vérificateur contradictoire et être prouvée par un test reproductible qui échoue de façon déterministe.
</p>

<p align="center">
  <img src="../docs/assets/reproducer-proof.svg" alt="Deterministic reproducer output" width="900">
</p>

## Ce que détecte `chaos-audit`

- **Conditions de course TOCTOU** : lecture suivie d'un `await` puis écriture sans verrou ni CAS.
- **Webhooks et files non idempotents** : doubles crédits ou facturations lors des réessais `eventId`.
- **Appels HTTP sans délai d'expiration** : blocage indéfini des workers lorsqu'un service amont fige.
- **Interblocages SQL, write skew et écritures non atomiques sur disque.**
- **Pannes de pipelines LLM** : appels d'outils dupliqués et blocages de tubes `stdio` MCP.

## Installation et tests locaux

```bash
npx skills add https://github.com/Treamyracle/chaos-audit-skill --skill chaos-audit
```

```bash
node --test skills/chaos-audit/validate-fault-ledger.test.cjs skills/chaos-audit/validate-findings.test.cjs
node --test examples/vulnerable-checkout/reproducers/*.repro.test.cjs
```

Consultez le [README principal en anglais](../README.md) et le journal de vérification dans [STATUS.md](../docs/STATUS.md) ([Licence MIT](../LICENSE)).
