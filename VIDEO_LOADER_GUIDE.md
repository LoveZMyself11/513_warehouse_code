# 视频加载动画完整方案

## 📋 工作流程

### 步骤1：生成视频动画

#### 推荐平台选择

| 平台 | 优点 | 缺点 | 价格 |
|------|------|------|------|
| **Runway Gen-3** | 效果最好，细节精准 | 需要海外账号 | $12/月 |
| **Pika Labs** | 速度快，效果好 | 需要Discord | $10/月 |
| **即梦 AI** | 国内平台，中文友好 | 效果略逊 | ¥29/月 |
| **可灵 AI** | 快手出品，质量不错 | 生成速度慢 | 免费额度 |

#### 视频参数设置

```yaml
分辨率: 1080x1080 (移动端最佳)
帧率: 30 FPS
时长: 3-4 秒
格式: MP4 (H.264)
背景: 纯白 #FFFFFF
循环: 开启
文件大小目标: < 2MB
```

#### Prompt（复制使用）

**英文版（Runway/Pika）：**
```
A minimalist line art animation of a Chinese university emblem logo on white background.

The logo features:
- Concentric double circles (outer rings)
- Inner blue arc forming letter "D" 
- Stylized blue swoosh lines
- Chinese and English text around the border

Animation style: 
- Smooth stroke-based drawing reveal, each element appears sequentially
- Starting from outer circles, then inner arc, then center details
- Clean vector line art aesthetic
- Color: #0066CC blue strokes on white
- Similar to Apple product reveal animations
- Elegant, professional, corporate identity animation

Camera: static, centered
Mood: clean, modern, institutional
Duration: 3-4 seconds loop
```

**中文版（即梦/可灵）：**
```
在纯白背景上，一个大学院徽标志的线条绘制动画。

院徽元素包含：
- 最外层的同心双圆环
- 内部蓝色弧形组成字母"D"
- 蓝色流线型装饰
- 圆环边缘的中英文字

动画风格：
- 简洁的矢量线稿逐步描绘呈现
- 绘制顺序：外圈→内弧→中心细节
- 清晰的矢量线条美学
- 颜色：#0066CC蓝色线条
- 类似苹果产品发布会的logo揭示动画
- 优雅、专业、企业VI动画

镜头：静止，居中构图
氛围：简洁、现代、学院风
时长：3-4秒循环
```

---

### 步骤2：优化视频文件

生成后下载视频，然后优化：

#### 方法A：在线压缩（推荐）
访问 https://www.freeconvert.com/video-compressor
- 上传视频
- 目标大小：1-2MB
- 保持分辨率：1080x1080
- 下载优化后的文件

#### 方法B：使用 FFmpeg（本地）
```bash
# 压缩视频
ffmpeg -i input.mp4 -vcodec libx264 -crf 28 -preset slow -vf scale=1080:1080 logo-animation.mp4

# 如果文件还是太大，再压缩
ffmpeg -i logo-animation.mp4 -vcodec libx264 -crf 32 logo-animation-compressed.mp4
```

---

### 步骤3：集成到项目

#### 1. 放置视频文件

将生成的视频重命名为 `logo-animation.mp4`，放到：

```
514base_hub/
├── public/
│   └── assets/
│       ├── logo-animation.mp4  ← 视频文件
│       └── logo-static.png     ← 降级静态图（可选）
```

如果没有 `public/assets` 目录，创建它：
```bash
mkdir -p public/assets
```

#### 2. 使用组件

在你的 App 中导入：

```tsx
import { useState, useEffect } from 'react';
import VideoLogoLoader from './components/VideoLogoLoader';

function App() {
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // 模拟加载数据
    const loadData = async () => {
      // 这里放你的实际数据加载逻辑
      await fetchInventoryData();
      setIsLoading(false);
    };

    loadData();
  }, []);

  return (
    <>
      {/* 加载动画 */}
      {isLoading && (
        <VideoLogoLoader
          videoUrl="/assets/logo-animation.mp4"
          text="正在加载"
          onLoadComplete={() => setIsLoading(false)}
          minDuration={2000}
        />
      )}

      {/* 主内容 */}
      {!isLoading && (
        <div className="main-app">
          {/* 你的仓库管理界面 */}
        </div>
      )}
    </>
  );
}

export default App;
```

