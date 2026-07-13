# Design:段A上下文准备并行化

## 现状与目标

`prepareChatContext`(`src/lib/chat/orchestrator.ts`)当前完全串行 await,本设计把无数据依赖的耗时步并行化,保持兜底行为与 trace 输出逐字段一致。

## 依赖图(基于源码逐行核对)

| 步骤 | 产出 | 依赖 | 失败行为 |
|---|---|---|---|
| ① fileIds 合并(知识库) | `fileIds` | knowledgeBaseIds | 冒泡 |
| ② vision mime 分离 | `imageFileIds` | ①fileIds | 冒泡 |
| ③ vision 能力校验 | —— | ②imageFileIds, model/modelId | **返回 400**(特殊) |
| ④ buildMultimodalUserMessage | 改写 last user msg | ②imageFileIds | 冒泡 |
| ⑤ userSettings file_mode 查询 | `fileMode` | ①fileIds | 冒泡 |
| ⑥ buildMessagesWithFileContext(RAG) | `effectiveMessages, ragStatus` | ①fileIds, ⑤fileMode, userContent | 冒泡 |
| ⑦ searchWeb | `searchBundle` | userContent | **冒泡**(原无 catch) |
| ⑧ getMemories | `allMemories` | userId | `.catch(() => [])` 降级 |
| ⑨ recallMemories | `recalledMemories` | userId, userContent | try/catch 降级 `[]` |
| ⑩ existingMsgs 查询 | `compactionMsgs` | conversationId | 冒泡 |
| ⑪ maybeCompact | `compaction` | ⑩compactionMsgs | try/catch 降级 `null` |
| ⑫ getOutputMode | `outputModePrompt` | conv.outputModeId | `.catch(() => null)` 降级 |
| ⑬ getTemplate + render | `templateSystemPrompt` | templateId | 冒泡 |
| ⑭ getCardsByIds + render | `cardSystemPrompt` | instructionCardIds | 冒泡 |
| ⑮ renderSearchContext | `searchContext` | ⑦searchBundle | 同步纯函数 |
| ⑯ assembleContext | `assembled` | ⑥⑧⑨⑪⑫⑬⑭⑪ | 冒泡 |
| ⑰ buildTrace | `trace` | ⑯ | 同步纯函数 |

## 并行分组

```
阶段 1(串行前置):① fileIds 合并
   └─ 后续 RAG/vision 链与 fileIds 强依赖,先算出 fileIds

阶段 2(Promise.all 并行):
   分支 A(fileIds 链,内部有序):② → ③vision 校验 → ④ → ⑤ → ⑥
        · 返回 { ok:true, effectiveMessages, ragStatus } | { ok:false, error: NextResponse }
   分支 B(联网搜索):⑦ searchWeb          —— 失败冒泡(保留原行为)
   分支 C(记忆):⑧ getMemories + ⑨ recallMemories
   分支 D(消息+压缩):⑩ existingMsgs → ⑪ maybeCompact
   分支 E(output mode):⑫
   分支 F(template):⑬
   分支 G(cards):⑭

阶段 3(串行后置,等齐全部):
   ⑮ renderSearchContext(分支B产出)
   合并 system:outputModePrompt + templateSystemPrompt + cardSystemPrompt + searchContext
   ⑯ assembleContext
   ⑰ buildTrace
```

## 兜底与错误传播

- 每个分支**保留原有 catch**(⑧ `.catch(() => [])`、⑨ try/catch、⑪ try/catch、⑫ `.catch(() => null)`),并行后行为不变。
- 无原 catch 的(⑦searchWeb/⑬getTemplate/⑭getCardsByIds)失败 → 分支 reject → `Promise.all` reject → 冒泡到 `prepareChatContext` 调用方,与原串行行为**完全一致**。
- **vision 校验(③)特殊**:原代码 `return { error: NextResponse }`。并行分支内不能直接 return 函数。方案:分支 A 返回 discriminated union,阶段 2 后检查 `if (!A.ok) return A.error`。
- `Promise.all` 选择(非 allSettled):各降级项已在分支内部 catch(resolve),冒泡项失败 reject 整体——语义等价于串行版"中途抛错"。

## trace 一致性

- `buildTrace(assembled, compactionMsgs.length)` 输入完全相同(assembled 各字段值不变、compactionMsgs.length 不变)→ trace 逐字段一致。
- 验证方式:同一组输入,对比改动前后 `buildTrace` 输出快照。

## 不改的部分

- `prepareChatContext` 对外签名、返回结构(`PrepareContextResult`)不变。
- IRRequest 产出逻辑、max_tokens/temperature 等不动(那些在 route.ts 段B,本任务不碰)。
- 不给 searchWeb 新加 catch(那会改变对外行为,超出范围)。
