# 院徽加载动画组件使用说明

## 📁 已创建的文件

```
src/
├── components/
│   ├── LogoLoader.tsx      # 加载动画组件
│   └── LogoLoader.css      # 动画样式
└── AppDemo.tsx             # 使用示例
```

## 🎨 动画效果

1. **描边绘制动画**：院徽的圆环和D字母依次被描绘出来
2. **悬浮动画**：整体轻微上下浮动
3. **脉冲效果**：中心点有呼吸灯效果
4. **加载文字**：带跳动的"..."动画

## 🚀 使用方法

### 方法1：作为全屏加载页面

```tsx
import LogoLoader from './components/LogoLoader';

function App() {
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // 模拟数据加载
    fetchData().then(() => {
      setIsLoading(false);
    });
  }, []);

  return (
    <>
      {isLoading && <LogoLoader text="正在加载" />}
      <YourMainContent />
    </>
  );
}
```

### 方法2：作为局部加载指示器

```tsx
<div style={{ position: 'relative', minHeight: '400px' }}>
  {isLoading && <LogoLoader size={80} text="加载中" />}
</div>
```

## ⚙️ 组件属性

```tsx
interface LogoLoaderProps {
  size?: number;    // 院徽大小，默认 120px
  text?: string;    // 加载文字，默认 "加载中..."
}
```

### 使用示例

```tsx
// 默认样式
<LogoLoader />

// 自定义大小
<LogoLoader size={100} />

// 自定义文字
<LogoLoader text="数据加载中" />

// 无文字
<LogoLoader text="" />

// 大号加载器
<LogoLoader size={160} text="正在初始化" />
```

## 🎭 测试动画

我创建了一个演示文件 `AppDemo.tsx`，运行查看效果：

```bash
# 临时替换 App.tsx 测试
mv src/App.tsx src/App.backup.tsx
mv src/AppDemo.tsx src/App.tsx

# 启动开发服务器
npm run dev

# 测试完成后恢复
mv src/App.backup.tsx src/App.tsx
```

## 🎨 自定义样式

### 修改颜色

在 `LogoLoader.css` 中修改：

```css
/* 主色调 */
stroke="#0066CC"  → 改为你想要的颜色

/* 背景渐变 */
background: linear-gradient(135deg, #f5f7fa 0%, #e8f4ff 100%);
```

### 修改动画速度

```css
/* 描边速度 */
animation: drawPath 2s ... → 改为 1.5s 更快，3s 更慢

/* 悬浮速度 */
animation: logoFloat 3s ... → 调整悬浮周期
```

### 修改动画效果类型

可以改成其他效果：

1. **旋转效果**：
```css
.logo-loader-svg {
  animation: rotate 2s linear infinite;
}

@keyframes rotate {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
```

2. **脉冲缩放**：
```css
.logo-loader-svg {
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.1); }
}
```

## 📱 移动端适配

已自动适配：
- 响应式SVG，任意屏幕不变形
- 文字大小在小屏幕自动缩小
- 支持暗色模式

## 🔧 集成到现有项目

在你的仓库管理系统中使用：

```tsx
// 在 App.tsx 顶部导入
import LogoLoader from './components/LogoLoader';

// 在数据加载时显示
function WarehouseApp() {
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    // 加载物品数据
    loadInventoryData().then(() => {
      setLoading(false);
    });
  }, []);

  if (loading) {
    return <LogoLoader text="加载仓库数据" />;
  }

  return <InventoryManagement />;
}
```

## 🎯 下一步

你可以：
1. **测试动画效果**：运行 AppDemo.tsx 查看
2. **调整参数**：修改颜色、速度、大小
3. **集成到项目**：在需要的地方使用 `<LogoLoader />`
4. **优化院徽**：如果需要更精确的院徽SVG路径，可以从你的图片提取

需要我帮你做什么调整吗？比如：
- 改变动画风格（旋转/缩放/其他）
- 提取更精确的院徽SVG路径
- 添加进度条功能
- 其他自定义需求
