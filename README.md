# 孤棋 · GU QI

[![Deploy GitHub Pages](https://github.com/Ouheeeee/guqi/actions/workflows/pages.yml/badge.svg)](https://github.com/Ouheeeee/guqi/actions/workflows/pages.yml)
[![Live site](https://img.shields.io/badge/live-GitHub%20Pages-171614)](https://ouheeeee.github.io/guqi/)

一款支持**同屏双人**、**在线联机**和**账户棋谱**的极简连线围棋变体。支持三种先手贴目、系统预设布局双确认和最多 6 场同屏对局；不登录也能玩，登录后可保存对局、继续棋局和回看联机棋谱。

![孤棋界面预览](./preview.jpg)

## 在线访问

- **联机对战：<https://ouheeeee.github.io/guqi/online.html>**
- **账户与棋谱：<https://ouheeeee.github.io/guqi/account.html>**
- **同屏对战：<https://ouheeeee.github.io/guqi/>**
- **GitHub 仓库：<https://github.com/Ouheeeee/guqi>**

网站内容公开展示，请勿将私人信息放入对局页面。

## 联机对战

联机模式使用 **Cloudflare Workers + D1** 作为服务端，前端仍然部署在 GitHub Pages：

- 创建房间或输入 6 位房间码加入，匿名邀请制，无需注册
- 服务端生成预设布局；双方会看到同一盘布局
- 双方都可以选择“同意采用”或“不同意”，对方的表态实时可见
- **只有双方都同意后，服务端才会开始对局**；房主执黑先行
- 落子由服务端校验轮次、空格和棋局状态
- 悔棋、局中贴目调整都需要对方同意
- 立即结算由一方发起、另一方同意后生效，按当前孤棋数结算
- 认输由服务端立即结算
- 刷新页面可通过本机房间 token 恢复房间；房间状态保留约 7 天
- 服务端只保存 token 的 SHA-256 哈希，不保存明文 token

联机 API（Pages Functions 反代）：<https://guqi-online-api.pages.dev>

> 联机 API 的上游 Worker 位于 `workers.dev`，部分网络无法直接访问，因此通过可访问的 `pages.dev` 反向代理暴露 API；玩家只需要访问 GitHub Pages 页面。

## 账户与棋谱

账户是**可选**的。不登录仍然可以同屏对局或输入房间码联机；登录只增加云端能力。

- **邮箱 + 密码注册/登录**，昵称可自定义，无需邮箱验证邮件
- **云端存档**：同屏模式下登录后出现「保存对局」，可反复更新；账户页可继续对局
- **联机棋谱**：登录状态下结束的联机对局会自动保存棋谱；账户页可查看落子列表和终局结果
- **离线仍可用**：不登录也能完整使用同屏和匿名联机
- 进行中的联机房间仍通过本机浏览器中的房间身份恢复；已结束对局可保存为云端棋谱
- 密码使用 PBKDF2-SHA256（100,000 次迭代）+ 服务端 pepper 存储；会话 token 在 D1 中只存 SHA-256 哈希
- 登录 token 保存在当前浏览器的 localStorage 中，不进入 URL，也不会被写入仓库

当前限制：

- 不发送邮箱验证邮件，也不支持忘记密码自助找回；请自行保管密码
- 微信 / QQ 登录需要开发者应用资质和应用密钥，本版本暂未接入
- 登录后保存的是同屏模式的云端存档；联机进行中的对局需要同一浏览器中的房间身份

### 账户 API

账户接口和联机房间共用 `https://guqi-online-api.pages.dev`：

- `POST /api/auth/register`、`POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/auth/me`
- `GET/POST /api/games`、`GET/DELETE /api/games/:id`
- `POST /api/games/online`（用房间身份把已结束联机对局保存为棋谱）

## 功能

- **三种判定规则**：先手贴 0.5 间、1 间或 1.5 间，可随时切换。
- **立即结算**：同屏模式按当前孤棋数直接判定；联机模式需要对方同意，避免单方面结束对局。
- **贴目结算**：终局比较「黑方原始间数 + 先手贴目」与「白方原始间数」，少者获胜；原始间数相同或贴目后同数，均由后手白方获胜。
- **多场并行**：最多同时保留 6 场对局，可随时搁置当前对局、切换或开启新对局。
- **独立设置**：每场对局独立保存棋盘尺寸、贴目规则、落子历史与结果。
- **完整操作**：开始对局、重新生成布局、悔棋、立即结算、认输、关闭本场。
- **账户能力**：登录后可保存/继续同屏对局，联机终局自动保存棋谱；不登录则保持离线模式。
- **实时孤棋数**：默认开启，可隐藏；每场对局分别计算。
- **双端适配**：桌面和手机均可用，支持触控与键盘方向键落子。

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
npm test          # 规则单元测试
npm run test:online   # 联机 API 冒烟测试（会创建真实房间）
npm run test:account  # 账户/云存档 API 冒烟测试（会创建测试账户）
```

测试覆盖：

- 13 路 / 15 路预设布局的中心对称、四象限分布、切比雪夫距离、中心 3×3 为空、最外层有子且不过度贴边；
- 联机 API：创建/加入房间、双方投票、服务端落子、悔棋审批、贴目审批、立即结算审批、认输与断线恢复；
- 账户 API：注册、登录、会话校验、存档新建/更新/读取/删除、联机终局棋谱保存；
- 横竖连通块计数与斜角不连通；
- 三种先手贴目规则、原始同数与贴目同数的裁定；
- 每场对局独立保存贴目，终局后切换规则可重新裁定；
- 25 手连续落子与悔棋还原；
- 认输、棋盘填满结算；
- 非法尺寸与非法贴目防御。

## 规则

1. 13×13 双方各 6 枚预设子；15×15 双方各 7 枚预设子。
2. 预设布局每局随机生成：黑白中心对称、四象限双方均有子、任意两子切比雪夫距离 ≥ 2、中心 3×3 为空；最外层至少有一枚预设子，并会在多组候选中择优，让棋子分布更均匀、避免全部向边缘集中或同色扎堆。
3. 黑方先行，双方轮流在空格落子。
4. 横竖相邻的同色棋组成一个连通块，每个连通块计 **1 间**；斜角不算。
5. 终局按「黑方原始间数 + 先手贴目」与「白方原始间数」比较，少者获胜。
6. 先手贴目可选 0.5 / 1 / 1.5 间，可随时切换，只影响终局结算。
7. 原始间数相同，或贴目后同数，均由后手白方获胜。
8. 当前行棋方可以认输。悔棋支持撤销本场全部落子记录。

## 交互说明

- **对局栏**：顶部显示全部进行中的对局，点击切换；每场标签带 **×** 关闭按钮，二次点击确认；状态包括待开始、进行中、已结束。
- **新开局**：保留当前对局，按当前棋盘尺寸和贴目规则开启一场新对局并立即开始。
- **重新生成开局**：只更换当前对局的预设布局，不开始对局。
- **开始对局**：预设布局确定后开始，黑方先行。
- **悔棋**：撤销当前对局上一手，并实时重算间数；终局后也可悔棋复盘。
- **立即结算**：按当前孤棋数判定胜负；同屏模式直接结算，联机模式由一方请求、另一方同意后结算。
- **认输**：当前行棋方认输，对方立即获胜。
- **关闭对局**：连续点击顶部对局标签上的 **×** 两次确认关闭对应场次；关闭最后一场时会自动新建一场布局，最多同时保留 6 场。
- **棋盘 / 贴目**：分别切换当前对局的棋盘尺寸与先手贴目规则，棋盘切换会重置本场布局。
- **实时孤棋数**：默认开启；关闭后隐藏双方原始间数，但不影响贴目后的结算。
- **保存对局**：登录后在同屏操作区点击「保存对局」，可保存到云端并在账户页继续。
- **联机棋谱**：登录状态下结束联机对局会自动保存；账户页可查看每手棋谱。

## 部署

站点产物位于 `site/`，可直接部署到任意静态托管平台。

### GitHub Pages（自动部署）

仓库已配置 [`.github/workflows/pages.yml`](.github/workflows/pages.yml)：推送到 `main` 分支后，GitHub Actions 会自动把 `site/` 发布到 GitHub Pages。

线上地址：<https://ouheeeee.github.io/guqi/>

联机页面：<https://ouheeeee.github.io/guqi/online.html>

### Cloudflare 联机后端

后端代码在 `online/worker/`，公开 API 反代在 `online/pages/functions/`。首次部署或修改 Worker 后执行：

```bash
cd online/worker
npx wrangler d1 execute guqi-online --remote --file=schema.sql
npx wrangler secret put AUTH_PEPPER   # 至少 32 字符的随机值；现有部署已设置，不要随意更换
npx wrangler deploy

cd ../pages
npx wrangler pages deploy public --project-name guqi-online-api --branch main
```

Cloudflare 账号和 D1 数据库已经配置好；密钥、OAuth token 不进入仓库。

> `AUTH_PEPPER` 是密码哈希的服务端密钥，不是临时登录 token。请把它保留在 Cloudflare secret 中；更换它会导致已有账户无法登录。

#### 一次性发布凭据

仓库不保存长期部署凭据。每次需要发布时：

1. 发起一次 GitHub Device Authorization，由账号持有人在浏览器输入一次性验证码；
2. 将本次获得的一次性 token 仅通过环境变量传给发布脚本；
3. 发布进程退出后不保留 token，撤销本次授权；
4. 下次修改重新授权。

```bash
GITHUB_TOKEN=<本次一次性 token> node scripts/deploy.mjs "更新说明"
```

脚本会自动提交当前改动 → 推送到 `main` → 触发 GitHub Pages 部署。它不会读取任何本地 token 文件。

> Cloudflare 后端变更同理：使用 `wrangler login --device` 完成一次性授权，部署后执行 `wrangler logout` 并清理本地配置。

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
  index.html          # 同屏对战
  online.html         # 联机大厅与房间
  styles.css
  online.css
  game.js             # 规则引擎、贴目与随机布局生成
  app.js              # 同屏多场对局
  online.js           # 联机客户端
  account.html        # 账户与云端存档
  account.css
  account.js
  auth-client.js      # 账户 API / 本地 session
online/worker/        # Cloudflare Worker + D1 权威后端
online/pages/         # pages.dev API 反向代理
tests/game.test.mjs   # Node 规则测试
tests/account-api-smoke.mjs
scripts/build-single.mjs
scripts/deploy.mjs    # GitHub API 发布脚本
.github/workflows/    # GitHub Pages 自动部署
```

## 技术栈

- 原生 HTML / CSS / JavaScript（ES Modules）
- 无构建步骤、无第三方运行时依赖
- CSS Grid 棋盘、响应式布局、键盘方向键与对局切换
- 可访问的结果模态框（焦点陷阱、Escape 关闭、背景 inert）
- 邮箱账户、PBKDF2 + pepper 密码哈希、SHA-256 会话哈希、D1 云存档
