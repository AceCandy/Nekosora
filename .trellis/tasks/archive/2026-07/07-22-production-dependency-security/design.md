# 生产依赖安全修复设计

## Resolution Strategy

```text
@modelcontextprotocol/sdk -> ajv -> fast-uri 3.1.2
                                  override -> 3.1.4

next@15.5.20 -> sharp ^0.34.3 -> 0.34.5
                 scoped override -> 0.35.3 (existing direct dependency)
```

`fast-uri` 是同一 3.1 patch line；全局精确 override 风险低。sharp override 跨 0.x minor，风险高于普通 patch，因此限定到 `next@15.5.20>sharp`，并以 native 模块加载和完整 `next build` 作为兼容门禁。

## Rollback

回滚 `package.json` 两个 override 和 lockfile 对应解析即可。无代码、配置格式或数据迁移；若生产构建失败，不接受“审计变绿但应用不可构建”的结果。
