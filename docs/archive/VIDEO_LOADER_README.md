# 视频加载动画组件使用说明

## 📁 文件结构

```
src/
└── components/
    ├── VideoLoader.tsx      # 视频加载组件
    └── VideoLoader.css      # 组件样式
```

## 🎬 使用步骤

### 1️⃣ 准备视频文件

将你制作的院徽动画视频放到项目中：

```
public/
└── assets/
    └── logo-animation.mp4   # 你的院徽动画视频
```

**推荐视频格式：**
- **格式**: MP4 (H.264) 或 WebM
- **分辨率**: 800x800px 或 1000x1000px（正方形）
- **时长**: 2-4秒
- **大小**: 尽量 < 2MB（移动端加载考虑）
- **帧率**: 30fps 或 60fps
- **背景**: 透明背景或白色背景

### 2️⃣ 使用组件

```tsx
import VideoLoader from './components/VideoLoader';

function App() {
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // 模拟数据加载
    setTimeout(() => {
      setIsLoading(false);
    }, 3000);
  }, []);

  return (
    <>
      {isLoading && (
        <VideoLoader 
          videoSrc="/assets/logo-animation.mp4"
          text="正在加载"
        />
      )}
      <YourMainContent />
    </>
  );
}
```

## ⚙️ 组件属性

```tsx
interface VideoLoaderProps {
  videoSrc: string;           // 视频文件路径（必填）
  text?: string;              // 加载文字，默认 "加载中..."
  loop?: boolean;             // 是否循环播放，默认 true
  onVideoEnd?: () => void;    // 视频播放完成回调
}
```

## 📖 使用示例

### 示例1：基础循环加载

```tsx
<VideoLoader 
  videoSrc="/assets/logo-animation.mp4"
  text="正在加载"
/>
```

### 示例2：播放一次后自动跳转

```tsx
<VideoLoader 
  videoSrc="/assets/logo-animation.mp4"
  text="欢迎使用"
  loop={false}
  onVideoEnd={() => {
    setIsLoading(false); // 视频结束后隐藏加载页
  }}
/>
```

### 示例3：无文字纯视频

```tsx
<VideoLoader 
  videoSrc="/assets/logo-animation.mp4"
  text=""
/>
```

### 示例4：结合数据加载

```tsx
function WarehouseApp() {
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    // 加载数据
    loadInventoryData()
      .then(() => {
        setLoading(false);
      })
      .catch(err => {
        console.error('加载失败:', err);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <VideoLoader 
        videoSrc="/assets/logo-animation.mp4"
        text="加载仓库数据"
      />
    );
  }

  return <InventoryManagement />;
}
```

## 🎨 视频制作建议

### 给视频生成 AI 的 Prompt（中文）

```
创建一个大学院徽的动画视频，要求：

1. 院徽元素逐步出现，类似苹果开机动画的风格
2. 背景：纯白色或透明
3. 动画风格：
   - 线条从无到有勾勒出院徽轮廓
   - 或者元素逐个淡入组合
   - 或者从中心扩散展开
4. 颜色：使用蓝色（#0066CC）和白色
5. 时长：3-4秒
6. 最后1秒保持完整院徽静止
7. 分辨率：1000x1000像素，正方形
8. 风格：简洁、现代、专业

院徽包含：双层圆环、中心D字母、装饰线条、中英文文字。
```

### 视频压缩工具

如果视频太大，可以用这些工具压缩：
- **在线工具**: https://www.freeconvert.com/video-compressor
- **命令行 (ffmpeg)**:
```bash
ffmpeg -i input.mp4 -vcodec h264 -crf 28 -preset slow output.mp4
```

## 📱 性能优化

### 1. 预加载视频
```tsx
useEffect(() => {
  const video = document.createElement('video');
  video.src = '/assets/logo-animation.mp4';
  video.load(); // 提前加载
}, []);
```

### 2. 提供多种格式
```
public/assets/
├── logo-animation.mp4    # 主要格式
└── logo-animation.webm   # 备用格式（更小）
```

组件会自动尝试加载两种格式。

### 3. 使用占位图
视频加载慢时可以先显示静态图：
```tsx
<VideoLoader 
  videoSrc="/assets/logo-animation.mp4"
  text="正在加载"
  poster="/assets/logo-static.png"  // 视频封面
/>
```

## 🔧 自定义样式

### 修改视频大小
在 `VideoLoader.css` 中：
```css
.video-loader-wrapper {
  max-width: 300px;  /* 改为你想要的尺寸 */
}
```

### 修改背景颜色
```css
.video-loader-container {
  background: #ffffff;  /* 纯白背景 */
  /* 或者 */
  background: linear-gradient(135deg, #your-color1, #your-color2);
}
```

### 添加动画效果
可以给视频容器添加额外动画：
```css
.video-loader-wrapper {
  animation: fadeInScale 0.6s ease-out;
}

@keyframes fadeInScale {
  from {
    opacity: 0;
    transform: scale(0.8);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
```

## 🚨 常见问题

### Q: 视频不自动播放？
A: 现代浏览器限制自动播放，确保：
- 视频设置了 `muted` 属性
- 使用 `playsInline` 属性（移动端）

### Q: 视频在 iOS 上显示异常？
A: 添加这些属性：
```tsx
<video
  playsInline
  webkit-playsinline
  muted
/>
```

### Q: 视频文件太大？
A: 
1. 压缩视频（降低分辨率或码率）
2. 使用 WebM 格式（通常更小）
3. 或改用 Lottie 动画（JSON格式，体积更小）

## 🎯 下一步

1. **制作视频**: 使用 AI 工具或视频编辑软件
2. **测试效果**: 把视频放到 `public/assets/` 测试
3. **优化性能**: 压缩视频大小
4. **集成项目**: 在需要的地方使用组件

需要帮助吗？告诉我！
