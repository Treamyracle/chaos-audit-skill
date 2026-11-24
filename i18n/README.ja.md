<p align="center">
  <img src="../docs/assets/hero-banner.svg" alt="chaos-audit-skill banner" width="900">
</p>

<h1 align="center">chaos-audit (日本語)</h1>

<p align="center">
  <a href="../README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <b>日本語</b> ·
  <a href="README.ko.md">한국어</a> ·
  <a href="README.tr.md">Türkçe</a> ·
  <a href="README.es.md">Español</a> ·
  <a href="README.fr.md">Français</a> ·
  <a href="README.de.md">Deutsch</a> ·
  <a href="README.pt-BR.md">Português</a> ·
  <a href="README.vi.md">Tiếng Việt</a> ·
  <a href="README.ru.md">Русский</a>
</p>

<p align="center">
  <b>コーディングエージェントが10分で実装した機能に、二重支払い（Double-Spend）の競合状態が潜んでいませんか？</b><br>
  Claude Code・Codex・Cursor・Google Antigravity 対応の6フェーズ敵対的信頼性・カオスエンジニアリングスキル。<br>
  <code>confirmed</code> 判定には、反証エージェントの検証と決定論的な再現テストの失敗証明が必須です。
</p>

<p align="center">
  <img src="../docs/assets/reproducer-proof.svg" alt="Deterministic reproducer output" width="900">
</p>

## 主な検出対象

- **TOCTOU レースコンディション**：ロックなし `残高確認 → await → 更新` による二重引き落とし
- **非冪等な Webhook / キュー再試行**：重複した `eventId` による二重クレジット付与
- **タイムアウト未設定の外部 HTTP 通信**：上流ハングによるコネクション枯渇・サービス停止
- **DB デッドロック・ライトスキュー（Write Skew）・非アトミックな複数ストア更新**
- **AI エージェント特有の障害**：LLM ツール呼び出しの重複実行、ストリーミング途切れ JSON 破損、MCP `stdio` デッドロック

## 6フェーズ・ワークフロー

1. **Phase 1 — 偵察 ([`RECONNAISSANCE.md`](../skills/chaos-audit/RECONNAISSANCE.md))**：4つの並列リサーチエージェントが状態ストアと不変条件をマッピングし、`fault-ledger.json` を作成。
2. **Phase 2 — カバレッジ主導ハント ([`HUNTING.md`](../skills/chaos-audit/HUNTING.md))**：台帳単位で独立ハンターと7つのドメインプレイブックを実行し、カバレッジ批評で漏れを検出。
3. **Phase 3 — 敵対的反証＆再現テスト ([`VALIDATION-AND-REPORTING.md`](../skills/chaos-audit/VALIDATION-AND-REPORTING.md))**：別の新規エージェントがまず**反証**を試み、防壁がない場合は隔離環境で再現テストを実行。
4. **Phase 4 — ゼロ依存スキーマゲート**：[`validate-findings.cjs`](../skills/chaos-audit/validate-findings.cjs) で実ファイルの行番号と再現証跡を機械検証。
5. **Phase 5 — 独立記録検証**：別エージェントが `file:line` とテスト終了出力を再確認。
6. **Phase 6 — レポート生成**：`REPORT.md`、`FINDINGS-DETAIL.md`、`REPRODUCERS.md`、`NEEDS-VALIDATION.md` を出力。

## インストールと検証

```bash
npx skills add https://github.com/Treamyracle/chaos-audit-skill --skill chaos-audit
```

```bash
node --test skills/chaos-audit/validate-fault-ledger.test.cjs skills/chaos-audit/validate-findings.test.cjs
node --test examples/vulnerable-checkout/reproducers/*.repro.test.cjs
```

詳細は [英語メイン README](../README.md) および [検証ステータス](../docs/STATUS.md)（[MIT ライセンス](../LICENSE)）をご覧ください。
