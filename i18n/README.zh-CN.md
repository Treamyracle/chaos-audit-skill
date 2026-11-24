<p align="center">
  <img src="../docs/assets/hero-banner.svg" alt="chaos-audit-skill banner" width="900">
</p>

<h1 align="center">chaos-audit (简体中文)</h1>

<p align="center">
  <a href="../README.md">English</a> ·
  <b>简体中文</b> ·
  <a href="README.ja.md">日本語</a> ·
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
  <b>你的编程智能体 10 分钟交付了功能，但它是不是也顺手写了个双花竞态条件？</b><br>
  面向 Claude Code、Codex、Cursor 与 Google Antigravity 的六阶段对抗式可靠性与混沌工程 Skill。<br>
  每一条 <code>confirmed</code> 缺陷都必须通过对抗式证伪者审查，并由实际运行失败的确定性复现测试证明。
</p>

<p align="center">
  <img src="../docs/assets/reproducer-proof.svg" alt="Deterministic reproducer output" width="900">
</p>

## 核心能力

传统安全扫描只关注注入与越权，UI 工具只修复视觉审美；`chaos-audit` 专门猎杀 AI 生成后端与智能体链路中最致命的可靠性隐患：
- **TOCTOU 竞态与双花**：无行锁或 CAS 校验的 `读取 → await → 扣减` 流程
- **非幂等 Webhook 与队列重试**：同一 `eventId` 重复投递导致重复入账或重复发信
- **缺少超时的外部请求与连接池耗尽**：下游挂起拖垮整个服务线程池
- **数据库死锁、写偏斜（Write Skew）与非原子多库写入**
- **LLM 智能体链路故障**：工具调用重复执行、流式截断 JSON 损坏、MCP `stdio` 管道死锁

## 六阶段工作流

1. **第一阶段 — 侦察 ([`RECONNAISSANCE.md`](../skills/chaos-audit/RECONNAISSANCE.md))**：4 个只读智能体并行梳理状态存储、事务锁、异步入口与超时边界，生成 `fault-ledger.json`。
2. **第二阶段 — 覆盖驱动狩猎 ([`HUNTING.md`](../skills/chaos-audit/HUNTING.md))**：按台账单元分配独立猎手与 7 大领域手册，并由覆盖审查员查漏补缺。
3. **第三阶段 — 对抗式证伪与实测复现 ([`VALIDATION-AND-REPORTING.md`](../skills/chaos-audit/VALIDATION-AND-REPORTING.md))**：全新的验证者首先尝试**推翻**候选问题；若无法推翻，则在沙盒内编写并执行并发/故障复现测试。
4. **第四阶段 — 零依赖 Schema 门禁**：使用 [`validate-findings.cjs`](../skills/chaos-audit/validate-findings.cjs) 校验真实源码行号、台账指纹与失败复现证据。
5. **第五阶段 — 独立记录复核**：由全新智能体二次核验每处 `file:line` 引用与测试退出输出。
6. **第六阶段 — 生成报告**：产出 `REPORT.md`、`FINDINGS-DETAIL.md`、`REPRODUCERS.md` 与 `NEEDS-VALIDATION.md`。

## 快速安装与本地体验

```bash
npx skills add https://github.com/Treamyracle/chaos-audit-skill --skill chaos-audit
```

直接运行仓库自带的可执行示例与 48 项零依赖单元测试：

```bash
node --test skills/chaos-audit/validate-fault-ledger.test.cjs skills/chaos-audit/validate-findings.test.cjs
node --test examples/vulnerable-checkout/reproducers/*.repro.test.cjs
```

更多细节与实时状态请查看 [英文主文档](../README.md) 与 [验证状态表](../docs/STATUS.md)（[MIT 协议](../LICENSE)）。
