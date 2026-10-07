import React, { useState, useEffect } from 'react';
import LogoLoader from './components/LogoLoader';
import './App.css';

function App() {
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // 模拟加载时间（2秒后隐藏加载动画）
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 2000);

    return () => clearTimeout(timer);
  }, []);

  return (
    <>
      {/* 加载动画 */}
      {isLoading && <LogoLoader text="正在加载" />}

      {/* 主要内容 */}
      <div className={`main-content ${isLoading ? 'hidden' : 'visible'}`}>
        <div className="app-container">
          <h1>513 仓库管理系统</h1>
          <p>院徽加载动画演示</p>

          <button
            onClick={() => setIsLoading(true)}
            className="demo-button"
          >
            重新播放加载动画
          </button>
        </div>
      </div>
    </>
  );
}

export default App;
