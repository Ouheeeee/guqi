# 孤棋 · GU QI

[![Deploy GitHub Pages](https://github.com/Ouheeeee/guqi/actions/workflows/pages.yml/badge.svg)](https://github.com/Ouheeeee/guqi/actions/workflows/pages.yml)
[![Live site](https://img.shields.io/badge/live-GitHub%20Pages-171614)](https://ouheeeee.github.io/guqi/)

一款双人同屏的极简连线围棋变体。纯前端实现，不需要后端、登录或数据库。

![孤棋界面预览](./preview.jpg)

## 在线访问

- **GitHub Pages：<https://ouheeeee.github.io/guqi/>**
- **GitHub 仓库：<https://github.com/Ouheeeee/guqi>**
- 备用镜像：<https://808ec2a9.ht-ml.app/>

网站内容公开展示，请勿将私人信息放入对局页面。

## 本地运行

```bash
npm run serve
# 打开 http://localhost:4173
```

或使用任意静态文件服务器：

```bash
npx serve site
```

## 测试

```bash
npm test
```

测试覆盖：

- 13 路 / 15 路预设布局的中心对称、四象限分布、切比雪夫距离、中心 3×3 为空；
- 横竖连通块计数与斜角不连通；
- 25 手连续落子与悔棋还原；
- 认输、棋盘填满结算、同数白胜；
- 非法尺寸防御。

## 规则

1. 13×13 双方各 6 枚预设子；15×15 双方各 7 枚预设子。
2. 预设布局每局随机生成：黑白中心对称、四象限双方均有子、任意两子切比雪夫距离 ≥ 2、中心 3×3 为空。
3. 黑方先行，双方轮流在空格落子。
4. 横竖相邻的同色棋组成一个连通块，每个连通块计 **1 间**；斜角不算。
5. 棋盘填满后，孤棋数少者胜；双方同数时，后手白方获胜。
6. 当前行棋方可以认输。悔棋支持撤销全部落子记录。

## 交互说明

- **开始对局**：在预设布局确定后开始，黑方先行。
- **新开局**：重新生成预设布局并立即开始新对局。
- **重新生成开局**：只更换预设布局，回到布局阶段，等待再次开始。
- **悔棋**：撤销上一手，并实时重算双方间数；终局后也可悔棋复盘。
- **认输**：当前行棋方认输，对方立即获胜。
- **切换棋盘**：13×13 / 15×15 自动重置到布局阶段。
- **实时孤棋数**：默认开启；关闭后隐藏双方间数，但不影响结算。

## 部署

站点产物位于 `site/`，可直接部署到任意静态托管平台。

### GitHub Pages（自动部署）

仓库已配置 [`.github/workflows/pages.yml`](.github/workflows/pages.yml)：推送到 `main` 分支后，GitHub Actions 会自动把 `site/` 发布到 GitHub Pages。

线上地址：<https://ouheeeee.github.io/guqi/>

### 单文件构建

```bash
npm run build:single
# 生成 dist/guqi-standalone.html
```

该文件内联全部 CSS、JavaScript 与 favicon，可直接上传到只接受单页 HTML 的托管服务。

### Vercel

```bash
npx vercel ./site --prod
```

### Netlify

将 `site/` 目录拖入 Netlify Drop，或执行：

```bash
npx netlify deploy --dir=site --prod
```

### ShipStatic

```bash
npx @shipstatic/ship ./site
```

## 项目结构

```text
site/                 # 可直接部署的静态站点
  index.html
  styles.css
  game.js             # 规则引擎与随机布局生成
  app.js              # 交互与渲染
tests/game.test.mjs   # Node 规则测试
scripts/build-single.mjs
.github/workflows/    # GitHub Pages 自动部署
```

## 技术栈

- 原生 HTML / CSS / JavaScript（ES Modules）
- 无构建步骤、无第三方运行时依赖
- CSS Grid 棋盘、响应式布局、键盘方向键导航
- 可访问的结果模态框（焦点陷阱、Escape 关闭、背景 inert）