#### 3. 组件 Props 说明

```tsx
interface VideoLogoLoaderProps {
  videoUrl?: string;         // 视频路径，默认 '/assets/logo-animation.mp4'
  text?: string;             // 加载文字，默认 '加载中...'
  onLoadComplete?: () => void; // 加载完成回调
  minDuration?: number;      // 最小显示时长（毫秒），默认 2000
}
```

---

## 🎯 使用场景示例

### 场景1：首次进入应用

```tsx
function App() {
  const [firstLoad, setFirstLoad] = useState(true);

  useEffect(() => {
    // 首次加载完成后，设置标记
    if (!firstLoad) return;
    
    const timer = setTimeout(() => {
      setFirstLoad(false);
      localStorage.setItem('hasVisited', 'true');
    }, 3000);

    return () => clearTimeout(timer);
  }, []);

  return (
    <>
      {firstLoad && <VideoLogoLoader text="欢迎使用 513 仓库系统" />}
      <MainContent />
    </>
  );
}
```

### 场景2：数据加载中

```tsx
function InventoryPage() {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);

  const refreshData = async () => {
    setLoading(true);
    const data = await fetchItems();
    setItems(data);
    setLoading(false);
  };

  return (
    <>
      {loading && <VideoLogoLoader text="刷新数据中" minDuration={1000} />}
      <ItemList items={items} onRefresh={refreshData} />
    </>
  );
}
```

### 场景3：无文字纯动画

```tsx
<VideoLogoLoader text="" minDuration={2500} />
```

---

## 🛠️ 故障排查

### 问题1：视频不播放

**原因**：视频文件路径错误或格式不支持

**解决**：
```bash
# 检查文件是否存在
ls public/assets/logo-animation.mp4

# 确保视频格式正确
ffmpeg -i public/assets/logo-animation.mp4
```

### 问题2：iOS Safari 不自动播放

**原因**：需要 `playsInline` 和 `muted` 属性

**解决**：组件已包含这些属性，确保视频无音轨

### 问题3：视频文件太大，加载慢

**解决**：
1. 压缩视频到 < 2MB
2. 使用 WebM 格式（更小）
3. 添加预加载器：

```tsx
// 在 index.html 中预加载
<link rel="preload" href="/assets/logo-animation.mp4" as="video" type="video/mp4">
```

### 问题4：视频模糊

**解决**：确保生成时分辨率是 1080x1080，不要低于 720x720

---

## 📱 移动端优化

### 响应式尺寸

组件已自动适配：
- 桌面：280x280px
- 平板：200x200px
- 手机：160x160px

### 性能优化

```tsx
// 预加载视频
useEffect(() => {
  const video = document.createElement('video');
  video.src = '/assets/logo-animation.mp4';
  video.load();
}, []);
```

---

## 🎨 自定义样式

修改 `VideoLogoLoader.css`：

```css
/* 改变背景渐变 */
.video-logo-loader {
  background: linear-gradient(135deg, #yourColor1 0%, #yourColor2 100%);
}

/* 改变视频大小 */
.logo-video {
  width: 320px;  /* 自定义尺寸 */
  height: 320px;
}

/* 隐藏进度条 */
.loader-progress {
  display: none;
}
```

---

## ✅ 完成检查清单

- [ ] 在 AI 平台生成院徽动画视频
- [ ] 下载并压缩视频到 < 2MB
- [ ] 将视频放到 `public/assets/logo-animation.mp4`
- [ ] 在 App 中导入 `VideoLogoLoader` 组件
- [ ] 测试加载动画效果
- [ ] 检查移动端显示效果
- [ ] 优化加载时长 `minDuration`

---

## 🆘 需要帮助？

如果遇到问题：
1. 检查视频文件路径是否正确
2. 查看浏览器控制台是否有错误
3. 确认视频格式是 MP4 (H.264)
4. 测试视频是否能在浏览器直接播放

---

## 下一步

1. ✅ 生成视频 → 用上面的 Prompt
2. ✅ 集成组件 → 文件已创建
3. ⏸️ 继续 Supabase 配置 → 数据库还没完成

**你现在要先去生成视频，还是继续配置 Supabase？**
