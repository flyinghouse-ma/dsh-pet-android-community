# 排障手册（都是真机上踩出来的）

## 症状 1：点输入框，键盘不出来

**判断**：`dumpsys window windows | grep -A3 com.dsh.petframe`，看窗口属性里有没有 `fl=NOT_FOCUSABLE`。

```
fl=NOT_FOCUSABLE LAYOUT_NO_LIMITS    ← 有问题：不可聚焦
fl=LAYOUT_NO_LIMITS NOT_TOUCH_MODAL  ← 正常：可聚焦
```

**原因**：壳把窗口建成了不可聚焦，`setInteractive()` 又是空实现。
**修法**：换用打过补丁的壳（见 `patches/`），并确认页面在弹窗打开时调用了 `AndroidPetHost.setInteractive(true)`。

> `NOT_FOCUSABLE` 与输入法的关系：输入法只服务「有焦点」的窗口。窗口不可聚焦时，WebView 里 `<textarea>` 能拿到光标，但系统永远不会弹键盘。

## 症状 2：点发送，报「对话响应非法」

**判断**：直接打 3080 看返回：

```sh
curl -s -X POST 'http://127.0.0.1:3080/dsh-pet-7340/chat?pet=main&surface=desktop' \
  -H 'content-type: application/json' -d '{"text":"ping"}' -w '\n%{http_code}\n'
```

- 返回 `pet-proxy: RequestInit: duplex option is required` → 代理用 `fetch` 转流式 body
- 返回 `pet-proxy: other side closed` → 代理连上游被掐断
- 返回 **502 纯文本** → 前端 `res.json()` 失败，于是报「对话响应非法」

**原因 1**：代理用 `fetch`(undici) 转发 POST。换 `node:http` 的 `request` + 管道即可。
**原因 2**：DSH 的压缩中间件在客户端声明 `accept-encoding: gzip/br` 时，会在稍长的响应上断连。实测：

```sh
# 直连 38019，各 30 秒超时
curl --compressed ...      → 000（20s 后连接被重置）
curl 不带 accept-encoding  → 200（6s 正常）
```

**修法**：代理统一 `headers['accept-encoding'] = 'identity'`。

## 症状 3：发出去了，但什么也看不到

**判断**：查状态里有没有新回复：

```sh
curl -s http://127.0.0.1:38019/dsh-pet-7340/state | python3 -c \
  "import json,sys;d=json.load(sys.stdin);print(d['pets']['main']['say'])"
```

有 `say.counter` / `say.data.text` → 回复生成了，问题在展示。

**原因**：回复靠头顶气泡展示，气泡画在宠物头顶的透明余量区，而壳的窗口尺寸 = 宠物 + 一圈余量。
宠物贴屏幕边缘时，气泡出窗即被裁。

**修法**：安卓壳里把回复直接渲染进聊天弹窗（`shared-core.js` 的 `mountChatDialog`）。

## 症状 4：按钮被窗口下边缘切掉一半

**原因**：窗口高度由宠物尺寸决定，弹窗比窗口高就被裁。
**修法**：打开弹窗时临时 `margin.b += 150` 再 `sendBounds()`，关闭时还原（`sprite.js` 的 `showChatFromMenu`）。

## 通用：先确认三层都活着

```sh
curl -s -o /dev/null -w '3080 %{http_code}\n' http://127.0.0.1:3080/dsh-pet-7340/config   # 代理
curl -s -o /dev/null -w '38019 %{http_code}\n' http://127.0.0.1:38019/dsh-pet-7340/config  # DSH
adb shell dumpsys window windows | grep -A3 com.dsh.petframe                                # 壳窗口
```
