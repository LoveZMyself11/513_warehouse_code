import React, { useEffect, useState } from 'react';
import './VideoLogoLoader.css';

interface VideoLogoLoaderProps {
  videoUrl?: string;
  text?: string;
  onLoadComplete?: () => void;
  minDuration?: number; // 最小显示时长（毫秒）
}

const VideoLogoLoader: React.FC<VideoLogoLoaderProps> = ({
  videoUrl = '/assets/logo-animation.mp4',
  text = '加载中...',
  onLoadComplete,
  minDuration = 2000
}) => {
  const [isVideoLoaded, setIsVideoLoaded] = useState(false);
  const [shouldHide, setShouldHide] = useState(false);

  useEffect(() => {
    // 确保至少显示 minDuration 时间
    const timer = setTimeout(() => {
      if (isVideoLoaded && onLoadComplete) {
        setShouldHide(true);
        setTimeout(() => onLoadComplete(), 300); // 淡出动画时间
      }
    }, minDuration);

    return () => clearTimeout(timer);
  }, [isVideoLoaded, minDuration, onLoadComplete]);

  const handleVideoLoaded = () => {
    setIsVideoLoaded(true);
  };

  return (
    <div className={`video-logo-loader ${shouldHide ? 'fade-out' : ''}`}>
      <div className="video-logo-content">
        {/* 视频播放器 */}
        <video
          className="logo-video"
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          onLoadedData={handleVideoLoaded}
        >
          <source src={videoUrl} type="video/mp4" />
          {/* 降级方案：如果视频加载失败，显示静态图 */}
          <img
            src="/assets/logo-static.png"
            alt="院徽"
            className="logo-fallback"
          />
        </video>

        {/* 加载文字 */}
        {text && (
          <div className="video-loader-text">
            {text}
            <span className="video-loader-dots">
              <span>.</span>
              <span>.</span>
              <span>.</span>
            </span>
          </div>
        )}

        {/* 加载进度指示器（可选） */}
        <div className="loader-progress">
          <div className="progress-bar"></div>
        </div>
      </div>
    </div>
  );
};

export default VideoLogoLoader;
