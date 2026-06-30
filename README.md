# Tab

一个面向 Chrome / Edge 的高性能新标签页扩展。

Tab 的目标不是做一个臃肿的浏览器首页，而是做一个打开就很快、壁纸展示丝滑、搜索和快捷入口顺手、同时又足够可自定义的新标签页。

## 现在能做什么

- 替换 Chrome / Edge 的新标签页。
- 支持 Bing 每日壁纸。
- 支持本地上传多张壁纸。
- 壁纸会缓存到本地，打开新标签页时优先显示本地预览，减少白屏和闪烁。
- 支持壁纸轮换，并且在至少 3 张壁纸参与轮换时，任意连续 3 次不会重复。
- 支持单张壁纸设置：填充方式、位置、叠层、模糊、变暗、亮度。
- 支持搜索框，内置 Google、Bing、Baidu、DuckDuckGo、GitHub、YouTube、Bilibili 等搜索引擎。
- 支持自定义搜索 URL 模板，例如 `https://www.google.com/search?q={query}`。
- 支持快捷方式的添加、编辑、删除、分组和拖拽排序。
- 支持数字键快速打开快捷方式。
- 支持主题、强调色、图标透明度、面板透明度、搜索框位置、快捷方式密度等外观设置。
- 支持设置导入/导出，并可携带壁纸备份数据。

## 设计原则

这个项目参考了 PlainTab 的方向：新标签页应该轻、快、安静。

所以项目有几条硬规则：

- 打开新标签页时优先显示壁纸和搜索框。
- 不在启动路径里加载重功能。
- 不使用远程字体。
- 不默认启用视频、WebGL、动态背景等高 CPU / 高内存功能。
- 用户数据默认保存在本地。
- 网络权限尽量少，目前只为 Bing 壁纸声明了 `https://www.bing.com/*`。

## 安装使用

### 方式一：直接加载本地扩展

适合当前开发和试用。

1. 打开 `chrome://extensions` 或 `edge://extensions`。
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择项目里的 `extension` 文件夹。
5. 打开一个新标签页。

### 方式二：使用打包文件

先生成 zip：

```powershell
npm.cmd run package:edge
```

打包文件会生成在：

```text
release\tab-edge-extension.zip
```

注意：浏览器的“加载已解压扩展”需要选择解压后的文件夹，不是直接选择 zip 文件。

## 开发

安装依赖：

```powershell
npm.cmd install
```

启动 Vite 预览：

```powershell
npm.cmd run dev
```

构建：

```powershell
npm.cmd run build
```

## 项目结构

```text
extension/   可直接加载到 Chrome / Edge 的扩展文件
src/         Svelte + TypeScript 源码
public/      Vite 构建时使用的扩展静态文件
scripts/     自动化验证、打包和 smoke 测试脚本
release/     本地打包输出目录，不提交到 Git
```

## 验证命令

基础检查：

```powershell
npm.cmd run check
npm.cmd run build
npm.cmd run verify:extension
```

完整 Edge 验证：

```powershell
npm.cmd run smoke:edge
```

Chrome 关键验证：

```powershell
$env:SMOKE_BROWSER='chrome'; node scripts\smoke-functional.mjs
$env:SMOKE_BROWSER='chrome'; node scripts\smoke-first-frame.mjs
$env:SMOKE_BROWSER='chrome'; node scripts\smoke-performance.mjs
$env:SMOKE_BROWSER='chrome'; node scripts\smoke-rotation-memory.mjs
```

这些验证会覆盖：

- 扩展 Manifest V3 配置。
- 新标签页基础渲染。
- 设置面板和常用交互。
- 壁纸上传、切换、轮换。
- “更多”单张壁纸设置弹窗。
- 首帧白屏检查。
- 启动性能检查。
- 60 次壁纸轮换后的内存和对象 URL 释放情况。

## 性能约束

新标签页是高频入口，所以项目有严格性能预算：

- 默认启动路径不能引入视频解码、WebGL 渲染循环、远程字体、大型 UI 库或常驻动画循环。
- 首帧不能出现明显白屏。
- 本地缓存预览必须优先于完整大图显示。
- 重功能必须默认关闭，用户主动启用后才加载。
- 后续新增功能必须通过现有 smoke 测试，必要时补充新的测试。

## 手动检查清单

加载 `extension` 文件夹后，建议手动确认：

1. 打开新标签页，搜索框和背景应立即出现，没有明显白光闪烁。
2. `/` 和 `Ctrl+K` 可以聚焦搜索框。
3. 普通搜索和网址直达都能正常打开。
4. 上传本地壁纸后，重新打开新标签页仍能快速显示缓存预览。
5. 获取 Bing 每日壁纸后，壁纸能缓存并显示来源信息。
6. 添加、编辑、删除、拖拽排序快捷方式正常。
7. 数字键可以打开前几个快捷方式。
8. 修改主题、搜索位置、快捷方式密度、壁纸模糊/变暗/亮度等设置后能立即生效。
9. 点击壁纸旁边的“更多”，弹出的是单张壁纸设置，不会撑开或改变壁纸列表布局。
10. 至少选择 3 张壁纸参与轮换，多次点击“下一张”不应在任意连续 3 次内重复。
11. 导出设置再导入，快捷方式、视觉设置和壁纸备份应能恢复。

## 当前状态

当前版本是 v0.1 基础版，重点是：

- 新标签页替换。
- 搜索。
- 快捷方式。
- Bing / 本地壁纸。
- 壁纸缓存和丝滑启动。
- 壁纸轮换。
- 基础自定义。
- 自动化性能和稳定性验证。

后续建议先做产品体验打磨，再逐步增加在线图片 URL、壁纸包、本地视频背景、动态背景等能力。视频和动态背景这类重功能必须默认关闭，并且不能进入新标签页启动路径。

## 说明

这是一个个人开发中的新标签页扩展项目。当前更适合作为本地使用和继续开发的基础版本，还不是正式商店发布版本。
