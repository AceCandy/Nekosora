# Implement:段A上下文准备并行化

## 执行清单

1. **通读现状** → 确认 design 依赖图与源码 `src/lib/chat/orchestrator.ts` 逐行吻合(已完成于 design)。
2. **阶段 1 拆出**:fileIds 合并(知识库)保持串行前置,产出 `fileIds`。
3. **分支 A(fileIds 链)**:把 vision mime 分离 → 能力校验 → buildMultimodalUserMessage → file_mode 查询 → buildMessagesWithFileContext 封装为一个内部 async 函数,返回 `{ ok:true, effectiveMessages, ragStatus } | { ok:false, error: NextResponse }`。
4. **阶段 2 并行**:用 `Promise.all([分支A, ⑦searchWeb, ⑧+⑨记忆, ⑩→⑪消息+压缩, ⑫output, ⑬template, ⑭cards])`。
   - 每个分支保留原 catch(⑧/⑨/⑪/⑫ 的降级);无 catch 的(⑦/⑬/⑭)保持失败冒泡。
   - 分支 D 内部 `existingMsgs` 查询后再 `maybeCompact`(顺序依赖)。
   - 分支 C 内部 `getMemories` 与 `recallMemories` 可再内嵌一层 `Promise.all`(二者互不依赖)。
5. **vision 错误检查**:`Promise.all` resolve 后,`if (!branchA.ok) return { error: branchA.error };` 解构 `effectiveMessages, ragStatus`。
6. **阶段 3 后置**:`renderSearchContext(searchBundle)` → 合并 system → `assembleContext` → `buildTrace` → 组装 `irRequest` 返回。
7. **自检**:确认所有原变量赋值(effectiveMessages / ragStatus / searchBundle / allMemories / recalledMemories / compaction / outputModePrompt / templateSystemPrompt / cardSystemPrompt)在并行后仍被正确消费;`incTplUseCount` / `incCardUseCount` 的异步计数 `.catch(() => {})` 保留。

## 验证

- [ ] `pnpm typecheck` 通过
- [ ] `pnpm lint` 通过
- [ ] `pnpm test` 通过(现有 reasoning/routing 等不回归)
- [ ] trace 一致性:构造一组固定输入,对比改动前后 `buildTrace` 输出(必要时写一个临时对照或补 `prepareChatContext` 行为测试)
- [ ] 手测:`pnpm dev` 跑普通对话 / 带附件 RAG / 联网搜索 / 多轮,确认首字延迟下降、结果无回归
- [ ] vision 校验:对不支持图片的模型发图片附件,仍返回 400

## 回滚点

- 改动集中在一个函数,git revert 该提交即可完全回滚。
