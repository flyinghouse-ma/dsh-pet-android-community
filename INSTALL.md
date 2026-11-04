# 安装说明

## 0. 前置条件

- 一台安卓手机（Android 11+，需要「显示在其他应用上层」权限）
- DSH（`dsh web`）能正常打开
- 已安装上游桌宠本体：`dsh-pet`（≥ 0.3.7）
- 允许安装自签名 APK

> **顺序很重要**：先装插件，再起代理，最后装壳。壳每 2 秒轮询一次配置，前面不通它会一直空窗。

## 1. 安装插件

```sh
dsh plugin --profile web add @flyinghouse-ma/dsh-pet-android
```

如果你用的不是 npm 源，也可以直接从 GitHub 装：

```sh
dsh plugin --profile web add github:flyinghouse-ma/dsh-pet-android-community
```

## 2. 起 3080 转发（**必做**）

壳 App 里写死了 `http://127.0.0.1:3080`，而 DSH 的 Web 服务实际在 38019。必须有一个转发：

```sh
nohup node <插件目录>/scripts/pet-proxy.mjs > /tmp/pet-proxy.log 2>&1 &
```

验证：

```sh
curl -s http://127.0.0.1:3080/dsh-pet-7340/config | head -c 80
# 期望看到 JSON（含 "display"），不是 502
```

> 注意：这个代理**强制 `accept-encoding: identity`**。别顺手改回 gzip/br —— DSH 的压缩中间件会在稍长的响应上把连接掐断，表现就是「聊天点了发送没反应」。

## 3. 安装壳 APK

1. **先卸载**旧版「DSHA肥鱼窗」（签名不同，不卸载装不上；卸载会清掉原来的开机自启设置）
2. 安装 Release 里的 `dsh-petframe-<版本>.apk`
3. 打开 App → **授予悬浮窗权限**
4. 桌面上应该出现桌宠

## 4. 重启 DSH

插件是服务端模块，改完必须重启才生效：

```sh
# 在你启动 dsh web 的地方重启即可
```

## 5. 验证

1. 点桌宠 → 出现输入框，**键盘应该弹出**
2. 打字 → 点「发送」→ 回复**直接显示在弹窗里**
3. 不想聊了 → 点「取消」

## 排障

先看 [docs/troubleshooting.md](./docs/troubleshooting.md)，里面按症状列了这次的三个坑。

常见三连：

```sh
# 代理活着吗
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3080/dsh-pet-7340/config
# 宠物状态正常吗
curl -s http://127.0.0.1:38019/dsh-pet-7340/state | head -c 200
# 壳的窗口是不是还会抢焦点
adb shell dumpsys window windows | grep -A3 com.dsh.petframe
```