import React, { useEffect, useRef } from 'react';
import './VideoLoader.css';

interface VideoLoaderProps {
  videoSrc: string; // 视频文件路径
  text?: string;
  loop?: boolean; // 是否循环播放
  onVideoEnd?: () => void; // 视频播放完成回调
}

const VideoLoader: React.FC<VideoLoaderProps> = ({
  videoSrc,
  text = '加载中...',
  loop = true,
  onVideoEnd
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // 视频加载完成后自动播放
    video.load();

    const handleCanPlay = () => {
      video.play().catch(err => {
        console.warn('视频自动播放失败:', err);
      });
    };

    const handleEnded = () => {
      if (onVideoEnd) {
        onVideoEnd();
      }
    };

    video.addEventListener('canplay', handleCanPlay);
    video.addEventListener('ended', handleEnded);

    return () => {
      video.removeEventListener('canplay', handleCanPlay);
      video.removeEventListener('ended', handleEnded);
    };
  }, [videoSrc, onVideoEnd]);

  return (
    <div className="video-loader-container">
      <div className="video-loader-content">
        {/* 视频播放器 */}
        <div className="video-loader-wrapper">
          <video
            ref={videoRef}
            className="video-loader-video"
            muted
            playsInline
            loop={loop}
            preload="auto"
          >
            <source src={videoSrc} type="video/mp4" />
            <source src={videoSrc.replace('.mp4', '.webm')} type="video/webm" />
            您的浏览器不支持视频播放
          </video>
        </div>

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
      </div>
    </div>
  );
};

export default VideoLoader;
