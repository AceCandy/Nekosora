# 贡献指南

感谢你对 **Nekusora(星枢)** 的关注!本文档说明如何参与本项目开发。

## 📋 行为准则

参与本项目即代表你同意遵守 [Code of Conduct](./CODE_OF_CONDUCT.md)。请保持友善、尊重。

## 🚀 快速开始

```bash
# 1. Fork 并 clone 仓库
git clone https://github.com/<your-name>/Nekosora.git
cd Nekosora

# 2. 安装依赖(推荐 pnpm)
pnpm install   # postinstall 会自动同步 pdfjs cmaps

# 3. 配置环境变量
cp .env.example .env.local
# 编辑 .env.local,填入数据库连接、auth secret 等

# 4. 初始化数据库(PostgreSQL,需先启动 PG 服务)
pnpm db:migrate:pg
pnpm seed

# 5. 启动开发服务器
pnpm dev
```

## 🏗️ 项目结构

```
src/
├── app/           Next.js App Router(路由层,薄)
├── features/      业务域切片(chat/admin/panel/providers/...)
├── shared/        跨域共享层(ui 原子组件、lib 工具、通用组件)
├── lib/           后端核心(routing/stream/usage/keys/infra/errors/i18n)
└── db/            Drizzle schema + 迁移
```

**边界约定**:
- `features/<domain>/` 自包含,域间禁止横向 import
- `shared/` 只放无业务语义的资产
- `app/` 是组装层,业务从 `@/features/*` 引入

详见 [`src/features/README.md`](./src/features/README.md) 和 [`src/shared/README.md`](./src/shared/README.md)。

## 🔄 开发工作流

1. **建分支**:`git checkout -b feat/<short-desc>` 或 `fix/<issue-id>`
2. **开发**:遵循现有代码风格(命名、注释密度、Tailwind 用法)
3. **自检**:
   ```bash
   pnpm typecheck   # tsc --noEmit
   pnpm lint        # eslint(若环境已配)
   ```
4. **提交**:用 [Conventional Commits](https://www.conventionalcommits.org/) 规范:
   - `feat: 新增指令卡选择器`
   - `fix(routing): 熔断器 half-open 状态未重置`
   - `refactor(chat): ChatComposer hooks 拆分`
   - `docs: 补充 PWA 配置说明`
   - `chore: 升级依赖`
5. **PR**:推送后发起 Pull Request,填写模板

## 🎨 设计约定

本项目遵循「星枢天流」设计语言,详见 [`AGENTS.md`](./AGENTS.md) 的 Design Context 段:
- 色彩:暮色微澜黑 + 星云纯白(冷调,禁用奶油/暖沙)
- 原则:克制、纯粹、静止状态无投影
- 严禁:侧边彩色粗条、Eyebrow 眉标等 AI 模板痕迹

## 🐛 报告问题

- Bug:用 [Bug Report 模板](https://github.com/AceCandy/Nekosora/issues/new?template=bug_report.md) 提 issue
- 新功能:用 [Feature Request 模板](https://github.com/AceCandy/Nekosora/issues/new?template=feature_request.md)
- 安全漏洞:见 [SECURITY.md](./SECURITY.md),**请勿在公开 issue 披露**

## 📝 许可

提交的代码将遵循项目的 [MIT License](./LICENSE)。
