# Bug Analysis: 超长会话输出样式切换冻结与位置漂移

## 1. Root Cause Category

- **Category**: C - Change Propagation Failure；D - Test Coverage Gap
- **Specific Cause**: 前一版只缩小了 React renderer props 的传播范围，但 `rs-*` 仍在整段消息祖先一次切换，浏览器会同步重算全部后代样式。后续 renderer 分批后消息高度逐步变化，而视口禁用了原生 overflow anchor，缺少按消息语义保位的补偿。

## 2. Why Fixes Failed

1. 只延迟 renderer props：减少了部分 React 更新，但没有覆盖祖先 CSS 引发的 style/layout 成本。
2. 只分批切 renderer：降低了单帧计算量，但没有同步分批 CSS，也没有处理高度变化后的逻辑位置。

## 3. Prevention Mechanisms

| Priority | Mechanism | Specific Action | Status |
|---|---|---|---|
| P0 | Architecture | cssClass、renderer、paper 语义按 assistant 同批渐进应用 | DONE |
| P0 | Runtime | 历史中段按真实可见消息偏移补偿，用户/原语滚动优先，底部交给 autoScroll | DONE |
| P1 | Test Coverage | 覆盖 CSS-only、批次收敛、旧 generation 失效和滚动抢占纯逻辑 | DONE |
| P1 | Browser | 登录态超长会话验证中段保位、底部跟随和切换期间主动滚动 | TODO |

## 4. Systematic Expansion

- **Similar Issues**: 任何挂在长列表祖先、且会改变后代布局的主题 class 都可能绕过 React memo 造成整树重算。
- **Design Improvement**: 视觉 class 与渲染语义必须共享同一个渐进状态；滚动补偿只保存消息身份与视口内偏移，不保存跨样式像素位置。
- **Process Improvement**: 性能优化评审同时检查 React 更新、CSS 失效范围和布局后的滚动语义，不能只看组件 render 次数。

## 5. Knowledge Capture

- [x] 更新 frontend component guidelines 的输出样式切换契约。
- [x] 为本任务保存根因与预防机制。
- [ ] 完成登录态真实长会话浏览器验收。
