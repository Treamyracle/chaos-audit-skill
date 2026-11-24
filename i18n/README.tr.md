<p align="center">
  <img src="../docs/assets/hero-banner.svg" alt="chaos-audit-skill banner" width="900">
</p>

<h1 align="center">chaos-audit (Türkçe)</h1>

<p align="center">
  <a href="../README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a> ·
  <b>Türkçe</b> ·
  <a href="README.es.md">Español</a> ·
  <a href="README.fr.md">Français</a> ·
  <a href="README.de.md">Deutsch</a> ·
  <a href="README.pt-BR.md">Português</a> ·
  <a href="README.vi.md">Tiếng Việt</a> ·
  <a href="README.ru.md">Русский</a>
</p>

<p align="center">
  <b>Kodlama ajanınız özelliği 10 dakikada yayına aldı. Peki yanında bir çifte harcama (double-spend) yarış durumu da gönderdi mi?</b><br>
  Claude Code, Codex, Cursor ve Google Antigravity için 6 aşamalı düşmanca güvenilirlik ve kaos mühendisliği becerisi.<br>
  Her <code>confirmed</code> bulgu, karşıt doğrulayıcıyı geçmeli ve çalıştırılmış deterministik bir yeniden üretim testiyle kanıtlanmalıdır.
</p>

<p align="center">
  <img src="../docs/assets/reproducer-proof.svg" alt="Deterministic reproducer output" width="900">
</p>

## Neleri Yakalar?

- **TOCTOU Yarış Durumları**: Kilit olmadan `bakiye oku → await → düş` akışlarında çifte harcama
- **İdempotent Olmayan Webhook ve Kuyruk Tekrarları**: Aynı `eventId` ile mükerrer bakiye yüklemesi
- **Zaman Aşımı (Timeout) Eksik HTTP Çağrıları**: Yanıt vermeyen servislerde işçilerin sonsuza kadar asılı kalması
- **Veritabanı Kilitlenmeleri (Deadlock), Write Skew ve Atomik Olmayan Dosya/Çoklu Depo Yazımları**
- **Yapay Zekâ Ajan Hataları**: Yinelenen LLM araç çağrıları, yarım kalan JSON akışları ve MCP `stdio` kilitlenmeleri

## Kurulum ve Doğrulama

```bash
npx skills add https://github.com/Treamyracle/chaos-audit-skill --skill chaos-audit
```

```bash
node --test skills/chaos-audit/validate-fault-ledger.test.cjs skills/chaos-audit/validate-findings.test.cjs
node --test examples/vulnerable-checkout/reproducers/*.repro.test.cjs
```

Ayrıntılı mimari, 6 aşamalı akış ve kılavuzlar için [İngilizce README](../README.md) ve [Durum Raporu](../docs/STATUS.md) belgelerine göz atın ([MIT Lisansı](../LICENSE)).
