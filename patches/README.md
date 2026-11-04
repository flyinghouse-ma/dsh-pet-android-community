# 壳 APK 补丁说明

壳 App（`com.dsh.petframe`，约 250 KB）是预编译 APK，仓库里**不含其源码**。本目录记录我们改了什么，以及怎么复现。

## 改了什么

只动一个方法：`OverlayService$PetHost.setInteractive(Z)V`。

上游把它留成了空实现：

```smali
.method public setInteractive(Z)V
    .registers 2
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    return-void
.end method
```

但我们改成了「切换窗口能否获得焦点」，并通过新类 `OverlayService$PetHost$Flags`（`Runnable`，跑在 UI 线程）执行：

```smali
# 开：去掉 FLAG_NOT_FOCUSABLE(0x8)，补 FLAG_NOT_TOUCH_MODAL(0x20)
const/16 v1, 0x220
iput v1, v0, Landroid/view/WindowManager$LayoutParams;->flags:I
const/16 v1, 0x10            # SOFT_INPUT_ADJUST_RESIZE
iput v1, v0, Landroid/view/WindowManager$LayoutParams;->softInputMode:I

# 关：恢复原样
const/16 v1, 0x208           # LAYOUT_NO_LIMITS | NOT_FOCUSABLE
```

更新窗口靠 `WindowManager.updateViewLayout(root, params)`，用上游自带的 `runOnUi(Runnable)`（`access$300`）投递。

> `0x20` 不是可选项。窗口一旦可聚焦却仍拦截窗口外的触摸，整块屏幕都会被它吃掉；`NOT_TOUCH_MODAL` 保证窗口外的点击照常交给桌面/其他 App。

## 复现步骤

```sh
# 1. 取壳 APK，解出 dex
python3 -c "import zipfile;z=zipfile.ZipFile('dsh-petframe.apk');open('classes.dex','wb').write(z.read('classes.dex'))"

# 2. 反编译（需要 JDK + smali 工具链，见 scripts/）
java -cp baksmali.jar:dexlib2.jar:util.jar:guava.jar:jcommander.jar org.jf.baksmali.Main d classes.dex -o smali_out

# 3. 改 OverlayService$PetHost.smali 的 setInteractive，并新增 OverlayService$PetHost$Flags.smali
#    （完整文本见本目录 flags-runner.smali.txt）

# 4. 回编译
java -cp smali.jar:dexlib2.jar:util.jar:guava.jar:jcommander.jar:antlr-runtime.jar org.jf.smali.Main a smali_out -o classes.dex

# 5. 替换原 APK 里的 classes.dex，删掉旧签名，重新签名
#    见 scripts/sign.sh
```

## 注意

- **签名必须自己生成并长期保存**。换签名 = 用户必须卸载重装，等于每次升级都丢一次悬浮窗授权。
- 上游壳升级后，这个补丁要重新打一遍（和 `src/` 下的页面补丁一样）。
- 只改窗口标志，不动 WebView 加载逻辑；壳仍然只连 `127.0.0.1`。