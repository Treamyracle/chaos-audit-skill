<p align="center">
  <img src="../docs/assets/hero-banner.svg" alt="chaos-audit-skill banner" width="900">
</p>

<h1 align="center">chaos-audit (Tiếng Việt)</h1>

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
  <b>Tiếng Việt</b> ·
  <a href="README.ru.md">Русский</a>
</p>

<p align="center">
  <b>Coding agent vừa code xong tính năng trong 10 phút. Liệu nó có ship luôn một lỗi race condition chi tiêu kép không?</b><br>
  Skill kiểm thử độ tin cậy và chaos engineering đối kháng 6 pha dành cho Claude Code, Codex, Cursor và Google Antigravity.<br>
  Mọi lỗi <code>confirmed</code> đều phải vượt qua kiểm chứng viên phản biện và được chứng minh bằng test tái hiện lỗi thực thi thật.
</p>

<p align="center">
  <img src="../docs/assets/reproducer-proof.svg" alt="Deterministic reproducer output" width="900">
</p>

## Các lỗi `chaos-audit` săn tìm

- **TOCTOU & Race Conditions**: đọc trạng thái rồi `await` sau đó ghi đè mà không có khóa hoặc CAS.
- **Webhook & Queue không idempotent**: gửi lại cùng `eventId` dẫn tới cộng tiền hoặc xử lý hai lần.
- **Thiếu timeout khi gọi HTTP ngoài**: treo vĩnh viễn worker khi upstream bị chậm hoặc đứng.
- **Deadlock cơ sở dữ liệu, write skew và ghi file không nguyên tử.**
- **Lỗi pipeline AI Agent**: gọi trùng lặp LLM tool khi retry và deadlock ống `stdio` của MCP.

## Cài đặt & chạy test

```bash
npx skills add https://github.com/Treamyracle/chaos-audit-skill --skill chaos-audit
```

```bash
node --test skills/chaos-audit/validate-fault-ledger.test.cjs skills/chaos-audit/validate-findings.test.cjs
node --test examples/vulnerable-checkout/reproducers/*.repro.test.cjs
```

Xem chi tiết tại [README tiếng Anh](../README.md) và bảng trạng thái tại [STATUS.md](../docs/STATUS.md) ([Giấy phép MIT](../LICENSE)).
