# dsh-pet-android（社区补丁版）

把 [dsh-pet](https://www.npmjs.com/package/dsh-pet) 的桌宠放到安卓桌面上的**插件 + 壳 App** 组合。
本仓库是 **`dsh-pet-android` 的社区补丁分支**，修掉了原版在真机上「看得见、用不了」的三个问题。

> 上游：`dsh-pet`（MIT，© PC2005-cloud）· `dsh-pet-android` kit（MIT，© dsh-pet-android contributors）
> 本分支：MIT，保留上述版权声明。

## 修了什么

| # | 现象 | 根因 | 修法 |
|---|---|---|---|
| 1 | 点桌宠的输入框，**键盘死活弹不出来** | 壳（`com.dsh.petframe`）把悬浮窗建成了 `FLAG_NOT_FOCUSABLE`；壳里那个 `setInteractive()` 桥方法是**空实现** | 给壳打补丁：`setInteractive(true/false)` 临时切换窗口能否聚焦；页面在聊天弹窗打开/关闭时调用 |
| 2 | 打字了、点发送，**报「对话响应非法」** | 3080 代理用 `fetch`(undici) 转发 POST：要么缺 `duplex`，要么被上游掐连接；且 DSH 的压缩中间件在客户端声明 gzip/br 时会断连 | 代理改用 `node:http` 管道转发，并**统一强制 `accept-encoding: identity`** |
| 3 | 发出去了、**什么也看不到** | 回复靠头顶气泡展示，而气泡画在宠物头顶的透明余量区；壳的窗口只比宠物大一圈，气泡超出就被裁掉 | 安卓壳里回复**直接显示在聊天弹窗内**（不依赖气泡），可连续追问 |

附带：聊天弹窗加了「取消 / 粘贴 / 发送」三个按钮（中文输入法回车会被吃掉，光靠回车发不出去），并在打开时临时把窗口撑高，避免按钮被下边缘切掉。

## 安装

见 [INSTALL.md](./INSTALL.md)。一句话版：

```sh
dsh plugin --profile web add @flyinghouse-ma/dsh-pet-android
```

外加一个**打过补丁的壳 APK**（见 Release 附件）。插件和壳必须成对使用：只装插件不换壳，问题 1 依然存在。

## 已知限制

- 壳 APK 是**自签名**的，安装需要允许「未知来源」；与官方壳签名不同，**必须先卸载旧版**。
- 宠物贴在屏幕最上沿时，头顶气泡仍可能被屏幕边缘裁掉（物理空间不够）。这也是为什么回复改成在弹窗里显示。
- 只支持 Android（壳依赖 `TYPE_APPLICATION_OVERLAY`）。
- 壳只连 `127.0.0.1`，不向外发任何数据。

## 目录

```
src/                 插件本体（路由 + 桌面渲染器页面）
scripts/pet-proxy.mjs 3080→38019 转发（修复 2 就在这里）
patches/             壳 APK 的 smali 补丁说明与复现步骤
docs/                排障手册
apk/                 正式签名 APK 输出位置（不进 npm 包）
```

## 许可证

MIT。必须在再分发时保留上游与本分支的版权声明。