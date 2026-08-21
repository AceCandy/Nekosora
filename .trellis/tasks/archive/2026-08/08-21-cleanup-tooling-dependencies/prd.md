# 清理工程脚本依赖与死代码

## Goal

修复 actionlint 可移植性并删除确认无用的依赖和内部代码

## Requirements

- actionlint 脚本支持 Linux/macOS 的 x86_64/arm64，并继续使用固定版本与固定 SHA-256 校验。
- 校验工具兼容 `sha256sum` 与 macOS `shasum -a 256`。
- 删除源码无直接引用且不是必须 direct peer 的 Web 依赖：`@radix-ui/react-slot`、`class-variance-authority`、`tailwind-merge`、`react-markdown`、`remark-gfm`。
- 保留 `shiki@3.23.0`，遵守 `@streamdown/code` 在 Next.js 下的项目根直接依赖约定。
- 保留 `@langchain/core`，因为 `mem0ai` 将其声明为 peer dependency。
- 删除未通过 package exports 暴露且全仓无调用的内部函数；不提取只有少量净收益的共享 helper。
- 不修改相邻代码格式和无关依赖版本。

## Acceptance Criteria

- [x] actionlint 在四个目标 OS/架构组合选择正确归档与固定哈希，未知平台明确失败。
- [x] actionlint 脚本测试覆盖平台选择、哈希失败和校验工具分支。
- [x] 五个无用 direct dependencies 从 manifest/lockfile 移除，`shiki@3.23.0` 继续作为 Web 直接依赖。
- [x] `resolveReasoningLevel`、`resetBreaker`、`countKeys`、`hasArtifacts` 等确认无调用函数被删除且无类型错误。
- [x] workspace policy、相关脚本测试、Core/Web lint 与 typecheck 通过。

## Notes

- 逐字重复的 `rowsOf` 暂不抽共享模块；新增抽象的维护成本高于约 7 行净收益。
- `@streamdown/code@1.1.1` 虽声明 `shiki` 依赖，但项目规范记录 Next.js 外部化从应用根解析的兼容性要求，因此不删除 Web 的直接 `shiki`。
