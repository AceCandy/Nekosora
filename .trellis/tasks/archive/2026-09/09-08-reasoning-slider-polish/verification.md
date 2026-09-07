# 验证记录

- 全仓 pnpm lint、pnpm typecheck、pnpm test 通过；保留原有 12 条 Core lint warning 与既有跳过测试。
- 新增填充端点与 off 状态回归后，ChatToolbar 5 项测试通过。
- Chromium 中使用真实 ModelControlMenu 与局部 CSS 的临时测试页验收，未登录或访问真实业务配置。
- 320/390/768/1280px 无横向溢出，操作区 44px，首尾圆点与填充端点对齐。
- 实际鼠标从首档拖至末档得到索引 6；方向键、Home/End 正常，focus-visible 有 2px 蓝色轮廓。
- 双档模型 max=1；固定推理显示 Always on 且无滑杆，无推理模型隐藏滑杆。
- reduced-motion 与 off 的伪元素 animationName 均为 none。
- 桌面和窄屏截图复核通过，滑块描边从 2px 调整为 1px；重新审查最终 diff，无能力目录或持久化逻辑变化。
- 未验证生产构建、真实登录会话联动、Firefox/Safari 与真机触控；原生交互逻辑保持原样，剩余风险主要为跨浏览器视觉差异。
- 临时预览页已删除，浏览器与本次重启的开发服务在归档前关闭。
- 临时页初始设为展开，触发既有 Portal 的 SSR hydration 提示；真实模型菜单仍由用户点击后展开，本次未修改 Popover。预览页为测试夹具，已删除，不进入提交。
